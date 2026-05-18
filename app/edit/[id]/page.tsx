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
import { useCurrentShop } from '../../../lib/useCurrentShop';
import { logActivity } from '../../../lib/activity';
import { TIRE_STATUSES, statusStyle } from '../../../lib/tireStatus';
import { RADII, SHADOWS } from '../../../lib/theme';

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
  const currentShop = useCurrentShop();
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
    const patch = {
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
      status: tire.status || 'available',
    };
    const { data: updated } = await supabase
      .from('tires')
      .update(patch)
      .eq('id', tireId)
      .select()
      .single();
    await logActivity({
      action: 'edited',
      tire: updated ?? { ...patch, id: tireId },
      source: 'form',
    });
    router.push('/');
  };

  const remove = async () => {
    if (!confirm("Delete this tire? This can't be undone.")) return;
    // Snapshot the tire before delete so the log keeps a readable description.
    const snapshot = tire;
    await supabase.from('tires').delete().eq('id', tireId);
    await logActivity({ action: 'deleted', tire: snapshot, source: 'form' });
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
          justifyContent: 'space-between',
          gap: 8,
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
        <span
          aria-label={`Signed in as ${currentShop}`}
          style={{
            fontSize: 11,
            padding: '4px 10px',
            background: COLORS.redSoftBg,
            color: COLORS.red,
            border: `1px solid ${COLORS.red}`,
            borderRadius: RADII.pill,
            fontWeight: 700,
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}
        >
          {currentShop}
        </span>
      </header>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: COLORS.ink,
          margin: '0 0 2px',
          letterSpacing: -0.2,
        }}
      >
        Edit tire
      </h1>
      {tire.tire_number != null && (
        <p
          style={{
            fontSize: 13,
            color: COLORS.textMuted,
            margin: '0 0 16px',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          tire-{tire.tire_number}
        </p>
      )}

      {FIELDS.map((f) => (
        <div key={f.key} style={{ marginBottom: 14 }}>
          <label
            htmlFor={f.key}
            style={{
              display: 'block',
              fontSize: 13,
              color: COLORS.textBody,
              fontWeight: 600,
              marginBottom: 6,
              letterSpacing: 0.1,
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
              padding: '12px 14px',
              fontSize: 16,
              borderRadius: RADII.control,
              border: `1px solid ${COLORS.borderStrong}`,
              background: COLORS.surface,
              color: COLORS.ink,
              boxSizing: 'border-box',
            }}
          />
        </div>
      ))}

      {/* STATUS */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            color: COLORS.textBody,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Status
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TIRE_STATUSES.map((s) => {
            const active = (tire.status || 'available') === s;
            const ss = statusStyle(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setTire({ ...tire, status: s })}
                aria-pressed={active}
                style={{
                  flex: '1 1 80px',
                  padding: '11px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  background: 'transparent',
                  color: active ? ss.color : COLORS.textMuted,
                  border: `1px solid ${
                    active ? ss.border : COLORS.borderStrong
                  }`,
                  borderRadius: RADII.control,
                  cursor: 'pointer',
                  boxShadow: active
                    ? `inset 0 0 0 1px ${ss.border}`
                    : 'none',
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

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
              padding: '11px 14px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: RADII.control,
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
              padding: '11px 14px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: RADII.control,
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
                  borderRadius: RADII.control,
                  overflow: 'hidden',
                  background: COLORS.surfaceSoft,
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: SHADOWS.card,
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
          padding: '14px 16px',
          fontSize: 16,
          width: '100%',
          background: COLORS.red,
          color: '#fff',
          border: 'none',
          borderRadius: RADII.control,
          fontWeight: 700,
          letterSpacing: -0.1,
          cursor: 'pointer',
          marginTop: 8,
          boxShadow: SHADOWS.card,
        }}
      >
        Save
      </button>

      <div
        style={{
          marginTop: 32,
          paddingTop: 18,
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        <p
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            margin: '0 0 10px',
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          Danger zone
        </p>
        <button
          onClick={remove}
          style={{
            padding: '12px 14px',
            fontSize: 15,
            width: '100%',
            background: COLORS.surface,
            color: COLORS.redDeep,
            border: `1.5px solid ${COLORS.redDeep}`,
            borderRadius: RADII.control,
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
