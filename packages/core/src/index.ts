// @cookie/core — dominio puro. Sin React/DOM/Capacitor/Cloudflare.
// Entidades H2: PairSpace, Membership, Drawing, Draft, Installation.
export type PairSpaceId = string;
export type UserId = string;
export interface PairSpace {
  readonly id: PairSpaceId;
  readonly status: "active" | "locked" | "deleting" | "deleted";
}
