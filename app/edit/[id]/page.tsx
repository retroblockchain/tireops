'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

const FIELDS = ['shop','brand','model','size','season','condition','tread_pct','quantity','price','notes'];

export default function EditTire() {
  const { id } = useParams();
  const router = useRouter();
  const [tire, setTire] = useState<any>(null);

  useEffect(() => {
    supabase.from('tires').select('*').eq('id', id).single()
      .then(({ data }) => setTire(data));
  }, [id]);

  if (!tire) return <main style={{ padding: 16 }}>Loading...</main>;

  const save = async () => {
    await supabase.from('tires').update({
      shop: tire.shop, brand: tire.brand, model: tire.model, size: tire.size,
      season: tire.season, condition: tire.condition, tread_pct: tire.tread_pct,
      quantity: tire.quantity, price: tire.price, notes: tire.notes,
    }).eq('id', id);
    router.push('/');
  };

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>Edit tire</h1>
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