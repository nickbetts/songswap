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

test("one continuous smart queue rotates people and accepts late requests", async () => {
  await seed([a1, a2, b1, b2]);
  let state = await tick(a1);
  assert.deepEqual(state.queue.map((e) => e.id), ["b1", "a2", "b2"]);
  state = await tick(b1);
  assert.deepEqual(state.queue.map((e) => e.id), ["a2", "b2"]);
  await game.addSong(person("c"), "c10000000000");
  await game.addSong(person("a"), "a30000000000");
  state = await game.publicState(null, true);
  assert.deepEqual(state.queue.map((e) => e.addedBy.id), ["a", "c", "b", "a"]);
  assert.ok(!("currentRound" in state));
  assert.ok(!("roundResults" in state));
  assert.ok(state.queue.every((e) => !("roundNumber" in e)));
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

test("hosts can remove a locked-in request and clear its stale warning without sending playback commands", async () => {
  await seed([{ ...a1, handedOffAt: Date.now() - 20000 }, b1, a2]);
  await tick({ track: { ...a1.track, id: "unmatched-track" } });
  assert.match((await game.publicState(null, true)).error, /not confirmed/);
  assert.ok(await kv.get("ss:sync"));
  await game.removeEntry("a1");
  const state = await game.publicState(null, true);
  assert.equal(state.error, null);
  assert.deepEqual(state.queue.map((e) => e.id), ["b1", "a2"]);
  assert.equal(await kv.get("ss:sync"), null);
  assert.deepEqual(commands, []);
  await assert.rejects(game.removeEntry("a1"), /Not in the queue/);
});

test("another release of the same recording restores now playing and voting for legacy requests", async () => {
  await seed([{ ...a1, handedOffAt: Date.now() - 20000 }, b1]);
  const fetch = global.fetch;
  let lookups = 0;
  global.fetch = async (input, init) => {
    if (new URL(input).pathname === `/v1/tracks/${a1.track.id}`) {
      lookups++;
      return Response.json({
        id: a1.track.id, external_ids: { isrc: "GBTEST000001" },
      });
    }
    return fetch(input, init);
  };
  playback = {
    is_playing: true, progress_ms: 5000,
    item: { id: "different-release", external_ids: { isrc: "GBTEST000001" }, duration_ms: 200000 },
  };
  await game.sync();
  let state = await game.publicState("voter", true);
  assert.equal(state.nowPlaying.id, "a1");
  assert.equal(state.nowPlaying.canRate, true);
  assert.equal(state.error, null);
  await game.rateSong(person("voter"), "a1", 9);
  await kv.del("ss:sync");
  await game.sync();
  state = await game.publicState("voter", true);
  assert.equal(state.nowPlaying.myScore, 9);
  assert.equal(lookups, 1);
  assert.deepEqual(commands, []);
});

test("a different recording is not credited to the requested song", async () => {
  await seed([{ ...a1, track: { ...a1.track, isrc: "GBTEST000001" }, handedOffAt: Date.now() - 20000 }]);
  playback = {
    is_playing: true, progress_ms: 5000,
    item: { id: "different-recording", external_ids: { isrc: "GBTEST000002" }, duration_ms: 200000 },
  };
  await game.sync();
  const state = await game.publicState("voter", true);
  assert.equal(state.nowPlaying, null);
  assert.match(state.error, /not confirmed/);
  assert.deepEqual(commands, []);
});

test("leaderboard uses average ratings only and host edits recalculate", async () => {
  await seed([a1, b1, a2]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 8);
  await tick(b1);
  await game.rateSong(person("voter"), "b1", 8);
  let state = await tick(a2);
  assert.deepEqual(state.leaderboard.map((r) => [r.id, r.average]), [["a", 8], ["b", 8]]);
  assert.ok(state.leaderboard.every((r) => !("roundPoints" in r)));
  await tick(a2);
  state = await game.publicState(null, true);
  assert.deepEqual(state.leaderboard.map((r) => [r.id, r.average]), [["a", 8], ["b", 8]]);
  await game.deleteRating("a1", "voter");
  state = await game.publicState(null, true);
  assert.deepEqual(state.leaderboard.map((r) => [r.id, r.average]), [["b", 8]]);
  await game.deleteHistoryEntry("b1");
  state = await game.publicState(null, true);
  assert.deepEqual(state.leaderboard, []);
});

test("unrated songs stay out of the leaderboard and reset clears the session", async () => {
  await seed([a1]);
  await tick(a1);
  let state = await tick(null);
  assert.deepEqual(state.history.map((e) => e.id), ["a1"]);
  assert.deepEqual(state.leaderboard, []);
  await tick(null);
  state = await game.publicState(null, true);
  assert.equal(state.history.length, 1);
  await game.resetAll();
  state = await game.publicState(null, true);
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.queue, []);
  assert.deepEqual(state.leaderboard, []);
});

test("the next song is handed to Spotify without waiting for a round boundary", async () => {
  await seed([a1, a2]);
  await tick(a1, 190000);
  assert.equal(commands.filter((path) => path === "/v1/me/player/queue").length, 1);
  await game.addSong(person("b"), "b10000000000");
  await tick(a1, 195000);
  assert.equal(commands.filter((path) => path === "/v1/me/player/queue").length, 1);
  const state = await game.publicState(null, true);
  assert.equal(state.queue[0].id, "a2");
  assert.equal(state.queue[0].handedOff, true);
});

test("host reordering works across the entire queue while retaining smart rotation", async () => {
  await seed([a1, b1, entry("c1", "c"), a2, b2, entry("c2", "c")]);
  await game.reorderQueue(["b2", "a2"]);
  const state = await game.publicState(null, true);
  assert.deepEqual(state.queue.map((e) => e.id), ["b2", "a2", "c1", "b1", "a1", "c2"]);
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

test("all songs and ratings survive beyond 200 plays and a fresh server module for guests and hosts", async () => {
  const songs = Array.from({ length: 251 }, (_, i) => entry(`song${i}`, i === 0 ? "oldest" : "a"));
  await seed(songs);
  for (const song of songs) {
    await tick(song);
    await game.rateSong(person("voter"), song.id, song === songs[0] ? 10 : 9);
  }
  let state = await tick(null);
  const verifyHistory = (state) => {
    assert.equal(state.history.length, 251);
    assert.equal(state.history[0].id, "song250");
    assert.equal(state.history.at(-1).id, "song0");
    assert.deepEqual(state.history.at(-1).ratings.map((r) => [r.name, r.score]), [["VOTER", 10]]);
    assert.deepEqual(state.leaderboard.map((p) => [p.id, p.average, p.songs]), [["oldest", 10, 1], ["a", 9, 250]]);
    assert.deepEqual(state.stats, { songsPlayed: 251, totalDurationMs: 251 * 200000, ratingsCast: 251 });
  };
  verifyHistory(state);
  verifyHistory(await game.publicState("guest", false));

  const path = require.resolve("../src/lib/game.ts");
  const cached = require.cache[path];
  require.extensions[".ts"] = compileTS;
  delete require.cache[path];
  try {
    const freshGame = require(path);
    state = await freshGame.publicState(null, true);
    verifyHistory(state);
    verifyHistory(await freshGame.publicState("guest", false));
    await freshGame.deleteRating("song0", "voter");
    state = await freshGame.publicState(null, true);
    assert.equal(state.stats.ratingsCast, 250);
    assert.equal(state.history.at(-1).average, null);
    await freshGame.deleteHistoryEntry("song0");
    state = await freshGame.publicState(null, true);
    assert.deepEqual(state.stats, { songsPlayed: 250, totalDurationMs: 250 * 200000, ratingsCast: 250 });
    assert.deepEqual(state.leaderboard.map((p) => p.id), ["a"]);
  } finally {
    require.cache[path] = cached;
    delete require.extensions[".ts"];
  }
});

test("session stats count played history only and reset explicitly clears history and totals", async () => {
  await seed([a1, b1, a2]);
  let state = await tick(a1);
  assert.deepEqual(state.stats, { songsPlayed: 0, totalDurationMs: 0, ratingsCast: 0 });
  await game.rateSong(person("voter"), "a1", 8);
  state = await tick(b1);
  assert.deepEqual(state.stats, { songsPlayed: 1, totalDurationMs: 200000, ratingsCast: 1 });
  await tick(b1);
  state = await game.publicState("guest", false);
  assert.equal(state.stats.songsPlayed, 1);
  await game.resetAll();
  state = await game.publicState(null, true);
  assert.deepEqual(state.stats, { songsPlayed: 0, totalDurationMs: 0, ratingsCast: 0 });
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.leaderboard, []);
});

test("removing a queued entry does not lose played ratings", async () => {
  await seed([a1, b1, a2]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 7);
  await game.removeEntry("b1");
  const state = await tick(a2);
  assert.deepEqual(state.history.map((e) => [e.id, e.average]), [["a1", 7]]);
  assert.equal(state.leaderboard[0].average, 7);
});

test("a skipped song keeps its score in history and the rating leaderboard", async () => {
  await seed([a1, b1]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 9);
  for (let i = 0; i < 5; i++) await game.voteSkip(person(`v${i}`), "a1", true);
  await tick(b1);
  await game.rateSong(person("voter"), "b1", 6);
  const state = await tick(null);
  assert.deepEqual(state.leaderboard.map((e) => [e.id, e.average]), [["a", 9], ["b", 6]]);
  assert.equal(state.history.find((e) => e.id === "a1").skipped, true);
});

test("Play now can choose any song, including another pick by the current person", async () => {
  await seed([a1, b1, a2]);
  await tick(a1);
  await game.playNow("a2");
  assert.deepEqual(commands, ["/v1/me/player/play"]);
  const state = await tick(a2);
  assert.equal(state.nowPlaying.id, "a2");
  assert.deepEqual(state.queue.map((e) => e.id), ["b1"]);
});

test("smart rotation pins handed-off songs and preserves each person's pick order", () => {
  const pinned = { ...a1, handedOffAt: 1 };
  assert.deepEqual(game.fairOrder([pinned, a2, b1, b2], null).map((e) => e.id), ["a1", "b1", "a2", "b2"]);
  assert.deepEqual(game.fairOrder([a1, a2, b1, b2], a1).map((e) => e.id), ["b1", "a1", "b2", "a2"]);
});

test("guests receive every queued song and played history newest first, not highest rated", async () => {
  const songs = Array.from({ length: 75 }, (_, i) => entry(`queued${i}`, i % 2 ? "a" : "b"));
  await seed(songs);
  let state = await game.publicState("guest", false);
  assert.equal(state.queue.length, 75);
  assert.deepEqual(new Set(state.queue.map((e) => e.id)), new Set(songs.map((e) => e.id)));

  await seed([a1, b1, a2]);
  await tick(a1);
  await game.rateSong(person("voter"), "a1", 10);
  await tick(b1);
  await game.rateSong(person("voter"), "b1", 3);
  await tick(a2);
  state = await game.publicState("guest", false);
  assert.deepEqual(state.history.map((e) => [e.id, e.average]), [["b1", 3], ["a1", 10]]);
});
