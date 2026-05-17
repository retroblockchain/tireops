'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/theme';
import {
  TirePhoto,
  deleteTirePhoto,
  loadTirePhotos,
  uploadTirePhoto,
} from '../../../lib/photos';

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
  const tireId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const [tire, setTire] = useState<any>(null);
  const [photos, setPhotos] = useState<TirePhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!tireId) return;
    supabase
      .from('tires')
      .select('*')
      .eq('id', tireId)
      .single()
      .then(({ data }) => setTire(data));
    loadTirePhotos(tireId).then(setPhotos);
  }, [tireId]);

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
    await supabase
      .from('tires')
      .update({
        shop: tire.shop,
        brand: tire.brand,
        model: tire.model,
        size: tire.size,
        season: tire.season,
        condition: tire.condition,
        tread_pct: tire.tread_pct,
        quantity: tire.quantity,
        price: tire.price,
        notes: tire.notes,
      })
      .eq('id', tireId);
    router.push('/');
  };

  const remove = async () => {
    if (!confirm("Delete this tire? This can't be undone.")) return;
    await supabase.from('tires').delete().eq('id', tireId);
    router.push('/');
  };

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0 || !tireId) return;
    setUploading(true);
    setPhotoError(null);
    const added: TirePhoto[] = [];
    for (const f of files) {
      const row = await uploadTirePhoto(f, tireId);
      if (row) added.push(row);
      else setPhotoError('One or more photos failed to upload.');
    }
    if (added.length > 0) setPhotos((prev) => [...prev, ...added]);
    setUploading(false);
  };

  const removePhoto = async (p: TirePhoto) => {
    if (!confirm('Remove this photo?')) return;
    const ok = await deleteTirePhoto(p);
    if (ok) setPhotos((prev) => prev.filter((x) => x.id !== p.id));
    else setPhotoError('Photo removal failed.');
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
            disabled={uploading}
            style={{
              flex: '1 1 140px',
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            📷 Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            disabled={uploading}
            style={{
              flex: '1 1 140px',
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            🖼 Choose photo
          </button>
        </div>
        {uploading && (
          <p style={{ fontSize: 12, color: COLORS.textMuted, margin: '0 0 8px' }}>
            Uploading…
          </p>
        )}
        {photoError && (
          <p style={{ fontSize: 12, color: COLORS.redDeep, margin: '0 0 8px' }}>
            {photoError}
          </p>
        )}
        {photos.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 8,
            }}
          >
            {photos.map((p) => (
              <div
                key={p.id}
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
                  src={p.url}
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                  }}
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
                  onClick={() => removePhoto(p)}
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
