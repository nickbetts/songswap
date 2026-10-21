const { beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

// Never use a developer's or CI's real database for these in-memory tests.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;

// Exercise the server modules using the project's existing TypeScript compiler.
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { getKV } = require("../src/lib/store.ts");
const { setMeetingMode, getMeetingMode } = require("../src/lib/meeting.ts");
delete require.extensions[".ts"];

const originalFetch = global.fetch;
const kv = getKV();
let devices;
let calls;
let rejectVolume;

beforeEach(async () => {
  await kv.del("ss:meeting");
  await kv.del("ss:device");
  await kv.set("ss:spotify", { accessToken: "test-only", expiresAt: Date.now() + 3600000 });
  devices = [
    { id: "laptop", name: "Laptop", is_active: true, volume_percent: 80, supports_volume: true },
    { id: "phone", name: "Phone", is_active: false, volume_percent: 60, supports_volume: true },
  ];
  calls = [];
  rejectVolume = false;
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/devices")) return Response.json({ devices });
    assert.equal(url.pathname, "/v1/me/player/volume");
    if (rejectVolume) return Response.json({ error: { message: "Volume not available" } }, { status: 403 });
    const id = url.searchParams.get("device_id");
    const volume = Number(url.searchParams.get("volume_percent"));
    calls.push({ id, volume });
    const device = devices.find((d) => d.id === id);
    if (device) device.volume_percent = volume;
    return new Response(null, { status: 204 });
  };
});

after(() => { global.fetch = originalFetch; });

test("reduces volume by 75% and restores the exact original on the same device", async () => {
  const mode = await setMeetingMode(true);
  assert.equal(mode.originalVolume, 80);
  assert.equal(mode.quietVolume, 20);
  assert.equal(mode.applied, true);
  devices[0].is_active = false;
  devices[1].is_active = true;
  await kv.set("ss:device", { id: "phone", name: "Phone" });
  await setMeetingMode(false);
  assert.deepEqual(calls, [{ id: "laptop", volume: 20 }, { id: "laptop", volume: 80 }]);
  assert.equal(await getMeetingMode(), null);
});

test("uses the host's chosen device rather than another active one", async () => {
  await kv.set("ss:device", { id: "phone", name: "Phone" });
  await setMeetingMode(true);
  assert.deepEqual(calls, [{ id: "phone", volume: 15 }]);
});

test("repeated enable requests don't compound the reduction or lose the restore point", async () => {
  await setMeetingMode(true);
  await setMeetingMode(true);
  assert.equal((await getMeetingMode()).originalVolume, 80);
  assert.deepEqual(calls.map((c) => c.volume), [20, 20]);
});

test("rounds to Spotify's integer percentage and handles an already-muted device", async () => {
  devices[0].volume_percent = 67;
  assert.equal((await setMeetingMode(true)).quietVolume, 17);
  await setMeetingMode(false);
  devices[0].volume_percent = 0;
  await setMeetingMode(true);
  await setMeetingMode(false);
  assert.deepEqual(calls.map((c) => c.volume), [17, 67, 0, 0]);
});

test("does not guess a volume for unsupported devices", async () => {
  devices[0].supports_volume = false;
  await assert.rejects(setMeetingMode(true), /doesn't support remote volume/);
  assert.equal(await getMeetingMode(), null);
  assert.equal(calls.length, 0);
});

test("does not target an arbitrary device if the chosen device is missing", async () => {
  await kv.set("ss:device", { id: "missing", name: "Missing" });
  await assert.rejects(setMeetingMode(true), /Open Spotify/);
  assert.equal(calls.length, 0);
});

test("retains the restore point when Spotify rejects either command", async () => {
  rejectVolume = true;
  await assert.rejects(setMeetingMode(true), /Volume not available/);
  assert.equal((await getMeetingMode()).originalVolume, 80);
  assert.equal((await getMeetingMode()).applied, false);
  await assert.rejects(setMeetingMode(false), /Volume not available/);
  assert.equal((await getMeetingMode()).originalVolume, 80);
  rejectVolume = false;
  await setMeetingMode(false);
  assert.deepEqual(calls, [{ id: "laptop", volume: 80 }]);
});

test("two simultaneous enable requests preserve a single original volume", async () => {
  await Promise.all([setMeetingMode(true), setMeetingMode(true)]);
  assert.equal((await getMeetingMode()).originalVolume, 80);
  assert.deepEqual(calls.map((c) => c.volume), [20, 20]);
});

test("turning off an inactive mode is a no-op", async () => {
  assert.equal(await setMeetingMode(false), null);
  assert.equal(calls.length, 0);
});
