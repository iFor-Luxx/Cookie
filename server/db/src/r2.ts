// @cookie/server-db — adapter R2 → ObjectStore (estructural, sin SDK).
import type { ObjectStore, StoredObject } from "@cookie/storage";

export interface R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<unknown>;
}

/** Adapter R2 → ObjectStore para el Worker en prod. */
export function r2ObjectStore(bucket: R2BucketLike): ObjectStore {
  return {
    put: async (key, object: StoredObject) => {
      const bytes = Uint8Array.from(object.bytes);
      await bucket.put(key, bytes.buffer as ArrayBuffer, {
        httpMetadata: { contentType: object.contentType },
      });
    },
    get: async (key) => {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      return {
        bytes,
        contentType:
          obj.httpMetadata?.contentType ?? "application/octet-stream",
        size: obj.size,
      };
    },
    delete: async (key) => {
      await bucket.delete(key);
    },
  };
}
