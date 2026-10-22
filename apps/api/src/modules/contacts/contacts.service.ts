import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database } from '@arihant/shared';
import type { CreateContactDto, UpdateContactDto } from './contacts.dto.js';

@Injectable()
export class ContactsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async findByOrganisation(orgId: string) {
    return this.db
      .selectFrom('contacts')
      .selectAll()
      .where('organisation_id', '=', orgId)
      .orderBy('is_primary', 'desc')
      .orderBy('full_name', 'asc')
      .execute();
  }

  async create(dto: CreateContactDto) {
    // If set as primary, unmark previous primaries
    if (dto.is_primary) {
      await this.db
        .updateTable('contacts')
        .set({ is_primary: false })
        .where('organisation_id', '=', dto.organisation_id)
        .execute();
    }

    return this.db
      .insertInto('contacts')
      .values({
        organisation_id: dto.organisation_id,
        full_name: dto.full_name.trim(),
        designation: dto.designation || null,
        // stored as the 10-digit national number, the form the duplicate check compares against
        mobile: dto.mobile ? dto.mobile.replace(/\D/g, '').slice(-10) : null,
        email: dto.email || null,
        is_primary: dto.is_primary || false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(id: string, dto: UpdateContactDto) {
    const contact = await this.db
      .selectFrom('contacts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    if (dto.is_primary) {
      await this.db
        .updateTable('contacts')
        .set({ is_primary: false })
        .where('organisation_id', '=', contact.organisation_id)
        .execute();
    }

    return this.db
      .updateTable('contacts')
      .set({
        ...dto,
        full_name: dto.full_name ? dto.full_name.trim() : undefined,
        mobile: dto.mobile ? dto.mobile.replace(/\D/g, '').slice(-10) : undefined,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async delete(id: string) {
    const res = await this.db
      .deleteFrom('contacts')
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!res) {
      throw new NotFoundException('Contact not found');
    }

    return { success: true };
  }
}
