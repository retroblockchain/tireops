'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/theme';

type Field = { key: string; label: string; placeholder?: string; type?: string };
const FIELDS: Field[] = [
  { key: 'shop', label: 'Shop', placeholder: 'e.g. Main' },
  { key: 'brand', label: 'Brand', placeholder: 'e.g. Michelin' },
  { key: 'model', label: 'Model', placeholder: 'e.g. X-Ice Snow' },
  { key: 'size', label: 'Size', placeholder: 'e.g. 225/65R17' },
  { key: 'season', label: 'Season', placeholder: 'summer, winter, or all-season' },
  { key: 'condition', label: 'Condition', placeholder: 'new or used' },
  { key: 'tread_pct', label: 'Tread %', placeholder: '0 to 100', type: 'number' },
  { key: 'quantity', label: 'Quantity', placeholder: 'how many in stock', type: 'number' },
  { key: 'price', label: 'Price', placeholder: 'in dollars', type: 'number' },
  { key: 'notes', label: 'Notes', placeholder: 'anything else worth recording' },
];

export default function AddTire() {
  const router = useRouter();
  const [tire, setTire] = useState<any>({});

  const save = async () => {
    await supabase.from('tires').insert({ ...tire, shop: tire.shop || 'TEST' });
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
          margin: '0 0 4px',
          letterSpacing: -0.2,
        }}
      >
        Add tire
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}>
        Fill in what you know — you can edit the rest later.
      </p>

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
            placeholder={f.placeholder}
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
    </main>
  );
}
