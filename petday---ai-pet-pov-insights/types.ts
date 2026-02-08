
export type Page = 'landing' | 'gallery' | 'dashboard' | 'analysis' | 'settings' | 'discovery';

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
