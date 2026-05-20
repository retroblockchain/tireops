import { supabase } from './supabase';

const MODEL_DEFAULT = 'claude-sonnet-4-6';

// Approximate per-million-token pricing (USD). Real Anthropic invoices may
// drift ~5-10%. Used for the daily spend estimate, not for billing.
const PRICING: Record<
  string,
  { in: number; out: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-sonnet-4-6':         { in: 3,  out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-opus-4-7':           { in: 15, out: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-haiku-4-5-20251001': { in: 1,  out: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
};

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function estimateCostUsd(
  model: string,
  usage: AnthropicUsage | null | undefined,
): number {
  if (!usage) return 0;
  const p = PRICING[model] || PRICING[MODEL_DEFAULT];
  const inT = usage.input_tokens || 0;
  const outT = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return (
    (inT * p.in +
      outT * p.out +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

// Default $5/day — higher than the CRM's $2 because voice chat turns are
// richer than email-triage one-shots. Override via DAILY_AI_BUDGET_USD.
function dailyBudgetUsd(): number {
  const raw = Number(process.env.DAILY_AI_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5.0;
}

export async function todaysAiSpend(): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('ai_usage_log')
      .select('cost_usd')
      .gte('created_at', startOfDay.toISOString());
    if (error) return 0;
    return (data || []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
  } catch {
    return 0;
  }
}

export type BudgetStatus = { spent: number; budget: number };

export async function getBudgetStatus(): Promise<BudgetStatus> {
  return { spent: await todaysAiSpend(), budget: dailyBudgetUsd() };
}

// Throws if today's spend is already at/over budget. Caller catches and
// returns 429. Bypass with AI_BUDGET_DISABLED=true in emergencies.
export async function assertWithinBudget(): Promise<void> {
  if (process.env.AI_BUDGET_DISABLED === 'true') return;
  const spent = await todaysAiSpend();
  const budget = dailyBudgetUsd();
  if (spent >= budget) {
    throw new Error(
      `AI daily budget reached: $${spent.toFixed(4)} of $${budget.toFixed(2)} spent today. ` +
        `Raise DAILY_AI_BUDGET_USD in your env to continue, or wait until UTC midnight.`,
    );
  }
}

// Best-effort write to ai_usage_log. NEVER throws — a logging failure must
// not break the real API call. Returns the cost so callers can include it
// in responses if useful.
export async function logUsage(args: {
  model: string;
  feature?: string | null;
  usage: AnthropicUsage | null | undefined;
}): Promise<number> {
  const { model, feature, usage } = args;
  const cost = estimateCostUsd(model, usage);
  try {
    await supabase.from('ai_usage_log').insert({
      model,
      feature: feature || null,
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
      cache_read_tokens: usage?.cache_read_input_tokens || 0,
      cache_creation_tokens: usage?.cache_creation_input_tokens || 0,
      cost_usd: cost,
    });
  } catch {
    // Table missing or insert blocked — swallow.
  }
  return cost;
}
