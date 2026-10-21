const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const sharp = require("sharp");
const { randomBytes } = require("node:crypto");

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { MAX_AVATAR_BYTES, AVATAR_CHUNK_BYTES } = require("../src/lib/avatar-config.ts");
const { startAvatarUpload, uploadAvatarPart, finishAvatarUpload, validateAvatar, readLimitedBody } = require("../src/lib/avatar.ts");
delete require.extensions[".ts"];

const gif = Buffer.from(
  "47494638396101000100800000000000ffffff" +
  "21ff0b4e45545343415045322e300301000000" +
  "21f904000a0000002c0000000001000100000202440100" +
  "21f904000a0000002c00000000010001000002024c01003b", "hex",
);
const request = (body) => new Request("http://localhost/upload", { method: "PUT", body });

async function upload(userId, bytes) {
  const started = await startAvatarUpload(userId, bytes.length);
  for (let part = 0; part < started.parts; part++) {
    await uploadAvatarPart(userId, started.uploadId, part, request(bytes.subarray(part * started.chunkSize, (part + 1) * started.chunkSize)));
  }
  return finishAvatarUpload(userId, started.uploadId);
}

test("animated GIFs are accepted and preserved byte-for-byte", async () => {
  const original = await sharp(gif, { animated: true }).metadata();
  assert.equal(original.pages, 2);
  const { file } = await upload("gif-user", gif);
  assert.equal(file.type, "image/gif");
  assert.deepEqual(Buffer.from(file.data, "base64"), gif);
});

test("accepts a valid picture larger than Vercel's single-request limit using chunks", async () => {
  const bytes = await sharp(randomBytes(1280 * 1280 * 3), {
    raw: { width: 1280, height: 1280, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(bytes.length > 4.5 * 1024 * 1024 && bytes.length <= MAX_AVATAR_BYTES);
  const { file } = await upload("large-user", bytes);
  assert.equal(file.type, "image/png");
  assert.deepEqual(Buffer.from(file.data, "base64"), bytes);
});

test("the exact 5 MB boundary is allowed, one byte over is rejected", async () => {
  const exact = Buffer.concat([gif, Buffer.alloc(MAX_AVATAR_BYTES - gif.length)]);
  assert.equal(Buffer.from((await upload("limit-user", exact)).file.data, "base64").length, MAX_AVATAR_BYTES);
  await assert.rejects(startAvatarUpload("limit-user", MAX_AVATAR_BYTES + 1), { status: 413 });
  await assert.rejects(startAvatarUpload("limit-user", 0), { status: 400 });
});

test("JPEG and WebP are also supported, oversized dimensions are rejected", async () => {
  const image = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#bb33ff" } });
  assert.equal(await validateAvatar(await image().jpeg().toBuffer()), "image/jpeg");
  assert.equal(await validateAvatar(await image().webp().toBuffer()), "image/webp");
  const huge = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "#fff" } }).png().toBuffer();
  await assert.rejects(validateAvatar(huge), { status: 400 });
});

test("cannot upload to or finish another user's upload id", async () => {
  const { uploadId } = await startAvatarUpload("owner", gif.length);
  await assert.rejects(uploadAvatarPart("other", uploadId, 0, request(gif)), { status: 404 });
  await assert.rejects(finishAvatarUpload("other", uploadId), { status: 404 });
});

test("missing chunks and wrong chunk sizes are rejected", async () => {
  const { uploadId } = await startAvatarUpload("incomplete", gif.length);
  await assert.rejects(finishAvatarUpload("incomplete", uploadId), /isn't complete/);
  await assert.rejects(uploadAvatarPart("incomplete", uploadId, 0, request(gif.subarray(1))), /Incomplete/);
});

test("chunk retry is idempotent, but changing a received chunk is rejected", async () => {
  const { uploadId } = await startAvatarUpload("retry-user", gif.length);
  await uploadAvatarPart("retry-user", uploadId, 0, request(gif));
  await uploadAvatarPart("retry-user", uploadId, 0, request(gif));
  const changed = Buffer.from(gif);
  changed[10] ^= 1;
  await assert.rejects(uploadAvatarPart("retry-user", uploadId, 0, request(changed)), { status: 409 });
});

test("starting another upload discards the old staging data", async () => {
  const previous = await startAvatarUpload("replace-user", gif.length);
  await uploadAvatarPart("replace-user", previous.uploadId, 0, request(gif));
  await startAvatarUpload("replace-user", gif.length);
  await assert.rejects(finishAvatarUpload("replace-user", previous.uploadId), { status: 404 });
});

test("rejects executable or SVG content disguised as a profile picture", async () => {
  await assert.rejects(validateAvatar(Buffer.from("<html><script>alert(1)</script></html>")), { status: 400 });
  await assert.rejects(validateAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')), { status: 400 });
});

test("streamed chunks cannot bypass the byte limit by omitting Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(AVATAR_CHUNK_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const req = new Request("http://localhost/upload", { method: "PUT", body: stream, duplex: "half" });
  await assert.rejects(readLimitedBody(req, AVATAR_CHUNK_BYTES), { status: 413 });
});
