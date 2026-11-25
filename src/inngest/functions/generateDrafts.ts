import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/db";
import { generateDraftForProspect } from "@/modules/outreach/service";
import { inngest, prospectDraftRequested } from "@/inngest/client";

// Errors that will fail the same way on every retry.
const PERMANENT_ERRORS = [
  "Prospect not found.",
  "Configure a real product or service description",
];

/** Generates the first outreach draft for a newly discovered prospect. */
export const generateProspectDraft = inngest.createFunction(
  {
    id: "generate-prospect-draft",
    triggers: [prospectDraftRequested],
    retries: 3,
    // Keep AI provider load bounded.
    concurrency: { limit: 3 },
  },
  async ({ event, step }) => {
    const { prospectId } = event.data;

    return step.run("generate", async () => {
      const prospect = await prisma.prospect.findUnique({
        where: { id: prospectId },
        select: { userId: true, messages: { select: { id: true }, take: 1 } },
      });
      if (!prospect) {
        throw new NonRetriableError("Prospect not found.");
      }
      // Never overwrite a draft that exists already (e.g. the user hit Generate first).
      if (prospect.messages.length > 0) {
        return { skipped: true, messageId: prospect.messages[0].id };
      }

      try {
        const message = await generateDraftForProspect(
          prospect.userId,
          prospectId,
        );
        return { skipped: false, messageId: message.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (PERMANENT_ERRORS.some((text) => message.startsWith(text))) {
          throw new NonRetriableError(message);
        }
        throw error;
      }
    });
  },
);

export const draftFunctions = [generateProspectDraft];
