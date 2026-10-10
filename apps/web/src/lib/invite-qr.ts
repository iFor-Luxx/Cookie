// Formatos de QR. El escáner acepta el payload completo o el token pelado
// (compatibilidad con copiar/pegar). Dos clases:
// - invite: unirse como SEGUNDO miembro (pide un nombre, una sola vez).
// - login: entrar como UNO MISMO (el PC muestra, el celular aprueba).
export const INVITE_QR_SCHEME = "cookie://invite/";
export const LOGIN_QR_SCHEME = "cookie://login/";

export type QrPayload =
  | { kind: "invite"; token: string }
  | { kind: "login"; attemptId: string; code: string };

export function inviteQrPayload(inviteToken: string): string {
  return `${INVITE_QR_SCHEME}${inviteToken.trim()}`;
}

/** Formatea lo que escribe el usuario: mayúsculas, solo símbolos
 * válidos del token (sin 0/O/1/I), máximo 9 caracteres. */
export function formatInviteTokenInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, 9);
}

export function loginQrPayload(attemptId: string, code: string): string {
  return `${LOGIN_QR_SCHEME}${attemptId.trim()}/${code.trim()}`;
}

export function parseQrPayload(text: string): QrPayload | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith(INVITE_QR_SCHEME)) {
    const token = t.slice(INVITE_QR_SCHEME.length).trim();
    return token.length > 0 ? { kind: "invite", token } : null;
  }
  if (t.startsWith(LOGIN_QR_SCHEME)) {
    const rest = t.slice(LOGIN_QR_SCHEME.length);
    const sep = rest.indexOf("/");
    const attemptId = (sep < 0 ? rest : rest.slice(0, sep)).trim();
    const code = (sep < 0 ? "" : rest.slice(sep + 1)).trim();
    return attemptId.length > 0 && code.length > 0
      ? { kind: "login", attemptId, code }
      : null;
  }
  return { kind: "invite", token: t };
}
