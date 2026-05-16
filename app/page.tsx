'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [tires, setTires] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('tires').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22 }}>TireOps — Inventory</h1>
      <p style={{ color: '#666' }}>{tires.length} tires</p>
      {tires.map((t) => (
        <div key={t.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{t.size} — {t.brand} {t.model}</div>
          <div style={{ fontSize: 14, color: '#666' }}>
            {t.season} · {t.condition} · qty {t.quantity} · ${t.price}
          </div>
        </div>
      ))}
    </main>
  );
}