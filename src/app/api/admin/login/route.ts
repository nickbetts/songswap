import { NextResponse } from "next/server";
import { ADMIN_COOKIE, checkAdminPassword, isAdmin, makeAdminToken } from "@/lib/auth";
import { assertSameOrigin, clientIp, fail } from "@/lib/http";
import { AuthError, HOST_USERNAME, clearAttempts, currentHost, limitAttempts } from "@/lib/users";

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
    await limitAttempts(`${RL_KEY}:${clientIp(req)}`);
    await limitAttempts(RL_KEY);
    if (typeof body?.password !== "string" || !checkAdminPassword(body.password)) {
      await new Promise((r) => setTimeout(r, 500));
      throw new AuthError(401, "Wrong password");
    }
    await clearAttempts(RL_KEY);
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
