// Pet AI Persona — shared types

export type Species = 'cat' | 'dog' | 'other';

export type VoiceTone =
  | 'kitten'
  | 'puppy'
  | 'aloof'
  | 'eager'
  | 'sage'
  | 'goofball'
  | 'cuddler'
  | 'aloof_explorer';

export type GrowthStage = 'embryonic' | 'forming' | 'recognizable' | 'soul_bonded';
// Display labels (Chinese): 雏形期 / 成形期 / 灵魂契合期
// Mapping: embryonic=雏形期, forming=成形期, recognizable=成形期, soul_bonded=灵魂契合期

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'social'
  | 'preference'
  | 'safety'
  | 'milestone'
  | 'user_fact';

export type CitationStatus = 'verified' | 'partial' | 'unsupported' | 'vibe_only';

export type RelationshipStatus =
  | 'Bestie'
  | 'Soulmate'
  | 'Rival'
  | 'Acquaintance'
  | 'Stranger';

export interface Pet {
  id: string;
  ownerKey: string;
  name: string;
  normalizedName: string;
  species: Species;
  breed?: string;
  visualSignature?: string;
  dateOfBirth?: string;
  photoUrl?: string;
  voicePersona: VoiceTone;
  level: number;
  videoCount: number;
  totalWatchSeconds: number;
  createdAt: number;
  updatedAt: number;
  isMerged?: boolean;
  mergedFromPetIds?: string[];
}

export interface PetTraitScores {
  curiosity: number;
  sociability: number;
  bravery: number;
  affection: number;
  energy: number;
}

export interface PetTraits {
  petId: string;
  scores: PetTraitScores;
  evidence: PetTraitScores;
  // Each stable trait dimension carries the source memory IDs that moved it
  scoreReasons?: Partial<Record<keyof PetTraitScores, string[]>>;
  likes: Array<{
    subject: string;
    strength: number;
    firstSeenAt: number;
    lastSeenAt: number;
    sourceMemoryIds: string[];
  }>;
  dislikes: Array<{
    subject: string;
    strength: number;
    firstSeenAt: number;
    lastSeenAt: number;
    sourceMemoryIds: string[];
  }>;
  catchphrases: string[];
  routines: Array<{ pattern: string; confidence: number; sourceMemoryIds: string[] }>;
  dirtyForRebuild?: boolean;
  updatedAt: number;
}

export interface PetMemorySource {
  sessionId?: string;
  timestamp?: string;
  videoUrl?: string;
  coverUrl?: string;
  framePath?: string;
  chatThreadId?: string;
}

export interface PetMemory {
  id: string;
  petId: string;
  ownerKey: string;
  type: MemoryType;
  text: string;
  textZh?: string;
  importance: number; // 1-10 baseline
  importanceCurrent: number; // decaying value
  decayBaseline: number;
  confidence: number; // 0-100
  emotion?: string;
  embedding?: number[]; // 768 float32; optional — falls back to lexical retrieval
  // Repeated-observation strength (separate from accessCount).
  // Incremented when W4 dedupe merges new observation into existing memory.
  strength: number;
  source: PetMemorySource;
  relatedPetIds?: string[];
  relatedMemoryIds?: string[];
  consolidatedInto?: string;
  lastAccessedAt: number;
  accessCount: number;
  createdAt: number;
  userVerdict?: 'confirmed' | 'wrong' | 'private';
  archived?: boolean;
}

export interface PetPriors {
  petId: string;
  voiceTone: VoiceTone;
  speciesPriors: string[];
  breedPriors: string[];
  lifeStagePriors: string[];
  source: 'template' | 'llm';
  createdAt: number;
}

export interface PetRelationEdge {
  otherKey: string;
  displayName: string;
  type: 'friend_pet' | 'human' | 'unknown_animal';
  status: RelationshipStatus;
  bondScore: number;
  lastInteractionAt: number;
  encounterCount: number;
  totalInteractionSeconds: number;
  lastSeenAt: number;
  firstSeenAt: number;
  notableMemoryIds: string[];
  externalPetId?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  petId: string;
  ownerKey: string;
  role: 'user' | 'pet' | 'system';
  speakerLabel?: string;
  text: string;
  citedMemoryIds?: string[];
  citationStatus?: CitationStatus;
  moodHint?: string;
  createdAt: number;
}

export interface ChatThread {
  id: string;
  petId: string;
  ownerKey: string;
  title?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersonaSnapshot {
  id: string;
  petId: string;
  snapshotAt: number;
  traits: PetTraits;
  voicePersona: VoiceTone;
  level: number;
  growthStage: GrowthStage;
  summary: string;
  // every claim must be traceable to memory ids
  highlightMemoryIds: string[];
}

// Public API DTOs

export interface PetProfileDTO {
  pet: Pet;
  traits: PetTraits | null;
  priors: PetPriors | null;
  growthStage: GrowthStage;
  memoryCount: number;
  recentMemories: PetMemory[];
  relations: PetRelationEdge[];
  sessionIds: string[];
}

export interface ChatRequestPayload {
  threadId?: string;
  text: string;
  speakerLabelHint?: string;
}

export interface ChatStreamMeta {
  citedMemoryIds: string[];
  citationStatus: CitationStatus;
  moodHint?: string;
  suggestedFollowups?: string[];
  threadId: string;
  messageId: string;
}
