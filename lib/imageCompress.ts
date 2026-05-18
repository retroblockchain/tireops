/**
 * Browser-side image compressor. Resize to a max long edge and re-encode as
 * JPEG so phone-camera photos (3–10 MB) become 200–500 KB before upload.
 * This keeps requests well under the Vercel serverless body limit (~4.5 MB)
 * AND makes Storage uploads much faster on mobile networks.
 *
 * Non-images pass through unchanged. Decode failures (HEIC on older browsers,
 * corrupted files, etc.) fall back to the original File — never throw.
 */

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const SKIP_BELOW_BYTES = 256 * 1024; // 256 KB — already small enough

export async function compressImage(file: File): Promise<File> {
  if (typeof window === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await loadImage(objectUrl);
    const { width, height } = scaledDims(img.naturalWidth, img.naturalHeight);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;
    // If our "compressed" output ended up larger (rare — e.g. small PNG
    // becoming a JPEG), keep the original.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (e) {
    console.warn('image compression failed, using original file', e);
    return file;
  } finally {
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

function scaledDims(w: number, h: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= MAX_LONG_EDGE) return { width: w, height: h };
  const scale = MAX_LONG_EDGE / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
