// Pet AI Persona — memory store + retrieval.
// Wraps Firestore reads/writes and provides per-instance LRU cache for cosine retrieval.

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as appConfig } from '../config.ts';
import type {
  Pet,
  PetTraits,
  PetMemory,
  PetPriors,
  PetRelationEdge,
  ChatMessage,
  ChatThread,
  PersonaSnapshot,
  GrowthStage,
  PetTraitScores,
} from './personaTypes.ts';

const COL = {
  pets: process.env.PETS_COLLECTION || 'pets',
  petsIndex: process.env.PETS_INDEX_COLLECTION || 'pets_index',
  traits: process.env.PET_TRAITS_COLLECTION || 'pet_traits',
  memories: process.env.PET_MEMORIES_COLLECTION || 'pet_memories',
  priors: process.env.PET_PRIORS_COLLECTION || 'pet_priors',
  relations: process.env.PET_RELATIONS_COLLECTION || 'pet_relations',
  chats: process.env.PET_CHATS_COLLECTION || 'pet_chats',
  snapshots: process.env.PET_SNAPSHOTS_COLLECTION || 'pet_persona_snapshots',
};

let firestore: Firestore | null = null;

export function setFirestoreClient(client: Firestore | null): void {
  firestore = process.env.PERSONA_USE_FIRESTORE === 'true' ? client : null;
}

export function hasFirestore(): boolean {
  return !!firestore;
}

function db(): Firestore {
  if (!firestore) throw new Error('Persona memory store: Firestore not configured');
  return firestore;
}

type LocalPersonaState = {
  pets: Record<string, Pet>;
  petsIndex: Record<string, { visitorId: string; normalizedName: string; petId: string; displayName: string; createdAt: number; updatedAt: number }>;
  traits: Record<string, PetTraits>;
  priors: Record<string, PetPriors>;
  memories: Record<string, PetMemory>;
  relations: Record<string, Record<string, PetRelationEdge>>;
  chats: Record<string, ChatThread>;
  messages: Record<string, ChatMessage[]>;
  snapshots: Record<string, PersonaSnapshot[]>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.basename(path.dirname(__dirname)) === 'dist'
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '..');
const localStorePath = path.resolve(backendRoot, 'outputs/persona-local.json');
let localState: LocalPersonaState | null = null;

function emptyLocalState(): LocalPersonaState {
  return {
    pets: {},
    petsIndex: {},
    traits: {},
    priors: {},
    memories: {},
    relations: {},
    chats: {},
    messages: {},
    snapshots: {},
  };
}

function local(): LocalPersonaState {
  if (localState) return localState;
  try {
    if (fs.existsSync(localStorePath)) {
      localState = { ...emptyLocalState(), ...JSON.parse(fs.readFileSync(localStorePath, 'utf8')) };
      return localState;
    }
  } catch (e) {
    console.warn('[Persona Local Store] Failed to load, starting fresh:', (e as Error).message);
  }
  localState = emptyLocalState();
  return localState;
}

function saveLocal(): void {
  if (!localState) return;
  fs.mkdirSync(path.dirname(localStorePath), { recursive: true });
  fs.writeFileSync(localStorePath, JSON.stringify(sanitize(localState), null, 2));
}

// ---------------- Visitor / owner key ----------------

