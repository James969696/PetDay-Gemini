// Pet AI Persona — read path (R1..R6) + SSE streaming.

import type express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config as appConfig } from '../config.ts';
import {
  appendMessage,
  cosineSimilarity,
  embedTexts,
  getOrCreateThread,
  getPetById,
  getPriors,
  getRelations,
  getTraits,
  invalidateMemoryCache,
  listMemoriesForPet,
  listMessages,
  patchMemory,
  randomId,
  setTraits,
  writeMemory,
} from './memoryStore.ts';
import {
  buildChatMetadataPrompt,
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildUserFactExtractorPrompt,
} from './personaPrompts.ts';
import { buildKnownEntities, isReplyVibeOnly, validateCitations } from './citationValidator.ts';
import type {
  ChatMessage,
  ChatRequestPayload,
  ChatStreamMeta,
  CitationStatus,
  Pet,
  PetMemory,
} from './personaTypes.ts';

// ----- Tunables (env-configurable) -----

const W_COSINE = parsePositiveFloat(process.env.PERSONA_RETRIEVE_W_COSINE, 0.4);
const W_TYPE_MATCH = parsePositiveFloat(process.env.PERSONA_RETRIEVE_W_TYPE, 0.2);
const W_IMPORTANCE = parsePositiveFloat(process.env.PERSONA_RETRIEVE_W_IMP, 0.15);
const W_RECENCY = parsePositiveFloat(process.env.PERSONA_RETRIEVE_W_REC, 0.15);
const W_ENTITY_MATCH = parsePositiveFloat(process.env.PERSONA_RETRIEVE_W_ENTITY, 0.1);
const TOP_K = Number(process.env.PERSONA_RETRIEVE_TOP_K || 8);
const RECENT_CHAT_TURNS = 6;

const CHAT_MODEL = process.env.PERSONA_CHAT_MODEL || process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.1-pro-preview';

let genAi: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  if (!appConfig.geminiApiKey) return null;
  if (!genAi) genAi = new GoogleGenerativeAI(appConfig.geminiApiKey);
  return genAi;
}

// ---------------- SSE helpers ----------------

function setSseHeaders(res: express.Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // CORS already opened by app.use(cors()) — nothing else to do
}

