// Lightweight persona navigation state shared across pages.

const STORAGE_KEY = 'petday_persona_active_pet';

export function setActivePetId(petId: string | null): void {
  if (petId) localStorage.setItem(STORAGE_KEY, petId);
  else localStorage.removeItem(STORAGE_KEY);
}

export function getActivePetId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function growthStageDisplay(stage: string | undefined): { en: string; zh: string } {
  switch (stage) {
    case 'embryonic': return { en: 'Spark', zh: '雏形期' };
    case 'forming': return { en: 'Forming Voice', zh: '成形期' };
    case 'recognizable': return { en: 'Recognizable', zh: '成形期' };
    case 'soul_bonded': return { en: 'Soul Bonded', zh: '灵魂契合期' };
    default: return { en: 'New', zh: '雏形期' };
  }
}
