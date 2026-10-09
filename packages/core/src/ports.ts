// @cookie/core — puertos. El dominio no importa plataforma ni crypto concreta.
import type {
  Installation,
  Invite,
  Membership,
  PairSpace,
  RecoveryChallenge,
  RecoveryCredential,
  User,
} from "./entities";

export interface ClockPort {
  nowIso(): string;
}

export interface CryptoPort {
  /** ID aleatorio no enumerable (uuid). */
  newId(): string;
  /** Secreto aleatorio de alta entropía (base64url). */
  newSecret(): string;
  hashSecret(secret: string): Promise<string>;
  verifySecret(secret: string, hash: string): Promise<boolean>;
  /**
   * Hash DETERMINISTA (SHA-256) para tokens aleatorios de alta entropía que
   * requieren lookup por valor: invites y refresh tokens. Nunca para
   * secretos de baja entropía (esos van con salt via hashSecret).
   */
  lookupHash(secret: string): Promise<string>;
}

export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PAIRSPACE_FULL"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "NOT_FOUND";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: DomainErrorCode };

/** Persistencia que cada caso de uso necesita. Implementada por server (D1). */
export interface PairingStore {
  // users
  insertUser(user: User): Promise<void>;
  findUser(id: string): Promise<User | null>;
  updateUser(user: User): Promise<void>;
  // installations
  insertInstallation(i: Installation): Promise<void>;
  findInstallation(id: string): Promise<Installation | null>;
  updateInstallation(i: Installation): Promise<void>;
  // spaces
  insertPairSpace(s: PairSpace): Promise<void>;
  findPairSpace(id: string): Promise<PairSpace | null>;
  // memberships
  insertMembership(m: Membership): Promise<void>;
  activeMemberships(spaceId: string): Promise<Membership[]>;
  findMembership(spaceId: string, userId: string): Promise<Membership | null>;
  userSpaces(userId: string): Promise<Membership[]>;
  // invites
  insertInvite(i: Invite): Promise<void>;
  findInviteByTokenHash(hash: string): Promise<Invite | null>;
  updateInvite(i: Invite): Promise<void>;
  expireActiveInvites(spaceId: string, nowIso: string): Promise<void>;
  // recovery
  insertRecoveryCredential(r: RecoveryCredential): Promise<void>;
  activeRecoveryCredential(spaceId: string): Promise<RecoveryCredential | null>;
  insertRecoveryChallenge(c: RecoveryChallenge): Promise<void>;
  findRecoveryChallenge(id: string): Promise<RecoveryChallenge | null>;
  updateRecoveryChallenge(c: RecoveryChallenge): Promise<void>;
  /** Instalaciones no revocadas por userId dentro del espacio. */
  countActiveInstallations(spaceId: string): Promise<Map<string, number>>;
}
