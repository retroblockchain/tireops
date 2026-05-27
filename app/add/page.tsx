'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { COLORS, RADII, SHADOWS } from '../../lib/theme';
import { uploadTirePhoto } from '../../lib/photos';
import { useCurrentShop } from '../../lib/useCurrentShop';
import { UNASSIGNED_SHOP } from '../../lib/shops';
import { logActivity } from '../../lib/activity';
import { LocationInput } from '../components/LocationInput';
import { canonicalizeLocation } from '../../lib/locations';
import { prepareTireSizeFields } from '../../lib/tire-size';

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  type?: string;
};
// `location` is rendered with a dedicated picker — see the map below.
// Keeping it in this array preserves the form order.
const FIELDS: Field[] = [
  { key: 'shop', label: 'Shop', placeholder: 'e.g. Main' },
  { key: 'location', label: 'Location' },
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
  const currentShop = useCurrentShop();
  const [tire, setTire] = useState<any>({});
  const [shopPrefilled, setShopPrefilled] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-fill the shop field with the logged-in user's shop once it resolves,
  // unless the user has already edited it.
  useEffect(() => {
    if (shopPrefilled) return;
    if (!currentShop || currentShop === UNASSIGNED_SHOP) return;
    setTire((prev: any) => (prev.shop ? prev : { ...prev, shop: currentShop }));
    setShopPrefilled(true);
  }, [currentShop, shopPrefilled]);

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
      // Canonicalize location so "warehouse"/"WAREHOUSE" save as "Warehouse"
      // and an empty custom-text box clears the column instead of saving "".
      const cleanedLocation = canonicalizeLocation(tire.location);
      const sizeFields = prepareTireSizeFields(tire.size);
      const payload = {
        ...tire,
        shop: tire.shop || 'TEST',
        location: cleanedLocation || null,
        size_raw: sizeFields.size_raw,
        width: sizeFields.width,
        aspect_ratio: sizeFields.aspect_ratio,
        diameter: sizeFields.diameter,
      };
      const { data: inserted, error: insertError } = await supabase
        .from('tires')
        .insert(payload)
        .select()
        .single();
      if (insertError || !inserted) {
        throw new Error(insertError?.message || 'failed to save tire');
      }
      // Upload photos in sequence so order is preserved (oldest first = first uploaded).
      for (const f of pendingPhotos) {
        await uploadTirePhoto(f, inserted.id);
      }
      await logActivity({ action: 'added', tire: inserted, source: 'form' });
      if (sizeFields.warning) {
        try {
          sessionStorage.setItem('tireSaveWarning', JSON.stringify({
            message: sizeFields.warning,
            sizeRaw: sizeFields.size_raw,
          }));
        } catch { /* quota — warning just won't show */ }
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
        <div key={f.key} style={{ marginBottom: 14 }}>
          {f.key === 'location' ? (
            <LocationInput
              value={tire.location}
              onChange={(v) => setTire({ ...tire, location: v })}
            />
          ) : (
            <>
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
                placeholder={f.placeholder}
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
            </>
          )}
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
              padding: '11px 14px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: RADII.control,
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
              padding: '11px 14px',
              fontSize: 14,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.ink,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: RADII.control,
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
                  borderRadius: RADII.control,
                  overflow: 'hidden',
                  background: COLORS.surfaceSoft,
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: SHADOWS.card,
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
          padding: '14px 16px',
          fontSize: 16,
          width: '100%',
          background: COLORS.red,
          color: '#fff',
          border: 'none',
          borderRadius: RADII.control,
          fontWeight: 700,
          letterSpacing: -0.1,
          boxShadow: SHADOWS.card,
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
