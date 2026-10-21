import { NextResponse } from "next/server";
import { avatarKey, type AvatarFile } from "@/lib/avatar";
import { getKV } from "@/lib/store";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return new NextResponse(null, { status: 404 });
    const file = await getKV().get<AvatarFile>(avatarKey(id));
    const version = new URL(req.url).searchParams.get("v");
    if (!file || version !== file.version) return new NextResponse(null, { status: 404 });
    // Stream large GIFs rather than hitting Vercel's buffered-response size limit.
    const bytes = Buffer.from(file.data, "base64");
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + 65536)));
        offset += 65536;
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": file.type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
