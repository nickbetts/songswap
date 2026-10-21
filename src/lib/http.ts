import { NextResponse } from "next/server";
import { GameError } from "./game";
import { SpotifyError } from "./spotify";
import { AuthError } from "./users";
import { sameOrigin } from "./auth";

export function fail(e: unknown) {
  if (e instanceof GameError || e instanceof SpotifyError || e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 500 });
  }
  if (e instanceof Error && e.message === "Busy, try again") return NextResponse.json({ error: e.message }, { status: 503 });
  console.error(e);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
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

/** The caller's IP (Vercel sets x-real-ip / x-forwarded-for itself, so clients can't spoof it there). */
export function clientIp(req: Request) {
  return (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "local").trim().slice(0, 64);
}

/** Throws unless a state-changing request came from our own site. */
export function assertSameOrigin(req: Request) {
  if (!sameOrigin(req)) throw new AuthError(403, "Cross-site request blocked");
}
