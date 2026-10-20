import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isAdmin } from "@/lib/auth";
import { SCOPES } from "@/lib/spotify";
import { redirectUri } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!(await isAdmin())) return NextResponse.redirect(`${origin}/admin`);
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${origin}/admin?error=missing_client_id`);

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(req),
    state,
    show_dialog: "true",
  }).toString();

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("ss_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
