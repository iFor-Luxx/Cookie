// @cookie/core — formato del token de invitación.
// 9 caracteres, mayúsculas y dígitos, sin 0/O/1/I para evitar
// confusiones al dictarlo o escribirlo a mano.
// Alfabeto de 32 símbolos (5 bits por carácter, 45 bits en total).
export const INVITE_TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const INVITE_TOKEN_LENGTH = 9;

export const INVITE_TOKEN_REGEX = /^[A-HJ-NP-Z2-9]{9}$/;

/** Genera un token a partir de bytes aleatorios (un byte por carácter). */
export function generateInviteToken(takeByte: () => number): string {
  let out = "";
  for (let i = 0; i < INVITE_TOKEN_LENGTH; i++) {
    // 256 es múltiplo de 32: el módulo no introduce sesgo.
    out += INVITE_TOKEN_ALPHABET[takeByte() % 32];
  }
  return out;
}

/** Normaliza lo que escribe el usuario: mayúsculas y sin espacios. */
export function normalizeInviteToken(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isInviteTokenFormat(token: string): boolean {
  return INVITE_TOKEN_REGEX.test(token);
}
