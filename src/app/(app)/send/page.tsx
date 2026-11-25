import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CampaignFilter } from "@/components/DraftQueue";
import styles from "@/components/DraftQueue.module.css";
import { EmptyState } from "@/components/EmptyState";
import { IconSend } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { SendCard } from "@/components/SendQueue";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getLinkedInConnection } from "@/modules/integrations/service";
import { listReadyToSend } from "@/modules/outreach/service";

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const user = await requireUser();
  const { campaignId } = await searchParams;
  const [messages, campaigns, linkedin] = await Promise.all([
    listReadyToSend(user.id, campaignId || undefined),
    prisma.campaign.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    getLinkedInConnection(user.id),
  ]);

  return (
    <>
      <PageHeader
        kicker="One conversation at a time"
        title="Ready to send"
        description="Approved messages, ready for your personal touch. To change one, edit it in the draft view — editing clears approval."
      />

      {!linkedin.live ? (
        <Banner tone="warn">
          LinkedIn isn&apos;t linked, so Send only records a simulated send. Copy the
          message and use Mark sent if you send it yourself.{" "}
          <Link href="/connect-linkedin">Connect LinkedIn</Link>
        </Banner>
      ) : null}

      <div className={styles.toolbar}>
        <span className={styles.count}>
          {messages.length} approved {messages.length === 1 ? "message" : "messages"}
        </span>
        <CampaignFilter campaigns={campaigns} basePath="/send" />
      </div>

      {messages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconSend size={22} />}
            title="Nothing waiting to send"
            description="Approve drafts in the Draft queue and they'll appear here."
            action={
              <Link href="/drafts">
                <Button variant="secondary">Open Draft queue</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className={styles.grid}>
          {messages.map((message) => (
            <SendCard
              key={message.id}
              linkedinLive={linkedin.live}
              draft={{
                id: message.id,
                body: message.body,
                status: message.status,
                prospectId: message.prospectId,
                prospectName: message.prospect.fullName,
                role: [message.prospect.jobTitle, message.prospect.companyName]
                  .filter(Boolean)
                  .join(" at "),
                linkedinUrl: message.prospect.linkedinUrl,
                campaignName: message.campaign.name,
                isDemo: message.prospect.isDemo,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
