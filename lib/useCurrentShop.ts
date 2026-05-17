'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { UNASSIGNED_SHOP, getShopForEmail } from './shops';

/**
 * Returns the shop name for the currently signed-in user, derived from
 * the user's email via the mapping in lib/shops.ts. Starts as
 * UNASSIGNED_SHOP until Supabase resolves the session, then updates.
 */
export function useCurrentShop(): string {
  const [shop, setShop] = useState<string>(UNASSIGNED_SHOP);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setShop(getShopForEmail(data.user?.email));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setShop(getShopForEmail(session?.user?.email));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return shop;
}
