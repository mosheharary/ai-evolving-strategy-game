#!/usr/bin/env bash
# Acceptance check: create save → save → restart containers → load save → continue campaign.
# Usage: scripts/verify-persistence.sh   (requires the stack from `docker compose up --build`)
set -euo pipefail
B=${BASE_URL:-http://localhost:3000}
JAR=$(mktemp)
H=(-sf -H "content-type: application/json" -H "x-echoes-client: web" -H "origin: http://localhost:3000" -b "$JAR" -c "$JAR")
uuid() { node -e "console.log(crypto.randomUUID())"; }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log($1)})"; }

curl "${H[@]}" -X POST "$B/api/session" -d '{}' >/dev/null
GAME=$(curl "${H[@]}" -X POST "$B/api/games" -d '{"civilizationName":"Persistent Folk","seed":"persist-1"}' | json o.gameId)
curl "${H[@]}" -X POST "$B/api/games/$GAME/end-turn" -d "{\"commandId\":\"$(uuid)\"}" >/dev/null
SAVE=$(curl "${H[@]}" -X POST "$B/api/games/$GAME/save" -d '{"name":"Before restart"}' | json o.saveId)
HASH_BEFORE=$(curl "${H[@]}" "$B/api/games/$GAME" | json o.stateHash)
echo "created game $GAME, save $SAVE, turn 2, hash ${HASH_BEFORE:0:16}"

echo "restarting containers…"
docker compose restart api worker web postgres redis >/dev/null
for i in $(seq 1 60); do curl -sf "$B/healthz" >/dev/null && curl -sf "${BASE_API:-http://localhost:4000}/ready" >/dev/null && break; sleep 2; done

HASH_AFTER=$(curl "${H[@]}" "$B/api/games/$GAME" | json o.stateHash)
[ "$HASH_BEFORE" = "$HASH_AFTER" ] || { echo "FAIL: state hash changed across restart"; exit 1; }
curl "${H[@]}" -X POST "$B/api/saves/$SAVE/load" -d '{}' >/dev/null
TURN=$(curl "${H[@]}" -X POST "$B/api/games/$GAME/end-turn" -d "{\"commandId\":\"$(uuid)\"}" | json o.view.state.turn)
[ "$TURN" = "3" ] || { echo "FAIL: expected turn 3 after continuing, got $TURN"; exit 1; }
OK=$(curl "${H[@]}" "$B/internal/games/$GAME/replay-verify" | json o.ok)
[ "$OK" = "true" ] || { echo "FAIL: replay verification"; exit 1; }
echo "PASS: save survived container restart, loaded, campaign continued to turn $TURN, replay verified"
rm -f "$JAR"
