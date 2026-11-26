"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Select } from "@/components/Field";
import {
  IconLinkedIn,
  IconRefresh,
  IconSend,
  IconSkipForward,
} from "@/components/icons";
import { MESSAGE_STATUS } from "@/modules/outreach/constants";
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
export function ProspectCardHeader({
  draft,
  leading,
}: {
  draft: DraftCardData;
  /** Rendered before the avatar, e.g. a selection checkbox. */
  leading?: React.ReactNode;
}) {
  return (
    <>
      <div className={styles.head}>
        {leading}
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

export function DraftCard({
  draft,
  selected,
  onToggleSelected,
  disabled = false,
}: {
  draft: DraftCardData;
  selected: boolean;
  onToggleSelected: () => void;
  /** Locks the card while a bulk send is running. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft.body);
  const [pending, setPending] = useState<null | "approve" | "regenerate" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null || disabled;
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

  // Approved but still here means an earlier send didn't go through.
  const alreadyApproved = draft.status === MESSAGE_STATUS.approved && !dirty;

  function approve() {
    void run("approve", async () => {
      // Save the edit first so the approved body is exactly what's on screen.
      // Editing clears approval, so an edited message is always re-approved.
      if (dirty) {
        await post(`/api/v1/messages/${draft.id}`, "PATCH", { body: text });
      }
      if (!alreadyApproved) {
        await post(`/api/v1/messages/${draft.id}/approve`);
      }
      const data = (await post(`/api/v1/messages/${draft.id}/send`)) as {
        message?: { status: string };
      };
      if (data.message?.status === MESSAGE_STATUS.demoRecorded) {
        window.alert("Not sent — demo provider. The attempt was recorded only.");
      }
    });
  }

  const approveLabel =
    pending === "approve"
      ? "Approving…"
      : alreadyApproved
        ? "Retry"
        : dirty
          ? "Save & approve"
          : "Approve";

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
    <article className={`${styles.card} ${selected ? styles.cardSelected : ""}`}>
      <ProspectCardHeader
        draft={draft}
        leading={
          <input
            type="checkbox"
            className={styles.check}
            checked={selected}
            onChange={onToggleSelected}
            disabled={busy}
            aria-label={`Select message for ${draft.prospectName}`}
          />
        }
      />

      <textarea
        className={styles.textarea}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        aria-label={`Draft for ${draft.prospectName}`}
      />

      <div className={styles.footer}>
        <Button type="button" onClick={approve} disabled={busy}>
          <span className={styles.iconBtn}>
            <IconSend size={15} />
            {approveLabel}
          </span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={regenerate}
          disabled={busy}
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
          disabled={busy}
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

/**
 * Toolbar, selection and card grid for the Draft queue. The bulk button sends
 * the selected cards, or the whole queue when nothing is selected.
 */
export function DraftQueueBoard({
  drafts,
  campaigns,
  campaignId,
}: {
  drafts: Array<DraftCardData & { key: string }>;
  campaigns: Array<{ id: string; name: string }>;
  campaignId?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Drop ids that left the queue (sent, skipped, filtered out) after a refresh.
  const selected = drafts.filter((draft) => picked.has(draft.id)).map((d) => d.id);
  const allSelected = drafts.length > 0 && selected.length === drafts.length;
  const count = selected.length || drafts.length;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setPicked(allSelected ? new Set() : new Set(drafts.map((draft) => draft.id)));
  }

  async function sendBulk() {
    const scope = selected.length ? `${count} selected` : `all ${count}`;
    if (
      !window.confirm(
        `Approve and send ${scope} ${count === 1 ? "message" : "messages"} on LinkedIn as they are saved? Unsaved edits on this page are not included.`,
      )
    ) {
      return;
    }
    setPending(true);
    setNote(null);
    try {
      const data = (await post("/api/v1/messages/approve-all", "POST", {
        campaignId,
        ...(selected.length ? { ids: selected } : {}),
      })) as {
        result?: { sent: number; simulated: number; failed: unknown[] };
      };
      const sent = data.result?.sent ?? 0;
      const simulated = data.result?.simulated ?? 0;
      const failed = data.result?.failed.length ?? 0;
      setNote(
        [
          `Sent ${sent}.`,
          simulated ? `${simulated} recorded only (demo provider).` : "",
          failed ? `${failed} could not be sent.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Bulk send failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.selectAll}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selected.length > 0 && !allSelected;
            }}
            onChange={toggleAll}
            disabled={pending || drafts.length === 0}
            aria-label="Select all messages"
          />
          <span className={styles.count}>
            {selected.length
              ? `${selected.length} of ${drafts.length} selected`
              : `${drafts.length} ${drafts.length === 1 ? "message" : "messages"} to review`}
          </span>
        </label>
        <div className={styles.toolbarActions}>
          <CampaignFilter campaigns={campaigns} basePath="/drafts" />
          <Button type="button" onClick={sendBulk} disabled={pending || drafts.length === 0}>
            <span className={styles.iconBtn}>
              <IconSend size={15} />
              {pending
                ? "Approving…"
                : selected.length
                  ? `Approve (${selected.length})`
                  : "Approve all"}
            </span>
          </Button>
        </div>
      </div>
      {note ? <p className={styles.bulkNote}>{note}</p> : null}

      {drafts.length > 0 ? (
        <div className={styles.grid}>
          {drafts.map(({ key, ...draft }) => (
            <DraftCard
              key={key}
              draft={draft}
              selected={picked.has(draft.id)}
              onToggleSelected={() => toggle(draft.id)}
              disabled={pending}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
