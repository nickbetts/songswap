import { NextResponse } from "next/server";
import { assertSameOrigin, fail } from "@/lib/http";
import { voteSkip } from "@/lib/game";
import { requireActor } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    const body = await req.json().catch(() => ({}));
    const result = await voteSkip(person, String(body?.entryId ?? ""), body?.vote !== false);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
}
