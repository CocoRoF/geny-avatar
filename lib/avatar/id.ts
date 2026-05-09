/**
 * Stable IDs for our domain objects (Avatar / Layer / Texture / Variant /
 * Animation / Parameter / Adapter instances).
 *
 * Using a 12-char base32 random ID instead of a full ULID — we don't need
 * lexicographic sortability across machines, just collision resistance
 * within a single user's IndexedDB.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish, no I/L/O/U

function randomBase32(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBase32(12)}`;
}

export const ID_PREFIX = {
  avatar: "av",
  layer: "ly",
  group: "lg",
  texture: "tx",
  variant: "va",
  animation: "an",
  parameter: "pm",
  adapter: "ad",
  job: "jb",
  override: "ov",
  reference: "rf",
  componentLabel: "cl",
  regionMask: "rm",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];
