import { NextRequest } from 'next/server';
import { getBudgetStatus } from '../../../lib/anthropic';

export const runtime = 'nodejs';

// Lightweight read-only endpoint for the dashboard's spend widget. Returns
// today's running AI cost and the daily cap in USD. Errors collapse to
// { spent: 0, budget: default } via getBudgetStatus's internal swallowing.
export async function GET(_req: NextRequest) {
  const { spent, budget } = await getBudgetStatus();
  return Response.json({ spent, budget });
}
