"use client";

import { useState } from "react";
import { AudioLines, Orbit, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { AppState, postJSON } from "./hooks";
import { Spinner } from "./ui";

export function RoomModes({ rave, onRave, meeting, connected, refresh }: {
  rave: boolean;
  onRave: () => void;
  meeting: AppState["meeting"];
  connected: boolean;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Undefined means this viewer has no host permissions; do not render a volume control.
  const host = meeting !== undefined;
  const active = !!meeting?.active;

  async function toggleMeeting() {
    setBusy(true);
    try {
      await postJSON("/api/admin/action", { action: "meeting", enabled: !active });
      toast.success(active
        ? `Volume restored to ${meeting?.originalVolume}%`
        : "Meeting mode on. Spotify volume reduced by 75%");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change Spotify volume");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <aside className="mode-dock" aria-label="Room modes">
      <div className="mode-dock-label"><AudioLines size={12} /> ROOM FX</div>
      {host && (
        <button
          className={`mode-button meeting-button ${active ? "is-active" : ""}`}
          aria-pressed={active}
          disabled={busy || (!connected && !active)}
          onClick={toggleMeeting}
          title={active
            ? `Restore ${meeting.deviceName} to ${meeting.originalVolume}%`
            : "Lower Spotify volume by 75% on the host's playback device"}
        >
          <span className="mode-icon">
            {busy ? <Spinner size={21} /> : active ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </span>
          <span className="mode-copy">
            <strong>Meeting mode</strong>
            <small>{active
              ? meeting.applied ? `${meeting.quietVolume}% volume · tap to restore` : "Volume unconfirmed · tap to restore"
              : "A little less loud"}</small>
          </span>
          <span className="mode-switch" aria-hidden="true"><span /></span>
        </button>
      )}
      <button
        className={`mode-button rave-button ${rave ? "is-active" : ""}`}
        aria-pressed={rave}
        onClick={onRave}
        title="Toggle 3D club lighting on this screen. No strobe effects"
      >
        <span className="mode-icon"><Orbit size={23} /></span>
        <span className="mode-copy">
          <strong>Rave mode</strong>
          <small>{rave ? "You're in the afterhours" : "Enter the afterhours"}</small>
        </span>
        <span className="mode-switch" aria-hidden="true"><span /></span>
      </button>
      {rave && <span className="mode-caption">3D LIGHT SHOW / NO STROBES</span>}
    </aside>
  );
}
