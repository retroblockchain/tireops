'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/theme';
import { uploadTirePhoto } from '../../lib/photos';

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  type?: string;
};
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
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // Rebuild preview URLs whenever the pending list changes; revoke old ones.
  useEffect(() => {
    const urls = pendingPhotos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      for (const u of urls) {
        try { URL.revokeObjectURL(u); } catch { /* ignore */ }
      }
    };
  }, [pendingPhotos]);

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingPhotos((prev) => [...prev, ...files]);
    // reset input so the same file can be re-picked if removed
    e.target.value = '';
  };

  const removePending = (i: number) => {
    setPendingPhotos((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('tires')
        .insert({ ...tire, shop: tire.shop || 'TEST' })
        .select()
        .single();
      if (insertError || !inserted) {
        throw new Error(insertError?.message || 'failed to save tire');
      }
      // Upload photos in sequence so order is preserved (oldest first = first uploaded).
      for (const f of pendingPhotos) {
        await uploadTirePhoto(f, inserted.id);
      }
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
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
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 12,
        }}
      >
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
      <p
        style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}
      >
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

      {/* PHOTOS */}
      <div style={{ marginTop: 18, marginBottom: 12 }}>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            color: COLORS.textBody,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Photos
        </label>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={onFilesPicked}
          style={{ display: 'none' }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFilesPicked}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            style={{
              flex: '1 1 140px',
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            📷 Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            style={{
              flex: '1 1 140px',
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            🖼 Choose photo
          </button>
        </div>
        {previews.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 8,
            }}
          >
            {previews.map((src, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  paddingTop: '100%',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: COLORS.surfaceSoft,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <img
                  src={src}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removePending(i)}
                  aria-label="Remove photo"
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          padding: 14,
          fontSize: 16,
          width: '100%',
          background: COLORS.red,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 700,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
          marginTop: 8,
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {error && (
        <p style={{ color: COLORS.redDeep, fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </main>
  );
}
