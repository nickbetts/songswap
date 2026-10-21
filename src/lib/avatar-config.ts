export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_CHUNK_BYTES = 1024 * 1024;
export const avatarUrl = (id: string, version: string) => `/api/avatar/${encodeURIComponent(id)}?v=${version}`;
export const avatarName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
