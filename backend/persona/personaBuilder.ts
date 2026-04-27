// Pet AI Persona — write path (W1..W7).
//
// Runs asynchronously after a video session reaches status='ready'. A failure
// here writes personaError on the session but never undoes the session result.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config as appConfig } from '../config.ts';
import {
  cosineSimilarity,
  embedTexts,
  getMemoryCount,
  getPriors,
  getRelations,
  getTraits,
  invalidateMemoryCache,
  listMemoriesForPet,
  patchMemory,
  randomId,
  setTraits,
  shouldEnforceMemoryCap,
  upsertRelation,
  writeMemoriesBatch,
  writeMemory,
  writeSnapshot,
  growthStageFromCounts,
} from './memoryStore.ts';
import { resolvePet } from './petIdentity.ts';
import { buildMemoryExtractionPrompt } from './personaPrompts.ts';
import type {
  GrowthStage,
  Pet,
  PetMemory,
  PetMemorySource,
  PetRelationEdge,
  PetTraitScores,
  PetTraits,
  PersonaSnapshot,
  RelationshipStatus,
} from './personaTypes.ts';
import { updatePet } from './memoryStore.ts';

// ----- Tunables -----

const DEDUPE_THRESHOLD = Number(process.env.PERSONA_DEDUPE_THRESHOLD || 0.95); // start at 0.95 per consensus
const MEMORIES_PER_SESSION_MIN = 5;
const MEMORIES_PER_SESSION_MAX = 25;
const MAX_SESSION_TRAIT_DELTA = 5;
const TRAIT_EVIDENCE_FLOOR_THIS_SESSION = 2;
const TRAIT_EVIDENCE_FLOOR_TOTAL = 5;
const SAFETY_BRAVERY_DELTA = -3; // safety/milestone allowed to bypass evidence floor in caution direction

// ----- Public entrypoint -----

export interface PersonaBuildArgs {
  sessionId: string;
  visitorId: string;
  petName: string;
  species?: 'cat' | 'dog' | 'other';
  breed?: string;
  analysis: any;
  durationSeconds?: number;
  videoUrl?: string;
  coverUrl?: string;
}

export interface PersonaBuildResult {
  petId: string;
  petCreated: boolean;
  memoriesCreated: number;
  memoriesMerged: number;
  growthStage: GrowthStage;
  traitDeltas: Record<keyof PetTraitScores, DeltaPair>;
  newRelations: string[];
  updateCard: PersonaUpdateCard;
}

export interface PersonaUpdateCard {
  petName: string;
  petId: string;
  lines: string[];
  newFriends: string[];
  notableMemoryIds: string[];
  growthStage: GrowthStage;
}

