'use client';
import { useEffect, useState } from 'react';
import { COLORS, RADII } from '../../lib/theme';
import {
  TIRE_LOCATIONS,
  canonicalizeLocation,
  isPresetLocation,
} from '../../lib/locations';

/**
 * Picker for the physical storage location of a tire.
 *
 * Renders a <select> with the named presets (Showroom / Warehouse /
 * Container / Yard) plus a "Custom..." option that reveals a free-text
 * input. Whatever the user picks or types is sent back to the parent as a
 * plain string — the DB stores text only, the presets are just UI sugar.
 *
 * On hydration (e.g. the Edit page loading a saved tire), the component
 * detects whether the saved value matches a preset and selects the right
 * mode automatically; non-preset values open in "Custom..." with the saved
 * text already filled in.
 */

type Props = {
  value: string | null | undefined;
  onChange: (next: string) => void;
};

const NONE_SENTINEL = '';
const CUSTOM_SENTINEL = '__custom__';

export function LocationInput({ value, onChange }: Props) {
  // `mode` is what the <select> shows; `customText` is the typed string.
  const initialMode = !value
    ? NONE_SENTINEL
    : isPresetLocation(value)
      ? value
      : CUSTOM_SENTINEL;
  const initialCustom = !value || isPresetLocation(value) ? '' : value;
  const [mode, setMode] = useState<string>(initialMode);
  const [customText, setCustomText] = useState<string>(initialCustom);

  // Re-sync when the parent's value flips (Edit page hydrate, AI edit
  // mid-session, etc.). Without this, opening an Edit page would show the
  // old default ("none") regardless of what's stored.
  useEffect(() => {
    if (!value) {
      setMode(NONE_SENTINEL);
      setCustomText('');
      return;
    }
    if (isPresetLocation(value)) {
      setMode(value);
      return;
    }
    setMode(CUSTOM_SENTINEL);
    setCustomText(value);
  }, [value]);

  const onSelectChange = (next: string) => {
    setMode(next);
    if (next === NONE_SENTINEL) {
      onChange('');
    } else if (next === CUSTOM_SENTINEL) {
      // Don't bash whatever the user already typed; just surface it.
      onChange(customText.trim() ? canonicalizeLocation(customText) : '');
    } else {
      onChange(next);
    }
  };

  const onCustomChange = (text: string) => {
    setCustomText(text);
    onChange(canonicalizeLocation(text));
  };

  return (
    <>
      <label
        htmlFor="location-select"
        style={{
          display: 'block',
          fontSize: 13,
          color: COLORS.textBody,
          fontWeight: 600,
          marginBottom: 6,
          letterSpacing: 0.1,
        }}
      >
        Location
      </label>
      <select
        id="location-select"
        value={mode}
        onChange={(e) => onSelectChange(e.target.value)}
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 16,
          borderRadius: RADII.control,
          border: `1px solid ${COLORS.borderStrong}`,
          background: COLORS.surface,
          color: COLORS.ink,
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      >
        <option value={NONE_SENTINEL}>— none —</option>
        {TIRE_LOCATIONS.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>Custom…</option>
      </select>
      {mode === CUSTOM_SENTINEL && (
        <input
          id="location-custom"
          type="text"
          value={customText}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="e.g. Container A, Mezzanine, Bay 3"
          autoFocus
          style={{
            width: '100%',
            marginTop: 8,
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: RADII.control,
            border: `1px solid ${COLORS.borderStrong}`,
            background: COLORS.surface,
            color: COLORS.ink,
            boxSizing: 'border-box',
          }}
        />
      )}
    </>
  );
}
