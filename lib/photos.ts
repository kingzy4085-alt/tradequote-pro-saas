import { supabaseBrowser } from './supabase-browser';

export const PHOTO_BUCKET = 'job-photos';

// Shrinks phone photos to at most 1600px JPEG before upload
export async function compress(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.82));
  } catch {
    return file; // formats the browser can't read (e.g. HEIC on desktop) upload as-is
  }
}

// Uploads into the company's folder; returns stored paths and the first error, if any
export async function uploadPhotos(files: FileList, folder: string, onEach?: () => void) {
  const sb = supabaseBrowser();
  const paths: string[] = [];
  let error = '';
  for (const file of Array.from(files)) {
    const blob = await compress(file);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : file.name.split('.').pop() || 'jpg';
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const res = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || file.type });
    if (res.error) error ||= res.error.message;
    else paths.push(path);
    onEach?.();
  }
  return { paths, error };
}

export async function signedPhotoUrls(paths: string[]) {
  const { data } = await supabaseBrowser().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path!, d.signedUrl]));
}
