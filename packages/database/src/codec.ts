import { gunzipSync, gzipSync } from "node:zlib";
import type { GameState } from "@echoes/game-types";
import { migrateSave } from "@echoes/game-engine";

/** Compact serialised simulation state for snapshots and saves (gzip JSON). */
export function encodeState(state: GameState): Uint8Array<ArrayBuffer> {
  const buf = gzipSync(Buffer.from(JSON.stringify(state), "utf8"), { level: 6 });
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as Uint8Array<ArrayBuffer>;
}

/** Decode and run the versioned migration pipeline — old saves are upgraded, never silently corrupted. */
export function decodeState(data: Uint8Array): { state: GameState; migratedFrom: number | null } {
  const raw: unknown = JSON.parse(gunzipSync(Buffer.from(data)).toString("utf8"));
  return migrateSave(raw);
}
