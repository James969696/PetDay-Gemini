// Pet AI Persona — Express router. Registered from server.ts.
//
// Auth: every route requires visitorId via header (X-Visitor-Id) or query
// (?visitorId=...) and the resolved petId must belong to that visitor.

import express from 'express';
import {
  deleteMemory,
  deletePetCascade,
  getMemoryCount,
  getPetById,
  getPriors,
  getRelations,
  getTraits,
  growthStageDisplay,
  growthStageFromCounts,
  invalidateMemoryCache,
  hasFirestore,
  listLocalDemoPets,
  listMemoriesForPet,
  listMessages,
  listPetsForOwner,
  listSnapshots,
  listThreads,
  patchMemory,
  setTraits,
  updatePet,
  randomId,
} from './memoryStore.ts';
import { handleChatStream, rebuildTraitsFromMemories } from './chatService.ts';
import { resolvePet } from './petIdentity.ts';
import type { Pet, PetMemory } from './personaTypes.ts';

export function buildPersonaRouter(): express.Router {
  const router = express.Router();

  // ---- Helpers ----
  function getVisitorId(req: express.Request): string {
    const header = (req.headers['x-visitor-id'] || '') as string;
    const q = String(req.query.visitorId || '');
    const b = String((req.body as any)?.visitorId || '');
    return (header || q || b || '').trim();
  }

  function allowLocalDemoPersona(): boolean {
    return process.env.PERSONA_LOCAL_DEMO_FALLBACK !== 'false' && !hasFirestore();
  }

  async function authorizePet(req: express.Request, res: express.Response): Promise<Pet | null> {
    const visitorId = getVisitorId(req);
    if (!visitorId) {
      res.status(401).json({ error: 'visitorId required' });
      return null;
    }
    const petId = String(req.params.petId || '');
    const pet = await getPetById(petId);
    if (!pet) {
      res.status(404).json({ error: 'Pet not found' });
      return null;
    }
    if (pet.ownerKey !== visitorId && !allowLocalDemoPersona()) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return pet;
  }

  // ---- /api/pets ----

  router.get('/pets', async (req, res) => {
    const visitorId = getVisitorId(req);
    if (!visitorId) return res.status(401).json({ error: 'visitorId required' });
    try {
      let pets = await listPetsForOwner(visitorId);
      if (pets.length === 0 && allowLocalDemoPersona()) {
        pets = await listLocalDemoPets();
      }
      const enriched = await Promise.all(
        pets.map(async (p) => {
          const memoryCount = await getMemoryCount(p.id);
          const stage = growthStageFromCounts(p.videoCount || 0, memoryCount);
          const display = growthStageDisplay(stage);
          return { ...p, memoryCount, growthStage: stage, growthStageLabel: display };
        })
      );
      res.json(enriched.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    } catch (e: any) {
      console.error('[Persona Router] list pets failed', e);
      res.status(500).json({ error: 'Failed to list pets' });
    }
  });

  router.post('/pets', async (req, res) => {
    const visitorId = getVisitorId(req);
    if (!visitorId) return res.status(401).json({ error: 'visitorId required' });
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name required' });
    }
    try {
      const { pet, created } = await resolvePet({
        visitorId,
        petName: body.name,
        species: body.species,
        breed: body.breed,
        dateOfBirth: body.dateOfBirth,
      });
      res.json({ pet, created });
    } catch (e: any) {
      console.error('[Persona Router] create pet failed', e);
      res.status(500).json({ error: e?.message || 'Failed to create pet' });
    }
  });

  router.get('/pets/:petId', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      const [traits, priors, relations, memories, snapshots] = await Promise.all([
        getTraits(pet.id),
        getPriors(pet.id),
        getRelations(pet.id),
        listMemoriesForPet(pet.id),
        listSnapshots(pet.id, 6),
      ]);
      const memoryCount = memories.length;
      const stage = growthStageFromCounts(pet.videoCount || 0, memoryCount);
      const recentMemories: PetMemory[] = memories
        .filter((m) => !m.archived && m.userVerdict !== 'wrong')
        .sort((a, b) => (b.importanceCurrent ?? b.importance) - (a.importanceCurrent ?? a.importance))
        .slice(0, 12);
      res.json({
        pet,
        traits,
        priors,
        memoryCount,
        recentMemories,
        relations: relations.sort((a, b) => b.bondScore - a.bondScore),
        snapshots,
        growthStage: stage,
        growthStageLabel: growthStageDisplay(stage),
      });
    } catch (e: any) {
      console.error('[Persona Router] get pet failed', e);
      res.status(500).json({ error: 'Failed to load pet' });
    }
  });

  router.patch('/pets/:petId', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    const allowed = ['breed', 'dateOfBirth', 'photoUrl', 'voicePersona', 'name'];
    const patch: any = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = (req.body as any)[k];
    try {
      await updatePet(pet.id, patch);
      const updated = await getPetById(pet.id);
      res.json({ pet: updated });
    } catch (e: any) {
      console.error('[Persona Router] patch pet failed', e);
      res.status(500).json({ error: 'Failed to update pet' });
    }
  });

  router.delete('/pets/:petId', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      await deletePetCascade(pet.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[Persona Router] delete pet failed', e);
      res.status(500).json({ error: 'Failed to delete pet' });
    }
  });

  router.get('/pets/:petId/export.json', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      const [traits, priors, relations, memories, snapshots, threads] = await Promise.all([
        getTraits(pet.id),
        getPriors(pet.id),
        getRelations(pet.id),
        listMemoriesForPet(pet.id),
        listSnapshots(pet.id, 24),
        listThreads(pet.id, 50),
      ]);
      // Pull last 100 messages for each thread
      const threadDumps = await Promise.all(
        threads.map(async (t) => ({ thread: t, messages: await listMessages(t.id, 100) }))
      );
      res.setHeader('Content-Disposition', `attachment; filename="${pet.id}.json"`);
      res.json({
        pet,
        traits,
        priors,
        relations,
        memories,
        snapshots,
        threads: threadDumps,
        exportedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('[Persona Router] export failed', e);
      res.status(500).json({ error: 'Failed to export pet data' });
    }
  });

  // ---- /memories ----

  router.get('/pets/:petId/memories', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      const memories = await listMemoriesForPet(pet.id);
      const includeArchived = String(req.query.includeArchived || '') === 'true';
      const filtered = memories
        .filter((m) => includeArchived || !m.archived)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ memories: filtered });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to list memories' });
    }
  });

  router.patch('/pets/:petId/memories/:memoryId', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    const verdict = (req.body || {}).userVerdict;
    if (!['confirmed', 'wrong', 'private'].includes(verdict)) {
      return res.status(400).json({ error: 'invalid userVerdict' });
    }
    try {
      await patchMemory(req.params.memoryId, { petId: pet.id, userVerdict: verdict });
      // Mark traits dirty so user knows /rebuild is available
      const traits = await getTraits(pet.id);
      if (traits) await setTraits({ ...traits, dirtyForRebuild: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to update memory' });
    }
  });

  router.delete('/pets/:petId/memories/:memoryId', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      await deleteMemory(req.params.memoryId, pet.id);
      const traits = await getTraits(pet.id);
      if (traits) await setTraits({ ...traits, dirtyForRebuild: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to delete memory' });
    }
  });

  // ---- /rebuild ----

  router.post('/pets/:petId/rebuild', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      await rebuildTraitsFromMemories(pet.id);
      invalidateMemoryCache(pet.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[Persona Router] rebuild failed', e);
      res.status(500).json({ error: 'Rebuild failed' });
    }
  });

  // ---- /chat (SSE) ----

  router.post('/pets/:petId/chat', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    const body = req.body || {};
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return res.status(400).json({ error: 'text required' });
    }
    if (body.text.length > 2000) {
      return res.status(400).json({ error: 'text too long' });
    }
    await handleChatStream(
      {
        petId: pet.id,
        visitorId: getVisitorId(req),
        allowLocalDemoAccess: allowLocalDemoPersona(),
        payload: {
          threadId: body.threadId,
          text: body.text,
          speakerLabelHint: body.speakerLabelHint,
        },
      },
      res
    );
  });

  router.get('/pets/:petId/chats', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      const threadId = String(req.query.threadId || '').trim();
      if (threadId) {
        const threads = await listThreads(pet.id, 200);
        if (!threads.some((t) => t.id === threadId)) {
          return res.status(404).json({ error: 'Chat thread not found' });
        }
        const messages = await listMessages(threadId, 200);
        res.json({ messages });
      } else {
        const threads = await listThreads(pet.id, 30);
        res.json({ threads });
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to list chats' });
    }
  });

  // ---- /healthz (cold start warmer) ----

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, persona: true, ts: Date.now() });
  });

  // simple snapshot trigger
  router.post('/pets/:petId/snapshot', async (req, res) => {
    const pet = await authorizePet(req, res);
    if (!pet) return;
    try {
      // Snapshot is normally generated during persona builder; this endpoint
      // creates a lightweight one from current state for export.
      const { writeSnapshot } = await import('./memoryStore.ts');
      const traits = await getTraits(pet.id);
      const memCount = await getMemoryCount(pet.id);
      const stage = growthStageFromCounts(pet.videoCount || 0, memCount);
      await writeSnapshot({
        id: `snap-manual-${randomId(8)}`,
        petId: pet.id,
        snapshotAt: Date.now(),
        traits: traits || {
          petId: pet.id,
          scores: { curiosity: 50, sociability: 50, bravery: 50, affection: 50, energy: 50 },
          evidence: { curiosity: 0, sociability: 0, bravery: 0, affection: 0, energy: 0 },
          likes: [],
          dislikes: [],
          catchphrases: [],
          routines: [],
          updatedAt: Date.now(),
        },
        voicePersona: pet.voicePersona,
        level: pet.level,
        growthStage: stage,
        summary: `${pet.name}: snapshot at ${new Date().toISOString()}`,
        highlightMemoryIds: [],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Snapshot failed' });
    }
  });

  return router;
}
