import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { publicState, sync } from "@/lib/game";
import { avatarImages, currentUser, loadUsers } from "@/lib/users";
import { getMeetingMode } from "@/lib/meeting";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sync();
    const users = await loadUsers();
    const [me, admin] = await Promise.all([currentUser(users), isAdmin(users)]);
    const canMeet = !!me && !me.pending && !me.mustChange;
    const [state, meeting, avatars] = await Promise.all([
      publicState(me?.id ?? null, admin),
      canMeet ? getMeetingMode() : undefined,
      avatarImages(users),
    ]);
    return NextResponse.json({ ...state, me, avatars, ...(canMeet ? { meeting } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