export async function runPersonaBuilder(args: PersonaBuildArgs): Promise<PersonaBuildResult> {
  const startTs = Date.now();
  if (!args.analysis) throw new Error('persona builder: missing analysis');
  if (!args.petName) throw new Error('persona builder: missing petName');
  if (!args.visitorId) throw new Error('persona builder: missing visitorId');

  // W1 — pet resolution (creates pets_index entry transactionally)
  const inferredBreed = pickPetSelfBreed(args.analysis, args.breed);
  const { pet, created } = await resolvePet({
    visitorId: args.visitorId,
    petName: args.petName,
    species: args.species,
    breed: inferredBreed,
  });

  // W2 — memory extraction via Gemini Flash
  const existingMemories = await listMemoriesForPet(pet.id);
  const existingDigest = digestMemoriesForExtraction(existingMemories);

  const extractionPrompt = buildMemoryExtractionPrompt({
    pet: { name: pet.name, species: pet.species, breed: pet.breed },
    sessionId: args.sessionId,
    analysis: args.analysis,
    existingMemoryDigest: existingDigest,
  });

  const candidateMemories = await extractMemoriesFromLLM(extractionPrompt);

  // Lint: importance >= 7 must have timestamp; if not, downgrade.
  const lintedCandidates = candidateMemories
    .filter((c) => typeof c.text === 'string' && c.text.trim().length > 0)
    .map((c) => {
      const hasTimestamp = typeof c.timestamp === 'string' && /^\d{1,2}:\d{2}/.test(c.timestamp);
      let importance = clamp(Number(c.importance) || 4, 1, 10);
      if (importance >= 7 && !hasTimestamp) importance = 5;
      return { ...c, importance };
    });

  // Cap if we already at the per-pet limit
  const currentCount = await getMemoryCount(pet.id);
  let effectiveCandidates = lintedCandidates;
  if (shouldEnforceMemoryCap(currentCount + lintedCandidates.length)) {
    const room = Math.max(0, (Number(process.env.PERSONA_MEMORY_CAP_PER_PET || 500)) - currentCount);
    effectiveCandidates = lintedCandidates
      .sort((a, b) => (b.importance - a.importance))
      .slice(0, room);
  }

  // W3 — embed candidate texts
  const embeddings = await embedTexts(effectiveCandidates.map((c) => c.text));

  // W4 — dedupe vs existing memories
  const newMemories: PetMemory[] = [];
  let mergedCount = 0;
  const sessionSource: PetMemorySource = {
    sessionId: args.sessionId,
    videoUrl: args.videoUrl,
    coverUrl: args.coverUrl,
  };

  for (let i = 0; i < effectiveCandidates.length; i++) {
    const c = effectiveCandidates[i];
    const emb = embeddings[i];
    const dup = findDuplicate(emb, existingMemories);
    if (dup) {
      // strengthen existing
      const newStrength = (dup.strength || 1) + 1;
      const newImp = Math.max(dup.importance, c.importance);
      await patchMemory(dup.id, {
        petId: dup.petId,
        strength: newStrength,
        importance: newImp,
        importanceCurrent: Math.max(dup.importanceCurrent || 0, newImp),
        lastAccessedAt: Date.now(),
        relatedMemoryIds: Array.from(new Set([...(dup.relatedMemoryIds || []), args.sessionId])),
      });
      mergedCount++;
      continue;
    }
    const memId = `mem-${randomId(14)}`;
    const importance = c.importance;
    const memory: PetMemory = {
      id: memId,
      petId: pet.id,
      ownerKey: pet.ownerKey,
      type: c.type as any,
      text: c.text,
      importance,
      importanceCurrent: importance,
      decayBaseline: importance,
      confidence: clamp(Number(c.confidence) || 70, 0, 100),
      emotion: c.emotion,
      embedding: emb,
      strength: 1,
      source: {
        ...sessionSource,
        timestamp: c.timestamp,
      },
      relatedPetIds: c.relatedPetName ? [normalizeFriendName(c.relatedPetName)] : undefined,
      lastAccessedAt: Date.now(),
      accessCount: 0,
      createdAt: Date.now(),
    };
    newMemories.push(memory);
  }

  if (newMemories.length > 0) {
    await writeMemoriesBatch(newMemories);
  }
  invalidateMemoryCache(pet.id);

  // W5 — trait update (deterministic)
  const traitsBefore = (await getTraits(pet.id)) || initialTraits(pet.id);
  const traitDeltas = computeTraitDeltas(args.analysis, traitsBefore);
  const traitsAfter = applyTraitDeltas(traitsBefore, traitDeltas, newMemories);
  await setTraits(traitsAfter);

  // Likes / dislikes deterministic patch
  const updatedTraits = applyDeterministicLikesDislikes(traitsAfter, args.analysis, newMemories);
  if (updatedTraits !== traitsAfter) await setTraits(updatedTraits);

  // W6 — relation update
  const newRelations: string[] = [];
  if (Array.isArray(args.analysis?.friends)) {
    const existingEdges = await getRelations(pet.id);
    for (const friend of args.analysis.friends) {
      const edge = upsertFriendEdge(pet, friend, existingEdges, newMemories, args.sessionId);
      if (edge) {
        await upsertRelation(pet.id, edge);
        if (!existingEdges.some((e) => e.otherKey === edge.otherKey)) {
          newRelations.push(edge.displayName);
        }
      }
    }
  }

  // Pet updates
  const totalSeconds = (pet.totalWatchSeconds || 0) + (args.durationSeconds || 0);
  const memoriesAfterAll = currentCount + newMemories.length;
  const newLevel = computeLevel((pet.videoCount || 0) + 1, memoriesAfterAll);
  await updatePet(pet.id, {
    videoCount: (pet.videoCount || 0) + 1,
    totalWatchSeconds: totalSeconds,
    level: newLevel,
  });

  // Growth stage
  const stage = growthStageFromCounts((pet.videoCount || 0) + 1, memoriesAfterAll);

  // Snapshot (only one per session — keeps retention simple)
  const snapshotId = `snap-${args.sessionId}`;
  const snapshot: PersonaSnapshot = {
    id: snapshotId,
    petId: pet.id,
    snapshotAt: Date.now(),
    traits: updatedTraits,
    voicePersona: pet.voicePersona,
    level: newLevel,
    growthStage: stage,
    summary: buildSnapshotSummary(pet, updatedTraits, newRelations),
    highlightMemoryIds: newMemories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5)
      .map((m) => m.id),
  };
  await writeSnapshot(snapshot);

  const updateCard = buildUpdateCard(pet, traitDeltas, newRelations, newMemories, stage);

  console.log(
    `[Persona] Session ${args.sessionId} → pet=${pet.id} (${pet.name}) ` +
      `created=${created} memories=+${newMemories.length} merged=${mergedCount} stage=${stage} ` +
      `elapsed=${((Date.now() - startTs) / 1000).toFixed(1)}s`
  );

  return {
    petId: pet.id,
    petCreated: created,
    memoriesCreated: newMemories.length,
    memoriesMerged: mergedCount,
    growthStage: stage,
    traitDeltas,
    newRelations,
    updateCard,
  };
}

