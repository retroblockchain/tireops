import { supabase } from './supabase';
import { getEmployeeName } from './employeeName';

export type ActivityAction = 'added' | 'edited' | 'deleted';
export type ActivitySource = 'form' | 'voice' | 'file';

export type ActivityLogRow = {
  id: string;
  action: ActivityAction;
  tire_id: string | null;
  tire_description: string;
  shop: string | null;
  user_email: string | null;
  employee_name: string | null;
  source: ActivitySource;
  created_at: string;
};

/**
 * Build a human-readable summary of a tire row that survives the tire's
 * deletion. Prefers brand + model + size; falls back to a truncated id.
 */
export function tireDescription(t: any): string {
  if (!t) return 'tire';
  const friendly =
    t.tire_number != null && t.tire_number !== '' ? `tire-${t.tire_number}` : '';
  const brandModel = [t.brand, t.model].filter(Boolean).join(' ').trim();
  const size = (t.size || '').toString().trim();
  const main = [brandModel, size].filter(Boolean).join(' ').trim();
  if (friendly && main) return `${friendly} — ${main}`;
  if (friendly) return friendly;
  if (main) return main;
  if (t.id) return `tire ${String(t.id).slice(0, 8)}`;
  return 'tire';
}

/**
 * Insert one activity_log row. Used by both the client (form actions) and
 * the chat route (voice actions). Failures are logged but never thrown —
 * activity logging must not block the underlying user action.
 */
export async function insertActivityLog(args: {
  action: ActivityAction;
  tire: any;
  source: ActivitySource;
  userEmail: string | null;
  employeeName?: string | null;
}): Promise<void> {
  try {
    await supabase.from('activity_log').insert({
      action: args.action,
      tire_id: args.tire?.id ?? null,
      tire_description: tireDescription(args.tire),
      shop: args.tire?.shop ?? null,
      user_email: args.userEmail,
      employee_name: args.employeeName ?? null,
      source: args.source,
    });
  } catch (e) {
    console.error('activity log insert failed', e);
  }
}

/**
 * Client-side convenience wrapper. Auto-fetches the signed-in user's email
 * from Supabase Auth, and the employee name from sessionStorage (set by
 * the AI when the user introduced themselves), unless either is explicitly
 * passed in.
 */
export async function logActivity(args: {
  action: ActivityAction;
  tire: any;
  source: ActivitySource;
  userEmail?: string | null;
  employeeName?: string | null;
}): Promise<void> {
  let email = args.userEmail;
  if (email === undefined) {
    try {
      const { data } = await supabase.auth.getUser();
      email = data.user?.email ?? null;
    } catch {
      email = null;
    }
  }
  let employeeName = args.employeeName;
  if (employeeName === undefined) {
    employeeName = getEmployeeName();
  }
  await insertActivityLog({
    action: args.action,
    tire: args.tire,
    source: args.source,
    userEmail: email ?? null,
    employeeName: employeeName ?? null,
  });
}
