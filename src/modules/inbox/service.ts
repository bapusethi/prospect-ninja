import type { InboxStatus } from "@/modules/inbox/constants";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  assertUnipileConfigured,
  getUnipileConnection,
  markNeedsReconnect,
} from "@/modules/integrations/unipileAuth";
import { UnipileError, unipileClient } from "@/modules/integrations/unipileClient";

/**
 * Inbox = inbound LinkedIn messages and accepted connection requests, read
 * straight from recorded Unipile `message.new` / `relation.new` webhooks
 * (WebhookEvent) for the user's linked account.
 * Triage status (Interested / Not now / Meeting booked) lives in LeadReplyStatus,
 * one row per user + LinkedIn member, so all of a member's replies share it.
 */

const MAX_EVENTS = 200;
/** LinkedIn's message length limit. */
export const MAX_REPLY_CHARS = 8000;

type MessageSender = {
  id?: unknown;
  display_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  description?: unknown;
  profile_url?: unknown;
  public_picture_url?: unknown;
};

/** relation.new payload: a UserRelation, `user` is the new connection. */
type RelationPayload = {
  id?: unknown;
  created_at?: unknown;
  user?: MessageSender;
};

type MessagePayload = {
  id?: unknown;
  text?: unknown;
  chat_id?: unknown;
  timestamp?: unknown;
  is_sender?: unknown;
  is_event?: unknown;
  is_deleted?: unknown;
  attachments?: unknown;
  sender?: MessageSender;
};

export type InboxReply = {
  /** WebhookEvent id; used to reply. */
  id: string;
  /** message: they wrote to us. connection: they accepted our connection request. */
  kind: "message" | "connection";
  name: string;
  firstName: string;
  initials: string;
  headline: string | null;
  profileUrl: string | null;
  text: string;
  receivedAt: Date;
  campaignName: string | null;
  sentAt: Date | null;
  status: InboxStatus | null;
};

