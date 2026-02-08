
import { PetStory, AnalysisData } from './types';

export const COLORS = {
  primary: "#f2cc0d",
  background: "#1a180b",
  card: "#2a2718",
  textSecondary: "#cbc190",
};

export const MOCK_STORIES: PetStory[] = [
  {
    id: '1',
    title: "Luna's Morning Run",
    date: 'Oct 24, 2023',
    location: 'Central Park',
    duration: '04:22',
    thumbnail: 'https://picsum.photos/seed/luna/800/450',
    mood: 'HAPPY',
    tags: ['4 FRIENDS', 'HIGH ENERGY'],
    energy: 'High'
  },
  {
    id: '2',
    title: "Oliver's Window Watch",
    date: 'Oct 22, 2023',
    location: 'Home',
    duration: '08:15',
    thumbnail: 'https://picsum.photos/seed/oliver/800/450',
    mood: 'CURIOUS',
    tags: ['LOW ENERGY'],
    energy: 'Low'
  },
  {
    id: '3',
    title: "Max's Fetch Session",
    date: 'Oct 20, 2023',
    location: 'Backyard',
    duration: '12:45',
    thumbnail: 'https://picsum.photos/seed/max/800/450',
    mood: 'EXCITED',
    tags: ['12 BALLS', 'FAST'],
    energy: 'High'
  }
];

export const MOCK_ANALYSIS: AnalysisData = {
  id: '3',
  title: "Daily Highlight: Max's Big Day",
  aiNote: "Max spent 40% of his time exploring the north trail. His excitement levels peaked when meeting 'Buddy' at 0:45. No major stressors detected.",
  moodData: [
    { name: '0:00', value: 40 },
    { name: '0:15', value: 35 },
    { name: '0:30', value: 60 },
    { name: '0:45', value: 90 },
    { name: '1:00', value: 70 },
    { name: '1:15', value: 45 },
    { name: '1:30', value: 30 },
    { name: '1:45', value: 85 },
    { name: '2:00', value: 55 },
    { name: '2:15', value: 40 },
  ],
  scenery: [
    'https://picsum.photos/seed/s1/300/300',
    'https://picsum.photos/seed/s2/300/300',
    'https://picsum.photos/seed/s3/300/300',
  ],
  friends: [
    { name: 'Buddy', type: 'Dog', img: 'https://picsum.photos/seed/d1/100/100' },
    { name: 'Mailman', type: 'Human', img: 'https://picsum.photos/seed/h1/100/100' },
    { name: 'Luna', type: 'Cat', img: 'https://picsum.photos/seed/c1/100/100' },
  ],
  timeline: [
    { time: '0:12', label: 'Breakfast', icon: 'restaurant' },
    { time: '0:45', label: 'Fetch Play', icon: 'sports_tennis' },
    { time: '1:30', label: 'New Trail', icon: 'explore' },
    { time: '2:05', label: 'Greeting', icon: 'group' },
  ]
};
