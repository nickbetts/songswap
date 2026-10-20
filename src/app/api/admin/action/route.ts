import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { playNow, playerControl, removeEntry, resetAll } from "@/lib/game";
import { clearAuth } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Admin only" }, { status: 401 });
  try {
    const body = await req.json();
    switch (body?.action) {
      case "pause":
      case "resume":
      case "skip":
        await playerControl(body.action);
        break;
      case "playNow":
        await playNow(String(body.entryId));
        break;
      case "remove":
        await removeEntry(String(body.entryId));
        break;
      case "reset":
        await resetAll();
        break;
      case "disconnect":
        await clearAuth();
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