function sseEvent(res: express.Response, event: string, data: unknown): void {
  const payload = JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${payload}\n\n`);
  // @ts-ignore — Express response exposes Node ServerResponse.flush via compress middleware; not always present
  if (typeof (res as any).flush === 'function') (res as any).flush();
}

// ---------------- Public entry ----------------

export interface ChatRequestContext {
  petId: string;
  visitorId: string;
  allowLocalDemoAccess?: boolean;
  payload: ChatRequestPayload;
}

export async function handleChatStream(
  ctx: ChatRequestContext,
  res: express.Response
): Promise<void> {
  setSseHeaders(res);
  // 15s heartbeat
  const ping: NodeJS.Timeout = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* socket dead */ }
  }, 15_000);
  res.on('close', () => clearInterval(ping));

  try {
    // R1 — speaker identity (MVP: always Owner)
    const speakerLabel = ctx.payload.speakerLabelHint?.trim() || 'Owner';

    // Load pet + traits + priors + relations
    const pet = await getPetById(ctx.petId);
    if (!pet) {
      sseEvent(res, 'error', { error: 'Pet not found' });
      res.end();
      return;
    }
    if (pet.ownerKey !== ctx.visitorId && !ctx.allowLocalDemoAccess) {
      sseEvent(res, 'error', { error: 'Forbidden' });
      res.end();
      return;
    }

    const [traits, priors, relations, memories, thread] = await Promise.all([
      getTraits(ctx.petId),
      getPriors(ctx.petId),
      getRelations(ctx.petId),
      listMemoriesForPet(ctx.petId),
      getOrCreateThread(ctx.petId, ctx.visitorId, ctx.payload.threadId),
    ]);
    const recentMessages = await listMessages(thread.id, RECENT_CHAT_TURNS);

    // Persist user message right away
    const userMessage: ChatMessage = {
      id: `msg-${randomId(12)}`,
      threadId: thread.id,
      petId: pet.id,
      ownerKey: pet.ownerKey,
      role: 'user',
      speakerLabel,
      text: ctx.payload.text,
      createdAt: Date.now(),
    };
    await appendMessage(userMessage);

    // R2 — intent (heuristic)
    const intent = classifyIntent(ctx.payload.text);

    // R3 — retrieval
    const queryEmbedding = await embedQueryText(ctx.payload.text);
    const knownEntities = buildKnownEntities(traits, relations);
    const candidates = scoreMemories({
      memories: memories.filter((m) => !m.archived && m.userVerdict !== 'wrong' && m.userVerdict !== 'private'),
      query: ctx.payload.text,
      queryEmbedding,
      intent,
      friendNames: knownEntities.friendNames,
    });
    const top = candidates.slice(0, TOP_K);

    // R4 — compose prompt
    const memoryItems = top.map((c) => ({
      id: c.memory.id,
      type: c.memory.type,
      text: c.memory.text,
      timestamp: c.memory.source?.timestamp,
      importance: c.memory.importance,
      confidence: c.memory.confidence,
    }));
    const recentChatHistory = recentMessages
      .filter((m) => m.role !== 'system')
      .slice(-RECENT_CHAT_TURNS)
      .map((m) => ({ role: m.role as 'user' | 'pet', text: m.text }));

    const systemPrompt = buildChatSystemPrompt({
      pet,
      traits,
      priors,
      topRelations: [...relations].sort((a, b) => b.bondScore - a.bondScore).slice(0, 3),
      speakerLabel,
      memories: memoryItems,
      recentChat: recentChatHistory,
      userMessage: ctx.payload.text,
    });
    const userPrompt = buildChatUserPrompt(ctx.payload.text);

    sseEvent(res, 'thread', { threadId: thread.id });

    // R5 Pass A — stream reply
    const ai = getGenAI();
    let reply = '';
    if (!ai) {
      reply = `*${pet.name} flicks an ear* I'm here, but my voice isn't tuned in right now.`;
      sseEvent(res, 'delta', { text: reply });
    } else {
      try {
        const model = ai.getGenerativeModel({
          model: CHAT_MODEL,
          systemInstruction: systemPrompt,
          generationConfig: { temperature: 0.7 },
        } as any);
        const stream = await model.generateContentStream([userPrompt]);
        for await (const chunk of stream.stream as any) {
          const text = typeof chunk?.text === 'function' ? chunk.text() : '';
          if (text) {
            reply += text;
            sseEvent(res, 'delta', { text });
          }
        }
      } catch (e) {
        console.warn('[Persona Chat] Pass A failed:', (e as Error).message);
        reply = pickSafeFallback(pet, intent);
        sseEvent(res, 'delta', { text: reply });
      }
    }

    // R5b — citation validation + soft rewrite
    const validator = validateCitations({
      reply,
      selfCitedMemoryIds: [], // model didn't self-cite in Pass A; we'll fold Pass B in if not vibe_only
      retrievalPool: top.map((c) => c.memory),
      knownEntities,
    });

    let finalReply = validator.reply;
    let citationStatus: CitationStatus = validator.citationStatus;
    let citedMemoryIds: string[] = validator.supportedCitedMemoryIds;
    let moodHint: string | undefined;
    let suggestedFollowups: string[] = [];

    // R5 Pass B — only when reply has specifics; else save the call.
    if (ai && !isReplyVibeOnly(finalReply)) {
      try {
        const passBPrompt = buildChatMetadataPrompt(
          finalReply,
          top.map((c) => c.memory.id)
        );
        const model = ai.getGenerativeModel({ model: CHAT_MODEL, generationConfig: { temperature: 0.2 } } as any);
        const result = await model.generateContent([passBPrompt]);
        const txt = result.response.text();
        const meta = parseJsonStrict(txt);
        if (meta) {
          if (Array.isArray(meta.citedMemoryIds)) {
            // intersect with retrieval pool
            const allowed = new Set(top.map((c) => c.memory.id));
            const reCheck = (meta.citedMemoryIds as string[]).filter((id) => allowed.has(id));
            citedMemoryIds = Array.from(new Set([...citedMemoryIds, ...reCheck]));
            // Re-run validator with these IDs to upgrade partial→verified if possible.
            const second = validateCitations({
              reply: finalReply,
              selfCitedMemoryIds: citedMemoryIds,
              retrievalPool: top.map((c) => c.memory),
              knownEntities,
            });
            // If validator soft-rewrote anything in Pass A, stay with Pass A's text.
            if (second.citationStatus === 'verified' && validator.rewrites.length === 0) {
              citationStatus = 'verified';
            } else if (second.citationStatus === 'partial' && validator.rewrites.length === 0) {
              citationStatus = 'partial';
            }
          }
          if (typeof meta.moodHint === 'string') moodHint = meta.moodHint;
          if (Array.isArray(meta.suggestedFollowups)) {
            suggestedFollowups = (meta.suggestedFollowups as string[])
              .filter((s) => typeof s === 'string')
              .slice(0, 3);
          }
        }
      } catch (e) {
        console.warn('[Persona Chat] Pass B failed:', (e as Error).message);
      }
    }

    // Persist pet message
    const petMessage: ChatMessage = {
      id: `msg-${randomId(12)}`,
      threadId: thread.id,
      petId: pet.id,
      ownerKey: pet.ownerKey,
      role: 'pet',
      text: finalReply,
      citedMemoryIds,
      citationStatus,
      moodHint,
      createdAt: Date.now(),
    };
    await appendMessage(petMessage);

    // Reinforce cited memories (partial recovery, not reset)
    for (const id of citedMemoryIds) {
      const m = top.find((c) => c.memory.id === id)?.memory;
      if (!m) continue;
      const baseline = m.decayBaseline || m.importance;
      const current = m.importanceCurrent ?? m.importance;
      const recovered = current + Math.min((baseline - current) * 0.3, baseline * 0.3);
      await patchMemory(m.id, {
        petId: m.petId,
        importanceCurrent: clamp(recovered, 0, 10),
        accessCount: (m.accessCount || 0) + 1,
        lastAccessedAt: Date.now(),
      });
    }

    // R6 — user_fact extraction (only when message looks declarative)
    if (ai && looksLikeUserFact(ctx.payload.text)) {
      try {
        const factsPrompt = buildUserFactExtractorPrompt(ctx.payload.text, pet.name);
        const model = ai.getGenerativeModel({ model: CHAT_MODEL, generationConfig: { temperature: 0 } } as any);
        const result = await model.generateContent([factsPrompt]);
        const txt = result.response.text();
        const parsed = parseJsonStrict(txt);
        const facts: any[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
        for (const f of facts.slice(0, 3)) {
          if (typeof f?.text !== 'string' || f.text.length < 4) continue;
          const importance = clamp(Number(f.importance) || 3, 1, 5);
          const newId = `mem-${randomId(14)}`;
          await writeMemory({
            id: newId,
            petId: pet.id,
            ownerKey: pet.ownerKey,
            type: 'user_fact',
            text: f.text,
            importance,
            importanceCurrent: importance,
            decayBaseline: importance,
            confidence: 60, // user_fact cap
            strength: 1,
            source: { chatThreadId: thread.id },
            lastAccessedAt: Date.now(),
            accessCount: 0,
            createdAt: Date.now(),
          });
        }
        if (facts.length > 0) invalidateMemoryCache(pet.id);
      } catch (e) {
        console.warn('[Persona Chat] user_fact extractor failed:', (e as Error).message);
      }
    }

    const meta: ChatStreamMeta = {
      citedMemoryIds,
      citationStatus,
      moodHint,
      suggestedFollowups,
      threadId: thread.id,
      messageId: petMessage.id,
    };
    sseEvent(res, 'meta', meta);
    sseEvent(res, 'done', {});
    res.end();
  } catch (e) {
    console.error('[Persona Chat] handler error', e);
    try {
      sseEvent(res, 'error', { error: (e as Error).message });
    } catch { /* socket already closed */ }
    try { res.end(); } catch { /* ignore */ }
  } finally {
    clearInterval(ping);
  }
}

// ---------------- Retrieval scoring ----------------

interface ScoredMemory {
  memory: PetMemory;
  score: number;
  cosScore: number;
  typeMatchScore: number;
  importanceScore: number;
  recencyScore: number;
  entityMatchScore: number;
}

interface ScoreInput {
  memories: PetMemory[];
  query: string;
  queryEmbedding?: number[];
  intent: Intent;
  friendNames: string[];
}

function scoreMemories(input: ScoreInput): ScoredMemory[] {
  const { memories, query, queryEmbedding, intent, friendNames } = input;
  if (memories.length === 0) return [];
  const queryLower = query.toLowerCase();
  const tokens = tokenize(queryLower);
  const now = Date.now();

  const out: ScoredMemory[] = [];
  for (const m of memories) {
    const cos = m.embedding && queryEmbedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
    const cosScore = clamp((cos + 1) / 2, 0, 1); // -1..1 -> 0..1

    const typeMatchScore = matchesIntent(m.type, intent) ? 1 : 0;
    const importanceScore = clamp((m.importanceCurrent ?? m.importance) / 10, 0, 1);

    const ageDays = Math.max(0, (now - (m.createdAt || now)) / 86_400_000);
    const recencyScore = clamp(1 - ageDays / 60, 0, 1);

    let entityMatchScore = 0;
    const lowerText = m.text.toLowerCase();
    for (const tok of tokens) {
      if (tok.length < 3) continue;
      if (lowerText.includes(tok)) entityMatchScore += 0.2;
    }
    for (const friend of friendNames) {
      if (queryLower.includes(friend.toLowerCase())) {
        if (m.relatedPetIds?.some((p) => p.toLowerCase() === friend.toLowerCase())) entityMatchScore += 0.6;
      }
    }
    entityMatchScore = clamp(entityMatchScore, 0, 1);

    const score =
      W_COSINE * cosScore +
      W_TYPE_MATCH * typeMatchScore +
      W_IMPORTANCE * importanceScore +
      W_RECENCY * recencyScore +
      W_ENTITY_MATCH * entityMatchScore;

    out.push({ memory: m, score, cosScore, typeMatchScore, importanceScore, recencyScore, entityMatchScore });
  }

  // Always inject up to 1 milestone
  const sorted = out.sort((a, b) => b.score - a.score);
  const milestoneIndex = sorted.findIndex((s) => s.memory.type === 'milestone' && s.score < 0.5);
  if (milestoneIndex > 0 && sorted.findIndex((s) => s.memory.type === 'milestone') >= TOP_K) {
    const m = sorted.splice(milestoneIndex, 1)[0];
    sorted.splice(Math.min(2, sorted.length), 0, m);
  }
  return sorted;
}

async function embedQueryText(text: string): Promise<number[] | undefined> {
  const [v] = await embedTexts([text]);
  return v;
}

// ---------------- Intent classification ----------------

type Intent =
  | 'about_friend'
  | 'about_place'
  | 'about_event'
  | 'preference_query'
  | 'safety_query'
  | 'small_talk'
  | 'meta';

function classifyIntent(text: string): Intent {
  const lower = text.toLowerCase();
  if (/\b(friend|buddy|你和|和谁|with whom|with who)\b/.test(lower)) return 'about_friend';
  if (/\b(park|home|window|street|where|place|地方|哪里)\b/.test(lower)) return 'about_place';
  if (/\b(today|yesterday|recently|last|did you|你今天|你昨天)\b/.test(lower)) return 'about_event';
  if (/\b(like|love|hate|favorite|prefer|喜欢|讨厌)\b/.test(lower)) return 'preference_query';
  if (/\b(safe|danger|hurt|sick|scared|怕|危险|生病)\b/.test(lower)) return 'safety_query';
  if (/\b(why are you|are you ai|what model|系统|你是机器)\b/.test(lower)) return 'meta';
  return 'small_talk';
}

function matchesIntent(memoryType: string, intent: Intent): boolean {
  switch (intent) {
    case 'about_friend': return memoryType === 'social';
    case 'about_place': return memoryType === 'episodic' || memoryType === 'semantic';
    case 'about_event': return memoryType === 'episodic' || memoryType === 'milestone';
    case 'preference_query': return memoryType === 'preference' || memoryType === 'user_fact';
    case 'safety_query': return memoryType === 'safety';
    case 'small_talk':
    case 'meta':
    default:
      return false;
  }
}

// ---------------- Misc ----------------

function looksLikeUserFact(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\byour (birthday|favorite|favourite|name|allergy|sister|brother)\b/.test(lower)) return true;
  if (/\b(my pet|my cat|my dog) (loves|hates|is|was)\b/.test(lower)) return true;
  if (/\b你的(生日|喜欢|名字|家人)\b/.test(text)) return true;
  return false;
}

function pickSafeFallback(pet: Pet, intent: Intent): string {
  const tone = pet.species === 'cat' ? '*flicks tail*' : '*tilts head*';
  if (intent === 'safety_query') return `${tone} I haven't seen anything like that, but ask the human just in case.`;
  return `${tone} I haven't got a clear memory of that yet — maybe next video!`;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean);
}

