'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase.from('tires').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
  }, []);

  const shown = tires.filter((t) => {
    const text = `${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop}`.toLowerCase();
    return text.includes(q.toLowerCase());
  });

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <button onClick={() => supabase.auth.signOut()} style={{ float: 'right', fontSize: 13, padding: '6px 10px', border: 'none', borderRadius: 6, background: '#E0500F', color: '#fff' }}>
        Sign out
      </button>
      <h1 style={{ fontSize: 22 }}>BuySell Tires Inventory</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <a href="/add" style={{ padding: '8px 14px', background: '#E0500F', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>+ Add tire</a>
        <a href="/chat" style={{ padding: '8px 14px', background: '#fff', color: '#E0500F', border: '1px solid #E0500F', borderRadius: 8, textDecoration: 'none' }}>🎤 Voice chat</a>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search brand, size, season..."
        style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc', marginBottom: 12 }}
      />
      <p style={{ color: '#666' }}>{shown.length} tires</p>
      {shown.map((t) => (
        <a key={t.id} href={`/edit/${t.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{t.size} — {t.brand} {t.model}</div>
          <div style={{ fontSize: 14, color: '#666' }}>
            {t.season} · {t.condition} · qty {t.quantity} · ${t.price}
          </div>
        </a>
      ))}
    </main>
  );
}