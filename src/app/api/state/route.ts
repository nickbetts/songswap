import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { publicState, sync } from "@/lib/game";
import { currentUser } from "@/lib/users";
import { getMeetingMode } from "@/lib/meeting";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sync();
    const [me, admin] = await Promise.all([currentUser(), isAdmin()]);
    const state = await publicState(me?.id ?? null, admin);
    const meeting = admin ? await getMeetingMode() : undefined;
    return NextResponse.json({ ...state, me, ...(admin ? { meeting } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