function parseJsonStrict(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const n = Number(raw || '');
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

// ---------------- Trait rebuild (used by /rebuild endpoint) ----------------

export async function rebuildTraitsFromMemories(petId: string): Promise<void> {
  const pet = await getPetById(petId);
  if (!pet) return;
  const memories = await listMemoriesForPet(petId);
  const live = memories.filter((m) => !m.archived && m.userVerdict !== 'wrong');

  const scores = { curiosity: 50, sociability: 50, bravery: 50, affection: 50, energy: 50 };
  const evidence = { curiosity: 0, sociability: 0, bravery: 0, affection: 0, energy: 0 };
  const reasons: any = { curiosity: [], sociability: [], bravery: [], affection: [], energy: [] };
  const likes: any[] = [];
  const dislikes: any[] = [];

  for (const m of live) {
    if (m.type === 'social') {
      scores.sociability = clamp(scores.sociability + 1, 0, 100);
      evidence.sociability += 1;
      reasons.sociability.push(m.id);
    } else if (m.type === 'safety') {
      scores.bravery = clamp(scores.bravery - 2, 0, 100);
      evidence.bravery += 1;
      reasons.bravery.push(m.id);
    } else if (m.type === 'milestone') {
      scores.curiosity = clamp(scores.curiosity + 1, 0, 100);
      evidence.curiosity += 1;
      reasons.curiosity.push(m.id);
    } else if (m.type === 'preference') {
      scores.affection = clamp(scores.affection + 1, 0, 100);
      evidence.affection += 1;
      reasons.affection.push(m.id);
    } else if (m.type === 'episodic' || m.type === 'semantic') {
      scores.energy = clamp(scores.energy + 0.2, 0, 100);
      evidence.energy += 1;
      reasons.energy.push(m.id);
    }
  }

  await setTraits({
    petId,
    scores,
    evidence,
    scoreReasons: reasons,
    likes,
    dislikes,
    catchphrases: [],
    routines: [],
    dirtyForRebuild: false,
    updatedAt: Date.now(),
  });
}
