import { NextResponse } from "next/server";
import { fromUnknownError, jsonError } from "@/lib/http";
import { getApiUser } from "@/lib/session";
import { approveAndSendDrafts } from "@/modules/outreach/service";

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return jsonError("Unauthorized.", 401);
  }
  try {
    let campaignId: string | undefined;
    let ids: string[] | undefined;
    try {
      const body = (await request.json()) as { campaignId?: unknown; ids?: unknown };
      if (typeof body.campaignId === "string" && body.campaignId) {
        campaignId = body.campaignId;
      }
      if (Array.isArray(body.ids)) {
        ids = body.ids.filter((id): id is string => typeof id === "string");
        if (ids.length === 0) {
          return jsonError("Select at least one message.", 400);
        }
      }
    } catch {
      campaignId = undefined;
    }
    const result = await approveAndSendDrafts(user.id, { campaignId, ids });
    return NextResponse.json({ result });
  } catch (error) {
    return fromUnknownError(error);
  }
}
