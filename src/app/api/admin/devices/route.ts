import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { getChosenDevice, listDevices } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Admin only" }, { status: 401 });
  try {
    const [devices, chosen] = await Promise.all([listDevices(), getChosenDevice()]);
    return NextResponse.json({ devices, chosen: chosen?.id ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
