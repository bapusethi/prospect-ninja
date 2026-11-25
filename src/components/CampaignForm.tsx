"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Field, Select, TextArea, TextInput } from "@/components/Field";
import styles from "./CampaignForm.module.css";
import {
  DAILY_PROSPECT_LIMIT,
  MESSAGE_TONES,
  type Icp,
} from "@/modules/campaigns/schema";

export function CampaignForm({
  campaignId,
  initial,
}: {
  campaignId?: string;
  initial?: {
    name: string;
    description: string;
    isActive: boolean;
    dailyDiscoverLimit: number;
    icp: Icp;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const icp = initial?.icp;

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setSuccess(null);
    const payload = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      isActive: formData.get("isActive") === "on",
      dailyDiscoverLimit: DAILY_PROSPECT_LIMIT,
      icp: {
        // Targeting fields are no longer on the form; keep any saved values on edit.
        jobTitles: icp?.jobTitles ?? [],
        industries: icp?.industries ?? [],
        locations: icp?.locations ?? [],
        keywords: icp?.keywords ?? [],
        exclusions: icp?.exclusions ?? [],
        companySize: icp?.companySize,
        companySizeMin: icp?.companySizeMin,
        companySizeMax: icp?.companySizeMax,
        productService: String(formData.get("productService") ?? ""),
        outreachObjective: String(formData.get("outreachObjective") ?? ""),
        senderName: String(formData.get("senderName") ?? "").trim() || undefined,
        tone: String(formData.get("tone") ?? "professional"),
      },
    };
    const response = await fetch(
      campaignId ? `/api/v1/campaigns/${campaignId}` : "/api/v1/campaigns",
      {
        method: campaignId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = (await response.json()) as {
      error?: string;
      campaign?: { id: string };
    };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save campaign.");
      return;
    }
    setSuccess(
      campaignId ? "Campaign updated." : "Campaign created. Daily limit is 15 prospects.",
    );
    router.push(
      campaignId ? "/targeting?updated=1" : "/targeting?created=1",
    );
    router.refresh();
  }

  return (
    <form action={onSubmit}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {success ? <Banner>{success}</Banner> : null}
      <p className={styles.limitNote}>
        Each campaign discovers at most {DAILY_PROSPECT_LIMIT} new prospects per
        day. This limit cannot be increased.
      </p>
      <div className={styles.grid}>
        <div className={styles.wide}>
          <Field label="Campaign name">
            <TextInput
              name="name"
              required
              minLength={2}
              defaultValue={initial?.name}
              placeholder="APAC SaaS founders"
            />
          </Field>
        </div>
        <div className={styles.wide}>
          <Field
            label="Campaign description"
            hint="What this campaign is trying to achieve."
          >
            <TextArea
              name="description"
              required
              minLength={10}
              defaultValue={initial?.description}
              placeholder="Find operations leaders at mid-market SaaS companies who may need outreach help."
            />
          </Field>
        </div>
        <div className={styles.wide}>
          <Field
            label="Product or service description"
            hint="Used in outreach. Do not use placeholder or test copy."
          >
            <TextArea
              name="productService"
              required
              minLength={10}
              defaultValue={icp?.productService}
              placeholder="Human-approved LinkedIn outreach for B2B teams."
            />
          </Field>
        </div>
        <Field
          label="Sender name"
          hint="Optional. Shown in generated outreach. Account name is never used."
        >
          <TextInput
            name="senderName"
            defaultValue={icp?.senderName ?? ""}
            placeholder="Campaign sender"
          />
        </Field>
        <Field label="Outreach objective">
          <TextInput
            name="outreachObjective"
            required
            minLength={5}
            defaultValue={icp?.outreachObjective}
            placeholder="Book a 15-minute intro call"
          />
        </Field>
        <Field label="Preferred message tone">
          <Select name="tone" defaultValue={icp?.tone ?? "professional"}>
            {MESSAGE_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {tone[0].toUpperCase() + tone.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={initial?.isActive ?? true}
        />
        Campaign is active
      </label>
      <div className={styles.actions}>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : campaignId
              ? "Save changes"
              : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}
