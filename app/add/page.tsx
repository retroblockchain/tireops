'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

const FIELDS = ['shop','brand','model','size','season','condition','tread_pct','quantity','price','notes'];

export default function AddTire() {
  const router = useRouter();
  const [tire, setTire] = useState<any>({});

  const save = async () => {
    await supabase.from('tires').insert({ ...tire, shop: tire.shop || 'TEST' });
    router.push('/');
  };

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>Add tire</h1>
      {FIELDS.map((f) => (
        <div key={f} style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 13, color: '#666' }}>{f}</label>
          <input
            value={tire[f] ?? ''}
            onChange={(e) => setTire({ ...tire, [f]: e.target.value })}
            style={{ width: '100%', padding: 10, fontSize: 16, borderRadius: 8, border: '1px solid #ccc' }}
          />
        </div>
      ))}
      <button onClick={save} style={{ padding: 12, fontSize: 16, width: '100%',
        background: '#E0500F', color: '#fff', border: 'none', borderRadius: 8 }}>
        Save
      </button>
    </main>
  );
}