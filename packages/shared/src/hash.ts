import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` dropped,
 * non-finite numbers rejected. Two semantically equal values always produce
 * the same string, which makes it suitable for state hashing and cache keys.
 */
export function canonicalStringify(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalStringify: non-finite number");
      // Normalise -0 to 0 so hashes do not differ on sign of zero.
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : serialise(v))).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialise(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalStringify: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/** sha256 of the canonical JSON representation. */
export function hashObject(value: unknown): string {
  return sha256Hex(canonicalStringify(value));
}
