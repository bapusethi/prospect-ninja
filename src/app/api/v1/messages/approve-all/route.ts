import { NextResponse } from "next/server";
import { fromUnknownError, jsonError } from "@/lib/http";
import { getApiUser } from "@/lib/session";
import { approveAllDrafts } from "@/modules/outreach/service";

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return jsonError("Unauthorized.", 401);
  }
  try {
    let campaignId: string | undefined;
    try {
      const body = (await request.json()) as { campaignId?: unknown };
      if (typeof body.campaignId === "string" && body.campaignId) {
        campaignId = body.campaignId;
      }
    } catch {
      campaignId = undefined;
    }
    const result = await approveAllDrafts(user.id, campaignId);
    return NextResponse.json({ result });
  } catch (error) {
    return fromUnknownError(error);
  }
}
