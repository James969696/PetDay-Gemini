
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

interface Session {
  id: string;
  originalName: string;
  status: 'processing' | 'ready' | 'error';
  createdAt: string;
  analysis?: any;
  coverUrl?: string;
  petName?: string;
}

interface GalleryProps {
  onSelect: () => void;
}

const Gallery: React.FC<GalleryProps> = ({ onSelect }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPet, setSelectedPet] = useState<string>('All');

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch(apiUrl('/api/sessions'));
        const data = await response.json();
        setSessions(data);
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessions();
  }, []);

  return (
    <div className="p-8 pb-20 max-w-7xl mx-auto">
      <header className="mb-12">
        <h1 className="text-4xl font-black tracking-tight">Stories Gallery</h1>
        <p className="text-slate-400 mt-2 text-lg">Rewatch and explore your pet's best moments through their eyes.</p>

        <div className="flex flex-col lg:flex-row gap-4 mt-10">
          <div className="flex-1 relative group">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">search</span>
            <input
              className="w-full h-14 pl-12 pr-4 bg-surface-dark border border-warm-gray/30 rounded-2xl focus:ring-2 focus:ring-primary text-sm font-medium transition-all outline-none"
              placeholder="Search by pet, location, or keyword..."
            />
          </div>
        </div>

        {(() => {
          const petNames = [...new Set(sessions.map(s => s.petName).filter((n): n is string => !!n && n.trim() !== ''))].sort();
          return petNames.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-6">
              {['All', ...petNames].map((name) => (
                <button
                  key={name}
                  onClick={() => setSelectedPet(name)}
                  className={`px-5 py-2 rounded-xl text-sm font-bold border transition-all ${
                    selectedPet === name
                      ? 'bg-primary text-background-dark border-primary'
                      : 'bg-surface-dark text-slate-300 border-warm-gray/30 hover:border-primary/50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null;
        })()}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {sessions.filter(s => selectedPet === 'All' || s.petName === selectedPet).map((story) => (
          <div
            key={story.id}
            onClick={() => {
              localStorage.setItem('currentSessionId', story.id);
              onSelect();
            }}
            className="group bg-surface-dark rounded-[2rem] overflow-hidden border border-warm-gray/30 hover:border-primary/50 transition-all shadow-xl cursor-pointer"
          >
            <div className="relative aspect-video bg-black overflow-hidden">
              {story.coverUrl ? (
                <img src={story.coverUrl} alt={story.originalName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-800">
                  <span className="material-symbols-outlined text-4xl text-slate-600">video_file</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/10 transition-all"></div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-primary size-14 rounded-full flex items-center justify-center shadow-2xl scale-75 group-hover:scale-100 transition-transform duration-300">
                  <span className="material-symbols-outlined text-background-dark font-black text-3xl">play_arrow</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-xl leading-tight group-hover:text-primary transition-colors">{story.originalName}</h3>
                  <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-wider">
                    {story.petName && <span className="text-primary mr-2">{story.petName}</span>}
                    {new Date(story.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {story.status === 'ready' && story.analysis?.title ? (
                <p className="text-sm text-slate-400 mt-2 line-clamp-2">{story.analysis.title}</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border bg-primary/10 text-primary border-primary/20`}>
                    {story.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        <div onClick={() => window.location.reload()} className="group border-2 border-dashed border-warm-gray/30 rounded-[2rem] flex flex-col items-center justify-center p-12 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer min-h-[400px]">
          <div className="bg-primary/10 group-hover:bg-primary text-primary group-hover:text-background-dark size-20 rounded-[2rem] flex items-center justify-center mb-6 transition-all rotate-12 group-hover:rotate-0">
            <span className="material-symbols-outlined !text-4xl">add</span>
          </div>
          <p className="font-bold text-2xl">Analyze New Clip</p>
          <p className="text-slate-500 text-sm text-center mt-3 leading-relaxed max-w-[240px]">Upload a pet POV video to generate a new AI emotional summary.</p>
        </div>
      </div>
    </div>
  );
};

export default Gallery;
