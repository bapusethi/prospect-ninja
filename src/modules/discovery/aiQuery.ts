import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { RocketReachPersonQuery } from "@/modules/discovery/rocketreachClient";

/** One employee-count range: "1-50" or "501+". */
const SIZE_RANGE = /^(\d+)(?:-(\d+)|\+)$/;

const QUERY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["current_title", "geo", "company_industry_keywords", "company_size"],
  properties: {
    current_title: {
      type: "array",
      items: { type: "string" },
      description:
        'Job titles to target, including common variants (e.g. "Founder", "Co-Founder"). Prefix with "-" to exclude a title.',
    },
    geo: {
      type: "array",
      items: { type: "string" },
      description:
        'Locations as "City, Country" or "Country" (e.g. "Melbourne, Australia").',
    },
    company_industry_keywords: {
      type: "array",
      items: { type: "string" },
      description: 'Free-text industry keywords (e.g. "Finance", "FinTech").',
    },
    company_size: {
      type: "array",
      items: { type: "string" },
      description:
        'One employee-count range as "min-max" or "min+" (e.g. "1-50", "201-500", "1000+"). Empty if no size is given.',
    },
  },
};

const SYSTEM_PROMPT = `You turn a campaign description into RocketReach People Search filters.
Return only filters the description actually states or clearly implies. Leave a list empty when the description says nothing about it. Never invent criteria.
- current_title: the target roles, plus common variants of the same role.
- geo: make ambiguous cities unambiguous by adding the country when it is clear from context.
- company_industry_keywords: short industry terms.
- company_size: a single range in employees, "min-max" or "min+". "less than 50" → ["1-50"], "50 to 200" → ["50-200"], "over 1000" → ["1001+"].`;

const outputSchema = z.object({
  current_title: z.array(z.string()),
  geo: z.array(z.string()),
  company_industry_keywords: z.array(z.string()),
  company_size: z.array(z.string()),
});

function cleanList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 40);
}

export function isAiQueryAvailable(): boolean {
  return Boolean(env.openaiApiKey);
}

/** Asks OpenAI for the RocketReach `query` object that matches a campaign description. */
export async function rocketReachQueryFromDescription(
  description: string,
): Promise<RocketReachPersonQuery> {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: { name: "rocketreach_query", strict: true, schema: QUERY_JSON_SCHEMA },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty search query.");
  }
  const parsed = outputSchema.parse(JSON.parse(content));
  parsed.company_size = parsed.company_size
    .map((size) => size.replace(/\s+/g, ""))
    .filter((size) => SIZE_RANGE.test(size))
    .slice(0, 1);

  const query: RocketReachPersonQuery = {};
  for (const key of ["current_title", "geo", "company_industry_keywords", "company_size"] as const) {
    const values = cleanList(parsed[key]);
    if (values.length > 0) {
      query[key] = values;
    }
  }
  return query;
}

export type DerivedTargeting = {
  jobTitles: string[];
  exclusions: string[];
  industries: string[];
  locations: string[];
  companySizeMin?: number;
  companySizeMax?: number;
};

/** "1-50" → { min: 1, max: 50 }; "501+" → { min: 501 }. */
export function parseSizeRange(range: string | undefined): {
  companySizeMin?: number;
  companySizeMax?: number;
} {
  const match = range ? SIZE_RANGE.exec(range) : null;
  if (!match) {
    return {};
  }
  const min = Number(match[1]);
  const max = match[2] === undefined ? undefined : Number(match[2]);
  if (min < 1 || (max !== undefined && max < min)) {
    return {};
  }
  return { companySizeMin: min, companySizeMax: max };
}

/**
 * Turns a campaign description into ICP targeting fields via a RocketReach
 * query. buildQuery() turns these fields back into the same query at discovery time.
 */
export async function targetingFromDescription(
  description: string,
): Promise<DerivedTargeting> {
  const query = await rocketReachQueryFromDescription(description);
  const titles = query.current_title ?? [];
  return {
    jobTitles: titles.filter((title) => !title.startsWith("-")),
    exclusions: titles
      .filter((title) => title.startsWith("-"))
      .map((title) => title.slice(1).trim())
      .filter(Boolean),
    industries: query.company_industry_keywords ?? [],
    locations: query.geo ?? [],
    ...parseSizeRange(query.company_size?.[0]),
  };
}
