import sharp, { type Metadata } from "sharp";
import { randomBytes } from "crypto";
import { getKV, withLock } from "./store";
import { AVATAR_CHUNK_BYTES, MAX_AVATAR_BYTES } from "./avatar-config";
const UPLOAD_TTL = 15 * 60_000;

export class AvatarError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Upload {
  size: number;
  parts: number;
}

export interface AvatarFile {
  version: string;
  type: string;
  data: string;
}

const uploadKey = (userId: string, uploadId: string) => `ss:avatar-upload:${userId}:${uploadId}`;
export const avatarKey = (id: string) => `ss:avatar:${id}`;

export async function readLimitedBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max) throw new AvatarError(413, "Profile pictures must be 5 MB or smaller");
  const reader = req.body?.getReader();
  if (!reader) throw new AvatarError(400, "No file received");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new AvatarError(413, "Upload is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function startAvatarUpload(userId: string, size: unknown) {
  if (!Number.isInteger(size) || typeof size !== "number" || size < 1) throw new AvatarError(400, "Choose a non-empty picture");
  if (size > MAX_AVATAR_BYTES) throw new AvatarError(413, "Profile pictures must be 5 MB or smaller");
  return withLock(`avatar-upload:${userId}`, async () => {
    const previous = await getKV().get<string>(`ss:avatar-last:${userId}`);
    if (previous) await discardAvatarUpload(uploadKey(userId, previous), Math.ceil(MAX_AVATAR_BYTES / AVATAR_CHUNK_BYTES));
    const id = randomBytes(16).toString("hex");
    const upload: Upload = { size, parts: Math.ceil(size / AVATAR_CHUNK_BYTES) };
    await getKV().setNX(uploadKey(userId, id), JSON.stringify(upload), UPLOAD_TTL);
    await getKV().set(`ss:avatar-last:${userId}`, id);
    return { uploadId: id, chunkSize: AVATAR_CHUNK_BYTES, parts: upload.parts };
  });
}

async function loadUpload(userId: string, id: unknown): Promise<{ key: string; upload: Upload }> {
  if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) throw new AvatarError(400, "Invalid upload");
  const key = uploadKey(userId, id);
  const json = await getKV().get<string>(key);
  if (!json) throw new AvatarError(404, "Upload expired or not found. Choose your picture again");
  return { key, upload: JSON.parse(json) };
}

export async function uploadAvatarPart(userId: string, id: unknown, part: number, req: Request) {
  const { key, upload } = await loadUpload(userId, id);
  if (!Number.isInteger(part) || part < 0 || part >= upload.parts) throw new AvatarError(400, "Invalid upload part");
  const bytes = await readLimitedBody(req, AVATAR_CHUNK_BYTES);
  const expected = Math.min(AVATAR_CHUNK_BYTES, upload.size - part * AVATAR_CHUNK_BYTES);
  if (bytes.length !== expected) throw new AvatarError(400, "Incomplete upload part");
  const value = bytes.toString("base64");
  const partKey = `${key}:${part}`;
  if (!(await getKV().setNX(partKey, value, UPLOAD_TTL)) && await getKV().get<string>(partKey) !== value) {
    throw new AvatarError(409, "That upload part was already received with different content");
  }
}

export async function validateAvatar(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw new AvatarError(413, "Profile pictures must be 5 MB or smaller");
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { animated: true, limitInputPixels: 100_000_000 }).metadata();
  } catch (error) {
    console.warn("Rejected invalid profile image:", error instanceof Error ? error.message : error);
    throw new AvatarError(400, "That file isn't a valid picture. Use JPG, PNG, WebP or GIF");
  }
  const types: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const type = metadata.format && types[metadata.format];
  if (!type) throw new AvatarError(400, "Use JPG, PNG, WebP or GIF. SVG and other file types aren't allowed");
  const height = metadata.pageHeight ?? metadata.height;
  if (!metadata.width || !height || metadata.width > 4096 || height > 4096 ||
      metadata.width * height * (metadata.pages ?? 1) > 100_000_000) {
    throw new AvatarError(400, "Picture is too large to display safely. Use dimensions up to 4096px and a shorter GIF");
  }
  return type;
}

export async function finishAvatarUpload(userId: string, id: unknown) {
  const { key, upload } = await loadUpload(userId, id);
  const parts = await Promise.all(Array.from({ length: upload.parts }, (_, i) => getKV().get<string>(`${key}:${i}`)));
  if (parts.some((p) => p === null)) throw new AvatarError(400, "Upload isn't complete yet");
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(p!, "base64")));
  if (bytes.length !== upload.size) throw new AvatarError(400, "Incomplete picture");
  const type = await validateAvatar(bytes);
  return { file: { data: bytes.toString("base64"), type, version: randomBytes(12).toString("hex") }, key, parts: upload.parts };
}

export async function discardAvatarUpload(key: string, parts: number) {
  await Promise.all([getKV().del(key), ...Array.from({ length: parts }, (_, i) => getKV().del(`${key}:${i}`))]);
}

export async function deleteAvatarData(userId: string) {
  const previous = await getKV().get<string>(`ss:avatar-last:${userId}`);
  if (previous) await discardAvatarUpload(uploadKey(userId, previous), Math.ceil(MAX_AVATAR_BYTES / AVATAR_CHUNK_BYTES));
  await Promise.all([getKV().del(avatarKey(userId)), getKV().del(`ss:avatar-last:${userId}`)]);
}
