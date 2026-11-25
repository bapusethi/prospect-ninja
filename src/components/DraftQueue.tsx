"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Select } from "@/components/Field";
import {
  IconCheck,
  IconLinkedIn,
  IconRefresh,
  IconSkipForward,
} from "@/components/icons";
import styles from "./DraftQueue.module.css";

/** LinkedIn's limit for the note on a connection request. */
const INVITATION_NOTE_LIMIT = 300;

export type DraftCardData = {
  id: string;
  body: string;
  status: string;
  prospectId: string;
  prospectName: string;
  role: string;
  linkedinUrl: string;
  campaignName: string;
  isDemo: boolean;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export async function post(path: string, method = "POST", payload?: unknown) {
  const response = await fetch(path, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

/** Avatar, name/role and LinkedIn link, plus the campaign/status line. */
export function ProspectCardHeader({ draft }: { draft: DraftCardData }) {
  return (
    <>
      <div className={styles.head}>
        <span className={styles.avatar}>{initials(draft.prospectName)}</span>
        <div className={styles.who}>
          <Link href={`/prospects/${draft.prospectId}`} className={styles.name}>
            {draft.prospectName}
          </Link>
          <div className={styles.role}>{draft.role || "—"}</div>
        </div>
        <a
          href={draft.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.channel}
          title="Open LinkedIn profile"
        >
          <IconLinkedIn size={20} />
        </a>
      </div>

      <div className={styles.meta}>
        <span>
          {draft.campaignName} · LinkedIn
          {draft.isDemo ? " · Demo data" : ""}
        </span>
        <Badge status={draft.status} />
      </div>
    </>
  );
}

export function DraftCard({ draft }: { draft: DraftCardData }) {
  const router = useRouter();
  const [text, setText] = useState(draft.body);
  const [pending, setPending] = useState<null | "approve" | "regenerate" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = text.trim() !== draft.body.trim();
  const length = Array.from(text).length;

  async function run(kind: "approve" | "regenerate" | "skip", action: () => Promise<unknown>) {
    setPending(kind);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setPending(null);
    }
  }

  function approve() {
    void run("approve", async () => {
      // Save the edit first so the approved body is exactly what's on screen.
      if (dirty) {
        await post(`/api/v1/messages/${draft.id}`, "PATCH", { body: text });
      }
      await post(`/api/v1/messages/${draft.id}/approve`);
    });
  }

  function regenerate() {
    if (dirty && !window.confirm("Discard your unsaved edits and regenerate?")) {
      return;
    }
    void run("regenerate", async () => {
      const data = (await post(`/api/v1/messages/${draft.id}/generate`, "POST", {
        replaceExisting: true,
      })) as { message?: { body: string } };
      if (data.message?.body) {
        setText(data.message.body);
      }
    });
  }

  function skip() {
    void run("skip", () => post(`/api/v1/messages/${draft.id}/reject`));
  }

  return (
    <article className={styles.card}>
      <ProspectCardHeader draft={draft} />

      <textarea
        className={styles.textarea}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={pending !== null}
        aria-label={`Draft for ${draft.prospectName}`}
      />

      <div className={styles.footer}>
        <Button type="button" onClick={approve} disabled={pending !== null}>
          <span className={styles.iconBtn}>
            <IconCheck size={15} />
            {pending === "approve" ? "Approving…" : dirty ? "Save & approve" : "Approve"}
          </span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={regenerate}
          disabled={pending !== null}
        >
          <span className={styles.iconBtn}>
            <IconRefresh size={15} />
            {pending === "regenerate" ? "Regenerating…" : "Regenerate"}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={skip}
          disabled={pending !== null}
          title="Skip: reject this draft and remove it from the queue"
          aria-label="Skip draft"
        >
          <IconSkipForward size={16} />
        </Button>
        <span
          className={`${styles.chars} ${length > INVITATION_NOTE_LIMIT ? styles.over : ""}`}
          title="Connection-request notes are limited to 300 characters"
        >
          {length}/{INVITATION_NOTE_LIMIT}
        </span>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </article>
  );
}

export function CampaignFilter({
  campaigns,
  basePath,
}: {
  campaigns: Array<{ id: string; name: string }>;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("campaignId") ?? "";

  return (
    <Select
      className={styles.filter}
      value={current}
      aria-label="Filter by campaign"
      onChange={(event) => {
        const value = event.target.value;
        router.push(value ? `${basePath}?campaignId=${value}` : basePath);
      }}
    >
      <option value="">All campaigns</option>
      {campaigns.map((campaign) => (
        <option key={campaign.id} value={campaign.id}>
          {campaign.name}
        </option>
      ))}
    </Select>
  );
}

export function ApproveAllButton({
  campaignId,
  count,
}: {
  campaignId?: string;
  count: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function approveAll() {
    if (
      !window.confirm(
        `Approve all ${count} drafts as they are saved? Unsaved edits on this page are not included.`,
      )
    ) {
      return;
    }
    setPending(true);
    setNote(null);
    try {
      const data = (await post("/api/v1/messages/approve-all", "POST", {
        campaignId,
      })) as { result?: { approved: number; failed: unknown[] } };
      const failed = data.result?.failed.length ?? 0;
      setNote(
        `Approved ${data.result?.approved ?? 0}.${failed ? ` ${failed} could not be approved.` : ""}`,
      );
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Approve all failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button type="button" onClick={approveAll} disabled={pending || count === 0}>
        <span className={styles.iconBtn}>
          <IconCheck size={15} />
          {pending ? "Approving…" : "Approve all"}
        </span>
      </Button>
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  );
}
