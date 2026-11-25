import { NextResponse } from "next/server";
import { fromUnknownError, jsonError } from "@/lib/http";
import { getApiUser } from "@/lib/session";
import { requestDrafts } from "@/inngest/client";
import { discoverForCampaign } from "@/modules/prospects/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const user = await getApiUser();
  if (!user) {
    return jsonError("Unauthorized.", 401);
  }
  try {
    const { id } = await params;
    const result = await discoverForCampaign(user.id, id);
    const draftsQueued = await requestDrafts(
      result.prospects.map((prospect) => prospect.id),
    );
    return NextResponse.json({ result: { ...result, draftsQueued } });
  } catch (error) {
    return fromUnknownError(error);
  }
}
