"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import {
  type DraftCardData,
  post,
  ProspectCardHeader,
} from "@/components/DraftQueue";
import { IconCheck, IconSend } from "@/components/icons";
import { MESSAGE_STATUS } from "@/modules/outreach/constants";
import styles from "./DraftQueue.module.css";

export function SendCard({
  draft,
  linkedinLive,
}: {
  draft: DraftCardData;
  linkedinLive: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "send" | "mark" | "copy">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const length = Array.from(draft.body).length;

  async function run(kind: "send" | "mark", path: string) {
    setPending(kind);
    setError(null);
    try {
      const data = (await post(path)) as { message?: { status: string } };
      if (data.message?.status === MESSAGE_STATUS.demoRecorded) {
        window.alert("Not sent — demo provider. The attempt was recorded only.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setPending(null);
    }
  }

  function send() {
    if (
      !window.confirm(
        `Send this message to ${draft.prospectName} on LinkedIn? If you're not connected, it goes out as a connection request with this note.`,
      )
    ) {
      return;
    }
    void run("send", `/api/v1/messages/${draft.id}/send`);
  }

  async function copy() {
    await navigator.clipboard.writeText(draft.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article className={styles.card}>
      <ProspectCardHeader draft={draft} />

      <textarea
        className={styles.textarea}
        value={draft.body}
        readOnly
        aria-label={`Approved message for ${draft.prospectName}`}
      />

      <div className={styles.footer}>
        <Button type="button" onClick={send} disabled={pending !== null}>
          <span className={styles.iconBtn}>
            <IconSend size={15} />
            {pending === "send"
              ? "Sending…"
              : linkedinLive
                ? "Send on LinkedIn"
                : "Send (simulated)"}
          </span>
        </Button>
        <Button type="button" variant="secondary" onClick={copy} disabled={pending !== null}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => run("mark", `/api/v1/messages/${draft.id}/mark-sent`)}
          disabled={pending !== null}
          title="Record that you sent this yourself, outside Prospect Ninja"
        >
          <span className={styles.iconBtn}>
            <IconCheck size={15} />
            {pending === "mark" ? "Saving…" : "Mark sent"}
          </span>
        </Button>
        <span
          className={`${styles.chars} ${length > 300 ? styles.over : ""}`}
          title="Connection-request notes are limited to 300 characters"
        >
          {length}/300
        </span>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </article>
  );
}
