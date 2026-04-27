import React, { useEffect, useState } from 'react';
import { fetchPets } from '../lib/api';
import { setActivePetId } from '../lib/personaState';
import type { PetListItem, Page } from '../types';

interface MyPetsProps {
  onNavigate: (page: Page) => void;
}

const MyPets: React.FC<MyPetsProps> = ({ onNavigate }) => {
  const [pets, setPets] = useState<PetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchPets();
        if (!cancelled) setPets(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load pets');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openProfile = (petId: string) => {
    setActivePetId(petId);
    onNavigate('pet-profile');
  };

  const openChat = (petId: string) => {
    setActivePetId(petId);
    onNavigate('pet-chat');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <header className="mb-12">
        <h1 className="text-4xl font-black tracking-tight">My Pets</h1>
        <p className="text-slate-400 mt-2 text-lg">Each pet grows from the videos you upload — chat with their evolving persona.</p>
      </header>

      {loading && <div className="text-slate-400">Loading pets…</div>}
      {error && <div className="text-red-400">{error}</div>}

      {!loading && !error && pets.length === 0 && (
        <div className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-12 text-center">
          <span className="material-symbols-outlined text-6xl text-primary mb-4 block">pets</span>
          <h3 className="text-xl font-bold mb-2">No persona yet</h3>
          <p className="text-slate-400 mb-6">Upload a video on the Dashboard, give your pet a name, and a persona will start forming.</p>
          <button
            onClick={() => onNavigate('dashboard')}
            className="bg-primary text-background-dark font-bold px-6 py-3 rounded-xl hover:scale-105 transition"
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {!loading && !error && pets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pets.map((p) => (
            <div
              key={p.id}
              className="bg-surface-dark rounded-3xl border border-warm-gray/30 p-6 hover:border-primary/50 transition group"
            >
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="size-16 rounded-full bg-warm-gray/30 bg-cover bg-center border-2 border-primary/30"
                  style={p.photoUrl ? { backgroundImage: `url('${p.photoUrl}')` } : undefined}
                >
                  {!p.photoUrl && (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-2xl text-primary">pets</span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p className="text-xs text-slate-400 uppercase tracking-wide">
                    {p.species}{p.breed ? ` · ${p.breed}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] uppercase tracking-widest font-bold bg-primary/20 text-primary px-3 py-1 rounded-full">
                  {p.growthStageLabel?.zh || '雏形期'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {p.memoryCount} memories · {p.videoCount} videos
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openProfile(p.id)}
                  className="flex-1 bg-warm-gray/20 hover:bg-warm-gray/30 text-sm font-bold py-2 rounded-xl transition"
                >
                  Profile
                </button>
                <button
                  onClick={() => openChat(p.id)}
                  className="flex-1 bg-primary text-background-dark text-sm font-bold py-2 rounded-xl hover:scale-105 transition"
                >
                  Tap to Talk
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyPets;
