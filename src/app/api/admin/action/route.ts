import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { assertSameOrigin, fail } from "@/lib/http";
import { shuffleQueue, deleteHistoryEntry, deleteRating, playNow, playerControl, removeEntry, reorderQueue, resetAll } from "@/lib/game";
import { chooseDevice, clearAuth } from "@/lib/spotify";
import { AuthError, deleteUser, setApproved } from "@/lib/users";
import { getMeetingMode, setMeetingMode } from "@/lib/meeting";
import { withLock } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Admin only" }, { status: 401 });
  try {
    assertSameOrigin(req);
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
      case "reorder":
        await reorderQueue(body.order);
        break;
      case "deleteHistory":
        await deleteHistoryEntry(String(body.entryId));
        break;
      case "deleteRating":
        await deleteRating(String(body.entryId), String(body.raterId));
        break;
      case "shuffle":
        await shuffleQueue();
        break;
      case "reset":
        await resetAll();
        break;
      case "setDevice":
        await withLock("meeting", async () => {
          if (await getMeetingMode()) throw new AuthError(409, "Turn Meeting mode off before changing the playback device");
          await chooseDevice(typeof body.deviceId === "string" && body.deviceId ? body.deviceId : null);
        });
        break;
      case "meeting":
        if (typeof body.enabled !== "boolean") {
          return NextResponse.json({ error: "Meeting mode needs an enabled boolean" }, { status: 400 });
        }
        return NextResponse.json({ ok: true, meeting: await setMeetingMode(body.enabled) });
      case "approveUser":
        await setApproved(body.userId, true);
        break;
      case "blockUser":
        await setApproved(body.userId, false);
        break;
      case "deleteUser":
        await deleteUser(body.userId);
        break;
      case "disconnect":
        await setMeetingMode(false);
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
