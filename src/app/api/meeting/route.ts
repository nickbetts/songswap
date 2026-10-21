import { NextResponse } from "next/server";
import { assertSameOrigin, fail } from "@/lib/http";
import { setMeetingMode } from "@/lib/meeting";
import { limitAttempts, requireActor } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    const body = await req.json();
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ error: "Meeting mode needs an enabled boolean" }, { status: 400 });
    }
    await limitAttempts(`meeting:${person.id}`, 20, 60_000);
    return NextResponse.json({ ok: true, meeting: await setMeetingMode(body.enabled) });
  } catch (e) {
    return fail(e);
  }
}
