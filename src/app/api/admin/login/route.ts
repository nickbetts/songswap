import { NextResponse } from "next/server";
import { ADMIN_COOKIE, checkAdminPassword, isAdmin, makeAdminToken } from "@/lib/auth";
import { assertSameOrigin, fail } from "@/lib/http";
import { AuthError, HOST_USERNAME, checkRateLimit, currentHost, recordFail } from "@/lib/users";
import { getKV } from "@/lib/store";

export const dynamic = "force-dynamic";

const RL_KEY = "admin";

export async function GET() {
  const [admin, host] = await Promise.all([isAdmin(), currentHost()]);
  return NextResponse.json({ admin, host: !!host }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json().catch(() => ({}));
    if (body?.logout) {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(ADMIN_COOKIE);
      return res;
    }
    const host = await currentHost();
    if (!host) throw new AuthError(403, `Host controls are only for ${HOST_USERNAME}. Log in as ${HOST_USERNAME} first.`);
    if (!process.env.ADMIN_PASSWORD) throw new AuthError(500, "ADMIN_PASSWORD is not set on the server");
    await checkRateLimit(RL_KEY);
    if (typeof body?.password !== "string" || !checkAdminPassword(body.password)) {
      await recordFail(RL_KEY);
      throw new AuthError(401, "Wrong password");
    }
    await getKV().del(`ss:rl:${RL_KEY}`);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, makeAdminToken(host), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 12,
      path: "/",
    });
    return res;
  } catch (e) {
    return fail(e);
  }
}
