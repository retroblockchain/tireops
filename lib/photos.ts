import { supabase } from './supabase';

export type TirePhoto = {
  id: string;
  tire_id: string;
  url: string;
  created_at: string;
};

const BUCKET = 'tire-photos';

function extFor(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  const fromType = file.type.split('/')[1];
  return (fromType || 'jpg').toLowerCase();
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Upload a single photo to Supabase Storage and link it to a tire.
 * Returns the created `tire_photos` row, or `null` on failure.
 */
export async function uploadTirePhoto(
  file: File,
  tireId: string,
): Promise<TirePhoto | null> {
  const ext = extFor(file);
  const path = `${tireId}/${Date.now()}-${randomToken()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || `image/${ext}`,
    });
  if (uploadError) {
    console.error('photo upload failed', uploadError);
    return null;
  }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { data, error } = await supabase
    .from('tire_photos')
    .insert({ tire_id: tireId, url })
    .select()
    .single();
  if (error) {
    console.error('photo row insert failed', error);
    return null;
  }
  return data as TirePhoto;
}

/**
 * Best-effort delete: remove from Storage AND from the tire_photos table.
 * Returns true if the DB row was removed.
 */
export async function deleteTirePhoto(photo: TirePhoto): Promise<boolean> {
  const marker = `/${BUCKET}/`;
  const idx = photo.url.indexOf(marker);
  if (idx !== -1) {
    const path = photo.url.slice(idx + marker.length);
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      // continue — DB delete is the source of truth
    }
  }
  const { error } = await supabase
    .from('tire_photos')
    .delete()
    .eq('id', photo.id);
  if (error) {
    console.error('photo row delete failed', error);
    return false;
  }
  return true;
}

/** Photos for a single tire, oldest first (so first uploaded = first shown). */
export async function loadTirePhotos(tireId: string): Promise<TirePhoto[]> {
  const { data } = await supabase
    .from('tire_photos')
    .select('*')
    .eq('tire_id', tireId)
    .order('created_at', { ascending: true });
  return (data as TirePhoto[]) || [];
}

/**
 * Returns a map of tire_id → first photo URL, used to render thumbnails
 * on the inventory and "recently added" cards in one query.
 */
export async function loadFirstPhotosByTire(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('tire_photos')
    .select('tire_id, url, created_at')
    .order('created_at', { ascending: true });
  const map = new Map<string, string>();
  for (const p of (data as { tire_id: string; url: string }[]) || []) {
    if (!map.has(p.tire_id)) map.set(p.tire_id, p.url);
  }
  return map;
}
