const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;

require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { getKV } = require("../src/lib/store.ts");
const game = require("../src/lib/game.ts");
delete require.extensions[".ts"];

const kv = getKV();
const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

const entry = (id) => ({
  id,
  track: { id: `t${id}`, uri: `spotify:track:t${id}`, name: id, artists: "A", album: "B", image: null, durationMs: 1000, explicit: false },
  addedBy: { id: "u1", name: "Ann" },
  addedAt: 1,
  ratings: { u2: { name: "Bob", score: 8 } },
});

/** Records which keys are read and written during `fn`. */
async function track(fn) {
  const gets = [];
  const sets = [];
  const { get, set } = kv;
  kv.get = (k) => (gets.push(k), get.call(kv, k));
  kv.set = (k, v) => (sets.push(k), set.call(kv, k, v));
  try {
    await fn();
  } finally {
    kv.get = get;
    kv.set = set;
  }
  return { gets, sets };
}

test("migrates legacy single-key state and keeps history out of ss:state", async () => {
  await kv.set("ss:state", {
    queue: [], nowPlaying: null, history: [entry("a"), entry("b")],
    playback: null, playbackAt: 0, error: null,
  });
  assert.equal((await game.publicState(null, false)).history.length, 2);

  await game.deleteHistoryEntry("a");
  const core = await kv.get("ss:state");
  assert.equal(core.history, undefined);
  assert.equal(core.playback, undefined);
  assert.ok(core.historyVer);
  const h = await kv.get("ss:history");
  assert.equal(h.ver, core.historyVer);
  assert.deepEqual(h.list.map((e) => e.id), ["b"]);

  const s = await game.publicState(null, false);
  assert.deepEqual(s.history.map((e) => e.id), ["b"]);
  assert.equal(s.leaderboard[0].average, 8);
});

test("polls reuse the cached history instead of re-reading it", async () => {
  const { gets } = await track(() => game.publicState(null, false));
  assert.ok(!gets.includes("ss:history"));
});

test("a sync with only playback progress changes writes just ss:playback", async () => {
  await kv.set("ss:spotify", { accessToken: "test-only", expiresAt: Date.now() + 3600000 });
  let progress = 100;
  global.fetch = async () =>
    new Response(JSON.stringify({
      is_playing: true, progress_ms: progress, item: { id: "other", duration_ms: 200000 },
      device: { id: "d", name: "Desk" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  await kv.del("ss:sync");
  await game.sync();
  progress = 2600;
  await kv.del("ss:sync");
  const { sets } = await track(() => game.sync());
  assert.deepEqual(sets, ["ss:playback"]);

  const s = await game.publicState(null, false);
  assert.equal(s.playerPaused, false);
  assert.deepEqual(s.history.map((e) => e.id), ["b"]);
});
