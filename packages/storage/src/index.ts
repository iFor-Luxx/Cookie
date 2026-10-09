// @cookie/storage — interfaces + codecs. Sin cloud SDK.
export interface Codec<T> {
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}
