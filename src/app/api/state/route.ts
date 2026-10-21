import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { publicState, sync } from "@/lib/game";
import { HOST_PERSON, currentUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sync();
    const [me, admin] = await Promise.all([currentUser(), isAdmin()]);
    const actor = me ?? (admin ? { ...HOST_PERSON, mustChange: false } : null);
    const state = await publicState(actor?.id ?? null, admin);
    return NextResponse.json({ ...state, me: actor }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
