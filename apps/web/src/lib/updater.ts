import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor, registerPlugin } from "@capacitor/core";

// Actualizaciones propias sin Play Store (H-updates): el aviso vive en
// RTDB y lo lee el nativo (una lectura puntual al entrar, sin polling).
// La web solo orquesta: consultar, descargar (con progreso) e instalar.
// Fuera de Android nativo todo responde "no soportado".

export interface ReleaseInfo {
  versionCode: number;
  tag: string;
  apkUrl: string;
  sha256: string;
  notes: string;
}

export interface UpdateCheck {
  supported: boolean;
  available: boolean;
  currentVersion?: number | undefined;
  release?: ReleaseInfo | undefined;
  reason?: string | undefined;
}

interface CookieUpdaterPlugin {
  getVersion(): Promise<{ versionCode: number }>;
  checkUpdate(): Promise<{
    available: boolean;
    reason?: string;
    currentVersion?: number;
    versionCode?: number;
    tag?: string;
    apkUrl?: string;
    sha256?: string;
    notes?: string;
  }>;
  downloadUpdate(opts: {
    url: string;
    sha256: string;
    versionCode: number;
  }): Promise<{ bytes: number }>;
  addListener(
    event: "downloadProgress",
    cb: (info: { progress: number }) => void,
  ): Promise<PluginListenerHandle>;
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<void>;
  installUpdate(opts: { versionCode: number }): Promise<void>;
}

const Native = registerPlugin<CookieUpdaterPlugin>("CookieUpdater");

export function updaterSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** true si remote es strictly mayor (enteros positivos). */
export function isNewer(current: number, remote: number): boolean {
  return (
    Number.isInteger(current) &&
    Number.isInteger(remote) &&
    current > 0 &&
    remote > current
  );
}

/** Valida el nodo RTDB antes de mostrar/descargar nada. */
export function parseReleaseNode(raw: unknown): ReleaseInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { versionCode, tag, apkUrl, sha256, notes } = r;
  if (
    typeof versionCode !== "number" ||
    !Number.isInteger(versionCode) ||
    versionCode <= 0 ||
    typeof tag !== "string" ||
    tag.trim().length === 0 ||
    tag.length > 64 ||
    typeof apkUrl !== "string" ||
    !apkUrl.startsWith("https://") ||
    apkUrl.length > 512 ||
    typeof sha256 !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(sha256) ||
    (notes !== undefined && typeof notes !== "string")
  ) {
    return null;
  }
  return {
    versionCode,
    tag: tag.trim(),
    apkUrl,
    sha256: sha256.toLowerCase(),
    notes: typeof notes === "string" ? notes.slice(0, 500) : "",
  };
}

/** Una lectura puntual al entrar (el listener persistente gasta batería). */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!updaterSupported()) return { supported: false, available: false };
  try {
    const res = await Native.checkUpdate();
    if (!res.available || res.versionCode === undefined) {
      return {
        supported: true,
        available: false,
        currentVersion: res.currentVersion,
        reason: res.reason,
      };
    }
    const release = parseReleaseNode({
      versionCode: res.versionCode,
      tag: res.tag,
      apkUrl: res.apkUrl,
      sha256: res.sha256,
      notes: res.notes,
    });
    if (!release) return { supported: true, available: false };
    const current = await Native.getVersion();
    if (!isNewer(current.versionCode, release.versionCode)) {
      return {
        supported: true,
        available: false,
        currentVersion: current.versionCode,
      };
    }
    return {
      supported: true,
      available: true,
      currentVersion: current.versionCode,
      release,
    };
  } catch {
    return { supported: true, available: false, reason: "check-failed" };
  }
}

export async function downloadRelease(
  release: ReleaseInfo,
  onProgress: (percent: number) => void,
): Promise<void> {
  const listener = await Native.addListener("downloadProgress", (info) => {
    onProgress(Math.max(0, Math.min(100, Math.round(info.progress))));
  });
  try {
    await Native.downloadUpdate({
      url: release.apkUrl,
      sha256: release.sha256,
      versionCode: release.versionCode,
    });
  } finally {
    await listener.remove();
  }
}

export async function ensureInstallPermission(): Promise<boolean> {
  const { granted } = await Native.canInstall();
  if (granted) return true;
  await Native.openInstallSettings();
  return false;
}

export async function installRelease(versionCode: number): Promise<void> {
  await Native.installUpdate({ versionCode });
}
