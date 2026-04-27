// Pet AI Persona — R5b Citation Validator.
//
// Evidence-bound is enforced here, not in prompts. We extract verifiable nouns
// from the model's reply and check that each has support in either the
// model-cited memories or the retrieval pool. If a specific named claim has no
// support, we soft-rewrite that span before the reply leaves the server.

import type { CitationStatus, PetMemory, PetRelationEdge, PetTraits } from './personaTypes.ts';

export interface ValidatorInputs {
  reply: string;
  selfCitedMemoryIds: string[]; // what the model itself reported
  retrievalPool: PetMemory[]; // top memories sent in the prompt
  knownEntities: KnownEntities;
}

export interface KnownEntities {
  friendNames: string[]; // e.g., ["Snowball", "Mochi"]
  likedSubjects: string[];
  dislikedSubjects: string[];
}

export interface ValidatorResult {
  reply: string;
  citationStatus: CitationStatus;
  supportedCitedMemoryIds: string[];
  rewrites: Array<{ original: string; replacement: string; reason: string }>;
  hasSpecifics: boolean;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'yours',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'it', 'its',
  'and', 'or', 'but', 'so', 'because', 'when', 'while', 'with', 'without',
  'today', 'yesterday', 'tomorrow', 'now', 'then', 'sometime', 'someday',
  'one', 'two', 'three',
  'home', 'outside', 'inside',
  'mom', 'dad', 'human',
]);

const VERIFIABLE_TIME_PHRASES = [
  /\b(this morning|tonight|last night|earlier today|that one time)\b/i,
];

// MARK 1: Extract verifiable specifics from reply.
export function extractVerifiableSpans(reply: string): string[] {
  const spans = new Set<string>();
  // Capitalized non-sentence-initial words → likely proper nouns (friend names, places).
  const sentences = reply.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
    // Skip the first token of the sentence (could be ordinary capitalization).
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (STOPWORDS.has(t.toLowerCase())) continue;
      spans.add(t);
    }
  }
  // Timestamps — MM:SS
  const timestamps = reply.match(/\b\d{1,2}:\d{2}\b/g) || [];
  for (const ts of timestamps) spans.add(ts);
  // Vague time phrases
  for (const re of VERIFIABLE_TIME_PHRASES) {
    const m = reply.match(re);
    if (m) spans.add(m[0]);
  }
  return Array.from(spans);
}

// MARK 2: Test whether a verifiable span has supporting evidence.
function hasSupportFor(
  span: string,
  cited: PetMemory[],
  pool: PetMemory[],
  known: KnownEntities
): { supported: boolean; bySource: 'cited' | 'pool' | 'persona' | null } {
  const lower = span.toLowerCase();

  // Cited memories first
  for (const m of cited) {
    if (m.text.toLowerCase().includes(lower)) return { supported: true, bySource: 'cited' };
    if (m.source?.timestamp && lower.includes(m.source.timestamp)) return { supported: true, bySource: 'cited' };
  }
  // Then full pool (could auto-cite)
  for (const m of pool) {
    if (m.text.toLowerCase().includes(lower)) return { supported: true, bySource: 'pool' };
    if (m.source?.timestamp && lower.includes(m.source.timestamp)) return { supported: true, bySource: 'pool' };
  }
  // Persona structural facts
  if (known.friendNames.some((n) => n.toLowerCase() === lower)) {
    return { supported: true, bySource: 'persona' };
  }
  if (known.likedSubjects.some((s) => s.toLowerCase() === lower)) {
    return { supported: true, bySource: 'persona' };
  }
  if (known.dislikedSubjects.some((s) => s.toLowerCase() === lower)) {
    return { supported: true, bySource: 'persona' };
  }
  return { supported: false, bySource: null };
}

// MARK 3: Soft rewrite — replace unsupported specific name with a vague description.
function softRewrite(reply: string, span: string): string {
  const replacement = pickFuzzyReplacement(span);
  // Replace whole-word, all occurrences, preserving case-insensitive match.
  const re = new RegExp(`\\b${escapeRegex(span)}\\b`, 'g');
  return reply.replace(re, replacement);
}

function pickFuzzyReplacement(span: string): string {
  if (/^\d{1,2}:\d{2}$/.test(span)) return 'sometime ago';
  if (/^[A-Z]/.test(span)) return 'someone I sometimes meet';
  return 'something';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// MARK 4: main entry
export function validateCitations(input: ValidatorInputs): ValidatorResult {
  const { reply, selfCitedMemoryIds, retrievalPool, knownEntities } = input;
  const cited = retrievalPool.filter((m) => selfCitedMemoryIds.includes(m.id));

  const spans = extractVerifiableSpans(reply);
  const rewrites: ValidatorResult['rewrites'] = [];
  let mutatedReply = reply;
  const supportedIds = new Set<string>();
  let hasUnsupportedSpecifics = false;
  let hasPartial = false;

  for (const span of spans) {
    const { supported, bySource } = hasSupportFor(span, cited, retrievalPool, knownEntities);
    if (!supported) {
      hasUnsupportedSpecifics = true;
      const replacement = pickFuzzyReplacement(span);
      mutatedReply = softRewrite(mutatedReply, span);
      rewrites.push({ original: span, replacement, reason: 'no supporting memory' });
      continue;
    }
    // For supported spans, accumulate the citing memory IDs.
    if (bySource === 'cited' || bySource === 'pool') {
      const memHit = retrievalPool.find((m) => m.text.toLowerCase().includes(span.toLowerCase()));
      if (memHit) supportedIds.add(memHit.id);
      if (bySource === 'pool') hasPartial = true;
    }
  }

  // Self-cited IDs that actually correspond to memories in the pool also count
  // as supported (covers "vibe-cite"; we don't auto-strip them as long as their
  // content didn't fail the per-span check).
  for (const id of selfCitedMemoryIds) {
    if (retrievalPool.some((m) => m.id === id)) supportedIds.add(id);
  }

  let citationStatus: CitationStatus;
  if (spans.length === 0) {
    citationStatus = 'vibe_only';
  } else if (hasUnsupportedSpecifics) {
    citationStatus = 'unsupported';
  } else if (hasPartial) {
    citationStatus = 'partial';
  } else {
    citationStatus = 'verified';
  }

  return {
    reply: mutatedReply,
    citationStatus,
    supportedCitedMemoryIds: Array.from(supportedIds),
    rewrites,
    hasSpecifics: spans.length > 0,
  };
}

// MARK 5: helper for skip-Pass-B optimization — if validator decides vibe_only,
// the chat service can avoid the second LLM round entirely.
export function isReplyVibeOnly(reply: string): boolean {
  return extractVerifiableSpans(reply).length === 0;
}

export function buildKnownEntities(
  traits: PetTraits | null,
  relations: PetRelationEdge[]
): KnownEntities {
  return {
    friendNames: relations.map((r) => r.displayName).filter(Boolean),
    likedSubjects: traits?.likes?.map((l) => l.subject) || [],
    dislikedSubjects: traits?.dislikes?.map((d) => d.subject) || [],
  };
}
