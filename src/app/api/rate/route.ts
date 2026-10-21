import { NextResponse } from "next/server";
import { assertSameOrigin, fail } from "@/lib/http";
import { rateSong } from "@/lib/game";
import { requireActor } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    const body = await req.json().catch(() => ({}));
    await rateSong(person, String(body?.entryId ?? ""), Number(body?.score));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
