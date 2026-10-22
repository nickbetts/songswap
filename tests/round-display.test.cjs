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

const { History, RoundPanel } = load(path.resolve(__dirname, "../src/components/parts.tsx"));
const entry = (id, average, roundNumber = 1) => ({
  id,
  track: { name: `Track-${id}`, artists: "Artist", image: null },
  addedBy: { id, name: `Picker-${id}` },
  average,
  ratingCount: average === null ? 0 : 1,
  ratings: average === null ? [] : [{ id: "voter", name: "Voter", score: average }],
  roundNumber,
});
const renderHistory = (items, props = {}) =>
  renderToStaticMarkup(React.createElement(History, { items, userId: null, ...props }));
const countLeaders = (html) => (html.match(/class="hrow round-leader"/g) || []).length;

test("played songs sort highest first with stable ties and unrated songs last, without mutating state", () => {
  const items = [entry("unrated", null), entry("low", 3), entry("best", 9), entry("tie", 9)];
  const html = renderHistory(items);
  const positions = ["best", "tie", "low", "unrated"].map((id) => html.indexOf(`Track-${id}`));
  assert.ok(positions.every((position, i) => i === 0 || position > positions[i - 1]));
  assert.deepEqual(items.map((e) => e.id), ["unrated", "low", "best", "tie"]);
  assert.equal(countLeaders(html), 0);
});

test("only rated leaders receive gold treatment and ties share first place", () => {
  const html = renderHistory([entry("low", 6), entry("best", 9), entry("tie", 9)], { roundStatus: "live" });
  assert.equal(countLeaders(html), 2);
  assert.equal((html.match(/Joint round leader/g) || []).length, 2);
  assert.equal((html.match(/round-leader-medal/g) || []).length, 2);
  assert.match(html, /Picker-best/);
  assert.equal(countLeaders(renderHistory([entry("unrated", null)], { roundStatus: "live" })), 0);
  assert.match(renderHistory([], { roundStatus: "live" }), /Songs land here/);
});

test("leader updates after score changes or deletion and completed rounds label winners", () => {
  const best = entry("best", 9);
  const challenger = entry("challenger", 8);
  assert.match(renderHistory([best, challenger], { roundStatus: "live" }), /Current round leader/);
  const updated = renderHistory([best, { ...challenger, average: 10 }], { roundStatus: "live" });
  assert.ok(updated.indexOf("Track-challenger") < updated.indexOf("Track-best"));
  assert.equal(countLeaders(updated), 1);
  const completed = renderHistory([challenger], { roundStatus: "complete" });
  assert.equal(countLeaders(completed), 1);
  assert.match(completed, /Round winner/);
  assert.doesNotMatch(completed, /Current round leader/);
});

test("round panel ranks only the selected round and preserves host rating controls", () => {
  const html = renderToStaticMarkup(React.createElement(RoundPanel, {
    state: {
      currentRound: 2, roundResults: [], queue: [], nowPlaying: null,
      history: [entry("previous", 10, 1), entry("low", 4, 2), entry("best", 8, 2)],
    },
    receivedAt: 0, userId: "host", onRequest() {}, canRequest: true,
    historyAdmin: { onDelete() {}, onDeleteRating() {} },
  }));
  assert.doesNotMatch(html, /Track-previous/);
  assert.ok(html.indexOf("Track-best") < html.indexOf("Track-low"));
  assert.equal(countLeaders(html), 1);
  assert.match(html, /Delete Track-best from history/);
  assert.match(html, /Delete Voter/);
});
