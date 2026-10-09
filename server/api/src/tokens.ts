import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 900 as const; // 15 min
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 días

export interface AccessClaims {
  installationId: string;
  userId: string;
}

export async function signAccessToken(
  secret: Uint8Array,
  claims: AccessClaims,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secret);
}

export async function verifyAccessToken(
  secret: Uint8Array,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const { installationId, userId } = payload;
    if (typeof installationId !== "string") return null;
    if (typeof userId !== "string") return null;
    return { installationId, userId };
  } catch {
    return null;
  }
}
