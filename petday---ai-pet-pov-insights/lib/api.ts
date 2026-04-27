import type { ChatStreamMeta } from '../types';

const fallbackApiBase = 'http://localhost:3001';
const configuredApiBase = typeof import.meta.env.VITE_API_BASE_URL === 'string'
  ? import.meta.env.VITE_API_BASE_URL.trim()
  : '';
const resolvedApiBase = configuredApiBase || (import.meta.env.DEV ? fallbackApiBase : '');

export const API_BASE = resolvedApiBase.replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

// ---------------- Visitor identity (matches Dashboard.tsx) ----------------

export function getVisitorId(): string {
  const urlVisitorId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('visitorId')?.trim()
    : '';
  if (urlVisitorId) {
    localStorage.setItem('petday_visitor_id', urlVisitorId);
    return urlVisitorId;
  }

  let id = localStorage.getItem('petday_visitor_id');
  if (!id) {
    id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('petday_visitor_id', id);
  }
  return id;
}

function visitorHeaders(extra?: HeadersInit): HeadersInit {
  const base: Record<string, string> = {
    'X-Visitor-Id': getVisitorId(),
  };
  if (extra) {
    if (extra instanceof Headers) extra.forEach((v, k) => { base[k] = v; });
    else Object.assign(base, extra as Record<string, string>);
  }
  return base;
}

// ---------------- Persona REST helpers ----------------

export async function fetchPets(): Promise<any[]> {
  const res = await fetch(apiUrl(`/api/pets?visitorId=${encodeURIComponent(getVisitorId())}`), {
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load pets (${res.status})`);
  return res.json();
}

export async function fetchPetProfile(petId: string): Promise<any> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}`), {
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load pet (${res.status})`);
  return res.json();
}

export async function fetchPetMemories(petId: string): Promise<any[]> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/memories`), {
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load memories (${res.status})`);
  const json = await res.json();
  return json.memories || [];
}

export async function patchPetMemory(petId: string, memoryId: string, body: { userVerdict: 'confirmed' | 'wrong' | 'private' }): Promise<void> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/memories/${encodeURIComponent(memoryId)}`), {
    method: 'PATCH',
    headers: visitorHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to update memory (${res.status})`);
}

export async function deletePetMemory(petId: string, memoryId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/memories/${encodeURIComponent(memoryId)}`), {
    method: 'DELETE',
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete memory (${res.status})`);
}

export async function rebuildPetTraits(petId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/rebuild`), {
    method: 'POST',
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Rebuild failed (${res.status})`);
}

export async function deletePet(petId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}`), {
    method: 'DELETE',
    headers: visitorHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function exportPetData(petId: string): Promise<void> {
  const url = apiUrl(`/api/pets/${encodeURIComponent(petId)}/export.json`);
  // Use fetch then blob to attach visitor header
  const res = await fetch(url, { headers: visitorHeaders() });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${petId}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------- Chat streaming (fetch ReadableStream + SSE frames) ----------------

export interface ChatStreamCallbacks {
  onDelta: (text: string) => void;
  onMeta: (meta: ChatStreamMeta) => void;
  onThread?: (threadId: string) => void;
  onError?: (err: string) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

export async function chatStream(
  petId: string,
  payload: { text: string; threadId?: string; speakerLabelHint?: string },
  cb: ChatStreamCallbacks
): Promise<void> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/chat`), {
    method: 'POST',
    headers: visitorHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal: cb.signal,
  });
  if (!res.ok || !res.body) {
    cb.onError?.(`Chat failed (${res.status})`);
    cb.onDone?.();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        if (!frame || frame.startsWith(':')) continue; // comment/heartbeat
        const evMatch = frame.match(/^event:\s*(\w+)/m);
        const dataMatch = frame.match(/^data:\s*(.+)$/m);
        if (!evMatch || !dataMatch) continue;
        const event = evMatch[1];
        let data: any = {};
        try { data = JSON.parse(dataMatch[1]); } catch { /* ignore */ }
        switch (event) {
          case 'delta': cb.onDelta(data.text || ''); break;
          case 'meta':  cb.onMeta(data as ChatStreamMeta); break;
          case 'thread': cb.onThread?.(data.threadId); break;
          case 'error': cb.onError?.(data.error || 'Stream error'); break;
          case 'done':  cb.onDone?.(); return;
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') cb.onError?.(String(e?.message || e));
  } finally {
    cb.onDone?.();
  }
}

export async function fetchChatThreads(petId: string): Promise<any[]> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/chats`), {
    headers: visitorHeaders(),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.threads || [];
}

export async function fetchChatMessages(petId: string, threadId: string): Promise<any[]> {
  const res = await fetch(apiUrl(`/api/pets/${encodeURIComponent(petId)}/chats?threadId=${encodeURIComponent(threadId)}`), {
    headers: visitorHeaders(),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.messages || [];
}