// ---------------- Memory extraction (W2) ----------------

interface CandidateMemory {
  type: string;
  text: string;
  timestamp?: string;
  importance: number;
  confidence?: number;
  emotion?: string;
  relatedPetName?: string;
  subject?: string;
}

let genAi: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  if (!appConfig.geminiApiKey) return null;
  if (!genAi) genAi = new GoogleGenerativeAI(appConfig.geminiApiKey);
  return genAi;
}

const EXTRACTION_MODEL = process.env.PERSONA_EXTRACT_MODEL || process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.1-pro-preview';

async function extractMemoriesFromLLM(prompt: string): Promise<CandidateMemory[]> {
  const ai = getGenAI();
  if (!ai) {
    console.warn('[Persona] Gemini key missing; skipping LLM extraction');
    return [];
  }
  try {
    const model = ai.getGenerativeModel({ model: EXTRACTION_MODEL });
    const result = await model.generateContent([prompt]);
    const text = result.response.text();
    const json = extractFirstJsonObject(text);
    if (!json) return [];
    const parsed = JSON.parse(json);
    const items: CandidateMemory[] = Array.isArray(parsed?.memories) ? parsed.memories : [];
    return items.slice(0, MEMORIES_PER_SESSION_MAX);
  } catch (e) {
    console.warn('[Persona] memory extraction failed:', (e as Error).message);
    return [];
  }
}

