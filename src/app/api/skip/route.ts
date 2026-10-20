import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { cleanPerson, voteSkip } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const person = cleanPerson(body?.user);
    const result = await voteSkip(person, String(body?.entryId ?? ""), body?.vote !== false);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
}
