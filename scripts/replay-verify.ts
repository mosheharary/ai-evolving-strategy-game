/**
 * Deterministic replay verification from the database.
 * For each game (or the ids given), replays the logged commands — with their STORED AI
 * decisions, never calling an AI provider — from the timeline root snapshot and checks
 * the result against the persisted authoritative state hash.
 *
 *   pnpm replay:verify            # all games
 *   pnpm replay:verify g0123…     # specific games
 */
import { createDb, GameRepository } from "@echoes/database";
import { replay } from "@echoes/game-engine";

const db = createDb(process.env.DATABASE_URL ?? "postgresql://echoes:echoes@localhost:5432/echoes");
const repo = new GameRepository(db);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : (await db.game.findMany({ select: { id: true } })).map((g) => g.id);
let failures = 0;
for (const id of ids) {
  const meta = await repo.meta(id);
  const root = await repo.timelineRoot(id);
  if (!meta || !root) {
    console.log(`? ${id}: missing`);
    continue;
  }
  const log = await repo.commandsAfter(id, root.seq);
  const r = replay(root.state, log);
  const ok = r.stateHash === meta.stateHash;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${id}: ${log.length} commands from ${root.kind} snapshot → ${r.stateHash.slice(0, 16)}${ok ? "" : ` (expected ${meta.stateHash.slice(0, 16)})`}`);
}
await db.$disconnect();
console.log(failures ? `${failures} game(s) FAILED replay verification` : `all ${ids.length} game(s) replay deterministically`);
process.exit(failures ? 1 : 0);
