#!/usr/bin/env node
// End-to-end check without the Cocos editor: two bot players join one server and play a game to the end.
//
//   node scripts/e2e.mjs                                   # local server, ws://localhost:2567
//   node scripts/e2e.mjs --server=wss://<fqdn>:<port>      # one direct Edgegap deployment
//   node scripts/e2e.mjs --mm=<matchmaker url> --mm-token=<auth token> [--profile=casual]
//   add --players=1 for one bot only: an opponent for a person playing the Cocos build
//
// Exits 0 when both players saw the same winner and the server closed the room.
import { Client, Callbacks } from "@colyseus/sdk";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const mmUrl = arg("mm")?.replace(/\/+$/, "");
const mmToken = arg("mm-token");
const profile = arg("profile") || "casual";
const solo = arg("players") === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mm(method, path, body) {
  const res = await fetch(mmUrl + path, {
    method,
    headers: { Authorization: mmToken, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Matchmaker ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function findMatch(name) {
  const ticket = await mm("POST", "/tickets", { profile, attributes: {} });
  console.log(`[${name}] ticket ${ticket.id}`);
  for (let started = Date.now(); ; ) {
    await sleep(2000);
    const t = await mm("GET", `/tickets/${ticket.id}`);
    if (t.status === "HOST_ASSIGNED") {
      const a = t.assignment;
      const url = `wss://${a.fqdn}:${a.ports.gameport.external}`;
      console.log(`[${name}] assigned ${url} after ${Math.round((Date.now() - started) / 1000)}s`);
      return url;
    }
    if (t.status === "CANCELLED") throw new Error(`[${name}] ticket expired`);
  }
}

async function joinWithRetry(url, attempts) {
  for (let i = 1; ; i++) {
    try {
      return await new Client(url).joinOrCreate("tictactoe");
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`join attempt ${i} failed (${e.message}), retrying`);
      await sleep(2000);
    }
  }
}

// Player "A" takes the top row, "B" the middle one: whoever moves first wins.
const moves = { A: [[0, 0], [1, 0], [2, 0]], B: [[0, 1], [1, 1], [2, 1]] };

async function play(name, url, attempts) {
  const room = await joinWithRetry(url, attempts);
  console.log(`[${name}] joined room ${room.roomId} as ${room.sessionId}`);
  const $ = Callbacks.get(room);
  const queue = [...moves[name]];
  const turn = (sessionId) => {
    if (sessionId !== room.sessionId || room.state.winner || room.state.draw) return;
    const move = queue.shift();
    if (move) setTimeout(() => room.send("action", { x: move[0], y: move[1] }), 300);
  };
  $.listen("currentTurn", turn);
  return new Promise((resolve, reject) => {
    let result = null;
    $.listen("winner", (id) => id && (result = id === room.sessionId ? "win" : "lose"));
    $.listen("draw", (d) => d && (result = "draw"));
    room.onLeave((code) => {
      console.log(`[${name}] left (code ${code}), result: ${result}`);
      result ? resolve(result) : reject(new Error(`[${name}] left without a result`));
    });
    room.onError((code, msg) => reject(new Error(`[${name}] room error ${code} ${msg}`)));
  });
}

let urls;
let attempts = 1;
if (mmUrl && mmToken) {
  urls = solo ? [null, await findMatch("B")] : await Promise.all([findMatch("A"), findMatch("B")]);
  if (!solo && urls[0] !== urls[1]) throw new Error(`Players were sent to different servers: ${urls.join(" / ")}`);
  attempts = 10; // a fresh deployment answers 502 for a few seconds
} else {
  const url = arg("server") || "ws://localhost:2567";
  urls = [url, url];
  attempts = url.startsWith("wss://") ? 10 : 1;
}

if (solo) {
  const result = await play("B", urls[1], attempts);
  console.log(`PASS: bot ${result}`);
  process.exit(0);
}
const a = play("A", urls[0], attempts);
await sleep(500);
const results = await Promise.all([a, play("B", urls[1], attempts)]);
const ok = results.sort().join() === "lose,win";
console.log(ok ? `PASS: ${results.join(" / ")}` : `FAIL: ${results.join(" / ")}`);
process.exit(ok ? 0 : 1);
