// H6: deep links cookie://drawing/{id} (tap del widget) → detalle en Historial.
// Vía plugin @capacitor/app; en navegador no hace nada.
import { App } from "@capacitor/app";

export function parseDrawingDeepLink(url: string): string | null {
  const m = /^cookie:\/\/drawing\/([^/?#]+)/.exec(url);
  return m?.[1] ?? null;
}

export function installDeepLinkListener(
  onDrawing: (drawingId: string) => void,
): void {
  try {
    void App.addListener("appUrlOpen", (event: { url: string }) => {
      const id = parseDrawingDeepLink(event.url);
      if (id) onDrawing(id);
    });
  } catch {
    // Sin plugin nativo (navegador): sin deep links.
  }
}
