import { NextResponse } from "next/server";
import { ADMIN_COOKIE, checkAdminPassword, isAdmin, makeAdminToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ admin: await isAdmin() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(ADMIN_COOKIE);
    return res;
  }
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not set on the server" }, { status: 500 });
  }
  if (typeof body?.password !== "string" || !checkAdminPassword(body.password)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, makeAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
