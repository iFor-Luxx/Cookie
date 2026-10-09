// H6: puente TypeScript ↔ nativo vía plugin Preferences (sin código Java/Kotlin
// propio para esto). La sesión espejada la lee SyncWorker; el token FCM lo
// escribe CookieMessagingService y la web lo sube al servidor.
import { Preferences } from "@capacitor/preferences";
import { api, apiBaseUrl, type Session } from "./api";

const SESSION_KEY = "cookie.session";
const API_BASE_KEY = "cookie.apiBase";
const FCM_TOKEN_KEY = "cookie.fcmToken";

let spaceIdHolder: string | null = null;

export function setNativeSpace(spaceId: string | null): void {
  spaceIdHolder = spaceId;
  void mirror();
}

async function mirror(): Promise<void> {
  try {
    await Preferences.set({ key: API_BASE_KEY, value: apiBaseUrl() });
  } catch {
    // Fuera de nativo persiste sessionStorage (ya lo hace ApiClient).
  }
}

/** Espeja cada cambio de sesión para el worker en background. */
export function installSessionMirror(): void {
  api.onSessionChange((s: Session | null) => {
    void (async () => {
      try {
        if (!s) {
          await Preferences.remove({ key: SESSION_KEY });
          return;
        }
        await Preferences.set({
          key: SESSION_KEY,
          value: JSON.stringify({ ...s, spaceId: spaceIdHolder }),
        });
      } catch {
        // Nativo no disponible: nada que espejar.
      }
    })();
  });
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
