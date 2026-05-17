'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/theme';

type Field = { key: string; label: string; type?: string };
const FIELDS: Field[] = [
  { key: 'shop', label: 'Shop' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'size', label: 'Size' },
  { key: 'season', label: 'Season' },
  { key: 'condition', label: 'Condition' },
  { key: 'tread_pct', label: 'Tread %', type: 'number' },
  { key: 'quantity', label: 'Quantity', type: 'number' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'notes', label: 'Notes' },
];

export default function EditTire() {
  const { id } = useParams();
  const router = useRouter();
  const [tire, setTire] = useState<any>(null);

  useEffect(() => {
    supabase.from('tires').select('*').eq('id', id).single()
      .then(({ data }) => setTire(data));
  }, [id]);

  if (!tire) {
    return (
      <main
        style={{
          padding: 16,
          fontFamily: 'sans-serif',
          color: COLORS.textMuted,
        }}
      >
        Loading...
      </main>
    );
  }

  const save = async () => {
    await supabase.from('tires').update({
      shop: tire.shop, brand: tire.brand, model: tire.model, size: tire.size,
      season: tire.season, condition: tire.condition, tread_pct: tire.tread_pct,
      quantity: tire.quantity, price: tire.price, notes: tire.notes,
    }).eq('id', id);
    router.push('/');
  };

  const remove = async () => {
    if (!confirm("Delete this tire? This can't be undone.")) return;
    await supabase.from('tires').delete().eq('id', id);
    router.push('/');
  };

  return (
    <main
      style={{
        padding: 16,
        fontFamily: 'sans-serif',
        maxWidth: 600,
        margin: '0 auto',
        color: COLORS.textBody,
        background: COLORS.bg,
        minHeight: '100dvh',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        <a
          href="/"
          style={{
            color: COLORS.red,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 700,
            padding: '6px 8px',
            borderRadius: 6,
          }}
        >
          ← Inventory
        </a>
      </header>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: COLORS.ink,
          margin: '0 0 16px',
          letterSpacing: -0.2,
        }}
      >
        Edit tire
      </h1>

      {FIELDS.map((f) => (
        <div key={f.key} style={{ marginBottom: 12 }}>
          <label
            htmlFor={f.key}
            style={{
              display: 'block',
              fontSize: 13,
              color: COLORS.textBody,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {f.label}
          </label>
          <input
            id={f.key}
            type={f.type ?? 'text'}
            value={tire[f.key] ?? ''}
            onChange={(e) => setTire({ ...tire, [f.key]: e.target.value })}
            style={{
              width: '100%',
              padding: 12,
              fontSize: 16,
              borderRadius: 8,
              border: `1px solid ${COLORS.borderStrong}`,
              background: COLORS.surface,
              color: COLORS.ink,
              boxSizing: 'border-box',
            }}
          />
        </div>
      ))}

      <button
        onClick={save}
        style={{
          padding: 14,
          fontSize: 16,
          width: '100%',
          background: COLORS.red,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        Save
      </button>

      <div
        style={{
          marginTop: 28,
          paddingTop: 16,
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: COLORS.textMuted,
            margin: '0 0 8px',
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Danger zone
        </p>
        <button
          onClick={remove}
          style={{
            padding: 12,
            fontSize: 15,
            width: '100%',
            background: COLORS.surface,
            color: COLORS.redDeep,
            border: `2px solid ${COLORS.redDeep}`,
            borderRadius: 8,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🗑 Delete tire
        </button>
      </div>
    </main>
  );
}
