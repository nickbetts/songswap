import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { addSong, cleanPerson } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const person = cleanPerson(body?.user);
    await addSong(person, String(body?.trackId ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
