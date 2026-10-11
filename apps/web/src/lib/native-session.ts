// H6: puente TypeScript ↔ nativo vía plugin Preferences (sin código Java/Kotlin
// propio para esto). La sesión espejada la lee SyncWorker; el token FCM lo
// escribe CookieMessagingService y la web lo sube al servidor.
//
// La WebView pierde sessionStorage al cerrar la app: al abrir, la sesión se
// restaura desde este espejo para seguir en la misma sala sin crear otra.
// Solo nativo: en web Preferences es localStorage y el refresh jamás debe
// tocarlo (los tokens van en memoria + store seguro nativo).
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { api, apiBaseUrl, type Session } from "./api";

const SESSION_KEY = "cookie.session";
const API_BASE_KEY = "cookie.apiBase";
const FCM_TOKEN_KEY = "cookie.fcmToken";

let spaceIdHolder: string | null = null;
let lastSession: Session | null = null;

function native(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function setNativeSpace(spaceId: string | null): void {
  spaceIdHolder = spaceId;
  void mirror();
}

async function mirror(): Promise<void> {
  if (!native()) return;
  try {
    await Preferences.set({ key: API_BASE_KEY, value: apiBaseUrl() });
  } catch {
    // Fuera de nativo persiste sessionStorage (ya lo hace ApiClient).
  }
  try {
    if (lastSession) {
      await Preferences.set({
        key: SESSION_KEY,
        value: JSON.stringify({ ...lastSession, spaceId: spaceIdHolder }),
      });
    } else {
      await Preferences.remove({ key: SESSION_KEY });
    }
  } catch {
    // Sin almacenamiento nativo: el worker reconcilia al abrir la app.
  }
}

/** Espeja cada cambio de sesión para el worker en background. */
export function installSessionMirror(): void {
  api.onSessionChange((s: Session | null) => {
    lastSession = s;
    void mirror();
  });
}

/** Valida el espejo sin lanzarlo a la sesión (puro, testeable). */
export function parseMirroredSession(raw: string): Session | null {
  try {
    const s = JSON.parse(raw) as Partial<Session>;
    if (
      !s ||
      typeof s.accessToken !== "string" ||
      s.accessToken.length === 0 ||
      typeof s.refreshToken !== "string" ||
      s.refreshToken.length === 0 ||
      typeof s.installationId !== "string" ||
      s.installationId.length === 0 ||
      typeof s.userId !== "string" ||
      s.userId.length === 0
    ) {
      return null;
    }
    return {
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      installationId: s.installationId,
      userId: s.userId,
    };
  } catch {
    return null;
  }
}

/**
 * Al abrir en Android: restaura la sesión espejada (la WebView olvida
 * sessionStorage al cerrar). Devuelve true si hay sesión lista para /v1/me.
 * La sala persiste hasta "Abandonar sala", que limpia este espejo.
 */
export async function restoreNativeSession(): Promise<boolean> {
  try {
    if (!native() || api.loggedIn) return api.loggedIn;
    const { value } = await Preferences.get({ key: SESSION_KEY });
    if (!value) return false;
    const session = parseMirroredSession(value);
    if (!session) {
      await Preferences.remove({ key: SESSION_KEY });
      return false;
    }
    api.setSession(session);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sube el token FCM al servidor si el nativo ya lo guardó (onNewToken).
 * Llamar tras login y al entrar al estudio. Best-effort.
 */
export async function uploadFcmTokenIfPresent(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: FCM_TOKEN_KEY });
    if (!value || !api.loggedIn) return;
    await api.pushToken(value);
  } catch {
    // Sin token o sin red: se reintentará en el próximo arranque.
  }
}