function extractFirstJsonObject(text: string): string | null {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function digestMemoriesForExtraction(memories: PetMemory[]): string {
  if (memories.length === 0) return '';
  return memories
    .filter((m) => !m.archived)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
    .map((m) => `- (${m.type}, imp=${m.importance}) "${m.text}"`)
    .join('\n');
}

// ---------------- Dedupe (W4) ----------------

function findDuplicate(
  embedding: number[] | undefined,
  existing: PetMemory[]
): PetMemory | null {
  if (!embedding) return null;
  let best: { mem: PetMemory; sim: number } | null = null;
  for (const m of existing) {
    if (m.archived) continue;
    if (!m.embedding) continue;
    const sim = cosineSimilarity(embedding, m.embedding);
    if (sim >= DEDUPE_THRESHOLD && (!best || sim > best.sim)) {
      best = { mem: m, sim };
    }
  }
  return best?.mem || null;
}

// ---------------- Trait update (W5) ----------------

function initialTraits(petId: string): PetTraits {
  return {
    petId,
    scores: { curiosity: 50, sociability: 50, bravery: 50, affection: 50, energy: 50 },
    evidence: { curiosity: 0, sociability: 0, bravery: 0, affection: 0, energy: 0 },
    scoreReasons: { curiosity: [], sociability: [], bravery: [], affection: [], energy: [] },
    likes: [],
    dislikes: [],
    catchphrases: [],
    routines: [],
    updatedAt: Date.now(),
  };
}

interface DeltaPair {
  delta: number;
  events: number;
  // Whether at least one event was a safety/milestone signal that bypasses the evidence floor
  // toward caution. Bravery is the only field that benefits.
  hasSafetyEvent?: boolean;
}

function computeTraitDeltas(analysis: any, traits: PetTraits): Record<keyof PetTraitScores, DeltaPair> {
  const acc: Record<keyof PetTraitScores, DeltaPair> = {
    curiosity: { delta: 0, events: 0 },
    sociability: { delta: 0, events: 0 },
    bravery: { delta: 0, events: 0, hasSafetyEvent: false },
    affection: { delta: 0, events: 0 },
    energy: { delta: 0, events: 0 },
  };

  if (Array.isArray(analysis?.friends)) {
    for (const f of analysis.friends) {
      acc.sociability.delta += f.relationshipStatus === 'Bestie' || f.relationshipStatus === 'Soulmate' ? 2 : 1;
      acc.sociability.events++;
      if (f.relationshipStatus === 'Bestie' || f.relationshipStatus === 'Soulmate') {
        acc.affection.delta += 1;
        acc.affection.events++;
      }
    }
  }

  if (Array.isArray(analysis?.scenery)) {
    for (const s of analysis.scenery) {
      const dur = Number(s.stayDuration) || 0;
      if (dur >= 5) {
        acc.curiosity.delta += 1;
        acc.curiosity.events++;
      }
    }
  }

  if (Array.isArray(analysis?.safetyAlerts)) {
    for (const a of analysis.safetyAlerts) {
      if (a.type === 'danger') {
        acc.bravery.delta += SAFETY_BRAVERY_DELTA; // toward caution
        acc.bravery.events++;
        acc.bravery.hasSafetyEvent = true;
      } else if (a.type === 'warning') {
        acc.bravery.delta += -1;
        acc.bravery.events++;
        acc.bravery.hasSafetyEvent = true;
      }
    }
  }

  if (Array.isArray(analysis?.moodData)) {
    const values = analysis.moodData.map((p: any) => Number(p.value) || 0).filter((v: number) => Number.isFinite(v));
    if (values.length > 0) {
      const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
      if (avg > 60) {
        acc.affection.delta += 1;
        acc.affection.events++;
        acc.energy.delta += avg > 75 ? 2 : 1;
        acc.energy.events++;
      }
    }
  }

  if (Array.isArray(analysis?.timeline)) {
    let runEvents = 0;
    for (const e of analysis.timeline) {
      if (e?.icon === 'directions_run' || e?.icon === 'speed' || e?.icon === 'bolt') runEvents++;
    }
    if (runEvents >= 2) {
      acc.energy.delta += 1;
      acc.energy.events++;
    }
  }

  // Cap absolute delta per dim
  for (const k of Object.keys(acc) as Array<keyof PetTraitScores>) {
    const sign = Math.sign(acc[k].delta);
    acc[k].delta = sign * Math.min(Math.abs(acc[k].delta), MAX_SESSION_TRAIT_DELTA);
  }

  return acc;
}

function applyTraitDeltas(
  traits: PetTraits,
  deltas: Record<keyof PetTraitScores, DeltaPair>,
  newMemories: PetMemory[]
): PetTraits {
  const next: PetTraits = JSON.parse(JSON.stringify(traits));
  next.scoreReasons = next.scoreReasons || {};

  for (const k of Object.keys(deltas) as Array<keyof PetTraitScores>) {
    const pair = deltas[k];
    const totalEvidence = next.evidence?.[k] ?? 0;
    // Evidence floor; safety events that move bravery toward caution may bypass.
    const isSafetyCarveOut = k === 'bravery' && pair.hasSafetyEvent && pair.delta < 0;
    if (
      !isSafetyCarveOut &&
      pair.events < TRAIT_EVIDENCE_FLOOR_THIS_SESSION &&
      totalEvidence < TRAIT_EVIDENCE_FLOOR_TOTAL
    ) {
      continue;
    }
    if (pair.delta === 0) continue;
    const smoothed = pair.delta * (1 / (1 + totalEvidence / 20));
    const updated = clamp((next.scores[k] || 50) + smoothed, 0, 100);
    next.scores[k] = Math.round(updated);
    next.evidence[k] = (next.evidence[k] || 0) + pair.events;
    // Trait reason — attach IDs of new memories
    const ids = new Set(next.scoreReasons[k] || []);
    for (const m of newMemories.slice(0, 3)) ids.add(m.id);
    next.scoreReasons[k] = Array.from(ids).slice(0, 12);
  }
  next.updatedAt = Date.now();
  return next;
}

function applyDeterministicLikesDislikes(
  traits: PetTraits,
  analysis: any,
  newMemories: PetMemory[]
): PetTraits {
  let modified = false;
  const out: PetTraits = JSON.parse(JSON.stringify(traits));
  const now = Date.now();

  if (Array.isArray(analysis?.dietaryHabits)) {
    for (const d of analysis.dietaryHabits) {
      if (!d?.item) continue;
      const subject = String(d.item).toLowerCase();
      const existing = out.likes.find((l) => l.subject === subject);
      const sourceIds = newMemories.filter((m) => m.text.toLowerCase().includes(subject)).map((m) => m.id);
      if (existing) {
        existing.strength = (existing.strength || 1) + 1;
        existing.lastSeenAt = now;
        if (sourceIds.length) {
          existing.sourceMemoryIds = Array.from(new Set([...(existing.sourceMemoryIds || []), ...sourceIds]));
        }
      } else {
        out.likes.push({
          subject,
          strength: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          sourceMemoryIds: sourceIds,
        });
      }
      modified = true;
    }
  }

  if (Array.isArray(analysis?.safetyAlerts)) {
    for (const a of analysis.safetyAlerts) {
      const subject = extractDislikeSubject(a?.message);
      if (!subject) continue;
      const existing = out.dislikes.find((d) => d.subject === subject);
      const sourceIds = newMemories.filter((m) => m.type === 'safety').map((m) => m.id);
      if (existing) {
        existing.strength = (existing.strength || 1) + 1;
        existing.lastSeenAt = now;
        if (sourceIds.length) {
          existing.sourceMemoryIds = Array.from(new Set([...(existing.sourceMemoryIds || []), ...sourceIds]));
        }
      } else {
        out.dislikes.push({
          subject,
          strength: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          sourceMemoryIds: sourceIds,
        });
      }
      modified = true;
    }
  }

  return modified ? out : traits;
}

function extractDislikeSubject(message: string | undefined): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  // crude: take first noun-ish token after common verbs
  const m = lower.match(/(?:of|with|from|near|by)\s+([a-z][a-z\- ]{2,30})/);
  if (m && m[1]) return m[1].trim();
  return null;
}

