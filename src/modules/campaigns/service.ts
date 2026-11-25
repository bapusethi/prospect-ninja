import { prisma } from "@/lib/db";
import { MESSAGE_STATUS } from "@/modules/outreach/constants";
import {
  campaignInputSchema,
  campaignStatusSchema,
  clampDailyLimit,
  companySizeBounds,
  parseIcp,
  type CampaignInput,
} from "@/modules/campaigns/schema";
import {
  isAiQueryAvailable,
  targetingFromDescription,
} from "@/modules/discovery/aiQuery";

type ParsedIcp = ReturnType<typeof campaignInputSchema.parse>["icp"];

function hasTargeting(icp: ParsedIcp): boolean {
  return (
    icp.jobTitles.length > 0 ||
    icp.industries.length > 0 ||
    icp.locations.length > 0 ||
    Boolean(icp.companySize) ||
    Boolean(icp.companySizeMin)
  );
}

/**
 * The form has no targeting fields, so fill them from the description with
 * OpenAI: discovery (RocketReach query + scoring) and message generation read them.
 */
async function withTargeting(
  description: string,
  icp: ParsedIcp,
  options: { descriptionChanged: boolean },
): Promise<ParsedIcp> {
  if (hasTargeting(icp) && !options.descriptionChanged) {
    return icp;
  }
  if (!isAiQueryAvailable()) {
    return icp;
  }
  const targeting = await targetingFromDescription(description);
  const derived = {
    ...icp,
    ...targeting,
    companySize: undefined,
    companySizeMin: targeting.companySizeMin,
    companySizeMax: targeting.companySizeMax,
  };
  if (!hasTargeting(derived)) {
    throw new Error(
      "Could not work out who to target from the campaign description. Mention the roles, locations, industries or company size you are looking for.",
    );
  }
  return derived;
}

function icpForStorage(icp: ParsedIcp) {
  // A preset bucket sets the bounds; otherwise keep the exact derived range.
  return icp.companySize
    ? { ...icp, ...companySizeBounds(icp.companySize) }
    : icp;
}

function mapCampaign<
  T extends {
    icp: unknown;
    _count: { prospects: number; messages: number };
  },
>(campaign: T) {
  return {
    ...campaign,
    icp: parseIcp(campaign.icp),
    prospectCount: campaign._count.prospects,
    pendingApprovals: campaign._count.messages,
  };
}

const campaignInclude = {
  _count: {
    select: {
      prospects: true,
      messages: { where: { status: MESSAGE_STATUS.pendingReview } },
    },
  },
} as const;

export async function listCampaigns(userId: string) {
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: campaignInclude,
  });
  return campaigns.map(mapCampaign);
}

export async function getCampaign(userId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    include: campaignInclude,
  });
  if (!campaign) {
    return null;
  }
  return mapCampaign(campaign);
}

export async function createCampaign(userId: string, input: CampaignInput) {
  const data = campaignInputSchema.parse(input);
  const icp = await withTargeting(data.description, data.icp, {
    descriptionChanged: false,
  });
  return prisma.campaign.create({
    data: {
      userId,
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      dailyDiscoverLimit: clampDailyLimit(data.dailyDiscoverLimit),
      icp: icpForStorage(icp),
    },
  });
}

export async function updateCampaign(
  userId: string,
  id: string,
  input: CampaignInput,
) {
  const existing = await getCampaign(userId, id);
  if (!existing) {
    throw new Error("Campaign not found.");
  }
  const data = campaignInputSchema.parse(input);
  const icp = await withTargeting(data.description, data.icp, {
    descriptionChanged: data.description !== existing.description,
  });
  return prisma.campaign.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      dailyDiscoverLimit: clampDailyLimit(data.dailyDiscoverLimit),
      icp: icpForStorage(icp),
    },
  });
}

export async function setCampaignActive(
  userId: string,
  id: string,
  isActive: boolean,
) {
  const existing = await getCampaign(userId, id);
  if (!existing) {
    throw new Error("Campaign not found.");
  }
  const parsed = campaignStatusSchema.parse({ isActive });
  return prisma.campaign.update({
    where: { id },
    data: { isActive: parsed.isActive },
  });
}

export async function deleteCampaign(userId: string, id: string) {
  const existing = await getCampaign(userId, id);
  if (!existing) {
    throw new Error("Campaign not found.");
  }
  await prisma.campaign.delete({ where: { id } });
}
