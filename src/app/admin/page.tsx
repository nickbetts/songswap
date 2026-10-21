import type { Metadata } from "next";
import { isAdmin } from "@/lib/auth";
import { HOST_USERNAME, currentHost } from "@/lib/users";
import { HostConsole } from "./host";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminPage() {
  const [admin, host] = await Promise.all([isAdmin(), currentHost()]);
  return <HostConsole admin={admin} isHost={!!host} hostName={HOST_USERNAME} />;
}
