import { calendarDay, todayInKolkata } from '../../common/utils/ist-date.util.js';
import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { AuthUser, Database } from '@arihant/shared';
import type { CreateInteractionDto } from './interactions.dto.js';
import { assertRegionScope } from '../../common/utils/scope.util.js';
import { assertOrganisationInScope } from '../organisations/organisation-scope.js';

@Injectable()
export class InteractionsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Lead-level access, mirroring LeadsService.findOne: a salesperson acts only on leads assigned to them; a Regional
   * Manager on leads they manage, own or whose owner reports to them, otherwise their region/zone; other roles all.
   */
  private async assertLeadAccess(leadId: string, user: AuthUser) {
    const lead = await this.db
      .selectFrom('leads')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .select([
        'leads.id',
        'leads.organisation_id',
        'leads.assigned_to',
        'leads.regional_manager_id',
        'organisations.region_id',
        'organisations.zone_id',
        'assignee.reporting_manager_id as assignee_reporting_manager_id',
      ])
      .where('leads.id', '=', leadId)
      .executeTakeFirst();

    if (!lead) {
      throw new NotFoundException(`Lead with id '${leadId}' not found`);
    }
    if (user.role === 'sales' && lead.assigned_to !== user.id) {
      throw new ForbiddenException('You are not authorized to access this lead.');
    }
    if (
      user.role === 'regional_manager' &&
      lead.regional_manager_id !== user.id &&
      lead.assigned_to !== user.id &&
      lead.assignee_reporting_manager_id !== user.id
    ) {
      assertRegionScope(user, lead.region_id, lead.zone_id);
    }
    return lead;
  }

  async findByOrganisation(orgId: string, user: AuthUser) {
    await assertOrganisationInScope(this.db, orgId, user);

    let query = this.db
      .selectFrom('interactions')
      .leftJoin('contacts', 'interactions.contact_id', 'contacts.id')
      .leftJoin('users', 'interactions.employee_id', 'users.id')
      .leftJoin('leads', 'interactions.lead_id', 'leads.id')
      .selectAll('interactions')
      .select([
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'contacts.email as contact_email',
        'users.full_name as employee_name',
        'leads.lead_status',
        'leads.status as legacy_status',
      ])
      .where('interactions.organisation_id', '=', orgId);

    // A salesperson sees the account-level touchpoints and those on their own leads — not colleagues' lead history
    if (user.role === 'sales') {
      query = query.where((eb) =>
        eb.or([
          eb('interactions.lead_id', 'is', null),
          eb('leads.assigned_to', '=', user.id),
          eb('interactions.employee_id', '=', user.id),
        ]),
      );
    }

    const interactions = await query
      .orderBy('interactions.occurred_on', 'desc')
      .orderBy('interactions.created_at', 'desc')
      .execute();

    if (interactions.length === 0) {
      return [];
    }

    const ids = interactions.map((i) => i.id);
    const attachments = await this.db
      .selectFrom('interaction_attachments')
      .selectAll()
      .where('interaction_id', 'in', ids)
      .execute();

    return interactions.map((item) => ({
      ...item,
      attachments: attachments.filter((a) => a.interaction_id === item.id),
    }));
  }

  async findByLead(leadId: string, user: AuthUser) {
    await this.assertLeadAccess(leadId, user);

    const interactions = await this.db
      .selectFrom('interactions')
      .leftJoin('contacts', 'interactions.contact_id', 'contacts.id')
      .leftJoin('users', 'interactions.employee_id', 'users.id')
      .selectAll('interactions')
      .select([
        'contacts.full_name as contact_name',
        'users.full_name as employee_name',
      ])
      .where('interactions.lead_id', '=', leadId)
      .orderBy('interactions.occurred_on', 'desc')
      .orderBy('interactions.created_at', 'desc')
      .execute();

    if (interactions.length === 0) {
      return [];
    }

    const ids = interactions.map((i) => i.id);
    const attachments = await this.db
      .selectFrom('interaction_attachments')
      .selectAll()
      .where('interaction_id', 'in', ids)
      .execute();

    return interactions.map((item) => ({
      ...item,
      attachments: attachments.filter((a) => a.interaction_id === item.id),
    }));
  }

  async create(dto: CreateInteractionDto, user: AuthUser) {
    const employeeId = user.id;
    // The lead must belong to the stated account, and the caller must be allowed to act on it / the account
    if (dto.lead_id) {
      const lead = await this.assertLeadAccess(dto.lead_id, user);
      if (lead.organisation_id !== dto.organisation_id) {
        throw new BadRequestException('The selected lead does not belong to this customer account.');
      }
    } else {
      await assertOrganisationInScope(this.db, dto.organisation_id, user);
    }
    if (dto.contact_id) {
      const contact = await this.db
        .selectFrom('contacts')
        .select('organisation_id')
        .where('id', '=', dto.contact_id)
        .executeTakeFirst();
      if (!contact || contact.organisation_id !== dto.organisation_id) {
        throw new BadRequestException('The selected contact does not belong to this customer account.');
      }
    }

    const occurredOn = dto.occurred_on || dto.interaction_date || todayInKolkata();
    const remarks = dto.remarks || dto.notes || null;
    const followupDate = dto.followup_date || dto.next_followup_date || null;
    // A follow-up is booked for today or later (IST) — never straight into the overdue queue (QA DEF-053 / DEF-058)
    if (followupDate && (calendarDay(followupDate) || '') < todayInKolkata()) {
      throw new BadRequestException('Next follow-up date cannot be in the past — choose today or a later date.');
    }

    const result = await this.db.transaction().execute(async (trx) => {
      // 1. Insert interaction
      const interaction = await trx
        .insertInto('interactions')
        .values({
          organisation_id: dto.organisation_id,
          contact_id: dto.contact_id || null,
          lead_id: dto.lead_id || null,
          type: dto.type,
          employee_id: employeeId,
          occurred_on: occurredOn,
          remarks: remarks,
          outcome: dto.outcome || null,
          next_action: dto.next_action || null,
          followup_date: followupDate,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 2. Attachments
      let createdAttachments: any[] = [];
      if (dto.attachments && dto.attachments.length > 0) {
        for (const att of dto.attachments) {
          const inserted = await trx
            .insertInto('interaction_attachments')
            .values({
              interaction_id: interaction.id,
              file_url: att.file_url,
              file_name: att.file_name,
              file_size: att.file_size || null,
              mime_type: att.mime_type || null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          createdAttachments.push(inserted);
        }
      }

      // 3. Atomically update Lead last_interaction_at & next_followup_at if lead_id present
      if (dto.lead_id) {
        await trx
          .updateTable('leads')
          .set({
            last_interaction_at: new Date(),
            last_contact_date: occurredOn,
            next_followup_at: followupDate ? new Date(followupDate) : undefined,
            next_followup_date: followupDate || undefined,
            updated_at: new Date(),
          })
          .where('id', '=', dto.lead_id)
          .execute();
      }

      // 4. Automatically create follow-up if followup_date provided
      let createdFollowUp: any = null;
      if (followupDate) {
        createdFollowUp = await trx
          .insertInto('follow_ups')
          .values({
            organisation_id: dto.organisation_id,
            contact_id: dto.contact_id || null,
            lead_id: dto.lead_id || null,
            interaction_id: interaction.id,
            assigned_to: employeeId,
            due_date: followupDate,
            status: 'pending',
            remarks: dto.next_action || remarks || 'Follow-up scheduled from client interaction',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Enqueue FollowUpCreated Outbox event
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.FOLLOWUP_CREATED,
          aggregateType: 'FOLLOW_UP',
          aggregateId: createdFollowUp.id,
          actorId: employeeId,
          payload: {
            followUpId: createdFollowUp.id,
            organisationId: dto.organisation_id,
            leadId: dto.lead_id,
            assignedTo: employeeId,
            dueDate: followupDate,
            remarks: createdFollowUp.remarks,
          },
        });
      }

      // 5. Enqueue InteractionCreated Outbox event
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.INTERACTION_CREATED,
        aggregateType: 'INTERACTION',
        aggregateId: interaction.id,
        actorId: employeeId,
        payload: {
          interactionId: interaction.id,
          organisationId: dto.organisation_id,
          contactId: dto.contact_id,
          leadId: dto.lead_id,
          type: dto.type,
          occurredOn,
          employeeId,
          outcome: dto.outcome,
          followupDate: followupDate,
        },
      });

      return {
        ...interaction,
        attachments: createdAttachments,
        follow_up: createdFollowUp,
      };
    });

    this.outboxService.triggerImmediate();

    return result;
  }
}
