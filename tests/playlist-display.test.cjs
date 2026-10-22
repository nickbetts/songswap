const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const nativeRequire = createRequire(filename);
  const requireSource = (id) => {
    if (!id.startsWith(".") && !id.startsWith("@/")) return nativeRequire(id);
    const base = id.startsWith("@/")
      ? path.resolve(__dirname, "../src", id.slice(2))
      : path.resolve(path.dirname(filename), id);
    const source = [base + ".ts", base + ".tsx"].find((file) => fs.existsSync(file));
    return source ? load(source) : nativeRequire(id);
  };
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  assert.deepEqual(diagnostics, [], `Invalid TypeScript in ${filename}`);
  new Function("require", "module", "exports", outputText)(requireSource, module, module.exports);
  return module.exports;
}

const { History, QueuePanel, SidePanel, Leaderboard, NowPlayingHero } = load(path.resolve(__dirname, "../src/components/parts.tsx"));
const entry = (id, average, roundNumber = 1) => ({
  id,
  track: { name: `Track-${id}`, artists: "Artist", image: null, durationMs: 200000 },
  addedBy: { id, name: `Picker-${id}` },
  average,
  ratingCount: average === null ? 0 : 1,
  ratings: average === null ? [] : [{ id: "voter", name: "Voter", score: average }],
  roundNumber,
});
const renderHistory = (items, props = {}) =>
  renderToStaticMarkup(React.createElement(History, { items, userId: null, ...props }));
test("played songs retain newest-first history, with ratings but no round decorations", () => {
  const items = [entry("unrated", null), entry("low", 3), entry("best", 9), entry("tie", 9)];
  const html = renderHistory(items);
  const positions = ["unrated", "low", "best", "tie"].map((id) => html.indexOf(`Track-${id}`));
  assert.ok(positions.every((position, i) => i === 0 || position > positions[i - 1]));
  assert.deepEqual(items.map((e) => e.id), ["unrated", "low", "best", "tie"]);
  assert.doesNotMatch(html, /round-leader|Round winner/);
  assert.match(html, /Voter/);
});

test("one Up Next list includes every request regardless of old round metadata", () => {
  const html = renderToStaticMarkup(React.createElement(QueuePanel, {
    queue: [entry("one", null, 1), entry("two", null, 2), entry("three", null, 3)],
    np: null, receivedAt: 0, userId: "guest", onRequest() {}, canRequest: true,
  }));
  assert.match(html, /Up Next/);
  assert.match(html, /Track-one/);
  assert.match(html, /Track-two/);
  assert.match(html, /Track-three/);
  assert.doesNotMatch(html, /Previous round|Next round|Round \d|round-leader/);
});

test("only rating leaderboard and played tabs remain; ratings rank highest first", () => {
  const rows = [
    { id: "low", name: "Low", average: 4, songs: 2 },
    { id: "best", name: "Best", average: 9, songs: 1 },
  ];
  const html = renderToStaticMarkup(React.createElement(SidePanel, {
    leaderboard: rows, history: [], userId: null, userName: null,
  }));
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.match(html, /Leaderboard/);
  assert.match(html, /Played/);
  assert.doesNotMatch(html, /Point Leaderboard|round point/);
  const board = renderToStaticMarkup(React.createElement(Leaderboard, { rows, me: null }));
  assert.ok(board.indexOf("Best") < board.indexOf("Low"));
  assert.match(board, /9.00\/10/);
});

test("history preserves host deletion controls and empty state", () => {
  const html = renderHistory([entry("best", 8)], {
    admin: { onDelete() {}, onDeleteRating() {} },
  });
  assert.match(html, /Delete Track-best from history/);
  assert.match(html, /Delete Voter/);
  assert.match(renderHistory([]), /Songs land here/);
});

test("the Picked by avatar stays 72px", () => {
  const html = renderToStaticMarkup(React.createElement(NowPlayingHero, {
    np: { ...entry("current", 8), progressMs: 0, ageMs: 0, isPlaying: true, canRate: false,
      skip: { needed: 5, voters: [], mine: false, pending: false } },
    receivedAt: Date.now(), user: null, onChange() {}, onRequest() {}, effects: false,
  }));
  assert.match(html, /class="picked-by"><span class="avatar " style="width:72px;height:72px/);
});
