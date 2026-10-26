import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module.js';
import type { Database } from '@arihant/shared';

export interface AuditEventPayload {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: any;
  newValue?: any;
  /** Why the change was made — persisted inside new_value.reason so the audit trail carries it (Module 2 §11). */
  reason?: string | null;
}

@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  @OnEvent('audit.log')
  async handleAuditLog(payload: AuditEventPayload) {
    let newValue = payload.newValue;
    if (payload.reason) {
      newValue =
        newValue && typeof newValue === 'object' && !Array.isArray(newValue)
          ? { ...newValue, reason: newValue.reason ?? payload.reason }
          : newValue !== undefined && newValue !== null
            ? { value: newValue, reason: payload.reason }
            : { reason: payload.reason };
    }
    try {
      await this.db
        .insertInto('audit_log')
        .values({
          actor_id: payload.actorId,
          entity_type: payload.entityType,
          entity_id: payload.entityId,
          action: payload.action,
          previous_value: payload.previousValue ? JSON.stringify(payload.previousValue) : null,
          new_value: newValue ? JSON.stringify(newValue) : null,
        })
        .execute();

      this.logger.log(`Audit log written: [${payload.action}] on ${payload.entityType} ${payload.entityId}`);
    } catch (err: any) {
      this.logger.error(`Failed to write audit log: ${err.message}`);
    }
  }
}
