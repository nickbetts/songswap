import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { exchangeCode, me, saveAuth } from "@/lib/spotify";
import { redirectUri } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${url.origin}/admin${q}`);

  if (!(await isAdmin())) return back("");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("ss_oauth_state="))
    ?.split("=")[1];

  if (url.searchParams.get("error")) return back(`?error=${encodeURIComponent(url.searchParams.get("error")!)}`);
  if (!code || !state || state !== cookieState) return back("?error=state_mismatch");

  try {
    const tok = await exchangeCode(code, redirectUri(req));
    let displayName: string | undefined;
    try {
      displayName = (await me(tok.access_token)).display_name;
    } catch {}
    await saveAuth({
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + tok.expires_in * 1000,
      displayName,
    });
  } catch (e) {
    return back(`?error=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "auth_failed")}`);
  }
  const res = back("?connected=1");
  res.cookies.delete("ss_oauth_state");
  return res;
}
