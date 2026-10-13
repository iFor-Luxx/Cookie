import { Capacitor, registerPlugin } from "@capacitor/core";
import { api } from "./api";

// Puente web → widget con la app abierta (B): al detectar un dibujo nuevo
// por realtime se pinta al instante, sin esperar FCM + WorkManager.
// Con la app cerrada el que actualiza es SyncWorker. Best-effort.

interface CookieWidgetPlugin {
  refreshWidget(opts: {
    drawingId: string;
    createdAt: string;
    cursor: number;
    doc: string;
  }): Promise<void>;
  clearWidget(): Promise<void>;
}

const Native = registerPlugin<CookieWidgetPlugin>("CookieWidget");

export function widgetBridgeSupported(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
    );
  } catch {
    return false;
  }
}

/** Sincroniza el widget con la cabeza del timeline (o lo vacía). */
export async function syncNativeWidget(
  spaceId: string,
  cursor: number,
): Promise<void> {
  if (!widgetBridgeSupported()) return;
  try {
    const tl = await api.timeline(spaceId);
    const first = tl.drawings[0];
    if (!first) {
      await Native.clearWidget();
      return;
    }
    const doc = await api.documentText(first.id);
    await Native.refreshWidget({
      drawingId: first.id,
      createdAt: first.createdAt,
      cursor,
      doc,
    });
  } catch {
    // Best-effort: SyncWorker lo repara por FCM/cursor.
  }
}