// ---------------- Relations (W6) ----------------

function upsertFriendEdge(
  _pet: Pet,
  friend: any,
  existing: PetRelationEdge[],
  newMemories: PetMemory[],
  sessionId: string
): PetRelationEdge | null {
  if (!friend?.name) return null;
  const otherKey = computeFriendKey(friend.name, friend.type);
  const now = Date.now();
  const previous = existing.find((e) => e.otherKey === otherKey);

  const interactionSeconds = Number(friend.duration) || 0;
  const status = (friend.relationshipStatus || 'Acquaintance') as RelationshipStatus;
  const statusBonus = status === 'Bestie' ? 5 : status === 'Soulmate' ? 8 : status === 'Rival' ? -2 : 1;

  let bondScore: number;
  if (previous) {
    const days = Math.max(0, (now - (previous.lastInteractionAt || previous.lastSeenAt || now)) / 86_400_000);
    const decayedPrev = previous.bondScore * Math.pow(0.97, Math.min(days, 30));
    bondScore = clamp(decayedPrev + interactionSeconds * 0.5 + statusBonus, 0, 100);
  } else {
    bondScore = clamp(20 + interactionSeconds * 0.5 + statusBonus, 0, 100);
  }

  const notable = newMemories
    .filter((m) => m.relatedPetIds?.includes(normalizeFriendName(friend.name)))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((m) => m.id);

  const edge: PetRelationEdge = {
    otherKey,
    displayName: String(friend.name),
    type: 'friend_pet',
    status,
    bondScore,
    lastInteractionAt: now,
    encounterCount: (previous?.encounterCount || 0) + 1,
    totalInteractionSeconds: (previous?.totalInteractionSeconds || 0) + interactionSeconds,
    lastSeenAt: now,
    firstSeenAt: previous?.firstSeenAt || now,
    notableMemoryIds: previous
      ? Array.from(new Set([...(previous.notableMemoryIds || []), ...notable])).slice(0, 5)
      : notable,
  };
  // session marker for traceability of this update
  void sessionId;
  return edge;
}

