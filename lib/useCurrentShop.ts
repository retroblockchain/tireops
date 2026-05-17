'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { UNASSIGNED_SHOP, getShopForEmail } from './shops';

export type AuthInfo = { email: string | null; shop: string };

const INITIAL: AuthInfo = { email: null, shop: UNASSIGNED_SHOP };

/**
 * Returns the signed-in user's email AND shop in one subscription.
 * Email is derived directly from the Supabase session; shop is derived
 * from email via lib/shops.ts.
 */
export function useAuthInfo(): AuthInfo {
  const [info, setInfo] = useState<AuthInfo>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const email = data.user?.email ?? null;
      setInfo({ email, shop: getShopForEmail(email) });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      setInfo({ email, shop: getShopForEmail(email) });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return info;
}

/** Backwards-compat thin wrapper — returns just the shop name. */
export function useCurrentShop(): string {
  return useAuthInfo().shop;
}
