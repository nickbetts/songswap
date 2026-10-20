import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { searchTracks } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ tracks: [] });
  try {
    return NextResponse.json({ tracks: await searchTracks(q) });
  } catch (e) {
    return fail(e);
  }
}
