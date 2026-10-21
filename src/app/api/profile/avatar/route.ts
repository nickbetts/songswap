import { NextResponse } from "next/server";
import { assertSameOrigin, fail } from "@/lib/http";
import { limitAttempts, requireActor, saveAvatar } from "@/lib/users";
import { AvatarError, discardAvatarUpload, finishAvatarUpload, readLimitedBody, startAvatarUpload, uploadAvatarPart } from "@/lib/avatar";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    const body = JSON.parse((await readLimitedBody(req, 4096)).toString("utf8"));
    if (body?.action === "start") {
      await limitAttempts(`avatar:${person.id}`, 10, 60 * 60_000);
      return NextResponse.json(await startAvatarUpload(person.id, body.size));
    }
    if (body?.action === "finish") {
      const { file, key, parts } = await finishAvatarUpload(person.id, body.uploadId);
      const url = await saveAvatar(person.id, file);
      await discardAvatarUpload(key, parts);
      return NextResponse.json({ avatarUrl: url });
    }
    return NextResponse.json({ error: "Unknown upload action" }, { status: 400 });
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    return fail(e);
  }
}

export async function PUT(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    const url = new URL(req.url);
    const part = url.searchParams.get("part");
    if (part === null || !/^\d$/.test(part)) throw new AvatarError(400, "Invalid upload part");
    await uploadAvatarPart(person.id, url.searchParams.get("uploadId"), Number(part), req);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    const person = await requireActor();
    await saveAvatar(person.id, null);
    return NextResponse.json({ avatarUrl: null });
  } catch (e) {
    return fail(e);
  }
}
