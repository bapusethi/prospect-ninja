import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { DraftQueueBoard } from "@/components/DraftQueue";
import { EmptyState } from "@/components/EmptyState";
import { IconListChecks } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getLinkedInConnection } from "@/modules/integrations/service";
import { listDraftQueue } from "@/modules/outreach/service";

export default async function DraftQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const user = await requireUser();
  const { campaignId } = await searchParams;
  const [drafts, campaigns, linkedin] = await Promise.all([
    listDraftQueue(user.id, campaignId || undefined),
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
        kicker="Make every word count"
        title="Draft queue"
        description="Review, refine, and approve your personal outreach. Approving sends the message on LinkedIn straight away."
      />

      {!linkedin.live ? (
        <Banner tone="warn">
          LinkedIn isn&apos;t linked, so approving only records a simulated send.{" "}
          <Link href="/connect-linkedin">Connect LinkedIn</Link>
        </Banner>
      ) : null}

      <DraftQueueBoard
        campaigns={campaigns}
        campaignId={campaignId || undefined}
        drafts={drafts.map((draft) => ({
          // Remount when the stored body changes (e.g. after regenerate).
          key: `${draft.id}:${draft.updatedAt.toISOString()}`,
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
        }))}
      />

      {drafts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconListChecks size={22} />}
            title="All caught up"
            description="New drafts appear here automatically when discovery adds prospects to a campaign."
            action={
              <Link href="/history">
                <Button variant="secondary">View sent messages</Button>
              </Link>
            }
          />
        </Card>
      ) : null}
    </>
  );
}
