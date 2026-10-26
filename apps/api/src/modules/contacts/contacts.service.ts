import { Injectable, NotFoundException, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { AuthUser, Database } from '@arihant/shared';
import { assertOrganisationInScope } from '../organisations/organisation-scope.js';
import type { CreateContactDto, UpdateContactDto } from './contacts.dto.js';

@Injectable()
export class ContactsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Loads a contact and checks its account lies inside the caller's Customer Register territory. */
  private async getScopedContact(id: string, user: AuthUser) {
    const contact = await this.db
      .selectFrom('contacts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    await assertOrganisationInScope(this.db, contact.organisation_id, user);
    return contact;
  }

  async findByOrganisation(orgId: string, user: AuthUser) {
    if (!orgId) {
      throw new BadRequestException('organisation_id is required');
    }
    await assertOrganisationInScope(this.db, orgId, user);
    return this.db
      .selectFrom('contacts')
      .selectAll()
      .where('organisation_id', '=', orgId)
      .orderBy('is_primary', 'desc')
      .orderBy('full_name', 'asc')
      .execute();
  }

  async create(dto: CreateContactDto, user: AuthUser) {
    await assertOrganisationInScope(this.db, dto.organisation_id, user);

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

  async update(id: string, dto: UpdateContactDto, user: AuthUser) {
    const contact = await this.getScopedContact(id, user);

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

  async delete(id: string, user: AuthUser) {
    const contact = await this.getScopedContact(id, user);

    try {
      await this.db.deleteFrom('contacts').where('id', '=', id).execute();
    } catch (err: any) {
      // Still referenced by a lead, interaction, follow-up, visit… — keep the history intact
      if (err?.code === '23503') {
        throw new ConflictException(
          'This contact is linked to existing leads, interactions or visits and cannot be deleted.',
        );
      }
      throw err;
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'contact',
      entityId: id,
      action: 'contact_delete',
      previousValue: contact,
    });

    return { success: true };
  }
}
