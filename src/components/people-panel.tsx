"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Check, Trash2, Users } from "lucide-react";
import { postJSON } from "./hooks";
import { Avatar, Spinner } from "./ui";

interface Person {
  id: string;
  name: string;
  createdAt: number;
  pending: boolean;
  tempPassword: boolean;
  host: boolean;
}

/** Host: approve new sign-ups, block or delete accounts. */
export function PeoplePanel() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setPeople(j.users);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action: string, p: Person, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action + p.id);
    try {
      await postJSON("/api/admin/action", { action, userId: p.id });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = people?.filter((p) => p.pending) ?? [];
  const shown = open ? (people ?? []) : pending;

  return (
    <section className="people glass">
      <div className="row">
        <Users size={18} />
        <div className="grow">
          <div className="title">
            People {people && <span className="count">{people.length}</span>}
            {pending.length > 0 && <span className="pending-badge">{pending.length} waiting</span>}
          </div>
          <div className="sub">New sign-ups can't add, rate or vote until you approve them.</div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Manage"}
        </button>
      </div>
      {shown.length > 0 && (
        <ul className="people-list">
          {shown.map((p) => (
            <li key={p.id} className="row">
              <Avatar name={p.name} size={30} />
              <div className="grow">
                <strong>{p.name}</strong>
                <div className="muted small">
                  {p.host
                    ? "Host"
                    : p.pending
                      ? "Waiting for approval"
                      : p.tempPassword
                        ? "Still on temporary password"
                        : "Approved"}
                </div>
              </div>
              {!p.host && (
                <div className="row-actions">
                  {p.pending ? (
                    <button className="btn sm btn-cta" onClick={() => act("approveUser", p)}>
                      {busy === "approveUser" + p.id ? <Spinner size={14} /> : <Check size={14} />} Approve
                    </button>
                  ) : (
                    <button
                      className="icon-btn sm"
                      title="Block"
                      aria-label={`Block ${p.name}`}
                      onClick={() => act("blockUser", p, `Block ${p.name}? They won't be able to add, rate or vote.`)}
                    >
                      {busy === "blockUser" + p.id ? <Spinner size={14} /> : <Ban size={16} />}
                    </button>
                  )}
                  <button
                    className="icon-btn sm"
                    title="Delete account"
                    aria-label={`Delete ${p.name}`}
                    onClick={() =>
                      act("deleteUser", p, `Delete ${p.name}'s account? Their played songs and scores stay in the history.`)
                    }
                  >
                    {busy === "deleteUser" + p.id ? <Spinner size={14} /> : <Trash2 size={16} />}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
