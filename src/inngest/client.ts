import { eventType, Inngest, staticSchema } from "inngest";

export const inngest = new Inngest({ id: "prospect-ninja" });

/** Requests a discovery run for a single campaign. */
export const campaignDiscoverRequested = eventType(
  "campaign/discover.requested",
  {
    schema: staticSchema<{ campaignId: string }>(),
  },
);

/** Requests an AI outreach draft for a newly discovered prospect. */
export const prospectDraftRequested = eventType("prospect/draft.requested", {
  schema: staticSchema<{ prospectId: string }>(),
});

/** One event per prospect; the id dedupes repeat requests for the same prospect. */
export function draftRequestEvents(prospectIds: string[]) {
  return prospectIds.map((prospectId) =>
    prospectDraftRequested.create(
      { prospectId },
      { id: `draft-${prospectId}` },
    ),
  );
}

/**
 * Queues draft generation for new prospects. Failure to reach Inngest is
 * logged, not thrown: the prospects are already saved and the user can still
 * generate drafts manually.
 */
export async function requestDrafts(prospectIds: string[]): Promise<boolean> {
  if (prospectIds.length === 0) {
    return false;
  }
  try {
    await inngest.send(draftRequestEvents(prospectIds));
    return true;
  } catch (error) {
    console.error("Failed to queue draft generation", error);
    return false;
  }
}