export type InboxStatusCounts = Record<InboxStatus | "all", number>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function payloadOf(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = (raw as { payload?: unknown }).payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function messageOf(raw: unknown): MessagePayload | null {
  return payloadOf(raw) as MessagePayload | null;
}

function relationOf(raw: unknown): RelationPayload | null {
  return payloadOf(raw) as RelationPayload | null;
}

/**
 * Inbound message.new (is_sender = false) or any relation.new.
 * Messages the linked account sent itself have is_sender = true.
 */
function inboundEventsWhere(accountId: string) {
  return {
    provider: "unipile",
    externalAccountId: accountId,
    ...verifiedFilter(),
    OR: [
      { event: "message.new", payload: { path: ["payload", "is_sender"], equals: false } },
      { event: "relation.new" },
    ],
  };
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return letters.toUpperCase() || "?";
}

/** Only accept events whose signature checked out, unless verification is off. */
function verifiedFilter() {
  return env.unipileWebhookVerify ? { verified: true } : {};
}

function emptyCounts(): InboxStatusCounts {
  return { all: 0, interested: 0, not_now: 0, meeting_booked: 0 };
}

type InboxItem = {
  eventId: string;
  kind: InboxReply["kind"];
  receivedAt: Date;
  memberId: string;
  member: MessageSender;
  text: string;
  timestamp: string | null;
};

/**
 * Inbound replies and accepted connections for the user's linked account, newest first.
 * `filter` limits the list to one status; counts always cover every reply.
 */
export async function listInboxReplies(
  userId: string,
  filter?: InboxStatus,
): Promise<{ connected: boolean; replies: InboxReply[]; counts: InboxStatusCounts }> {
  const connection = await getUnipileConnection(userId);
  const accountId = connection?.externalAccountId;
  if (!accountId) {
    return { connected: false, replies: [], counts: emptyCounts() };
  }

  const events = await prisma.webhookEvent.findMany({
    where: inboundEventsWhere(accountId),
    orderBy: { receivedAt: "desc" },
    take: MAX_EVENTS,
    select: { id: true, event: true, payload: true, receivedAt: true },
  });

  // Unipile retries can deliver the same event twice; keep the newest copy.
  const seen = new Set<string>();
  const items: InboxItem[] = [];
  for (const event of events) {
    if (event.event === "relation.new") {
      const relation = relationOf(event.payload);
      const memberId = str(relation?.user?.id);
      // One card per accepted connection.
      const key = memberId ? `relation:${memberId}` : null;
      if (!relation || !memberId || !key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        eventId: event.id,
        kind: "connection",
        receivedAt: event.receivedAt,
        memberId,
        member: relation.user ?? {},
        text: "Accepted your connection request.",
        timestamp: str(relation.created_at),
      });
      continue;
    }

    const message = messageOf(event.payload);
    const senderId = str(message?.sender?.id);
    if (!message || !senderId || message.is_event === true || message.is_deleted === true) {
      continue;
    }
    const key = `message:${str(message.id) ?? event.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
    items.push({
      eventId: event.id,
      kind: "message",
      receivedAt: event.receivedAt,
      memberId: senderId,
      member: message.sender ?? {},
      text: str(message.text) ?? (hasAttachments ? "(Sent an attachment)" : "(No text)"),
      timestamp: str(message.timestamp),
    });
  }

  const senderIds = [...new Set(items.map((item) => item.memberId))];
  const [prospects, statuses] = items.length
    ? await Promise.all([
        prisma.prospect.findMany({
        where: { userId, linkedinProviderId: { in: senderIds } },
        select: {
          linkedinProviderId: true,
          fullName: true,
          firstName: true,
          headline: true,
          jobTitle: true,
          companyName: true,
          linkedinUrl: true,
          campaign: { select: { name: true } },
          messages: { select: { sentAt: true }, take: 1 },
        },
        }),
        prisma.leadReplyStatus.findMany({
          where: { userId, linkedinProviderId: { in: senderIds } },
          select: { linkedinProviderId: true, status: true },
        }),
      ])
    : [[], []];
  const prospectBySender = new Map(prospects.map((p) => [p.linkedinProviderId, p]));
  const statusBySender = new Map(statuses.map((s) => [s.linkedinProviderId, s.status]));

  const replies = items.map(({ eventId, kind, receivedAt, memberId, member: sender, text, timestamp }) => {
    const prospect = prospectBySender.get(memberId);
    const name =
      prospect?.fullName ||
      str(sender.display_name) ||
      [str(sender.first_name), str(sender.last_name)].filter(Boolean).join(" ") ||
      "LinkedIn member";
    const firstName = prospect?.firstName || str(sender.first_name) || name.split(" ")[0];
    const roleAtCompany =
      prospect?.jobTitle && prospect.companyName
        ? `${prospect.jobTitle} at ${prospect.companyName}`
        : null;

    return {
      id: eventId,
      kind,
      name,
      firstName,
      initials: initialsOf(name),
      headline: roleAtCompany ?? prospect?.headline ?? str(sender.description),
      profileUrl: prospect?.linkedinUrl ?? str(sender.profile_url),
      text,
      receivedAt: timestamp ? new Date(timestamp) : receivedAt,
      campaignName: prospect?.campaign.name ?? null,
      sentAt: prospect?.messages[0]?.sentAt ?? null,
      status: statusBySender.get(memberId) ?? null,
    } satisfies InboxReply;
  });
  // Merged feed: order by when it happened, not when the webhook landed.
  replies.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const counts = emptyCounts();
  for (const reply of replies) {
    counts.all += 1;
    if (reply.status) {
      counts[reply.status] += 1;
    }
  }

  return {
    connected: true,
    replies: filter ? replies.filter((reply) => reply.status === filter) : replies,
    counts,
  };
}

/**
 * Loads an inbound message or accepted-connection event that belongs to the
 * user's linked account, and returns the LinkedIn member it is about.
 * Scoping by account means one user can never act on another user's messages.
 */
async function findOwnInboundMessage(userId: string, eventId: string) {
  const connection = await getUnipileConnection(userId);
  const accountId = connection?.externalAccountId;
  if (!accountId) {
    throw new Error("Link your LinkedIn account first.");
  }
  const event = await prisma.webhookEvent.findFirst({
    where: { id: eventId, ...inboundEventsWhere(accountId) },
    select: { event: true, payload: true },
  });
  const senderId =
    event?.event === "relation.new"
      ? str(relationOf(event?.payload)?.user?.id)
      : str(messageOf(event?.payload)?.sender?.id);
  if (!event || !senderId) {
    throw new Error("Message not found.");
  }
  return { accountId, senderId };
}

/** Sets (or clears, with null) the status for the member who sent this message. */
export async function setInboxStatus(userId: string, eventId: string, status: InboxStatus | null) {
  const { senderId } = await findOwnInboundMessage(userId, eventId);
  const key = { userId_linkedinProviderId: { userId, linkedinProviderId: senderId } };
  if (status === null) {
    await prisma.leadReplyStatus.deleteMany({ where: { userId, linkedinProviderId: senderId } });
    return null;
  }
  await prisma.leadReplyStatus.upsert({
    where: key,
    create: { userId, linkedinProviderId: senderId, status },
    update: { status },
  });
  return status;
}

/**
 * Sends `text` to the member behind an inbox item (a reply's author, or a new
 * connection) as a 1:1 LinkedIn message.
 */
export async function sendInboxReply(userId: string, eventId: string, rawText: string) {
  const text = rawText.trim();
  if (!text) {
    throw new Error("Write a reply first.");
  }
  if (Array.from(text).length > MAX_REPLY_CHARS) {
    throw new Error(`Replies must be ${MAX_REPLY_CHARS} characters or fewer.`);
  }

  assertUnipileConfigured();
  const { accountId, senderId } = await findOwnInboundMessage(userId, eventId);

  try {
    // startChat reuses the existing 1:1 chat with this member.
    await unipileClient.startChat(accountId, senderId, text);
  } catch (error) {
    if (error instanceof UnipileError && error.needsReconnect) {
      await markNeedsReconnect(userId, error.message);
      throw new Error("Your LinkedIn session expired. Reconnect LinkedIn and try again.");
    }
    throw new Error(
      error instanceof Error ? `Could not send the reply: ${error.message}` : "Could not send the reply.",
    );
  }
}