export function computeFriendKey(name: string, breed?: string): string {
  const norm = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  const b = String(breed || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm}|${b}`;
}

export function normalizeFriendName(name: string): string {
  return String(name).trim().toLowerCase();
}

// ---------------- Misc ----------------

function pickPetSelfBreed(analysis: any, fallback?: string): string | undefined {
  // POV videos rarely show the wearer; the analysis breed describes friends, not the pet.
  // We only honor an explicit fallback (e.g., user-supplied breed during pet creation).
  return fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeLevel(videoCount: number, memoriesAfter: number): number {
  const lvl = Math.floor(Math.log2(Math.max(1, videoCount + 1)) + memoriesAfter / 30);
  return clamp(lvl, 0, 10);
}

function buildSnapshotSummary(pet: Pet, traits: PetTraits, newRelations: string[]): string {
  const top = (Object.entries(traits.scores) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v}`);
  const friends = newRelations.length ? `, met ${newRelations.join(', ')}` : '';
  return `${pet.name}: ${top.join(' · ')}${friends}`;
}

function buildUpdateCard(
  pet: Pet,
  deltas: Record<keyof PetTraitScores, DeltaPair>,
  newRelations: string[],
  newMemories: PetMemory[],
  stage: GrowthStage
): PersonaUpdateCard {
  const lines: string[] = [];

  const milestones = newMemories.filter((m) => m.type === 'milestone' || m.type === 'safety');
  if (milestones[0]) {
    lines.push(`I’ll remember: ${milestones[0].text}`);
  }

  for (const friend of newRelations.slice(0, 2)) {
    lines.push(`I made a new friend: ${friend}.`);
  }

  for (const k of Object.keys(deltas) as Array<keyof PetTraitScores>) {
    const d = deltas[k];
    if (!d.delta) continue;
    if (Math.abs(d.delta) < 1) continue;
    if (d.delta > 0) lines.push(`A little more ${k} grew in me today.`);
    else if (k === 'bravery') lines.push('I’m a bit more cautious after today.');
  }

  if (lines.length === 0 && newMemories.length > 0) {
    lines.push('I came home with a quiet new memory today.');
  }

  return {
    petId: pet.id,
    petName: pet.name,
    lines: lines.slice(0, 3),
    newFriends: newRelations,
    notableMemoryIds: newMemories.slice(0, 3).map((m) => m.id),
    growthStage: stage,
  };
}

// ---------------- Async job runner ----------------

interface PendingJob {
  args: PersonaBuildArgs;
  onComplete?: (r: PersonaBuildResult) => void;
  onError?: (err: Error) => void;
}

const JOB_QUEUE: PendingJob[] = [];
let queueRunning = false;

export function queuePersonaJob(
  args: PersonaBuildArgs,
  onComplete?: (r: PersonaBuildResult) => void,
  onError?: (err: Error) => void
): void {
  JOB_QUEUE.push({ args, onComplete, onError });
  if (!queueRunning) void runQueue();
}

async function runQueue(): Promise<void> {
  queueRunning = true;
  try {
    while (JOB_QUEUE.length > 0) {
      const job = JOB_QUEUE.shift()!;
      try {
        const r = await runPersonaBuilder(job.args);
        job.onComplete?.(r);
      } catch (e) {
        console.error('[Persona] job failed', e);
        job.onError?.(e as Error);
      }
    }
  } finally {
    queueRunning = false;
  }
}
