import { NextResponse } from "next/server";
import { GameError } from "./game";
import { SpotifyError } from "./spotify";

export function fail(e: unknown) {
  if (e instanceof GameError || e instanceof SpotifyError) {
    return NextResponse.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 500 });
  }
  console.error(e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
}

export function origin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function redirectUri(req: Request) {
  return process.env.SPOTIFY_REDIRECT_URI || `${origin(req)}/api/auth/callback`;
}
