const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;

const compileTS = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
require.extensions[".ts"] = compileTS;
const { getKV } = require("../src/lib/store.ts");
const game = require("../src/lib/game.ts");
delete require.extensions[".ts"];

const kv = getKV();
const originalFetch = global.fetch;
let playback;
let commands;
const person = (id) => ({ id, name: id.toUpperCase() });
const entry = (id, owner) => ({
  id,
  track: {
    id: id.padEnd(12, "0"), uri: `spotify:track:${id.padEnd(12, "0")}`,
    albumUri: "spotify:album:test", name: id, artists: "Artist", album: "Album",
    image: null, durationMs: 200000, explicit: false,
  },
  addedBy: person(owner), addedAt: 1, ratings: {},
});
const a1 = entry("a1", "a");
const a2 = entry("a2", "a");
const b1 = entry("b1", "b");
const b2 = entry("b2", "b");

beforeEach(async () => {
  await game.resetAll();
  await kv.del("ss:sync");
  await kv.del("ss:device");
  await kv.set("ss:spotify", { accessToken: "test-only", expiresAt: Date.now() + 3600000 });
  playback = null;
  commands = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/v1/me/player" && !init.method) {
      return playback ? Response.json(playback) : new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/v1/tracks/")) {
      const id = url.pathname.split("/").at(-1);
      return Response.json({ id, uri: `spotify:track:${id}`, name: id,
        artists: [{ name: "Artist" }], album: { name: "Album", uri: "spotify:album:test" }, duration_ms: 200000 });
    }
    assert.ok(["/v1/me/player/play", "/v1/me/player/queue", "/v1/me/player/next"].includes(url.pathname), url.pathname);
    commands.push(url.pathname);
    return new Response(null, { status: 204 });
  };
});
after(() => { global.fetch = originalFetch; });

async function seed(queue) {
  await kv.del("ss:playback");
  await kv.set("ss:state", {
    queue, nowPlaying: null, history: [], playback: null, playbackAt: 0, error: null,
  });
}

async function tick(e, progress = 100) {
  playback = e ? {
    is_playing: true, progress_ms: progress,
    item: { id: e.track.id, duration_ms: e.track.durationMs },
    device: { id: "desktop", name: "Desktop" },
  } : null;
  await kv.del("ss:sync");
  await game.sync();
  return game.publicState(null, true);
}

test("one song per person per round; late new people join the last playing song's round", async () => {
  await seed([a1, a2, b1, b2]);
  let state = await tick(a1);
  assert.deepEqual(state.queue.map((e) => [e.id, e.roundNumber]), [["b1", 1], ["a2", 2], ["b2", 2]]);
  state = await tick(b1);
  assert.equal(state.currentRound, 1);
  await game.addSong(person("c"), "c10000000000");
  await game.addSong(person("a"), "a30000000000");
  state = await game.publicState(null, true);
  assert.equal(state.queue[0].addedBy.id, "c");
  assert.equal(state.queue[0].roundNumber, 1);
  assert.equal(state.queue.find((e) => e.track.id === "a30000000000").roundNumber, 3);
  await assert.rejects(game.playNow("a2"), /already has a song in this round/);
  const c = { track: state.queue[0].track };
  await tick(c);
  state = await tick(a2);
  assert.equal(state.currentRound, 2);
  assert.equal(state.roundResults[0].songCount, 3);
  assert.equal(state.nowPlaying.id, "a2");
});

test("Spotify relinked playback is recognised and can be rated without restarting it", async () => {
  await seed([a1, b1]);
  playback = {
    is_playing: true, progress_ms: 5000,
    item: { id: "substituted-track", linked_from: { id: a1.track.id }, duration_ms: 200000 },
    device: { id: "desktop", name: "Desktop" },
  };
  await kv.del("ss:sync");
  await game.sync();
  let state = await game.publicState("voter", true);
  assert.equal(state.nowPlaying.id, "a1");
  assert.equal(state.nowPlaying.canRate, true);
  await game.rateSong(person("voter"), "a1", 8);
  playback.progress_ms = 10000;
  await kv.del("ss:sync");
  await game.sync();
  state = await game.publicState("voter", true);
  assert.equal(state.nowPlaying.id, "a1");
  assert.equal(state.nowPlaying.myScore, 8);
  assert.equal(state.history.length, 0);
  assert.deepEqual(commands, []);
});

test("unconfirmed playback does not restart the same requested song indefinitely", async () => {
  await seed([{ ...a1, handedOffAt: Date.now() - 20000 }]);
  let state = await tick({ track: { ...a1.track, id: "unmatched-track" } });
  assert.equal(state.nowPlaying, null);
  assert.match(state.error, /Reported track: unmatched-track/);
  assert.match(state.error, /automatic retries are stopped/i);
  assert.deepEqual(commands, []);
  state = await tick(null);
  assert.match(state.error, /not reporting playback/);
  assert.deepEqual(commands, []);
  await game.playNow("a1");
  assert.equal(commands.length, 1);
  state = await tick(a1);
  assert.equal(state.nowPlaying.id, "a1");
  assert.equal(state.error, null);
});

