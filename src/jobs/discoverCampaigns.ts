import { requestDrafts } from "@/inngest/client";
import { discoverAllActiveCampaigns } from "@/modules/prospects/service";

export async function runDailyDiscovery() {
  const results = await discoverAllActiveCampaigns();
  await requestDrafts(
    results.flatMap((result) =>
      "prospects" in result && result.prospects
        ? result.prospects.map((prospect) => prospect.id)
        : [],
    ),
  );
  return results;
}
