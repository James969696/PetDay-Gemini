import React, { useEffect, useState } from 'react';
import {
  deletePetMemory,
  exportPetData,
  fetchPetMemories,
  fetchPetProfile,
  patchPetMemory,
  rebuildPetTraits,
} from '../lib/api';
import { getActivePetId, growthStageDisplay, setActivePetId } from '../lib/personaState';
import type { Page, PetMemory, PetProfileResponse } from '../types';

interface PetProfileProps {
  onNavigate: (page: Page) => void;
}

const TRAIT_DIMS: Array<{ key: keyof PetProfileResponse['traits'] extends never ? never : 'curiosity' | 'sociability' | 'bravery' | 'affection' | 'energy'; label: string }> = [
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'sociability', label: 'Sociability' },
  { key: 'bravery', label: 'Bravery' },
  { key: 'affection', label: 'Affection' },
  { key: 'energy', label: 'Energy' },
];

const PetProfile: React.FC<PetProfileProps> = ({ onNavigate }) => {
  const [profile, setProfile] = useState<PetProfileResponse | null>(null);
  const [allMemories, setAllMemories] = useState<PetMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const petId = getActivePetId();

  const reload = async () => {
    if (!petId) return;
    try {
      const [p, mems] = await Promise.all([
        fetchPetProfile(petId),
        fetchPetMemories(petId),
      ]);
      setProfile(p);
      setAllMemories(mems);
    } catch (e: any) {
      setError(e?.message || 'Failed to load pet');
    }
  };

  useEffect(() => {
    if (!petId) {
      onNavigate('pets');
      return;
    }
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId]);

  const onMemoryVerdict = async (memId: string, verdict: 'confirmed' | 'wrong' | 'private') => {
    if (!petId) return;
    await patchPetMemory(petId, memId, { userVerdict: verdict });
    await reload();
  };

  const onMemoryDelete = async (memId: string) => {
    if (!petId) return;
    if (!confirm('Forget this memory permanently?')) return;
    await deletePetMemory(petId, memId);
    await reload();
  };

  const onRebuild = async () => {
    if (!petId) return;
    await rebuildPetTraits(petId);
    await reload();
  };

  const onExport = async () => {
    if (!petId) return;
    await exportPetData(petId);
  };

  if (loading) return <div className="p-8 text-slate-400">Loading persona…</div>;
  if (error) return <div className="p-8 text-red-400">{error}</div>;
  if (!profile) return null;

  const stage = profile.growthStage;
  const stageLabel = profile.growthStageLabel || growthStageDisplay(stage);

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <button
        onClick={() => onNavigate('pets')}
        className="text-sm text-slate-400 mb-6 hover:text-primary inline-flex items-center gap-1"
      >
        <span className="material-symbols-outlined !text-base">arrow_back</span> Back to My Pets
      </button>

      {/* Header */}
      <header className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-8 mb-8 flex items-center gap-6">
        <div
          className="size-24 rounded-full border-4 border-primary/40 bg-cover bg-center bg-warm-gray/30"
          style={profile.pet.photoUrl ? { backgroundImage: `url('${profile.pet.photoUrl}')` } : undefined}
        >
          {!profile.pet.photoUrl && (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-primary">pets</span>
            </div>
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-4xl font-black tracking-tight">{profile.pet.name}</h1>
          <p className="text-slate-400 mt-1">
            {profile.pet.species}{profile.pet.breed ? ` · ${profile.pet.breed}` : ''} · voice: <span className="text-primary">{profile.pet.voicePersona}</span>
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-[11px] uppercase tracking-widest font-bold bg-primary/20 text-primary px-3 py-1 rounded-full">
              {stageLabel.zh} · {stageLabel.en}
            </span>
            <span className="text-xs text-slate-400">
              {profile.memoryCount} memories · {profile.pet.videoCount} videos
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setActivePetId(profile.pet.id); onNavigate('pet-chat'); }}
            className="bg-primary text-background-dark font-bold px-6 py-2 rounded-xl hover:scale-105 transition"
          >
            Chat
          </button>
          <button onClick={onExport} className="bg-warm-gray/20 hover:bg-warm-gray/30 text-sm py-2 px-4 rounded-xl">
            Export
          </button>
        </div>
      </header>

      {/* Trait card */}
      <section className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-8 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">psychology</span>
            Persona Card
          </h2>
          {profile.traits?.dirtyForRebuild && (
            <button onClick={onRebuild} className="text-xs bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full hover:bg-yellow-500/30">
              Memories changed — rebuild personality
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {TRAIT_DIMS.map((dim) => {
            const score = (profile.traits?.scores as any)?.[dim.key] ?? 50;
            const evidence = (profile.traits?.evidence as any)?.[dim.key] ?? 0;
            const confidence = Math.min(1, evidence / 10);
            return (
              <div key={dim.key} className="bg-background-dark/50 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-2">{dim.label}</div>
                <div className="text-3xl font-black text-primary">{score}</div>
                <div className="mt-2 h-1.5 bg-warm-gray/30 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${confidence * 100}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{evidence} evidence</div>
              </div>
            );
          })}
        </div>

        {(profile.traits?.likes?.length ?? 0) > 0 && (
          <div className="mt-6">
            <div className="text-xs uppercase font-bold text-slate-400 mb-2">Likes</div>
            <div className="flex flex-wrap gap-2">
              {profile.traits!.likes.map((l) => (
                <span key={l.subject} className="text-xs bg-primary/15 text-primary px-3 py-1 rounded-full">
                  {l.subject}{l.strength > 1 ? ` · ${l.strength}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        {(profile.traits?.dislikes?.length ?? 0) > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase font-bold text-slate-400 mb-2">Dislikes</div>
            <div className="flex flex-wrap gap-2">
              {profile.traits!.dislikes.map((d) => (
                <span key={d.subject} className="text-xs bg-red-500/15 text-red-300 px-3 py-1 rounded-full">
                  {d.subject}{d.strength > 1 ? ` · ${d.strength}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Inner Circle */}
      {profile.relations.length > 0 && (
        <section className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-8 mb-8">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">groups</span>
            Inner Circle
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {profile.relations.slice(0, 9).map((r) => (
              <div key={r.otherKey} className="bg-background-dark/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold">{r.displayName}</h3>
                  <span className="text-[10px] uppercase tracking-widest text-primary">{r.status}</span>
                </div>
                <div className="text-xs text-slate-400">Bond {Math.round(r.bondScore)}/100 · {r.encounterCount} encounters</div>
                <div className="mt-2 h-1.5 bg-warm-gray/30 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${r.bondScore}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Memory Lane */}
      <section className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-8 mb-8">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">menu_book</span>
          Memory Lane
        </h2>
        {allMemories.length === 0 ? (
          <p className="text-slate-400 text-sm">No memories yet — upload a video and watch them grow.</p>
        ) : (
          <div className="space-y-3">
            {allMemories.slice(0, 30).map((m) => (
              <div key={m.id} className="bg-background-dark/50 rounded-xl p-4 flex items-start gap-3">
                <span className="text-[10px] uppercase tracking-widest font-bold text-primary mt-1 shrink-0">
                  {m.type}
                </span>
                <div className="flex-1">
                  <p className="text-sm">{m.text}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                    <span>imp {Math.round(m.importanceCurrent ?? m.importance)}/10</span>
                    <span>conf {m.confidence}</span>
                    {m.source?.timestamp && <span>ts {m.source.timestamp}</span>}
                    {m.userVerdict && <span className="text-yellow-400">{m.userVerdict}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => onMemoryVerdict(m.id, 'confirmed')}
                    title="Confirm"
                    className="text-xs px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => onMemoryVerdict(m.id, 'wrong')}
                    title="Mark wrong (excluded from chat)"
                    className="text-xs px-2 py-1 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300"
                  >
                    !
                  </button>
                  <button
                    onClick={() => onMemoryDelete(m.id)}
                    title="Forget"
                    className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PetProfile;
