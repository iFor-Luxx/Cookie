// @cookie/core — puertos. El dominio no importa plataforma ni crypto concreta.
import type {
  Installation,
  Invite,
  LoginAttempt,
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
  /** Token de invitación corto (9 caracteres legibles, ver invite-token). */
  newInviteToken(): string;
  hashSecret(secret: string): Promise<string>;
  verifySecret(secret: string, hash: string): Promise<boolean>;
  /**
   * Hash DETERMINISTA (SHA-256) para tokens aleatorios de alta entropía que
   * requieren lookup por valor: invites y refresh tokens. Nunca para
   * secretos de baja entropía (esos van con salt via hashSecret).
   */
  lookupHash(secret: string): Promise<string>;
  /** SHA-256 hex de bytes o texto (hashes de contenido, idempotencia). */
  sha256Hex(data: Uint8Array | string): Promise<string>;
}

export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PAIRSPACE_FULL"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "LOGIN_EXPIRED"
  | "LOGIN_ALREADY_USED"
  | "NOT_FOUND";

export type Result<T, E extends string = DomainErrorCode> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: E };

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
  // login attempts (entrar escaneando: el PC muestra, el celular aprueba)
  insertLoginAttempt(a: LoginAttempt): Promise<void>;
  findLoginAttempt(id: string): Promise<LoginAttempt | null>;
  updateLoginAttempt(a: LoginAttempt): Promise<void>;
  /** Instalaciones no revocadas por userId dentro del espacio. */
  countActiveInstallations(spaceId: string): Promise<Map<string, number>>;
}
