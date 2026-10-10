import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
import { packParams, UNIFORM_FLOATS, WIPE_WGSL } from "./wipe.wgsl";
import type { WipeParams } from "./wipe-math";

/**
 * Canvas del barrido y nada más. Sin reloj propio: dibuja el progreso
 * que se le entrega, para que canvas y DOM vayan en el mismo reloj.
 * El device se crea en el primer `prepare()`, no al montar.
 */
export interface WipeCanvasHandle {
  /** Crea el device si aún no existe. `false` sin WebGPU → fallback. */
  prepare(): Promise<boolean>;
  /** Dibuja un fotograma. Barato: llamarlo desde el propio rAF. */
  draw(
    params: WipeParams,
    progress: number,
    surface: readonly [number, number, number],
  ): void;
  /** Avisa una vez si el device se pierde a mitad del barrido. */
  watchLost(onLost: () => void): void;
}

interface Renderer {
  device: GPUDevice;
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  uniform: GPUBuffer;
  bindGroup: GPUBindGroup;
  scratch: Float32Array<ArrayBuffer>;
  destroy(): void;
}

async function createRenderer(
  canvas: HTMLCanvasElement,
): Promise<Renderer | null> {
  if (typeof navigator === "undefined" || !navigator.gpu) return null;

  let device: GPUDevice;
  try {
    // Reutiliza el adapter precalentado si existe; si aún está en
    // vuelo, espera ese intento en vez de pedir otro.
    const adapter = warming
      ? await warming.catch(() => null)
      : await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    device = await adapter.requestDevice();
  } catch {
    return null;
  }

  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    return null;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  // Premultiplicado: el alfa del fragmento deja ver la página de detrás
  // donde el barrido ya pasó.
  context.configure({ device, format, alphaMode: "premultiplied" });

  try {
    const shader = device.createShaderModule({ code: WIPE_WGSL });
    // La compilación WGSL es asíncrona: un shader inválido daría un
    // pipeline de error que no pinta nada en silencio. Ante errores
    // se devuelve null para usar el fallback DOM (visible).
    const info = await shader.getCompilationInfo();
    if (info.messages.some((m) => m.type === "error")) {
      device.destroy();
      return null;
    }
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vs_main" },
      fragment: {
        module: shader,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    const uniform = device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });

    const renderer: Renderer = {
      device,
      context,
      pipeline,
      uniform,
      bindGroup,
      scratch: new Float32Array(UNIFORM_FLOATS),
      destroy() {
        uniform.destroy();
        context.unconfigure();
        device.destroy();
      },
    };
    return renderer;
  } catch {
    context.unconfigure();
    device.destroy();
    return null;
  }
}

/**
 * Precalienta el adapter WebGPU (la parte lenta) antes de que el
 * usuario pida el barrido. Llamar cuando el botón ya es visible.
 */
let warming: Promise<GPUAdapter | null> | null = null;

export function warmWipeGpu(): void {
  if (typeof navigator === "undefined" || !navigator.gpu || warming) return;
  warming = (async () => {
    try {
      return (await navigator.gpu?.requestAdapter()) ?? null;
    } catch {
      return null;
    }
  })();
  // Sin espera colgada si nadie lo consume.
  void warming.catch(() => null);
}

export const WipeCanvas = forwardRef<WipeCanvasHandle, { className?: string }>(
  function WipeCanvas({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const pendingRef = useRef<Promise<boolean> | null>(null);
    const disposedRef = useRef(false);

    useEffect(() => {
      disposedRef.current = false;
      return () => {
        disposedRef.current = true;
        rendererRef.current?.destroy();
        rendererRef.current = null;
        pendingRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      prepare() {
        if (rendererRef.current) return Promise.resolve(true);
        // Un solo intento en vuelo: React invoca los efectos dos veces en
        // dev y dos devices sobre el mismo canvas se pisan.
        pendingRef.current ??= (async () => {
          const canvas = canvasRef.current;
          if (!canvas) return false;
          const renderer = await createRenderer(canvas);
          if (!renderer) return false;
          if (disposedRef.current) {
            renderer.destroy();
            return false;
          }
          rendererRef.current = renderer;
          return true;
        })();
        return pendingRef.current;
      },

      draw(params, progress, surface) {
        const renderer = rendererRef.current;
        const canvas = canvasRef.current;
        if (!renderer || !canvas) return;

        // Tope 2x como la referencia: más allá el fragmento cuesta el
        // doble sin ganancia visible. Si el device se pierde, el fallback
        // 2D toma el relevo.
        const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        const width = Math.max(Math.round(canvas.clientWidth * dpr), 1);
        const height = Math.max(Math.round(canvas.clientHeight * dpr), 1);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const { device, context, pipeline, uniform, bindGroup, scratch } =
          renderer;
        device.queue.writeBuffer(
          uniform,
          0,
          packParams(scratch, params, progress, width, height, surface),
        );

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },

      watchLost(onLost: () => void): void {
        const renderer = rendererRef.current;
        if (!renderer) return;
        void renderer.device.lost.then(() => {
          if (!disposedRef.current) onLost();
        });
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn("block size-full", className)}
      />
    );
  },
);
