import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service.js';
import type { Database, AuthUser } from '@arihant/shared';
import type { AttachFileDto } from './uploads.dto.js';

@Injectable()
export class UploadsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getSignParameters(folder?: string) {
    await this.cloudinaryService.assertCredentialsAccepted();
    return this.cloudinaryService.generateSignedUploadParameters(folder);
  }

  async attachFile(dto: AttachFileDto, user: AuthUser) {
    const attachment = await this.db
      .insertInto('attachments')
      .values({
        entity_type: dto.entity_type,
        entity_id: dto.entity_id,
        file_url: dto.file_url,
        file_name: dto.file_name || 'Uploaded Document',
        uploaded_by: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: dto.entity_type,
      entityId: dto.entity_id,
      action: 'attach_file',
      newValue: { file_url: dto.file_url, file_name: dto.file_name },
    });

    return attachment;
  }

  /**
   * Generic attachments carry no per-record permissions of their own, so a user sees only files they uploaded;
   * management and admin see every file on the record. (Module documents use their own scoped endpoints.)
   */
  async getAttachments(entityType: string, entityId: string, user: AuthUser) {
    let q = this.db
      .selectFrom('attachments')
      .leftJoin('users', 'attachments.uploaded_by', 'users.id')
      .selectAll('attachments')
      .select('users.full_name as uploaded_by_name')
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId);
    if (!['management', 'admin'].includes(user.role)) q = q.where('attachments.uploaded_by', '=', user.id);
    return q.orderBy('created_at', 'desc').execute();
  }
}
