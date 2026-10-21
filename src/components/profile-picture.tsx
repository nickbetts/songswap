"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { MAX_AVATAR_BYTES } from "@/lib/avatar-config";
import { postJSON } from "./hooks";
import { Avatar, Spinner } from "./ui";

export function ProfilePicture({ name, image, onChanged }: {
  name: string;
  image: string | null;
  onChanged: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const current = saved === undefined ? image : saved;

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProgress("");
    if (file.size > MAX_AVATAR_BYTES || !file.size) {
      setError("Choose a picture no larger than 5 MB");
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    setProgress("Preparing upload...");
    try {
      const started: { uploadId: string; parts: number; chunkSize: number } = await postJSON("/api/profile/avatar", {
        action: "start", size: file.size,
      });
      for (let part = 0; part < started.parts; part++) {
        setProgress(`Uploading ${part + 1} of ${started.parts}...`);
        const res = await fetch(`/api/profile/avatar?${new URLSearchParams({ uploadId: started.uploadId, part: String(part) })}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(part * started.chunkSize, Math.min(file.size, (part + 1) * started.chunkSize)),
        });
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Picture upload failed");
        }
      }
      setProgress("Checking your picture...");
      const result: { avatarUrl: string } = await postJSON("/api/profile/avatar", { action: "finish", uploadId: started.uploadId });
      setSaved(result.avatarUrl);
      onChanged(result.avatarUrl);
      setProgress("Profile picture saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload your picture");
      setProgress("");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setProgress("");
    setBusy(true);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Couldn't remove your picture");
      }
      setSaved(null);
      onChanged(null);
      setProgress("Profile picture removed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove your picture");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-picture">
      <div className="row">
        <Avatar name={name} size={64} image={current} />
        <div className="grow">
          <strong>Your profile picture</strong>
          <p className="muted small">JPG, PNG, WebP or animated GIF. 5 MB max.</p>
        </div>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden aria-label="Upload profile picture" onChange={(e) => upload(e.target.files?.[0])} />
      <div className="row gap-sm">
        <button className="btn ghost sm grow" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Spinner size={16} /> : <Camera size={16} />} {current ? "Change picture" : "Upload picture"}
        </button>
        {current && <button className="icon-btn" disabled={busy} onClick={remove} aria-label="Remove profile picture"><Trash2 size={16} /></button>}
      </div>
      {progress && <p className="muted small" role="status">{progress}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
