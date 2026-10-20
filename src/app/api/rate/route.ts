import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { cleanPerson, rateSong } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const person = cleanPerson(body?.user);
    await rateSong(person, String(body?.entryId ?? ""), Number(body?.score));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
