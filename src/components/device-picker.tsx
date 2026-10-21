"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Speaker } from "lucide-react";
import { postJSON } from "./hooks";
import { Spinner } from "./ui";

interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

/** Lets the host pin which Spotify device the party plays through. */
export function DevicePicker({
  device,
  onChanged,
}: {
  device: { chosen: string | null; current: string | null } | null;
  onChanged: () => void;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/devices", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load devices");
      setDevices(j.devices);
      setChosen(j.chosen ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load devices");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pick(id: string) {
    const prev = chosen;
    setChosen(id);
    setBusy(true);
    try {
      await postJSON("/api/admin/action", { action: "setDevice", deviceId: id });
      toast.success(id ? `Playing through ${devices?.find((d) => d.id === id)?.name ?? "that device"}` : "Using Spotify’s active device");
      onChanged();
    } catch (e) {
      setChosen(prev);
      toast.error(e instanceof Error ? e.message : "Could not switch device");
    } finally {
      setBusy(false);
    }
  }

  const known = !chosen || devices?.some((d) => d.id === chosen);
  const mismatch = device?.chosen && device.current && device.current !== device.chosen;

  return (
    <div className="device-picker">
      <Speaker size={15} className="muted" />
      <select className="device-select" value={chosen} disabled={busy || !devices} onChange={(e) => pick(e.target.value)} aria-label="Playback device">
        <option value="">Auto (Spotify’s active device)</option>
        {!known && <option value={chosen}>{device?.chosen ?? "Saved device"} (offline)</option>}
        {devices?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.type}
            {d.isActive ? " (active)" : ""}
          </option>
        ))}
      </select>
      <button className="icon-btn sm" onClick={load} disabled={busy} title="Refresh devices" aria-label="Refresh devices">
        {busy ? <Spinner size={14} /> : <RefreshCw size={14} />}
      </button>
      {device?.current && <span className={`small ${mismatch ? "warn" : "muted"}`}>Now on: {device.current}</span>}
    </div>
  );
}
