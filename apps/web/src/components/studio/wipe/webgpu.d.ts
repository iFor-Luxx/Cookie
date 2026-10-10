// Declaraciones WebGPU mínimas para el barrido de marca.
// Solo lo que usa WipeCanvas (sin dependencia de @webgpu/types).

interface Navigator {
  readonly gpu?: GPU;
}

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

type GPUTextureFormat = "bgra8unorm";

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}

interface GPUDevice {
  readonly queue: GPUQueue;
  readonly lost: Promise<unknown>;
  createShaderModule(descriptor: { code: string }): GPUShaderModule;
  createRenderPipeline(descriptor: {
    layout: "auto";
    vertex: { module: GPUShaderModule; entryPoint: string };
    fragment: {
      module: GPUShaderModule;
      entryPoint: string;
      targets: Array<{ format: GPUTextureFormat }>;
    };
    primitive: { topology: "triangle-list" };
  }): GPURenderPipeline;
  createBuffer(descriptor: { size: number; usage: number }): GPUBuffer;
  createSampler(descriptor?: {
    magFilter?: string;
    minFilter?: string;
    addressModeU?: string;
    addressModeV?: string;
  }): GPUSampler;
  createBindGroup(descriptor: {
    layout: GPUBindGroupLayout;
    entries: Array<{
      binding: number;
      resource: { buffer: GPUBuffer } | GPUSampler | GPUTextureView;
    }>;
  }): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  destroy(): void;
}

interface GPUQueue {
  writeBuffer(buffer: GPUBuffer, offset: number, data: Float32Array): void;
  submit(commands: Array<GPUCommandBuffer>): void;
}

interface GPUCanvasContext {
  configure(config: {
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode: "premultiplied";
  }): void;
  unconfigure(): void;
  getCurrentTexture(): GPUTexture;
}

interface GPUTexture {
  createView(): GPUTextureView;
}

interface HTMLCanvasElement {
  getContext(contextId: "webgpu"): GPUCanvasContext | null;
}

interface GPUBuffer {
  destroy(): void;
}

interface GPUSampler {
  // Marcador de tipo.
  readonly __brand?: undefined;
}

interface GPUTextureView {
  // Marcador de tipo.
  readonly __brand?: undefined;
}

interface GPUBindGroup {
  // Marcador de tipo.
  readonly __brand?: undefined;
}

interface GPUBindGroupLayout {
  // Marcador de tipo.
  readonly __brand?: undefined;
}

interface GPUShaderModule {
  getCompilationInfo(): Promise<{
    messages: Array<{ type: string }>;
  }>;
}

interface GPURenderPipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: {
    colorAttachments: Array<{
      view: GPUTextureView;
      clearValue: { r: number; g: number; b: number; a: number };
      loadOp: "clear";
      storeOp: "store";
    }>;
  }): GPURenderPassEncoder;
  finish(): GPUCommandBuffer;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  draw(vertexCount: number): void;
  end(): void;
}

interface GPUCommandBuffer {
  // Marcador de tipo.
  readonly __brand?: undefined;
}

declare const GPUBufferUsage: {
  readonly UNIFORM: number;
  readonly COPY_DST: number;
};
