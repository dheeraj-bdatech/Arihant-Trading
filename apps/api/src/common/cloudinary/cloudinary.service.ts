import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Signs a direct browser upload. Fails loudly when Cloudinary is not configured (a placeholder secret would only
   * produce uploads Cloudinary rejects with a confusing error). Uploads always land under CLOUDINARY_UPLOAD_FOLDER;
   * a caller may only pick a plain sub-folder name. `allowed_formats` is part of the signature, so the browser
   * cannot widen it. (File size is capped in the upload forms; Cloudinary's plan limit is the hard ceiling.)
   */
  generateSignedUploadParameters(customFolder?: string): CloudinarySignedParams {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('File uploads are not configured on the server (Cloudinary credentials missing).');
    }
    const base = (this.configService.get<string>('CLOUDINARY_UPLOAD_FOLDER') || 'arihant-bos').replace(/\/+$/, '');
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