function hashOwner(visitorId: string): string {
  // small stable hash for index doc id; not cryptographic.
  let h = 5381;
  for (let i = 0; i < visitorId.length; i++) {
    h = ((h << 5) + h + visitorId.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function normalizeName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildPetIndexId(visitorId: string, normalizedName: string): string {
  return `${hashOwner(visitorId)}_${normalizedName.replace(/[^a-z0-9_-]/g, '_')}`;
}

// ---------------- Pet CRUD ----------------

export async function getPetById(petId: string): Promise<Pet | null> {
  if (!firestore) return local().pets[petId] || null;
  const snap = await db().collection(COL.pets).doc(petId).get();
  return snap.exists ? (snap.data() as Pet) : null;
}

export async function getPetIdByIndex(visitorId: string, normalizedName: string): Promise<string | null> {
  if (!firestore) return local().petsIndex[buildPetIndexId(visitorId, normalizedName)]?.petId || null;
  const idxId = buildPetIndexId(visitorId, normalizedName);
  const snap = await db().collection(COL.petsIndex).doc(idxId).get();
  if (!snap.exists) return null;
  return (snap.data() as any)?.petId ?? null;
}

// Transactional create: ensures only one pet for (visitorId, normalizedName).
// Returns the resolved petId regardless of who won the race.
export async function createPetWithIndex(pet: Pet): Promise<string> {
  const idxId = buildPetIndexId(pet.ownerKey, pet.normalizedName);
  if (!firestore) {
    const state = local();
    const existingId = state.petsIndex[idxId]?.petId;
    if (existingId) return existingId;
    state.petsIndex[idxId] = {
      visitorId: pet.ownerKey,
      normalizedName: pet.normalizedName,
      petId: pet.id,
      displayName: pet.name,
      createdAt: pet.createdAt,
      updatedAt: pet.updatedAt,
    };
    state.pets[pet.id] = sanitize(pet);
    saveLocal();
    return pet.id;
  }
  const idxRef = db().collection(COL.petsIndex).doc(idxId);
  const petRef = db().collection(COL.pets).doc(pet.id);

  return await db().runTransaction(async (tx) => {
    const idxSnap = await tx.get(idxRef);
    if (idxSnap.exists) {
      const existingId = (idxSnap.data() as any)?.petId as string;
      if (existingId) return existingId;
    }
    tx.set(idxRef, {
      visitorId: pet.ownerKey,
      normalizedName: pet.normalizedName,
      petId: pet.id,
      displayName: pet.name,
      createdAt: pet.createdAt,
      updatedAt: pet.updatedAt,
    });
    tx.set(petRef, sanitize(pet));
    return pet.id;
  });
}

export async function updatePet(petId: string, patch: Partial<Pet>): Promise<void> {
  if (!firestore) {
    const state = local();
    if (state.pets[petId]) {
      state.pets[petId] = sanitize({ ...state.pets[petId], ...patch, updatedAt: Date.now() });
      saveLocal();
    }
    return;
  }
  await db().collection(COL.pets).doc(petId).set(
    sanitize({ ...patch, updatedAt: Date.now() }),
    { merge: true }
  );
}

export async function listPetsForOwner(visitorId: string): Promise<Pet[]> {
  if (!firestore) return Object.values(local().pets).filter((p) => p.ownerKey === visitorId);
  const snap = await db().collection(COL.pets).where('ownerKey', '==', visitorId).get();
  return snap.docs.map((d) => d.data() as Pet);
}

export async function listLocalDemoPets(): Promise<Pet[]> {
  if (firestore) return [];
  return Object.values(local().pets);
}

export async function deletePetCascade(petId: string): Promise<void> {
  if (!firestore) {
    const state = local();
    delete state.pets[petId];
    delete state.traits[petId];
    delete state.priors[petId];
    delete state.relations[petId];
    delete state.snapshots[petId];
    for (const [id, m] of Object.entries(state.memories)) if (m.petId === petId) delete state.memories[id];
    for (const [id, t] of Object.entries(state.chats)) {
      if (t.petId === petId) {
        delete state.chats[id];
        delete state.messages[id];
      }
    }
    for (const [id, idx] of Object.entries(state.petsIndex)) if (idx.petId === petId) delete state.petsIndex[id];
    saveLocal();
    invalidateMemoryCache(petId);
    return;
  }
  const batchSize = 200;

  // memories
  await deleteByQuery(db().collection(COL.memories).where('petId', '==', petId), batchSize);
  // priors
  await db().collection(COL.priors).doc(petId).delete().catch(() => {});
  // traits
  await db().collection(COL.traits).doc(petId).delete().catch(() => {});
  // relations subcollection
  const relSnap = await db().collection(COL.relations).doc(petId).collection('edges').get();
  if (!relSnap.empty) {
    const writer = db().batch();
    relSnap.docs.forEach((d) => writer.delete(d.ref));
    await writer.commit();
  }
  await db().collection(COL.relations).doc(petId).delete().catch(() => {});
  // snapshots
  const snapSnap = await db().collection(COL.snapshots).doc(petId).collection('snapshots').get();
  if (!snapSnap.empty) {
    const writer = db().batch();
    snapSnap.docs.forEach((d) => writer.delete(d.ref));
    await writer.commit();
  }
  await db().collection(COL.snapshots).doc(petId).delete().catch(() => {});
  // chats — threads + messages
  const threads = await db().collection(COL.chats).where('petId', '==', petId).get();
  for (const t of threads.docs) {
    const msgs = await t.ref.collection('messages').get();
    if (!msgs.empty) {
      const writer = db().batch();
      msgs.docs.forEach((m) => writer.delete(m.ref));
      await writer.commit();
    }
    await t.ref.delete();
  }
  // index entries — find all aliases pointing to this petId for safety
  const idxSnap = await db().collection(COL.petsIndex).where('petId', '==', petId).get();
  if (!idxSnap.empty) {
    const writer = db().batch();
    idxSnap.docs.forEach((d) => writer.delete(d.ref));
    await writer.commit();
  }
  // pet doc
  await db().collection(COL.pets).doc(petId).delete().catch(() => {});
}

async function deleteByQuery(query: FirebaseFirestore.Query, batchSize: number): Promise<void> {
  while (true) {
    const snap = await query.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < batchSize) break;
  }
}

// ---------------- Traits ----------------

export async function getTraits(petId: string): Promise<PetTraits | null> {
  if (!firestore) return local().traits[petId] || null;
  const snap = await db().collection(COL.traits).doc(petId).get();
  return snap.exists ? (snap.data() as PetTraits) : null;
}

export async function setTraits(traits: PetTraits): Promise<void> {
  if (!firestore) {
    local().traits[traits.petId] = sanitize(traits);
    saveLocal();
    return;
  }
  await db().collection(COL.traits).doc(traits.petId).set(sanitize(traits), { merge: true });
}

// ---------------- Priors ----------------

export async function getPriors(petId: string): Promise<PetPriors | null> {
  if (!firestore) return local().priors[petId] || null;
  const snap = await db().collection(COL.priors).doc(petId).get();
  return snap.exists ? (snap.data() as PetPriors) : null;
}

export async function setPriors(priors: PetPriors): Promise<void> {
  if (!firestore) {
    local().priors[priors.petId] = sanitize(priors);
    saveLocal();
    return;
  }
  await db().collection(COL.priors).doc(priors.petId).set(sanitize(priors), { merge: true });
}

// ---------------- Memories ----------------

const MEMORY_CACHE = new Map<string, { loadedAt: number; memories: PetMemory[] }>();
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMORY_PER_PET_CAP = Number(process.env.PERSONA_MEMORY_CAP_PER_PET || 500);

export async function listMemoriesForPet(petId: string): Promise<PetMemory[]> {
  const now = Date.now();
  const cached = MEMORY_CACHE.get(petId);
  if (cached && now - cached.loadedAt < MEMORY_CACHE_TTL_MS) {
    return cached.memories;
  }
  if (!firestore) {
    const memories = Object.values(local().memories).filter((m) => m.petId === petId);
    MEMORY_CACHE.set(petId, { loadedAt: now, memories });
    return memories;
  }
  const snap = await db()
    .collection(COL.memories)
    .where('petId', '==', petId)
    .get();
  const memories = snap.docs.map((d) => d.data() as PetMemory);
  MEMORY_CACHE.set(petId, { loadedAt: now, memories });
  return memories;
}

export function invalidateMemoryCache(petId: string): void {
  MEMORY_CACHE.delete(petId);
}

export async function writeMemory(memory: PetMemory): Promise<void> {
  if (!firestore) {
    local().memories[memory.id] = sanitize(memory);
    saveLocal();
    invalidateMemoryCache(memory.petId);
    return;
  }
  await db().collection(COL.memories).doc(memory.id).set(sanitize(memory));
  invalidateMemoryCache(memory.petId);
}

export async function writeMemoriesBatch(memories: PetMemory[]): Promise<void> {
  if (memories.length === 0) return;
  if (!firestore) {
    const state = local();
    for (const m of memories) state.memories[m.id] = sanitize(m);
    saveLocal();
    invalidateMemoryCache(memories[0].petId);
    return;
  }
  const batch = db().batch();
  for (const m of memories) {
    batch.set(db().collection(COL.memories).doc(m.id), sanitize(m));
  }
  await batch.commit();
  if (memories.length) invalidateMemoryCache(memories[0].petId);
}

export async function patchMemory(memoryId: string, patch: Partial<PetMemory>): Promise<void> {
  if (!firestore) {
    const state = local();
    if (state.memories[memoryId]) {
      state.memories[memoryId] = sanitize({ ...state.memories[memoryId], ...patch });
      saveLocal();
      invalidateMemoryCache(patch.petId || state.memories[memoryId].petId);
    }
    return;
  }
  await db().collection(COL.memories).doc(memoryId).set(sanitize(patch), { merge: true });
  if (patch.petId) invalidateMemoryCache(patch.petId);
}

export async function deleteMemory(memoryId: string, petId: string): Promise<void> {
  if (!firestore) {
    delete local().memories[memoryId];
    saveLocal();
    invalidateMemoryCache(petId);
    return;
  }
  await db().collection(COL.memories).doc(memoryId).delete().catch(() => {});
  invalidateMemoryCache(petId);
}

export async function getMemoryCount(petId: string): Promise<number> {
  const list = await listMemoriesForPet(petId);
  return list.length;
}

export function shouldEnforceMemoryCap(count: number): boolean {
  return count >= MEMORY_PER_PET_CAP;
}

// ---------------- Relations ----------------

export async function getRelations(petId: string): Promise<PetRelationEdge[]> {
  if (!firestore) return Object.values(local().relations[petId] || {});
  const snap = await db().collection(COL.relations).doc(petId).collection('edges').get();
  return snap.docs.map((d) => d.data() as PetRelationEdge);
}

export async function upsertRelation(petId: string, edge: PetRelationEdge): Promise<void> {
  if (!firestore) {
    const state = local();
    state.relations[petId] = state.relations[petId] || {};
    state.relations[petId][edge.otherKey] = sanitize(edge);
    saveLocal();
    return;
  }
  await db()
    .collection(COL.relations)
    .doc(petId)
    .collection('edges')
    .doc(edge.otherKey)
    .set(sanitize(edge), { merge: true });
}

// ---------------- Chats ----------------

export async function getOrCreateThread(
  petId: string,
  ownerKey: string,
  threadId: string | undefined
): Promise<ChatThread> {
  if (!firestore) {
    const state = local();
    if (threadId && state.chats[threadId]) {
      const existing = state.chats[threadId];
      if (existing.petId !== petId || existing.ownerKey !== ownerKey) {
        throw new Error('Chat thread does not belong to this pet');
      }
      return existing;
    }
    const id = threadId || `thread-${randomId(10)}`;
    const thread: ChatThread = {
      id,
      petId,
      ownerKey,
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.chats[id] = thread;
    state.messages[id] = state.messages[id] || [];
    saveLocal();
    return thread;
  }
  if (threadId) {
    const snap = await db().collection(COL.chats).doc(threadId).get();
    if (snap.exists) {
      const existing = snap.data() as ChatThread;
      if (existing.petId !== petId || existing.ownerKey !== ownerKey) {
        throw new Error('Chat thread does not belong to this pet');
      }
      return existing;
    }
  }
  const id = threadId || `thread-${randomId(10)}`;
  const thread: ChatThread = {
    id,
    petId,
    ownerKey,
    messageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db().collection(COL.chats).doc(id).set(sanitize(thread));
  return thread;
}

export async function appendMessage(message: ChatMessage): Promise<void> {
  if (!firestore) {
    const state = local();
    state.messages[message.threadId] = state.messages[message.threadId] || [];
    state.messages[message.threadId].push(sanitize(message));
    if (state.chats[message.threadId]) {
      state.chats[message.threadId] = {
        ...state.chats[message.threadId],
        messageCount: (state.chats[message.threadId].messageCount || 0) + 1,
        updatedAt: Date.now(),
      };
    }
    saveLocal();
    return;
  }
  await db()
    .collection(COL.chats)
    .doc(message.threadId)
    .collection('messages')
    .doc(message.id)
    .set(sanitize(message));
  await db()
    .collection(COL.chats)
    .doc(message.threadId)
    .set(
      {
        messageCount: FieldValue.increment(1) as any,
        updatedAt: Date.now(),
        title: undefined,
      },
      { merge: true }
    );
}

export async function listMessages(threadId: string, limit = 50): Promise<ChatMessage[]> {
  if (!firestore) return (local().messages[threadId] || [])
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, limit);
  const snap = await db()
    .collection(COL.chats)
    .doc(threadId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as ChatMessage);
}

export async function listThreads(petId: string, limit = 20): Promise<ChatThread[]> {
  if (!firestore) return Object.values(local().chats)
    .filter((t) => t.petId === petId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
  const snap = await db()
    .collection(COL.chats)
    .where('petId', '==', petId)
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => d.data() as ChatThread)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// ---------------- Snapshots ----------------

export async function writeSnapshot(snapshot: PersonaSnapshot): Promise<void> {
  if (!firestore) {
    const state = local();
    state.snapshots[snapshot.petId] = state.snapshots[snapshot.petId] || [];
    state.snapshots[snapshot.petId].push(sanitize(snapshot));
    state.snapshots[snapshot.petId] = state.snapshots[snapshot.petId]
      .sort((a, b) => (b.snapshotAt || 0) - (a.snapshotAt || 0))
      .slice(0, 24);
    saveLocal();
    return;
  }
  await db()
    .collection(COL.snapshots)
    .doc(snapshot.petId)
    .collection('snapshots')
    .doc(snapshot.id)
    .set(sanitize(snapshot));
}

export async function listSnapshots(petId: string, limit = 12): Promise<PersonaSnapshot[]> {
  if (!firestore) return (local().snapshots[petId] || [])
    .slice()
    .sort((a, b) => (b.snapshotAt || 0) - (a.snapshotAt || 0))
    .slice(0, limit);
  const snap = await db()
    .collection(COL.snapshots)
    .doc(petId)
    .collection('snapshots')
    .orderBy('snapshotAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as PersonaSnapshot);
}

// ---------------- Embeddings ----------------

let genAi: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  if (!appConfig.geminiApiKey) return null;
  if (!genAi) genAi = new GoogleGenerativeAI(appConfig.geminiApiKey);
  return genAi;
}

const EMBED_MODEL = (process.env.PERSONA_EMBED_MODEL || 'none').trim();

export async function embedTexts(texts: string[]): Promise<(number[] | undefined)[]> {
  if (!EMBED_MODEL || ['none', 'off', 'disabled'].includes(EMBED_MODEL.toLowerCase())) {
    return texts.map(() => undefined);
  }
  const ai = getGenAI();
  if (!ai || texts.length === 0) return texts.map(() => undefined);
  try {
    const model = ai.getGenerativeModel({ model: EMBED_MODEL } as any);
    // Sequential to avoid quota spikes; per-video extraction yields <30 items.
    const out: (number[] | undefined)[] = [];
    for (const t of texts) {
      try {
        const result: any = await (model as any).embedContent({
          content: { parts: [{ text: t }] },
        });
        const values: number[] | undefined = result?.embedding?.values || result?.embedding;
        if (Array.isArray(values)) out.push(values);
        else out.push(undefined);
      } catch (e) {
        console.warn('[Persona] embedContent failed for one item:', (e as Error).message);
        out.push(undefined);
      }
    }
    return out;
  } catch (e) {
    console.warn('[Persona] embedTexts initialization failed:', (e as Error).message);
    return texts.map(() => undefined);
  }
}

export function cosineSimilarity(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
  }
  if (an === 0 || bn === 0) return 0;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

// ---------------- Helpers ----------------

export function randomId(len = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function growthStageFromCounts(videoCount: number, memoryCount: number): GrowthStage {
  if (videoCount === 0 && memoryCount === 0) return 'embryonic';
  if (videoCount <= 1 || memoryCount < 8) return 'embryonic';
  if (videoCount <= 3 || memoryCount < 24) return 'forming';
  if (videoCount <= 7 || memoryCount < 60) return 'recognizable';
  return 'soul_bonded';
}

export function growthStageDisplay(stage: GrowthStage): { en: string; zh: string } {
  switch (stage) {
    case 'embryonic':
      return { en: 'Spark', zh: '雏形期' };
    case 'forming':
      return { en: 'Forming Voice', zh: '成形期' };
    case 'recognizable':
      return { en: 'Recognizable', zh: '成形期' };
    case 'soul_bonded':
      return { en: 'Soul Bonded', zh: '灵魂契合期' };
  }
}

function sanitize<T>(value: T): T {
  // remove undefined fields recursively; mirror server.ts sanitizeForFirestore
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v)) as any;
  }
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

export const internals = {
  hashOwner,
  COL,
  sanitize,
};
