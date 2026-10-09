// @cookie/core — entidades de pairing (SDD §5). Solo datos, sin IO.
export type Platform = "web" | "android";
export type PairSpaceStatus = "active" | "locked" | "deleting" | "deleted";

export interface User {
  readonly id: string;
  readonly displayName: string;
  readonly avatarKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Installation {
  readonly id: string;
  readonly userId: string;
  readonly platform: Platform;
  /** Hash de la credencial. El secreto en claro solo existe en la respuesta de creación. */
  readonly credentialHash: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
}

export interface PairSpace {
  readonly id: string;
  readonly status: PairSpaceStatus;
  readonly createdAt: string;
}

export interface Membership {
  readonly pairSpaceId: string;
  readonly userId: string;
  readonly role: "owner" | "member";
  readonly joinedAt: string;
  readonly leftAt: string | null;
}

export interface Invite {
  readonly id: string;
  readonly pairSpaceId: string;
  readonly tokenHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly consumedBy: string | null;
}

export interface RecoveryCredential {
  readonly id: string;
  readonly pairSpaceId: string;
  readonly secretHash: string;
  readonly createdAt: string;
  readonly usedAt: string | null;
  readonly revokedAt: string | null;
}

export interface RecoveryChallenge {
  readonly id: string;
  readonly pairSpaceId: string;
  readonly installationId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/** Máximo de miembros activos por PairSpace en MVP. */
export const MAX_ACTIVE_MEMBERS = 2 as const;
/** TTL del challenge de recovery: 10 minutos. */
export const RECOVERY_CHALLENGE_TTL_SECONDS = 600 as const;
