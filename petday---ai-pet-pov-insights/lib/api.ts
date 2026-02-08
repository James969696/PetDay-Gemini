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
