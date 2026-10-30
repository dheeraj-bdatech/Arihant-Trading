import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

/** File types Cloudinary will accept for a signed upload (documents, sheets and images). */
export const ALLOWED_UPLOAD_FORMATS = 'pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png,webp,heic';

export interface CloudinarySignedParams {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  allowedFormats: string;
}

export type CloudinaryCredentialCheck = 'ok' | 'rejected' | 'unknown';

/** A setting as pasted into a hosting dashboard: surrounding whitespace and wrapping quotes are not part of it. */
const cleanSetting = (v: string | undefined | null) =>
  (v ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();

const OK_CACHE_MS = 60 * 60 * 1000;
const REJECTED_CACHE_MS = 5 * 60 * 1000;

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private lastCheck: { result: Exclude<CloudinaryCredentialCheck, 'unknown'>; at: number } | null = null;

  constructor(private readonly configService: ConfigService) {}

  private settings() {
    return {
      cloudName: cleanSetting(this.configService.get<string>('CLOUDINARY_CLOUD_NAME')),
      apiKey: cleanSetting(this.configService.get<string>('CLOUDINARY_API_KEY')),
      apiSecret: cleanSetting(this.configService.get<string>('CLOUDINARY_API_SECRET')),
      folder: cleanSetting(this.configService.get<string>('CLOUDINARY_UPLOAD_FOLDER')),
    };
  }

  /** Tell an administrator at start-up, not a user at upload time, that the credentials are wrong. */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if ((await this.checkCredentials()) === 'rejected') {
      this.logger.error('Cloudinary rejected CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET — every file upload will fail until the secret matches the key.');
    }
  }

  /**
   * Whether Cloudinary accepts this key / secret pair, via its read-only Admin API ping (nothing is uploaded).
   * 'unknown' when not configured or Cloudinary cannot be reached — uploads are then not blocked on our side.
   * A definite answer is cached (an hour when accepted, five minutes when rejected, so a fixed secret is picked up).
   */
  async checkCredentials(): Promise<CloudinaryCredentialCheck> {
    const { cloudName, apiKey, apiSecret } = this.settings();
    if (!cloudName || !apiKey || !apiSecret) return 'unknown';
    const now = Date.now();
    if (this.lastCheck && now - this.lastCheck.at < (this.lastCheck.result === 'ok' ? OK_CACHE_MS : REJECTED_CACHE_MS)) return this.lastCheck.result;
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/ping`, {
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) this.lastCheck = { result: 'ok', at: now };
      else if (res.status === 401 || res.status === 403) {
        const reason = await res.json().then((b: any) => b?.error?.message).catch(() => null);
        this.logger.error(`Cloudinary credential check failed (${res.status}${reason ? `: ${reason}` : ''}).`);
        this.lastCheck = { result: 'rejected', at: now };
      } else return 'unknown';
      return this.lastCheck.result;
    } catch {
      return 'unknown';
    }
  }

  /** Refuses to sign when Cloudinary is known to reject the credentials: a signature it cannot verify only fails later. */
  async assertCredentialsAccepted() {
    if ((await this.checkCredentials()) === 'rejected') {
      throw new ServiceUnavailableException(
        'File uploads are unavailable: Cloudinary rejects the server’s upload credentials. An administrator needs to set CLOUDINARY_API_SECRET to the secret of this API key (Cloudinary console → Settings → API Keys).',
      );
    }
  }

  /**
   * Signs a direct browser upload. Fails loudly when Cloudinary is not configured (a placeholder secret would only
   * produce uploads Cloudinary rejects with a confusing error). Uploads always land under CLOUDINARY_UPLOAD_FOLDER;
   * a caller may only pick a plain sub-folder name. `allowed_formats` is part of the signature, so the browser
   * cannot widen it. (File size is capped in the upload forms; Cloudinary's plan limit is the hard ceiling.)
   */
  generateSignedUploadParameters(customFolder?: string): CloudinarySignedParams {
    const { cloudName, apiKey, apiSecret, folder: baseSetting } = this.settings();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('File uploads are not configured on the server (Cloudinary credentials missing).');
    }
    const base = (baseSetting || 'arihant-bos').replace(/\/+$/, '');
    const sub = (customFolder || '').trim();
    const folder = /^[a-z0-9_-]{1,40}$/i.test(sub) ? `${base}/${sub}` : base;

    const timestamp = Math.round(new Date().getTime() / 1000);
    const allowedFormats = ALLOWED_UPLOAD_FORMATS;

    // Cloudinary signature: params sorted alphabetically, joined with &, secret appended, sha1.
    const paramsToSign = `allowed_formats=${allowedFormats}&folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1').update(`${paramsToSign}${apiSecret}`).digest('hex');

    return { timestamp, signature, apiKey, cloudName, folder, allowedFormats };
  }
}
