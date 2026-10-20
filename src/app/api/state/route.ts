import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { publicState, sync } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const userId = new URL(req.url).searchParams.get("userId");
    await sync();
    const state = await publicState(userId && /^[A-Za-z0-9_-]{8,64}$/.test(userId) ? userId : null, await isAdmin());
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
