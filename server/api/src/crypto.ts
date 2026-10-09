import type { CryptoPort } from "@cookie/core";

// Workers limita PBKDF2 a 100k iteraciones (NotSupportedError por encima).
// El formato `pbkdf2$iter$...` guarda las iteraciones y verifySecret las
// lee del hash, así que cambiar este valor no rompe hashes existentes.
const HASH_ITERATIONS = 100_000;
const SALT_BYTES = 16;

/** CryptoPort WebCrypto (Workers + Node 24 + Bun). Formato hash: `pbkdf2$iter$saltB64$hashB64`. */
export function webCryptoPort(): CryptoPort {
  return {
    newId: () => crypto.randomUUID(),
    newSecret: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return base64url(bytes);
    },
    hashSecret: async (secret: string) => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: HASH_ITERATIONS, hash: "SHA-256" },
        key,
        256,
      );
      return `pbkdf2$${HASH_ITERATIONS}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`;
    },
    lookupHash: async (secret: string) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(secret),
      );
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    sha256Hex: async (data: Uint8Array | string) => {
      const bytes: Uint8Array<ArrayBuffer> =
        typeof data === "string"
          ? new TextEncoder().encode(data)
          : Uint8Array.from(data);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    verifySecret: async (secret: string, hash: string) => {
      const parts = hash.split("$");
      const iterationsRaw = parts[1];
      const saltB64 = parts[2];
      const expectedB64 = parts[3];
      if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
      if (
        iterationsRaw === undefined ||
        saltB64 === undefined ||
        expectedB64 === undefined
      ) {
        return false;
      }
      const iterations = Number(iterationsRaw);
      if (!Number.isInteger(iterations) || iterations <= 0) return false;
      const salt = fromBase64url(saltB64);
      const expected = fromBase64url(expectedB64);
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
          key,
          expected.length * 8,
        ),
      );
      if (bits.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < bits.length; i++) {
        diff |= (bits[i] ?? 0) ^ (expected[i] ?? 0);
      }
      return diff === 0;
    },
  };
}

function base64url(bytes: Uint8Array<ArrayBuffer>): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
