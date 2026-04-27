// Pet AI Persona — identity resolution and innate priors initialization.
//
// Stable petId is a random nanoid-style string. The (visitorId, normalizedName)
// pair maps to the petId via the pets_index collection — renaming a pet only
// updates the index, never the id itself, so historical sessions/memories never
// get orphaned.

import {
  createPetWithIndex,
  getPetById,
  getPetIdByIndex,
  normalizeName,
  randomId,
  setPriors,
} from './memoryStore.ts';
import type { Pet, PetPriors, Species, VoiceTone } from './personaTypes.ts';

export interface ResolvePetArgs {
  visitorId: string;
  petName: string;
  species?: Species;
  breed?: string;
  dateOfBirth?: string;
}

export async function resolvePet(args: ResolvePetArgs): Promise<{ pet: Pet; created: boolean }> {
  const visitorId = String(args.visitorId || '').trim();
  if (!visitorId) throw new Error('visitorId required to resolve pet');
  const name = String(args.petName || '').trim();
  if (!name) throw new Error('petName required');

  const normalizedName = normalizeName(name);

  const existingId = await getPetIdByIndex(visitorId, normalizedName);
  if (existingId) {
    const pet = await getPetById(existingId);
    if (pet) return { pet, created: false };
  }

  // Create
  const species = args.species || inferSpeciesFromBreed(args.breed) || 'other';
  const now = Date.now();
  const newPet: Pet = {
    id: `pet-${randomId(12)}`,
    ownerKey: visitorId,
    name,
    normalizedName,
    species,
    breed: args.breed,
    dateOfBirth: args.dateOfBirth,
    voicePersona: pickInitialVoice(species, args.breed),
    level: 0,
    videoCount: 0,
    totalWatchSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };

  // Transactional create-if-not-exists. If a concurrent request already created
  // the index entry, we adopt the winner's petId.
  const winningId = await createPetWithIndex(newPet);
  if (winningId !== newPet.id) {
    const pet = await getPetById(winningId);
    if (pet) return { pet, created: false };
  }

  // Innate priors
  await setPriors(buildInnatePriors(newPet));

  return { pet: newPet, created: true };
}

export async function lookupPetByName(visitorId: string, petName: string): Promise<Pet | null> {
  if (!visitorId || !petName) return null;
  const normalizedName = normalizeName(petName);
  const petId = await getPetIdByIndex(visitorId, normalizedName);
  if (!petId) return null;
  return await getPetById(petId);
}

function inferSpeciesFromBreed(breed?: string): Species | undefined {
  if (!breed) return undefined;
  const lower = breed.toLowerCase();
  const catWords = ['cat', 'tabby', 'siamese', 'persian', 'sphynx', 'ragdoll', 'maine coon', 'bengal'];
  const dogWords = ['dog', 'retriever', 'labrador', 'corgi', 'shepherd', 'poodle', 'husky', 'bulldog', 'pomeranian', 'beagle', 'shiba'];
  if (catWords.some((w) => lower.includes(w))) return 'cat';
  if (dogWords.some((w) => lower.includes(w))) return 'dog';
  return undefined;
}

function pickInitialVoice(species: Species, breed?: string): VoiceTone {
  if (species === 'dog') return 'eager';
  if (species === 'cat') {
    const lower = (breed || '').toLowerCase();
    if (lower.includes('siamese') || lower.includes('sphynx')) return 'aloof';
    if (lower.includes('maine coon') || lower.includes('persian')) return 'sage';
    return 'kitten';
  }
  return 'kitten';
}

// Template-only innate priors. Phase 2 swaps to a 1-call LLM generation.
export function buildInnatePriors(pet: Pet): PetPriors {
  const speciesPriors = SPECIES_PRIORS[pet.species] || SPECIES_PRIORS.other;
  const breedPriors = breedPriorsFor(pet.breed);
  const lifeStagePriors = lifeStagePriorsFor(pet.dateOfBirth, pet.species);

  return {
    petId: pet.id,
    voiceTone: pet.voicePersona,
    speciesPriors,
    breedPriors,
    lifeStagePriors,
    source: 'template',
    createdAt: Date.now(),
  };
}

const SPECIES_PRIORS: Record<Species, string[]> = {
  cat: [
    'I am a cat — I value high places and quiet observation.',
    'New smells make me pause and decide before approaching.',
    'I show love by sitting nearby, not by being loud.',
  ],
  dog: [
    'I am a dog — moving things and friendly humans light me up.',
    'Smells tell me whole stories I want to share.',
    'I keep my favorite people in sight when I can.',
  ],
  other: [
    'I notice changes in my home before anyone says anything.',
    'I prefer routines that feel safe.',
  ],
};

function breedPriorsFor(breed?: string): string[] {
  if (!breed) return [];
  const lower = breed.toLowerCase();
  const result: string[] = [];
  if (lower.includes('maine coon')) {
    result.push('Maine Coons are larger than most cats and patient with humans.');
  }
  if (lower.includes('siamese')) {
    result.push('Siamese cats are talkative and bond strongly with one human.');
  }
  if (lower.includes('persian')) {
    result.push('Persian cats prefer calm corners over chaotic play.');
  }
  if (lower.includes('tabby')) {
    result.push('Tabby cats are curious and nimble climbers.');
  }
  if (lower.includes('retriever') || lower.includes('labrador')) {
    result.push('Retrievers love water, fetch, and friendly faces.');
  }
  if (lower.includes('corgi')) {
    result.push('Corgis herd whatever moves and have strong opinions.');
  }
  if (lower.includes('shepherd')) {
    result.push('Shepherds watch the perimeter and notice strangers first.');
  }
  if (lower.includes('shiba')) {
    result.push('Shibas have their own agenda and a famous side-eye.');
  }
  return result;
}

function lifeStagePriorsFor(dateOfBirth?: string, species?: Species): string[] {
  if (!dateOfBirth) return [];
  const dob = Date.parse(dateOfBirth);
  if (Number.isNaN(dob)) return [];
  const months = (Date.now() - dob) / (1000 * 60 * 60 * 24 * 30.44);
  if (species === 'cat') {
    if (months < 6) return ['I am a kitten — everything is new, and most sounds startle me.'];
    if (months < 18) return ['I am young — I leap first and think second.'];
    if (months > 120) return ['I am older — I prefer warm spots and predictable days.'];
  }
  if (species === 'dog') {
    if (months < 12) return ['I am a puppy — I need to chew and run.'];
    if (months < 24) return ['I am almost grown — energetic, learning my limits.'];
    if (months > 84) return ['I am a senior dog — naps are sacred and stairs are honest.'];
  }
  return [];
}
