import { supabase } from './supabase';
import { compressImage } from './imageCompress';

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
  try {
    // Resize/recompress before upload. Phone-camera photos can be 4–10 MB;
    // after this they're typically 200–500 KB.
    const prepared = await compressImage(file);
    const ext = extFor(prepared);
    const path = `${tireId}/${Date.now()}-${randomToken()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, prepared, {
        cacheControl: '3600',
        upsert: false,
        contentType: prepared.type || `image/${ext}`,
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
  } catch (e) {
    // The supabase client occasionally throws (e.g. when a proxy/CDN
    // returns a non-JSON response and the client tries to parse it).
    // Treat that as a failed upload rather than letting "Unexpected
    // token" bubble all the way to the user.
    console.error('uploadTirePhoto threw', e);
    return null;
  }
}

/**
 * Upload a photo to the tire-photos bucket WITHOUT linking it to a tire yet.
 * Used by the chat attach flow — the AI may later attach the returned URL
 * to a newly-created tire via add_tire's photo_url. Files land in
 * `pending/<timestamp>-<token>.<ext>` so they're easy to spot and clean up.
 *
 * Runs client-side, where the supabase client has the user's session — this
 * matches the auth-tier that the bucket's RLS allows for uploads.
 */
export async function uploadPendingPhoto(file: File): Promise<string | null> {
  try {
    const prepared = await compressImage(file);
    const ext = extFor(prepared);
    const path = `pending/${Date.now()}-${randomToken()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, prepared, {
        cacheControl: '3600',
        upsert: false,
        contentType: prepared.type || `image/${ext}`,
      });
    if (uploadError) {
      console.error('pending photo upload failed', uploadError);
      return null;
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e) {
    console.error('uploadPendingPhoto threw', e);
    return null;
  }
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
