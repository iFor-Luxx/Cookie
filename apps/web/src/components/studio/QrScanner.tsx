import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (options?: { formats?: string[] }) => NativeDetector;

function createDetector(): NativeDetector | null {
  try {
    const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor })
      .BarcodeDetector;
    if (!ctor) return null;
    return new ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * Escáner QR con la cámara (BarcodeDetector nativo, sin dependencias).
 * Entrega el texto crudo: el llamador distingue invitación de entrada.
 * Sin cámara o sin soporte: el padre mantiene el campo manual.
 */
export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (text: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [status, setStatus] = useState<"iniciando" | "escaneando" | "error">(
    "iniciando",
  );
  const [message, setMessage] = useState("Apunta al código QR");

  useEffect(() => {
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let done = false;
    const frame = document.createElement("canvas");
    const stopTracks = (): void => {
      if (!stream) return;
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    };
    const fail = (msg: string): void => {
      if (stopped) return;
      stopTracks();
      setStatus("error");
      setMessage(msg);
    };
    const start = async (): Promise<void> => {
      const detector = createDetector();
      if (!detector) {
        fail("Este navegador no lee QR. Escribe el token a mano.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail("Sin acceso a la cámara aquí. Escribe el token a mano.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        fail("Sin permiso de cámara. Revísalo o escribe el token a mano.");
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) {
        stopTracks();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay bloqueado: el usuario puede pulsar play en el vídeo.
      }
      if (stopped) {
        stopTracks();
        return;
      }
      setStatus("escaneando");
      const loop = async (): Promise<void> => {
        if (stopped || done) return;
        try {
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0) {
            frame.width = v.videoWidth;
            frame.height = v.videoHeight;
            frame
              .getContext("2d", { willReadFrequently: true })
              ?.drawImage(v, 0, 0);
            const found = await detector.detect(frame);
            const raw = found[0]?.rawValue?.trim();
            if (raw && !done) {
              done = true;
              stopTracks();
              onScanRef.current(raw);
              return;
            }
          }
        } catch {
          // Frame corrupto: seguir intentando.
        }
        raf = requestAnimationFrame(() => void loop());
      };
      void loop();
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopTracks();
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {status !== "error" ? (
        <video
          ref={videoRef}
          className="aspect-square w-full rounded-md border bg-black object-cover"
          muted
          playsInline
          autoPlay
        />
      ) : null}
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" onClick={onClose}>
        {status === "error" ? "Volver al token manual" : "Cancelar escaneo"}
      </Button>
    </div>
  );
}
