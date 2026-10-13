/**
 * Receipt storage (§5.12–13). Files are validated by content (magic bytes), hashed with SHA-256
 * for duplicate-receipt detection, written to private disk storage and only ever served through
 * the authorised download endpoint — there are no public URLs.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sql } from 'kysely';
import { EXPENSE_INACTIVE_FOR_DUPLICATES, type AuthUser } from '@arihant/shared';
import { ExpenseClaimsService } from './expense-claims.service.js';
import {
  ExpenseValidationException,
  MIME_EXTENSIONS,
  sanitizeFileName,
  sniffMime,
} from './expense-validation.js';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ExpenseAttachmentsService {
  constructor(private readonly claims: ExpenseClaimsService) {}

  private get db() {
    return this.claims.db;
  }

  private resolvePath(storageKey: string): string {
    const root = this.claims.config.storageDir;
    const full = path.resolve(root, storageKey);
    if (!full.startsWith(root + path.sep)) throw new NotFoundException('Attachment not found');
    return full;
  }

  private async loadItem(itemId: string) {
    if (!UUID.test(itemId)) throw new NotFoundException('Expense item not found');
    const item = await this.db
      .selectFrom('expense_items')
      .select(['id', 'claim_id', 'purpose'])
      .where('id', '=', itemId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!item) throw new NotFoundException('Expense item not found');
    return item;
  }

  async upload(itemId: string, file: UploadedFile | undefined, user: AuthUser) {
    const item = await this.loadItem(itemId);
    const claim = await this.claims.getVisibleClaim(item.claim_id, user);
    this.claims.assertOwnerEditable(claim, user);
    const cfg = this.claims.config;

    if (!file || !file.buffer || file.size === 0) throw new ExpenseValidationException({ file: 'Choose a receipt file to upload.' });
    if (file.size > cfg.maxFileBytes) {
      throw new ExpenseValidationException({ file: `Receipts can be at most ${Math.round(cfg.maxFileBytes / 1024 / 1024)} MB.` });
    }
    const mime = sniffMime(file.buffer);
    if (!mime || !cfg.allowedMimeTypes.includes(mime)) {
      throw new ExpenseValidationException({ file: 'Only PDF, JPG, PNG or HEIC receipts are accepted (checked by file content, not extension).' });
    }
    const existing = await this.db
      .selectFrom('expense_attachments')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('item_id', '=', itemId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (Number(existing?.n || 0) >= cfg.maxFilesPerItem) {
      throw new ExpenseValidationException({ file: `An expense line can have at most ${cfg.maxFilesPerItem} receipts.` });
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.db
      .selectFrom('expense_attachments as a')
      .innerJoin('expense_items as i', 'i.id', 'a.item_id')
      .innerJoin('expense_claims as c', 'c.id', 'i.claim_id')
      .select(['a.id', 'c.claim_number', 'i.purpose'])
      .where('a.sha256', '=', sha256)
      .where('a.deleted_at', 'is', null)
      .where('i.deleted_at', 'is', null)
      .where('c.deleted_at', 'is', null)
      .where('c.status', 'not in', [...EXPENSE_INACTIVE_FOR_DUPLICATES])
      .orderBy('a.uploaded_at')
      .executeTakeFirst();

    const ext = MIME_EXTENSIONS[mime];
    const storageKey = path.join(new Date().getFullYear().toString(), `${randomUUID()}.${ext}`);
    const fullPath = this.resolvePath(storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, file.buffer, { mode: 0o640 });

    let baseName = sanitizeFileName(file.originalname);
    if (!/\.[a-z0-9]{2,5}$/i.test(baseName)) baseName = `${baseName}.${ext}`;

    try {
      const row = await this.db.transaction().execute(async (trx) => {
        const locked = await this.claims.lockClaim(trx, claim.id);
        this.claims.assertOwnerEditable(locked, user);
        const att = await trx
          .insertInto('expense_attachments')
          .values({
            item_id: itemId,
            file_name: baseName,
            storage_key: storageKey,
            mime_type: mime,
            size_bytes: file.size,
            sha256,
            duplicate_of_attachment_id: duplicate?.id ?? null,
            uploaded_by: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.updateTable('expense_claims').set({ version: sql`version + 1`, updated_by: user.id }).where('id', '=', claim.id).execute();
        if (locked.status === 'clarification_required' || duplicate) {
          await this.claims.history(trx, claim.id, {
            from: locked.status,
            to: locked.status,
            action: locked.status === 'clarification_required' ? 'clarification_edit' : 'duplicate_receipt',
            actor: user,
            comment: duplicate
              ? `Receipt "${baseName}" matches a receipt already attached on ${duplicate.claim_number}.`
              : `Attached receipt "${baseName}" to "${item.purpose}"`,
            metadata: { item_id: itemId, attachment_id: att.id, duplicate_of: duplicate?.id ?? null },
          });
        }
        return att;
      });
      const fresh = await this.db.selectFrom('expense_claims').select('version').where('id', '=', claim.id).executeTakeFirstOrThrow();
      return {
        attachment: {
          id: row.id,
          item_id: row.item_id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          uploaded_at: row.uploaded_at,
          duplicate_of_attachment_id: row.duplicate_of_attachment_id,
          duplicate_claim_number: duplicate?.claim_number ?? null,
        },
        claim: { id: claim.id, version: fresh.version },
        warnings: duplicate
          ? [`This receipt was already attached on ${duplicate.claim_number} ("${duplicate.purpose}"). It will be flagged to your approver and Accounts.`]
          : [],
      };
    } catch (err) {
      await fs.promises.unlink(fullPath).catch(() => undefined);
      throw err;
    }
  }

  async open(attachmentId: string, user: AuthUser) {
    if (!UUID.test(attachmentId)) throw new NotFoundException('Attachment not found');
    const att = await this.db
      .selectFrom('expense_attachments as a')
      .innerJoin('expense_items as i', 'i.id', 'a.item_id')
      .select(['a.id', 'a.file_name', 'a.mime_type', 'a.size_bytes', 'a.storage_key', 'i.claim_id'])
      .where('a.id', '=', attachmentId)
      .where('a.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!att) throw new NotFoundException('Attachment not found');
    await this.claims.getVisibleClaim(att.claim_id, user);
    const fullPath = this.resolvePath(att.storage_key);
    if (!fs.existsSync(fullPath)) throw new NotFoundException('Receipt file is missing from storage.');
    return { stream: fs.createReadStream(fullPath), fileName: att.file_name, mimeType: att.mime_type, size: att.size_bytes };
  }

  async remove(attachmentId: string, user: AuthUser) {
    if (!UUID.test(attachmentId)) throw new NotFoundException('Attachment not found');
    const att = await this.db
      .selectFrom('expense_attachments as a')
      .innerJoin('expense_items as i', 'i.id', 'a.item_id')
      .select(['a.id', 'a.file_name', 'i.claim_id', 'i.purpose'])
      .where('a.id', '=', attachmentId)
      .where('a.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!att) throw new NotFoundException('Attachment not found');
    const claim = await this.claims.getVisibleClaim(att.claim_id, user);
    this.claims.assertOwnerEditable(claim, user);
    await this.db.transaction().execute(async (trx) => {
      const locked = await this.claims.lockClaim(trx, claim.id);
      this.claims.assertOwnerEditable(locked, user);
      await trx.updateTable('expense_attachments').set({ deleted_at: new Date() }).where('id', '=', attachmentId).execute();
      await trx.updateTable('expense_claims').set({ version: sql`version + 1`, updated_by: user.id }).where('id', '=', claim.id).execute();
      if (locked.status === 'clarification_required') {
        await this.claims.history(trx, claim.id, {
          from: locked.status,
          to: locked.status,
          action: 'clarification_edit',
          actor: user,
          comment: `Removed receipt "${att.file_name}" from "${att.purpose}"`,
          metadata: { attachment_id: attachmentId },
        });
      }
    });
    const fresh = await this.db.selectFrom('expense_claims').select('version').where('id', '=', claim.id).executeTakeFirstOrThrow();
    return { id: attachmentId, deleted: true, claim: { id: claim.id, version: fresh.version } };
  }
}
