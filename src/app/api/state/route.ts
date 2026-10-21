import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { publicState, sync } from "@/lib/game";
import { avatarImages, currentUser } from "@/lib/users";
import { getMeetingMode } from "@/lib/meeting";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sync();
    const [me, admin] = await Promise.all([currentUser(), isAdmin()]);
    const state = await publicState(me?.id ?? null, admin);
    const canMeet = !!me && !me.pending && !me.mustChange;
    const meeting = canMeet ? await getMeetingMode() : undefined;
    const avatars = await avatarImages();
    return NextResponse.json({ ...state, me, avatars, ...(canMeet ? { meeting } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
