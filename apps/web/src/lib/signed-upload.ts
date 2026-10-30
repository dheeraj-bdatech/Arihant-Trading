import { api } from './api';

interface UploadSignature {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  allowedFormats: string;
}

/**
 * Direct browser upload to Cloudinary, signed by POST /uploads/sign (which refuses with an administrator message when
 * the server's credentials are known to be wrong). Returns the stored file URL. Cloudinary's own errors are turned into
 * plain sentences — its raw text (e.g. "Invalid Signature … String to sign …") is logged, never shown to the user.
 */
export async function uploadSignedFile(file: File, folder: string): Promise<string> {
  const sig = await api.post<UploadSignature>('/uploads/sign', { folder });
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('allowed_formats', sig.allowedFormats); // signed by the API — must be sent exactly as returned
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/auto/upload`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.secure_url) return data.secure_url as string;

  const raw = String(data?.error?.message || `HTTP ${res.status}`);
  console.error(`Cloudinary rejected the upload of "${file.name}":`, raw);
  if (/signature|api[_ ]?secret|api[_ ]?key|cloud[_ ]?name|unknown api/i.test(raw)) {
    throw new Error('The file service rejected this upload because the server’s upload settings are wrong. The file was not attached — please tell your administrator.');
  }
  if (/format|file type/i.test(raw)) throw new Error(`“${file.name}” is not an accepted file type. Use PDF, Word, Excel or an image.`);
  if (/too large|file size|maximum/i.test(raw)) throw new Error(`“${file.name}” is too large to upload.`);
  throw new Error(`“${file.name}” could not be uploaded. Please try again.`);
}
