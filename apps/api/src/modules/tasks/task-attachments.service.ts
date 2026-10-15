/**
 * Task documents: supporting docs (assigner/manager), evidence and update photos (assignee, camera capture
 * from phones), blocker evidence. Validated by content (magic bytes) + extension allow-list, max size and
 * count per task, hashed with SHA-256, stored privately and only served through the authorised endpoint.
 * Evidence cannot be removed once the task is submitted or completed.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sql } from 'kysely';
import type { AuthUser, TaskAttachmentPurpose } from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { conflict, readEnum, sanitizeFileName, TaskValidationException, UUID_RE } from './task-common.js';
import { sniffTaskFile } from './task-common.js';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const PURPOSES: TaskAttachmentPurpose[] = ['supporting_doc', 'evidence', 'blocker_evidence', 'update'];

@Injectable()
export class TaskAttachmentsService {
  constructor(private readonly store: TaskStore) {}

  private get db() {
    return this.store.db;
  }

  private resolvePath(key: string) {
    const root = this.store.config.storageDir;
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new NotFoundException('File not found');
    return full;
  }

  async upload(taskId: string, file: UploadedFile | undefined, body: Record<string, unknown>, user: AuthUser) {
    const task = await this.store.getVisible(taskId, user);
    const cfg = this.store.config;
    const errors: Record<string, string> = {};
    const purpose = readEnum(errors, 'purpose', body.purpose, PURPOSES, { label: 'Purpose', fallback: 'supporting_doc' })!;
    const relatedId = typeof body.related_id === 'string' && UUID_RE.test(body.related_id) ? body.related_id : null;
    if (Object.keys(errors).length) throw new TaskValidationException(errors);
    const kinds = await this.store.access.actorKinds(task, user);
    const isAssignee = kinds.has('assignee');
    if ((purpose === 'evidence' || purpose === 'blocker_evidence') && !isAssignee) throw new ForbiddenException('Only the assignee uploads evidence for this task.');
    if (!isAssignee && !kinds.has('manager') && !kinds.has('assigner')) throw new ForbiddenException('You cannot add files to this task.');
    if (!['not_started', 'in_progress', 'blocked'].includes(task.status)) throw conflict('Files can only be added while the task is open.');

    if (!file?.buffer || file.size === 0) throw new TaskValidationException({ file: 'Choose a file to upload.' });
    if (file.size > cfg.maxFileBytes) throw new TaskValidationException({ file: `Files can be at most ${Math.round(cfg.maxFileBytes / 1024 / 1024)} MB.` });
    let baseName = sanitizeFileName(file.originalname || 'document');
    const ext = (baseName.split('.').pop() || '').toLowerCase();
    if (!cfg.allowedExtensions.includes(ext)) throw new TaskValidationException({ file: `Allowed file types: ${cfg.allowedExtensions.join(', ').toUpperCase()}.` });
    const sniffed = sniffTaskFile(file.buffer, baseName);
    if (!sniffed) throw new TaskValidationException({ file: 'The file content does not match an allowed type (checked by content, not the name).' });
    const count = await this.db
      .selectFrom('task_attachments')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('task_id', '=', taskId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (Number(count?.n) >= cfg.maxFilesPerTask) throw new TaskValidationException({ file: `A task can have at most ${cfg.maxFilesPerTask} files.` });

    if (!baseName.toLowerCase().endsWith(`.${sniffed.ext}`) && !(sniffed.ext === 'jpg' && ext === 'jpeg')) baseName = `${baseName}.${sniffed.ext}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = path.join(new Date().getFullYear().toString(), `${randomUUID()}.${sniffed.ext}`);
    const full = this.resolvePath(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, file.buffer, { mode: 0o640 });
    try {
      const row = await this.db.transaction().execute(async (trx) => {
        const att = await trx
          .insertInto('task_attachments')
          .values({ task_id: taskId, purpose, related_id: relatedId, file_name: baseName, storage_key: key, mime_type: sniffed.mime, size_bytes: file.size, sha256, uploaded_by: user.id })
          .returning(['id', 'task_id', 'purpose', 'related_id', 'file_name', 'mime_type', 'size_bytes', 'uploaded_at'])
          .executeTakeFirstOrThrow();
        await this.store.log(trx, taskId, { kind: 'attachment_added', author: user, comment: baseName, metadata: { attachment_id: att.id, purpose, sha256 } });
        if (isAssignee) await trx.updateTable('tasks').set({ last_update_at: new Date() }).where('id', '=', taskId).execute();
        return att;
      });
      this.store.audit(user, 'task_attachment', row.id, 'task_attachment_upload', undefined, { task_id: taskId, purpose, file_name: baseName, sha256 });
      return row;
    } catch (err) {
      await fs.promises.unlink(full).catch(() => undefined);
      throw err;
    }
  }

  async open(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('File not found');
    const att = await this.db.selectFrom('task_attachments').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!att) throw new NotFoundException('File not found');
    await this.store.getVisible(att.task_id, user);
    const full = this.resolvePath(att.storage_key);
    if (!fs.existsSync(full)) throw new NotFoundException('File is missing from storage.');
    return { stream: fs.createReadStream(full), fileName: att.file_name, mimeType: att.mime_type, size: att.size_bytes };
  }

  async remove(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('File not found');
    const att = await this.db.selectFrom('task_attachments').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!att) throw new NotFoundException('File not found');
    const task = await this.store.getVisible(att.task_id, user);
    if (!['not_started', 'in_progress', 'blocked'].includes(task.status)) throw conflict('Files on a submitted, completed or cancelled task are part of the record and cannot be removed.');
    const kinds = await this.store.access.actorKinds(task, user);
    if (att.uploaded_by !== user.id && !(kinds.has('manager') && !kinds.has('assignee'))) throw new ForbiddenException('Only the uploader or a manager can remove this file.');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('task_attachments').set({ deleted_at: new Date(), deleted_by: user.id }).where('id', '=', id).execute();
      await this.store.log(trx, att.task_id, { kind: 'attachment_removed', author: user, comment: att.file_name, metadata: { attachment_id: id, purpose: att.purpose } });
    });
    this.store.audit(user, 'task_attachment', id, 'task_attachment_remove', { file_name: att.file_name, task_id: att.task_id });
    return { id, deleted: true };
  }
}