test("ties award one point each, repeat polls do not award twice, and host edits recalculate", async () => {
  await seed([a1, b1, a2]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 8);
  await tick(b1);
  await game.rateSong(person("voter"), "b1", 8);
  let state = await tick(a2);
  assert.equal(state.currentRound, 2);
  assert.deepEqual(state.roundResults[0].winners.map((w) => w.id).sort(), ["a", "b"]);
  assert.deepEqual(state.leaderboard.map((r) => r.roundPoints), [1, 1]);
  await tick(a2);
  state = await game.publicState(null, true);
  assert.equal(state.roundResults.length, 1);
  assert.deepEqual(state.leaderboard.map((r) => r.roundPoints), [1, 1]);
  await game.deleteRating("a1", "voter");
  state = await game.publicState(null, true);
  assert.deepEqual(state.roundResults[0].winners.map((w) => w.id), ["b"]);
  assert.equal(state.leaderboard.find((r) => r.id === "b").roundPoints, 1);
  await game.deleteHistoryEntry("b1");
  state = await game.publicState(null, true);
  assert.deepEqual(state.roundResults[0].winners, []);
  assert.ok(state.leaderboard.every((r) => r.roundPoints === 0));
});

test("unrated rounds end without a winner even when the queue becomes empty; reset clears points", async () => {
  await seed([a1]);
  await tick(a1);
  let state = await tick(null);
  assert.equal(state.currentRound, 2);
  assert.deepEqual(state.roundResults, [{ number: 1, winners: [], songCount: 1 }]);
  await tick(null);
  state = await game.publicState(null, true);
  assert.equal(state.roundResults.length, 1);
  await game.resetAll();
  state = await game.publicState(null, true);
  assert.equal(state.currentRound, 1);
  assert.deepEqual(state.roundResults, []);
  assert.deepEqual(state.leaderboard, []);
});

test("the final song is not pre-queued into the next round, leaving room for new participants", async () => {
  await seed([a1, a2]);
  await tick(a1, 190000);
  assert.ok(!commands.includes("/v1/me/player/queue"));
  await game.addSong(person("b"), "b10000000000");
  await tick(a1, 195000);
  assert.equal(commands.filter((path) => path === "/v1/me/player/queue").length, 1);
  const state = await game.publicState(null, true);
  assert.equal(state.queue[0].roundNumber, 1);
  assert.equal(state.queue[0].handedOff, true);
});

test("reordering a future round does not pull its songs into the live round", async () => {
  await seed([a1, b1, entry("c1", "c"), a2, b2, entry("c2", "c")]);
  await game.reorderQueue(["b2", "a2"]);
  const state = await game.publicState(null, true);
  assert.deepEqual(state.queue.slice(0, 3).map((e) => e.id), ["a1", "b1", "c1"]);
  assert.deepEqual(state.queue.slice(3).map((e) => e.id), ["b2", "a2", "c2"]);
});

test("database write errors during sync surface instead of silently leaving stale playback", async () => {
  await seed([a1]);
  const set = kv.set;
  kv.set = async (key, value) => {
    if (key === "ss:playback") throw new Error("Database quota exhausted");
    return set.call(kv, key, value);
  };
  try {
    await assert.rejects(tick(a1), /Database quota exhausted/);
  } finally {
    kv.set = set;
  }
});

test("winner points survive the 200-song history cap and a fresh server module", async () => {
  const songs = Array.from({ length: 202 }, (_, i) => entry(`song${i}`, "a"));
  await seed(songs);
  for (const song of songs) {
    await tick(song);
    await game.rateSong(person("voter"), song.id, 9);
  }
  let state = await tick(null);
  assert.equal(state.history.length, 200);
  assert.equal(state.roundResults.length, 202);
  assert.equal(state.leaderboard[0].roundPoints, 202);

  const path = require.resolve("../src/lib/game.ts");
  const cached = require.cache[path];
  require.extensions[".ts"] = compileTS;
  delete require.cache[path];
  try {
    const freshGame = require(path);
    state = await freshGame.publicState(null, true);
    assert.equal(state.currentRound, 203);
    assert.equal(state.roundResults.length, 202);
    assert.equal(state.leaderboard[0].roundPoints, 202);
  } finally {
    require.cache[path] = cached;
    delete require.extensions[".ts"];
  }
});

test("removing the last unplayed entry completes the round without losing played ratings", async () => {
  await seed([a1, b1, a2]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 7);
  await game.removeEntry("b1");
  const state = await tick(a2);
  assert.equal(state.currentRound, 2);
  assert.equal(state.roundResults[0].songCount, 1);
  assert.deepEqual(state.roundResults[0].winners.map((w) => w.id), ["a"]);
});

test("a skipped song keeps its score for the round winner", async () => {
  await seed([a1, b1]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 9);
  for (let i = 0; i < 5; i++) await game.voteSkip(person(`v${i}`), "a1", true);
  await tick(b1);
  await game.rateSong(person("voter"), "b1", 6);
  const state = await tick(null);
  assert.deepEqual(state.roundResults[0].winners.map((w) => w.id), ["a"]);
  assert.equal(state.history.find((e) => e.id === "a1").skipped, true);
});
