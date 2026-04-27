import React, { useEffect, useRef, useState } from 'react';
import { chatStream, fetchChatMessages, fetchPetProfile } from '../lib/api';
import { getActivePetId } from '../lib/personaState';
import type { ChatMessageRecord, ChatStreamMeta, Page, PetProfileResponse } from '../types';

interface PetChatProps {
  onNavigate: (page: Page) => void;
}

interface UiMessage {
  id: string;
  role: 'user' | 'pet';
  text: string;
  citationStatus?: ChatStreamMeta['citationStatus'];
  citedMemoryIds?: string[];
  moodHint?: string;
  pending?: boolean;
}

const CITATION_LABEL: Record<string, { label: string; color: string }> = {
  verified: { label: 'verified', color: 'text-emerald-300 bg-emerald-500/15' },
  partial: { label: 'partial citation', color: 'text-yellow-300 bg-yellow-500/15' },
  unsupported: { label: 'no evidence (vibe-only)', color: 'text-slate-400 bg-slate-500/15' },
  vibe_only: { label: 'vibe-only', color: 'text-slate-400 bg-slate-500/15' },
};

const PetChat: React.FC<PetChatProps> = ({ onNavigate }) => {
  const petId = getActivePetId();
  const [profile, setProfile] = useState<PetProfileResponse | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!petId) {
      onNavigate('pets');
      return;
    }
    (async () => {
      try {
        const p = await fetchPetProfile(petId);
        setProfile(p);
      } catch (e: any) {
        setError(e?.message || 'Failed to load pet');
      }
    })();
  }, [petId, onNavigate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  const send = async () => {
    if (!petId || !input.trim() || streaming) return;
    const userText = input.trim();
    setInput('');
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: userText };
    const petMsg: UiMessage = { id: `p-${Date.now()}`, role: 'pet', text: '', pending: true };
    setMessages((m) => [...m, userMsg, petMsg]);
    setStreaming(true);

    let receivedDelta = '';
    try {
      await chatStream(
        petId,
        { text: userText, threadId },
        {
          onThread: (id) => setThreadId(id),
          onDelta: (delta) => {
            receivedDelta += delta;
            setMessages((m) => m.map((x) => (x.id === petMsg.id ? { ...x, text: receivedDelta } : x)));
          },
          onMeta: (meta) => {
            setMessages((m) =>
              m.map((x) =>
                x.id === petMsg.id
                  ? {
                      ...x,
                      pending: false,
                      citationStatus: meta.citationStatus,
                      citedMemoryIds: meta.citedMemoryIds,
                      moodHint: meta.moodHint,
                    }
                  : x
              )
            );
          },
          onError: (msg) => {
            setError(msg);
          },
          onDone: () => {
            setStreaming(false);
            setMessages((m) => m.map((x) => (x.id === petMsg.id ? { ...x, pending: false } : x)));
          },
        }
      );
    } catch (e: any) {
      setError(e?.message || 'Chat stream failed');
      setStreaming(false);
    }
  };

  const askChips = profile
    ? [
        `Tell me about your friends`,
        profile.relations[0] ? `What is ${profile.relations[0].displayName} like?` : `What's your favorite spot?`,
        `How were you feeling lately?`,
        `Any safety concerns I should know?`,
      ]
    : [];

  if (!petId) return null;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-warm-gray/30 bg-surface-dark flex items-center gap-3 shrink-0">
        <button onClick={() => onNavigate('pets')} className="p-2 rounded-xl hover:bg-warm-gray/20">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="flex items-center gap-3 flex-1">
          <div
            className="size-10 rounded-full bg-warm-gray/30 bg-cover bg-center border-2 border-primary/30"
            style={profile?.pet.photoUrl ? { backgroundImage: `url('${profile.pet.photoUrl}')` } : undefined}
          >
            {!profile?.pet.photoUrl && (
              <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-base text-primary">pets</span>
              </div>
            )}
          </div>
          <div>
            <h2 className="font-bold">{profile?.pet.name || 'Loading…'}</h2>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest">
              {profile?.growthStageLabel?.zh || '雏形期'}
            </div>
          </div>
        </div>
        <button onClick={() => onNavigate('pet-profile')} className="text-xs bg-warm-gray/20 hover:bg-warm-gray/30 px-3 py-2 rounded-xl">
          Profile
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 mt-12">
            <span className="material-symbols-outlined text-5xl text-primary mb-3 block">chat_bubble</span>
            <p className="mb-6">Say hi to {profile?.pet.name || 'your pet'}.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {askChips.map((c) => (
                <button
                  key={c}
                  onClick={() => setInput(c)}
                  className="text-xs bg-surface-dark hover:bg-warm-gray/20 border border-warm-gray/30 rounded-full px-4 py-2"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                m.role === 'user'
                  ? 'bg-primary text-background-dark font-bold'
                  : 'bg-surface-dark border border-warm-gray/30'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text || (m.pending ? '…' : '')}</p>
              {m.role === 'pet' && m.citationStatus && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${CITATION_LABEL[m.citationStatus]?.color || ''}`}>
                    {CITATION_LABEL[m.citationStatus]?.label || m.citationStatus}
                  </span>
                  {(m.citedMemoryIds?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-slate-500">refs: {m.citedMemoryIds!.length}</span>
                  )}
                  {m.moodHint && <span className="text-[10px] text-slate-500">mood: {m.moodHint}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="px-6 pb-2 text-xs text-red-400">{error}</div>}

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="p-4 border-t border-warm-gray/30 bg-surface-dark shrink-0"
      >
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${profile?.pet.name || 'your pet'}…`}
            className="flex-1 bg-background-dark/60 border border-warm-gray/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="bg-primary text-background-dark font-bold px-5 py-3 rounded-xl disabled:opacity-40 hover:scale-105 transition"
          >
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PetChat;
