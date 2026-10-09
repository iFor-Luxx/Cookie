// Último espacio conocido en este dispositivo (solo para rellenar la
// recuperación, nunca para memorizar el UUID).
// El ID del espacio NO es credencial (SDD §05); tokens y secretos jamás
// tocan localStorage (van en memoria + store seguro nativo).
const KEY = "cookie.lastSpaceId";

export function saveLastSpaceId(spaceId: string): void {
  try {
    localStorage.setItem(KEY, spaceId);
  } catch {
    // Almacenamiento no disponible: la recuperación pedirá el ID a mano.
  }
}

export function loadLastSpaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
