
export type Page =
  | 'landing'
  | 'gallery'
  | 'dashboard'
  | 'analysis'
  | 'settings'
  | 'discovery'
  | 'pets'
  | 'pet-profile'
  | 'pet-chat';

export interface PetStory {
  id: string;
  title: string;
  date: string;
  location: string;
  duration: string;
  thumbnail: string;
  mood: string;
  tags: string[];
  energy: 'High' | 'Low' | 'Moderate';
}

export interface ActivityLog {
  time: string;
  label: string;
  icon: string;
  originalTime?: string;
}

export interface AnalysisData {
  title: string;
  aiNote: string;
  narrativeSegments?: { text: string; timestamp: string }[];
  moodData: { name: string; value: number; originalTime?: string }[];
  moodDataHighlight?: { name: string; value: number; originalTime?: string }[];
  scenery: {
    description: string;
    timestamp: string;
    url?: string;
    sceneryLabel?: string;
    stayDuration?: number;
    originalTime?: string;
  }[];
  friends: {
    name: string;
    type: string;
    timestamp: string;  // Primary timestamp (first/best interaction)
    timestamps?: { time: string; duration?: number }[];  // All interaction timestamps
    url?: string;
    box?: [number, number, number, number];
    interactionNature?: string;
    duration?: number;  // Total duration across all interactions
    frequency?: number;
    relationshipStatus?: 'Bestie' | 'Soulmate' | 'Rival' | 'Acquaintance';
  }[];
  timeline: ActivityLog[];
  timelineHighlight?: ActivityLog[];
  safetyAlerts?: { type: 'warning' | 'danger'; message: string; timestamp: string }[];
  dietaryHabits?: { item: string; action: 'eating' | 'drinking'; timestamp: string; url?: string }[];
}

// ---------------- Pet AI Persona ----------------

export type Species = 'cat' | 'dog' | 'other';
export type VoiceTone =
  | 'kitten' | 'puppy' | 'aloof' | 'eager' | 'sage'
  | 'goofball' | 'cuddler' | 'aloof_explorer';

export type GrowthStage = 'embryonic' | 'forming' | 'recognizable' | 'soul_bonded';

export interface GrowthStageLabel {
  en: string;
  zh: string;
}

export type CitationStatus = 'verified' | 'partial' | 'unsupported' | 'vibe_only';

export type MemoryType =
  | 'episodic' | 'semantic' | 'social' | 'preference'
  | 'safety' | 'milestone' | 'user_fact';

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

export interface PetTraits {
  petId: string;
  scores: {
    curiosity: number;
    sociability: number;
    bravery: number;
    affection: number;
    energy: number;
  };
  evidence: PetTraits['scores'];
  scoreReasons?: Partial<Record<keyof PetTraits['scores'], string[]>>;
  likes: Array<{ subject: string; strength: number; firstSeenAt: number; lastSeenAt: number; sourceMemoryIds: string[] }>;
  dislikes: Array<{ subject: string; strength: number; firstSeenAt: number; lastSeenAt: number; sourceMemoryIds: string[] }>;
  catchphrases: string[];
  routines: Array<{ pattern: string; confidence: number; sourceMemoryIds: string[] }>;
  dirtyForRebuild?: boolean;
  updatedAt: number;
}

export interface PetMemory {
  id: string;
  petId: string;
  ownerKey: string;
  type: MemoryType;
  text: string;
  textZh?: string;
  importance: number;
  importanceCurrent: number;
  decayBaseline: number;
  confidence: number;
  emotion?: string;
  strength: number;
  source: {
    sessionId?: string;
    timestamp?: string;
    videoUrl?: string;
    coverUrl?: string;
    framePath?: string;
    chatThreadId?: string;
  };
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
  status: 'Bestie' | 'Soulmate' | 'Rival' | 'Acquaintance' | 'Stranger';
  bondScore: number;
  lastInteractionAt: number;
  encounterCount: number;
  totalInteractionSeconds: number;
  lastSeenAt: number;
  firstSeenAt: number;
  notableMemoryIds: string[];
  externalPetId?: string;
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
  highlightMemoryIds: string[];
}

export interface PetListItem extends Pet {
  memoryCount: number;
  growthStage: GrowthStage;
  growthStageLabel: GrowthStageLabel;
}

export interface PetProfileResponse {
  pet: Pet;
  traits: PetTraits | null;
  priors: PetPriors | null;
  memoryCount: number;
  recentMemories: PetMemory[];
  relations: PetRelationEdge[];
  snapshots: PersonaSnapshot[];
  growthStage: GrowthStage;
  growthStageLabel: GrowthStageLabel;
}

export interface ChatMessageRecord {
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

export interface ChatStreamMeta {
  citedMemoryIds: string[];
  citationStatus: CitationStatus;
  moodHint?: string;
  suggestedFollowups?: string[];
  threadId: string;
  messageId: string;
}
