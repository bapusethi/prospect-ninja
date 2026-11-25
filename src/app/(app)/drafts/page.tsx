import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  ApproveAllButton,
  CampaignFilter,
  DraftCard,
} from "@/components/DraftQueue";
import styles from "@/components/DraftQueue.module.css";
import { EmptyState } from "@/components/EmptyState";
import { IconListChecks } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listDraftQueue } from "@/modules/outreach/service";

export default async function DraftQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const user = await requireUser();
  const { campaignId } = await searchParams;
  const [drafts, campaigns] = await Promise.all([
    listDraftQueue(user.id, campaignId || undefined),
    prisma.campaign.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        kicker="Make every word count"
        title="Draft queue"
        description="Review, refine, and approve your personal outreach. Nothing is sent until you approve it."
        actions={
          <ApproveAllButton campaignId={campaignId || undefined} count={drafts.length} />
        }
      />

      <div className={styles.toolbar}>
        <span className={styles.count}>
          {drafts.length} {drafts.length === 1 ? "message" : "messages"} to review
        </span>
        <CampaignFilter campaigns={campaigns} basePath="/drafts" />
      </div>

      {drafts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconListChecks size={22} />}
            title="All caught up"
            description="New drafts appear here automatically when discovery adds prospects to a campaign."
            action={
              <Link href="/send">
                <Button variant="secondary">View approved messages</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className={styles.grid}>
          {drafts.map((draft) => (
            <DraftCard
              // Remount when the stored body changes (e.g. after regenerate).
              key={`${draft.id}:${draft.updatedAt.toISOString()}`}
              draft={{
                id: draft.id,
                body: draft.body,
                status: draft.status,
                prospectId: draft.prospectId,
                prospectName: draft.prospect.fullName,
                role: [draft.prospect.jobTitle, draft.prospect.companyName]
                  .filter(Boolean)
                  .join(" at "),
                linkedinUrl: draft.prospect.linkedinUrl,
                campaignName: draft.campaign.name,
                isDemo: draft.prospect.isDemo,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
