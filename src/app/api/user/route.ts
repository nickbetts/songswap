import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, fail } from "@/lib/http";
import { USER_COOKIE, changePassword, currentUser, login, register, sessionCookie } from "@/lib/users";
import { avatarUrl } from "@/lib/avatar-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ user: await currentUser() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json().catch(() => ({}));
    if (body?.action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(USER_COOKIE);
      return res;
    }
    const rec =
      body?.action === "register"
        ? await register(body.username, body.password, clientIp(req), body.adminPassword)
        : body?.action === "login"
          ? await login(body.username, body.password, clientIp(req))
          : body?.action === "changePassword"
            ? await changePassword(body.current, body.password)
            : null;
    if (!rec) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const res = NextResponse.json({ user: {
      id: rec.id, name: rec.name, mustChange: rec.mustChange, pending: rec.approved === false,
      avatarUrl: rec.avatarVersion ? avatarUrl(rec.id, rec.avatarVersion) : undefined,
    } });
    res.cookies.set(sessionCookie(rec));
    return res;
  } catch (e) {
    return fail(e);
  }
}
