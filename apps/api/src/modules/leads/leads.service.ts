import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { assertRegionScope } from '../../common/utils/scope.util.js';
import { LeadWorkflowService } from './leads.workflow.js';
import type { Database, AuthUser, PaginatedResult, LeadStatus, LeadCategory, LeadType } from '@arihant/shared';
import type {
  CreateLeadDto,
  UpdateLeadDto,
  ChangeLeadStatusDto,
  AssignLeadDto,
} from './leads.dto.js';

@Injectable()
export class LeadsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly outboxService: OutboxService,
    private readonly workflowService: LeadWorkflowService,
  ) {}

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      lead_status?: string;
      lead_type?: string;
      status?: string;
      category?: string;
      probability?: string;
      assigned_to?: string;
      regional_manager_id?: string;
      organisation_id?: string;
      sector?: string;
      zone_id?: string;
      region_id?: string;
      followup?: 'due_today' | 'overdue' | 'upcoming' | 'no_followup';
      sort_by?: 'next_followup' | 'last_interaction' | 'created_at' | 'organisation';
      sort_dir?: 'asc' | 'desc';
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const today = new Date().toISOString().split('T')[0];

    let baseQuery = this.db
      .selectFrom('leads')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .leftJoin('contacts', 'leads.primary_contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .leftJoin('users as rm', 'leads.regional_manager_id', 'rm.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id')
      .leftJoin('zones', 'organisations.zone_id', 'zones.id');

    // Role territory scoping
    if (user.role === 'sales') {
      baseQuery = baseQuery.where('leads.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      if (user.region_id) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb('organisations.region_id', '=', user.region_id),
            eb('leads.regional_manager_id', '=', user.id),
            eb('leads.assigned_to', '=', user.id),
          ]),
        );
      }
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(organisations.city) like ${s}`,
          sql<boolean>`lower(products.name) like ${s}`,
          sql<boolean>`lower(coalesce(contacts.full_name, '')) like ${s}`,
          sql<boolean>`lower(coalesce(contacts.email, '')) like ${s}`,
          sql<boolean>`coalesce(contacts.mobile, '') like ${s}`,
          sql<boolean>`lower(coalesce(leads.lead_status, leads.status, '')) like ${s}`,
          sql<boolean>`lower(coalesce(leads.lead_type, '')) like ${s}`,
          sql<boolean>`leads.id::text like ${s}`,
        ]),
      );
    }

    if (query.lead_status) {
      const target = query.lead_status.toLowerCase();
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(coalesce(leads.lead_status, '')) = ${target}`,
          sql<boolean>`lower(coalesce(leads.status, '')) = ${target}`,
        ]),
      );
    } else if (query.status) {
      baseQuery = baseQuery.where('leads.status', '=', query.status);
    }

    if (query.lead_type) {
      baseQuery = baseQuery.where('leads.lead_type', '=', query.lead_type as any);
    }

    if (query.category) {
      baseQuery = baseQuery.where('leads.category', '=', query.category as any);
    }

    if (query.probability) {
      baseQuery = baseQuery.where('leads.probability', '=', query.probability as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('leads.assigned_to', '=', query.assigned_to);
    }

    if (query.regional_manager_id) {
      baseQuery = baseQuery.where('leads.regional_manager_id', '=', query.regional_manager_id);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('leads.organisation_id', '=', query.organisation_id);
    }

    if (query.sector) {
      baseQuery = baseQuery.where('organisations.sector', '=', query.sector);
    }

    if (query.zone_id) {
      baseQuery = baseQuery.where('organisations.zone_id', '=', query.zone_id);
    }

    if (query.region_id) {
      baseQuery = baseQuery.where('organisations.region_id', '=', query.region_id);
    }

    // Follow-up status filter
    if (query.followup === 'due_today') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`leads.next_followup_at::date = ${today}::date`,
          sql<boolean>`leads.next_followup_date = ${today}`,
        ]),
      );
    } else if (query.followup === 'overdue') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`leads.next_followup_at::date < ${today}::date`,
          sql<boolean>`leads.next_followup_date < ${today}`,
        ]),
      );
    } else if (query.followup === 'upcoming') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`leads.next_followup_at::date > ${today}::date`,
          sql<boolean>`leads.next_followup_date > ${today}`,
        ]),
      );
    } else if (query.followup === 'no_followup') {
      baseQuery = baseQuery.where('leads.next_followup_at', 'is', null).where('leads.next_followup_date', 'is', null);
    }

    const countRes = await baseQuery
      .select(sql<number>`count(leads.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    // Sorting
    let orderedQuery = baseQuery;
    const dir = query.sort_dir === 'asc' ? 'asc' : 'desc';

    if (query.sort_by === 'next_followup') {
      orderedQuery = orderedQuery
        .orderBy(sql`coalesce(leads.next_followup_at, (leads.next_followup_date || ' 23:59:59')::timestamp)`, dir)
        .orderBy('leads.created_at', 'desc');
    } else if (query.sort_by === 'last_interaction') {
      orderedQuery = orderedQuery
        .orderBy(sql`leads.last_interaction_at`, dir)
        .orderBy('leads.created_at', 'desc');
    } else if (query.sort_by === 'organisation') {
      orderedQuery = orderedQuery
        .orderBy('organisations.name', dir)
        .orderBy('leads.created_at', 'desc');
    } else {
      orderedQuery = orderedQuery.orderBy('leads.created_at', dir);
    }

    const leads = await orderedQuery
      .select([
        'leads.id',
        'leads.organisation_id',
        'leads.primary_contact_id',
        'leads.product_id',
        'leads.source',
        'leads.category',
        'leads.probability',
        'leads.channel',
        'leads.status',
        'leads.lead_status',
        'leads.lead_type',
        'leads.loss_reason',
        'leads.last_interaction_at',
        'leads.next_followup_at',
        'leads.assigned_to',
        'leads.regional_manager_id',
        'leads.bill_qtr',
        'leads.last_contact_date',
        'leads.next_followup_date',
        'leads.qty',
        'leads.quot_price',
        'leads.order_price',
        'leads.value_lakh',
        'leads.value_lakh as estimated_value_lakh',
        'leads.booking_month',
        'leads.billing_month',
        'leads.order_status',
        'leads.remarks',
        'leads.created_at',
        'leads.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'organisations.sector as sector',
        sql<string>`coalesce(leads.department, organisations.department)`.as('department'),
        'organisations.region_id',
        'organisations.zone_id',
        'products.name as product_name',
        'products.category as product_category',
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'contacts.email as contact_email',
        'contacts.designation as contact_designation',
        'assignee.full_name as assignee_name',
        'assignee.full_name as assigned_salesperson_name',
        'rm.full_name as regional_manager_name',
        'regions.name as region_name',
        'zones.name as zone_name',
      ])
      .limit(limit)
      .offset(offset)
      .execute();

    const leadIds = leads.map((l) => l.id);
    const interestsMap = new Map<string, Array<{ id: string; product_id: string; interest_id: string; name: string; category?: string }>>();

    if (leadIds.length > 0) {
      const interests = await this.db
        .selectFrom('lead_product_interests')
        .innerJoin('products', 'lead_product_interests.product_id', 'products.id')
        .select([
          'lead_product_interests.id as interest_id',
          'lead_product_interests.lead_id',
          'lead_product_interests.product_id',
          'products.name',
          'products.category',
        ])
        .where('lead_product_interests.lead_id', 'in', leadIds)
        .execute();

      for (const item of interests) {
        let list = interestsMap.get(item.lead_id);
        if (!list) {
          list = [];
          interestsMap.set(item.lead_id, list);
        }
        list.push({
          id: item.product_id,
          product_id: item.product_id,
          interest_id: item.interest_id,
          name: item.name,
          category: item.category || undefined,
        });
      }
    }

    const leadsWithInterests = leads.map((lead) => {
      let leadInterests = interestsMap.get(lead.id) || [];
      if (leadInterests.length === 0 && lead.product_id && lead.product_name) {
        leadInterests = [
          {
            id: lead.product_id,
            product_id: lead.product_id,
            interest_id: lead.product_id,
            name: lead.product_name,
            category: lead.product_category || undefined,
          },
        ];
      }
      return {
        ...lead,
        product_interests: leadInterests,
      };
    });

    return buildPaginatedResult(leadsWithInterests, total, page, limit);
  }

  async findOne(id: string, user: AuthUser) {
    const lead = await this.db
      .selectFrom('leads')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .leftJoin('contacts', 'leads.primary_contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .leftJoin('users as rm', 'leads.regional_manager_id', 'rm.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id')
      .leftJoin('zones', 'organisations.zone_id', 'zones.id')
      .selectAll('leads')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'organisations.sector as sector',
        sql<string>`coalesce(leads.department, organisations.department)`.as('department'),
        'organisations.region_id',
        'organisations.zone_id',
        'products.name as product_name',
        'products.category as product_category',
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'contacts.email as contact_email',
        'contacts.designation as contact_designation',
        'assignee.full_name as assignee_name',
        'assignee.full_name as assigned_salesperson_name',
        'rm.full_name as regional_manager_name',
        'regions.name as region_name',
        'zones.name as zone_name',
      ])
      .where('leads.id', '=', id)
      .executeTakeFirst();

    if (!lead) {
      throw new NotFoundException(`Lead with id '${id}' not found`);
    }

    if (user.role === 'sales' && lead.assigned_to !== user.id) {
      throw new ForbiddenException('You are not authorized to view this lead.');
    }

    if (user.role === 'regional_manager') {
      assertRegionScope(user, lead.region_id, lead.zone_id);
    }

    // Fallback if primary contact details were not joined
    if (!lead.contact_name) {
      const orgContact = await this.db
        .selectFrom('contacts')
        .select([
          'contacts.full_name as contact_name',
          'contacts.mobile as contact_mobile',
          'contacts.email as contact_email',
          'contacts.designation as contact_designation',
        ])
        .where('organisation_id', '=', lead.organisation_id)
        .orderBy('is_primary', 'desc')
        .orderBy('created_at', 'asc')
        .executeTakeFirst();
      if (orgContact) {
        Object.assign(lead, orgContact);
      }
    }

    // Product interests
    let productInterests = await this.db
      .selectFrom('lead_product_interests')
      .innerJoin('products', 'lead_product_interests.product_id', 'products.id')
      .select([
        'lead_product_interests.id as interest_id',
        'lead_product_interests.lead_id',
        'lead_product_interests.product_id',
        'lead_product_interests.product_id as id',
        'lead_product_interests.created_at',
        'products.name as name',
        'products.name as product_name',
        'products.category as category',
        'products.category as product_category',
      ])
      .where('lead_product_interests.lead_id', '=', id)
      .execute();

    if (productInterests.length === 0 && lead.product_id && lead.product_name) {
      productInterests = [
        {
          id: lead.product_id,
          product_id: lead.product_id,
          interest_id: lead.product_id,
          lead_id: lead.id,
          created_at: lead.created_at,
          name: lead.product_name,
          product_name: lead.product_name,
          category: lead.product_category || undefined,
          product_category: lead.product_category || undefined,
        } as any,
      ];
    }

    // Assignment history
    const assignmentHistory = await this.db
      .selectFrom('lead_assignment_history')
      .leftJoin('users as prev_sales', 'lead_assignment_history.previous_salesperson_id', 'prev_sales.id')
      .leftJoin('users as new_sales', 'lead_assignment_history.new_salesperson_id', 'new_sales.id')
      .leftJoin('users as prev_rm', 'lead_assignment_history.previous_regional_manager_id', 'prev_rm.id')
      .leftJoin('users as new_rm', 'lead_assignment_history.new_regional_manager_id', 'new_rm.id')
      .leftJoin('users as changer', 'lead_assignment_history.changed_by', 'changer.id')
      .selectAll('lead_assignment_history')
      .select([
        'prev_sales.full_name as previous_salesperson_name',
        'new_sales.full_name as new_salesperson_name',
        'prev_rm.full_name as previous_rm_name',
        'new_rm.full_name as new_rm_name',
        'changer.full_name as changed_by_name',
      ])
      .where('lead_assignment_history.lead_id', '=', id)
      .orderBy('lead_assignment_history.changed_at', 'desc')
      .execute();

    // Interactions timeline
    const interactions = await this.db
      .selectFrom('interactions')
      .leftJoin('users', 'interactions.employee_id', 'users.id')
      .leftJoin('contacts', 'interactions.contact_id', 'contacts.id')
      .selectAll('interactions')
      .select([
        'users.full_name as employee_name',
        'contacts.full_name as contact_name',
      ])
      .where('interactions.lead_id', '=', id)
      .orderBy('interactions.occurred_on', 'desc')
      .orderBy('interactions.created_at', 'desc')
      .execute();

    // Attachments for interactions
    const interactionIds = interactions.map((i) => i.id);
    let attachments: any[] = [];
    if (interactionIds.length > 0) {
      attachments = await this.db
        .selectFrom('interaction_attachments')
        .selectAll()
        .where('interaction_id', 'in', interactionIds)
        .execute();
    }

    const interactionsWithAttachments = interactions.map((interaction) => ({
      ...interaction,
      attachments: attachments.filter((a) => a.interaction_id === interaction.id),
    }));

    // Follow-ups
    const followUps = await this.db
      .selectFrom('follow_ups')
      .leftJoin('users as assignee', 'follow_ups.assigned_to', 'assignee.id')
      .selectAll('follow_ups')
      .select('assignee.full_name as assigned_to_name')
      .where('follow_ups.lead_id', '=', id)
      .orderBy('follow_ups.due_date', 'asc')
      .execute();

    const currentStatus = (lead.lead_status || lead.status || 'new').toLowerCase();
    const allowedTransitions = this.workflowService.getAllowedTransitions(currentStatus);
    const lastInteraction = interactions[0];
    const nextFollowUp = followUps[0];

    return {
      ...lead,
      estimated_value_lakh: lead.value_lakh,
      last_interaction_type: lastInteraction?.type || (lead as any).last_interaction_type || null,
      last_interaction_notes: lastInteraction?.remarks || (lead as any).remarks || null,
      next_followup_status: nextFollowUp?.status || (lead.next_followup_date ? 'pending' : null),
      current_status: currentStatus,
      allowed_transitions: allowedTransitions,
      product_interests: productInterests,
      assignment_history: assignmentHistory,
      interactions: interactionsWithAttachments,
      follow_ups: followUps,
    };
  }

  async create(dto: CreateLeadDto, user: AuthUser) {
    if (!dto.organisation_id && !dto.organisation_name?.trim()) {
      throw new BadRequestException('Organisation ID or Organisation Name is required');
    }

    // 1. Resolve assigned salesperson and regional manager
    const assignedTo = dto.assigned_to || user.id;
    const assignee = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'reporting_manager_id', 'region_id', 'is_active'])
      .where('id', '=', assignedTo)
      .executeTakeFirst();

    if (!assignee) {
      throw new BadRequestException(`Assigned salesperson with id '${assignedTo}' does not exist.`);
    }

    const rmId = dto.regional_manager_id || assignee.reporting_manager_id || null;

    // 2. Resolve primary product ID and product list
    const productIds = new Set<string>();
    if (dto.product_id) productIds.add(dto.product_id);
    if (dto.product_ids && Array.isArray(dto.product_ids)) {
      for (const pid of dto.product_ids) {
        if (pid) productIds.add(pid);
      }
    }
    const primaryProductId = dto.product_id || (productIds.size > 0 ? Array.from(productIds)[0] : null);

    const leadStatus = (dto.lead_status || dto.status || 'new').toLowerCase() as LeadStatus;
    const initialStatus = leadStatus;

    const lastInteractionDate = dto.last_interaction_date || new Date().toISOString().split('T')[0];
    const lastInteractionAt = new Date(lastInteractionDate);
    const nextFollowupDate = dto.next_followup_date || null;
    const nextFollowupAt = nextFollowupDate ? new Date(nextFollowupDate) : null;

    // 3. Execute within a transactional boundary
    const result = await this.db.transaction().execute(async (trx) => {
      let orgId = dto.organisation_id;
      let orgName = dto.organisation_name?.trim() || '';

      if (orgId) {
        const existingOrg = await trx
          .selectFrom('organisations')
          .select(['id', 'name', 'region_id', 'zone_id', 'city', 'state', 'sector'])
          .where('id', '=', orgId)
          .executeTakeFirst();

        if (!existingOrg) {
          throw new NotFoundException(`Organisation with id '${orgId}' not found`);
        }
        orgName = existingOrg.name;

        // Optionally update missing location/sector/department fields if passed
        const orgUpdates: any = {};
        if (dto.city && (!existingOrg.city || existingOrg.city !== dto.city.trim())) orgUpdates.city = dto.city.trim();
        if (dto.state && (!existingOrg.state || existingOrg.state !== dto.state.trim())) orgUpdates.state = dto.state.trim();
        if (dto.zone_id && (!existingOrg.zone_id || existingOrg.zone_id !== dto.zone_id)) orgUpdates.zone_id = dto.zone_id;
        if (dto.region_id && (!existingOrg.region_id || existingOrg.region_id !== dto.region_id)) orgUpdates.region_id = dto.region_id;
        if (dto.sector && (!existingOrg.sector || existingOrg.sector !== dto.sector.trim())) orgUpdates.sector = dto.sector.trim();
        if (dto.department && (!(existingOrg as any).department || (existingOrg as any).department !== dto.department.trim())) {
          orgUpdates.department = dto.department.trim();
        }

        if (Object.keys(orgUpdates).length > 0) {
          orgUpdates.updated_at = new Date();
          await trx.updateTable('organisations').set(orgUpdates).where('id', '=', orgId).execute();
        }
      } else {
        // Find existing by name (case-insensitive deduplication) or create new
        const existingOrg = await trx
          .selectFrom('organisations')
          .selectAll()
          .where(sql<boolean>`lower(trim(name)) = lower(trim(${orgName}))`)
          .executeTakeFirst();

        if (existingOrg) {
          orgId = existingOrg.id;
          orgName = existingOrg.name;

          // Update missing or passed location/sector/department fields if passed
          const orgUpdates: any = {};
          if (dto.city && (!existingOrg.city || existingOrg.city !== dto.city.trim())) orgUpdates.city = dto.city.trim();
          if (dto.state && (!existingOrg.state || existingOrg.state !== dto.state.trim())) orgUpdates.state = dto.state.trim();
          if (dto.zone_id && (!existingOrg.zone_id || existingOrg.zone_id !== dto.zone_id)) orgUpdates.zone_id = dto.zone_id;
          if (dto.region_id && (!existingOrg.region_id || existingOrg.region_id !== dto.region_id)) orgUpdates.region_id = dto.region_id;
          if (dto.sector && (!existingOrg.sector || existingOrg.sector !== dto.sector.trim())) orgUpdates.sector = dto.sector.trim();
          if (dto.department && (!(existingOrg as any).department || (existingOrg as any).department !== dto.department.trim())) {
            orgUpdates.department = dto.department.trim();
          }

          if (Object.keys(orgUpdates).length > 0) {
            orgUpdates.updated_at = new Date();
            await trx.updateTable('organisations').set(orgUpdates).where('id', '=', orgId).execute();
          }
        } else {
          const newOrg = await trx
            .insertInto('organisations')
            .values({
              name: orgName,
              city: dto.city?.trim() || null,
              state: dto.state?.trim() || null,
              zone_id: dto.zone_id || null,
              region_id: dto.region_id || null,
              sector: dto.sector?.trim() || null,
              department: dto.department?.trim() || null,
              is_govt: true,
              created_by: user.id,
            })
            .returning(['id', 'name'])
            .executeTakeFirstOrThrow();
          orgId = newOrg.id;
          orgName = newOrg.name;
        }
      }

      // Handle Primary Contact Person
      let contactId = dto.primary_contact_id || null;
      if (contactId) {
        const contact = await trx
          .selectFrom('contacts')
          .selectAll()
          .where('id', '=', contactId)
          .where('organisation_id', '=', orgId)
          .executeTakeFirst();
        if (!contact) {
          throw new BadRequestException('Specified contact person does not belong to this organisation');
        }
        const contactUpdates: any = {};
        if (dto.contact_designation && contact.designation !== dto.contact_designation.trim()) contactUpdates.designation = dto.contact_designation.trim();
        if (dto.contact_mobile && contact.mobile !== dto.contact_mobile.trim()) contactUpdates.mobile = dto.contact_mobile.trim();
        if (dto.contact_email && contact.email !== dto.contact_email.trim()) contactUpdates.email = dto.contact_email.trim();
        if (Object.keys(contactUpdates).length > 0) {
          await trx.updateTable('contacts').set(contactUpdates).where('id', '=', contactId).execute();
        }
      } else if (dto.contact_name?.trim()) {
        const existingContact = await trx
          .selectFrom('contacts')
          .selectAll()
          .where('organisation_id', '=', orgId)
          .where(sql<boolean>`lower(trim(full_name)) = lower(trim(${dto.contact_name.trim()}))`)
          .executeTakeFirst();

        if (existingContact) {
          contactId = existingContact.id;
          const contactUpdates: any = {};
          if (dto.contact_designation && existingContact.designation !== dto.contact_designation.trim()) contactUpdates.designation = dto.contact_designation.trim();
          if (dto.contact_mobile && existingContact.mobile !== dto.contact_mobile.trim()) contactUpdates.mobile = dto.contact_mobile.trim();
          if (dto.contact_email && existingContact.email !== dto.contact_email.trim()) contactUpdates.email = dto.contact_email.trim();
          if (Object.keys(contactUpdates).length > 0) {
            await trx.updateTable('contacts').set(contactUpdates).where('id', '=', contactId).execute();
          }
        } else {
          const newContact = await trx
            .insertInto('contacts')
            .values({
              organisation_id: orgId,
              full_name: dto.contact_name.trim(),
              designation: dto.contact_designation?.trim() || null,
              mobile: dto.contact_mobile?.trim() || null,
              email: dto.contact_email?.trim() || null,
              is_primary: true,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          contactId = newContact.id;
        }
      }

      // Derive Fresh vs Re-Approached
      const priorInteractionsCount = await trx
        .selectFrom('interactions')
        .select(sql<number>`count(id)::int`.as('count'))
        .where('organisation_id', '=', orgId)
        .executeTakeFirst();

      const hasPriorInteractions = (priorInteractionsCount?.count || 0) > 0;
      const derivedType: LeadType = dto.lead_type || (hasPriorInteractions ? 're_approached' : 'fresh');

      // Determine lead category: explicitly provided or contextual
      let assignedCategory: LeadCategory = 'new_lead';
      if (dto.category) {
        assignedCategory = (dto.category === ('new' as any) ? 'new_lead' : dto.category) as LeadCategory;
      } else if (leadStatus === 'new') {
        assignedCategory = 'new_lead';
      } else if (['qualified', 'demo', 'proposal', 'tender_discussion', 'negotiation'].includes(leadStatus)) {
        assignedCategory = 'active';
      } else {
        assignedCategory = 'follow_up';
      }

      // Insert Lead
      const lead = await trx
        .insertInto('leads')
        .values({
          organisation_id: orgId,
          primary_contact_id: contactId,
          product_id: primaryProductId,
          department: dto.department?.trim() || null,
          source: dto.source || 'Direct',
          category: assignedCategory,
          probability: dto.probability || 'medium',
          channel: dto.channel || 'direct',
          status: initialStatus,
          lead_status: leadStatus,
          lead_type: derivedType,
          loss_reason: dto.loss_reason || null,
          last_interaction_at: lastInteractionAt,
          last_contact_date: lastInteractionDate,
          next_followup_at: nextFollowupAt,
          next_followup_date: nextFollowupDate,
          assigned_to: assignedTo,
          regional_manager_id: rmId,
          bill_qtr: dto.bill_qtr || null,
          qty: dto.qty || null,
          quot_price: dto.quot_price || null,
          order_price: dto.order_price || null,
          value_lakh:
            dto.value_lakh !== undefined && dto.value_lakh !== null
              ? dto.value_lakh
              : dto.estimated_value_lakh !== undefined && dto.estimated_value_lakh !== null
              ? dto.estimated_value_lakh
              : dto.estimated_value !== undefined && dto.estimated_value !== null
              ? Number(dto.estimated_value) > 1000
                ? Number(dto.estimated_value) / 100000
                : Number(dto.estimated_value)
              : null,
          booking_month: dto.booking_month || null,
          billing_month: dto.billing_month || null,
          order_status: dto.order_status || null,
          remarks: dto.remarks || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Product Interests
      for (const pid of productIds) {
        await trx
          .insertInto('lead_product_interests')
          .values({
            lead_id: lead.id,
            product_id: pid,
            created_by: user.id,
          })
          .onConflict((oc) => oc.columns(['lead_id', 'product_id']).doNothing())
          .execute();
      }

      // Initial interaction record
      const interaction = await trx
        .insertInto('interactions')
        .values({
          organisation_id: orgId,
          contact_id: contactId,
          lead_id: lead.id,
          type: dto.last_interaction_type || 'call',
          employee_id: user.id,
          occurred_on: lastInteractionDate,
          remarks:
            dto.last_interaction_notes ||
            dto.remarks ||
            `Opportunity registered [${derivedType.toUpperCase()}]: Initial touchpoint logged.`,
          outcome: 'Lead registered in pipeline',
          next_action: nextFollowupDate ? `Scheduled follow-up for ${nextFollowupDate}` : null,
          followup_date: nextFollowupDate,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // If next follow-up date was set, create a follow-up record
      if (nextFollowupDate) {
        await trx
          .insertInto('follow_ups')
          .values({
            organisation_id: orgId,
            contact_id: contactId,
            lead_id: lead.id,
            interaction_id: interaction.id,
            assigned_to: assignedTo,
            due_date: nextFollowupDate,
            status: 'pending',
            remarks: dto.remarks ? `Follow-up: ${dto.remarks}` : 'Initial follow-up scheduled on lead creation',
          })
          .execute();
      }

      // Enqueue domain event: LeadCreated
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.LEAD_CREATED,
        aggregateType: 'LEAD',
        aggregateId: lead.id,
        actorId: user.id,
        payload: {
          leadId: lead.id,
          organisationId: lead.organisation_id,
          leadType: derivedType,
          leadStatus: leadStatus,
          assignedTo,
          regionalManagerId: rmId,
          organisationName: orgName,
        },
      });

      // If re-approached, also enqueue LeadReApproached event
      if (derivedType === 're_approached') {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.LEAD_RE_APPROACHED,
          aggregateType: 'LEAD',
          aggregateId: lead.id,
          actorId: user.id,
          payload: {
            leadId: lead.id,
            organisationId: lead.organisation_id,
            assignedTo,
            regionalManagerId: rmId,
            organisationName: orgName,
          },
        });
      }

      return lead;
    });

    this.outboxService.triggerImmediate();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'lead',
      entityId: result.id,
      action: 'create',
      newValue: result,
    });

    return this.findOne(result.id, user);
  }

  async update(id: string, dto: UpdateLeadDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    const { estimated_value_lakh, estimated_value, ...cleanDto } = dto;
    const resolvedValueLakh =
      dto.value_lakh !== undefined
        ? dto.value_lakh
        : estimated_value_lakh !== undefined
        ? estimated_value_lakh
        : estimated_value !== undefined
        ? Number(estimated_value) > 1000
          ? Number(estimated_value) / 100000
          : Number(estimated_value)
        : undefined;

    const updated = await this.db
      .updateTable('leads')
      .set({
        ...cleanDto,
        value_lakh: resolvedValueLakh,
        category: dto.category ? ((dto.category === ('new' as any) ? 'new_lead' : dto.category) as LeadCategory) : undefined,
        lead_status: dto.lead_status || (dto.status ? (dto.status.toLowerCase() as any) : undefined),
        status: dto.status || (dto.lead_status ? dto.lead_status : undefined),
        next_followup_at: dto.next_followup_date ? new Date(dto.next_followup_date) : undefined,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'lead',
      entityId: id,
      action: 'update',
      previousValue: existing,
      newValue: updated,
    });

    return this.findOne(id, user);
  }

  async changeStatus(id: string, dto: ChangeLeadStatusDto, user: AuthUser) {
    const lead = await this.findOne(id, user);
    const fromStatus = (lead.lead_status || lead.status || 'new').toLowerCase();
    const toStatus = dto.status.toLowerCase();

    // 1. Validate transition
    this.workflowService.validateTransition(fromStatus, toStatus, user.role, dto.loss_reason);

    // 2. Execute transition in transaction
    const result = await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('leads')
        .set({
          lead_status: toStatus as LeadStatus,
          status: toStatus,
          loss_reason: toStatus === 'lost' ? (dto.loss_reason as any) : null,
          last_interaction_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Log status change as an interaction
      await trx
        .insertInto('interactions')
        .values({
          organisation_id: lead.organisation_id,
          contact_id: lead.primary_contact_id || null,
          lead_id: id,
          type: toStatus === 'demo' ? 'demo' : toStatus === 'proposal' ? 'proposal' : 'follow_up',
          employee_id: user.id,
          occurred_on: new Date().toISOString().split('T')[0],
          remarks: `Status updated to ${toStatus.toUpperCase()}${dto.loss_reason ? ` (Reason: ${dto.loss_reason})` : ''}. ${dto.remarks || ''}`.trim(),
          outcome: `Stage progressed from ${fromStatus} to ${toStatus}`,
          next_action: toStatus === 'converted' ? 'Initiate customer onboarding and proposal fulfillment' : null,
        })
        .execute();

      // Domain Event: LeadStatusChanged
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.LEAD_STATUS_CHANGED,
        aggregateType: 'LEAD',
        aggregateId: id,
        actorId: user.id,
        payload: {
          leadId: id,
          organisationId: lead.organisation_id,
          fromStatus,
          toStatus,
          lossReason: dto.loss_reason,
          assignedTo: lead.assigned_to,
          regionalManagerId: lead.regional_manager_id,
        },
      });

      // Special Domain Events
      if (toStatus === 'converted') {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.LEAD_CONVERTED,
          aggregateType: 'LEAD',
          aggregateId: id,
          actorId: user.id,
          payload: {
            leadId: id,
            organisationId: lead.organisation_id,
            assignedTo: lead.assigned_to,
            valueLakh: lead.value_lakh,
          },
        });
      } else if (toStatus === 'lost') {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.LEAD_LOST,
          aggregateType: 'LEAD',
          aggregateId: id,
          actorId: user.id,
          payload: {
            leadId: id,
            organisationId: lead.organisation_id,
            lossReason: dto.loss_reason,
            assignedTo: lead.assigned_to,
          },
        });
      }

      return updated;
    });

    this.outboxService.triggerImmediate();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'lead',
      entityId: id,
      action: 'status_change',
      previousValue: { status: fromStatus },
      newValue: { status: toStatus, loss_reason: dto.loss_reason },
    });

    return result;
  }

  async assign(id: string, dto: AssignLeadDto, user: AuthUser) {
    // Only management, regional_manager, or admin can reassign
    if (!['management', 'admin', 'regional_manager'].includes(user.role)) {
      throw new ForbiddenException('Only managers and administrators can assign or reassign leads.');
    }

    const lead = await this.findOne(id, user);

    // Verify new salesperson
    const newSalesperson = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'reporting_manager_id', 'is_active'])
      .where('id', '=', dto.assigned_to)
      .executeTakeFirst();

    if (!newSalesperson) {
      throw new NotFoundException(`Salesperson with id '${dto.assigned_to}' not found`);
    }

    const prevSalespersonId = lead.assigned_to;
    const newRmId = dto.regional_manager_id || newSalesperson.reporting_manager_id || lead.regional_manager_id;
    const prevRmId = lead.regional_manager_id;

    const result = await this.db.transaction().execute(async (trx) => {
      // Record assignment history
      await trx
        .insertInto('lead_assignment_history')
        .values({
          lead_id: id,
          previous_salesperson_id: prevSalespersonId,
          new_salesperson_id: dto.assigned_to,
          previous_regional_manager_id: prevRmId,
          new_regional_manager_id: newRmId,
          changed_by: user.id,
          reason: dto.reason || 'Lead reassigned by management',
        })
        .execute();

      // Update lead
      const updated = await trx
        .updateTable('leads')
        .set({
          assigned_to: dto.assigned_to,
          regional_manager_id: newRmId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Queue domain event: LeadAssigned
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.LEAD_ASSIGNED,
        aggregateType: 'LEAD',
        aggregateId: id,
        actorId: user.id,
        payload: {
          leadId: id,
          organisationId: lead.organisation_id,
          previousSalespersonId: prevSalespersonId,
          newSalespersonId: dto.assigned_to,
          previousRegionalManagerId: prevRmId,
          newRegionalManagerId: newRmId,
          reason: dto.reason,
        },
      });

      return updated;
    });

    this.outboxService.triggerImmediate();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'lead',
      entityId: id,
      action: 'reassign',
      previousValue: { assigned_to: prevSalespersonId },
      newValue: { assigned_to: dto.assigned_to, reason: dto.reason },
    });

    return result;
  }

  async addProductInterest(leadId: string, productId: string, user: AuthUser) {
    const lead = await this.findOne(leadId, user);

    const product = await this.db
      .selectFrom('products')
      .select('id')
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException(`Product with id '${productId}' not found`);
    }

    const existing = await this.db
      .selectFrom('lead_product_interests')
      .select('id')
      .where('lead_id', '=', leadId)
      .where('product_id', '=', productId)
      .executeTakeFirst();

    if (existing) {
      return { message: 'Product already added to interest list', id: existing.id };
    }

    const inserted = await this.db
      .insertInto('lead_product_interests')
      .values({
        lead_id: leadId,
        product_id: productId,
        created_by: user.id,
      })
      .onConflict((oc) => oc.columns(['lead_id', 'product_id']).doNothing())
      .returningAll()
      .executeTakeFirstOrThrow();

    // If lead has no primary product_id set, update it
    if (!lead.product_id) {
      await this.db
        .updateTable('leads')
        .set({ product_id: productId, updated_at: new Date() })
        .where('id', '=', leadId)
        .execute();
    }

    return inserted;
  }

  async removeProductInterest(leadId: string, productId: string, user: AuthUser) {
    await this.findOne(leadId, user);

    const deleted = await this.db
      .deleteFrom('lead_product_interests')
      .where('lead_id', '=', leadId)
      .where((eb) =>
        eb.or([
          eb('product_id', '=', productId),
          eb('id', '=', productId),
        ]),
      )
      .returningAll()
      .executeTakeFirst();

    if (!deleted) {
      throw new NotFoundException('Product interest relationship not found');
    }

    return { success: true };
  }

  async getDashboard(user: AuthUser) {
    let baseLeads = this.db
      .selectFrom('leads')
      .leftJoin('organisations', 'leads.organisation_id', 'organisations.id');

    if (user.role === 'sales') {
      baseLeads = baseLeads.where('leads.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      baseLeads = baseLeads.where((eb) =>
        eb.or([
          eb('organisations.region_id', '=', user.region_id),
          eb('leads.regional_manager_id', '=', user.id),
          eb('leads.assigned_to', '=', user.id),
        ]),
      );
    }

    const today = new Date().toISOString().split('T')[0];

    const stats = await baseLeads
      .select([
        sql<number>`count(leads.id)::int`.as('total_leads'),
        sql<number>`count(case when coalesce(leads.lead_type, 'fresh') = 'fresh' then 1 end)::int`.as('fresh_leads'),
        sql<number>`count(case when leads.lead_type = 're_approached' then 1 end)::int`.as('re_approached_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status, 'new')) = 'new' then 1 end)::int`.as('new_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'contacted' then 1 end)::int`.as('contacted'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'qualified' then 1 end)::int`.as('qualified'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'follow_up' then 1 end)::int`.as('follow_up'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'demo' then 1 end)::int`.as('demo'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'proposal' then 1 end)::int`.as('proposal'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'tender_discussion' then 1 end)::int`.as('tender_discussion'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'negotiation' then 1 end)::int`.as('negotiation'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('converted', 'won') then 1 end)::int`.as('converted'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('lost', 'dropped') then 1 end)::int`.as('lost'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) = 'on_hold' then 1 end)::int`.as('on_hold'),
        sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('pipeline_value_lakh'),
      ])
      .executeTakeFirst();

    // Follow-ups summary
    let followUpQuery = this.db
      .selectFrom('follow_ups')
      .leftJoin('organisations', 'follow_ups.organisation_id', 'organisations.id');

    if (user.role === 'sales') {
      followUpQuery = followUpQuery.where('follow_ups.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      followUpQuery = followUpQuery.where('organisations.region_id', '=', user.region_id);
    }

    const followUpStats = await followUpQuery
      .select([
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date = ${today}::date then 1 end)::int`.as('due_today'),
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date < ${today}::date then 1 end)::int`.as('overdue'),
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date > ${today}::date then 1 end)::int`.as('upcoming'),
        sql<number>`count(case when follow_ups.status = 'completed' then 1 end)::int`.as('completed'),
      ])
      .executeTakeFirst();

    // Customer accounts count (territorially scoped if regional manager)
    let orgQuery = this.db.selectFrom('organisations');
    if (user.role === 'regional_manager' && user.region_id) {
      orgQuery = orgQuery.where('organisations.region_id', '=', user.region_id);
    }
    const orgStats = await orgQuery
      .select(sql<number>`count(distinct organisations.id)::int`.as('total_customers'))
      .executeTakeFirst();
    const totalCustomers = Number(orgStats?.total_customers) || 0;

    const totalLeads = Number(stats?.total_leads) || 0;
    const freshLeads = Number(stats?.fresh_leads) || 0;
    const reApproachedLeads = Number(stats?.re_approached_leads) || 0;
    const convertedLeads = Number(stats?.converted) || 0;
    const lostLeads = Number(stats?.lost) || 0;
    const activeLeads = Math.max(0, totalLeads - convertedLeads - lostLeads);
    const pipelineValueLakh = Math.round((Number(stats?.pipeline_value_lakh) || 0) * 100) / 100;

    const dueToday = Number(followUpStats?.due_today) || 0;
    const overdue = Number(followUpStats?.overdue) || 0;
    const upcoming = Number(followUpStats?.upcoming) || 0;
    const completed = Number(followUpStats?.completed) || 0;

    return {
      // Top-level counts for direct card bindings (both snake_case and camelCase)
      total_leads: totalLeads,
      totalLeads,
      total_customers: totalCustomers,
      totalCustomers,
      total_organisations: totalCustomers,
      fresh_leads: freshLeads,
      freshLeads,
      reapproached_leads: reApproachedLeads,
      re_approached_leads: reApproachedLeads,
      reApproachedLeads,
      active_leads: activeLeads,
      activeLeads,
      converted_leads: convertedLeads,
      convertedLeads,
      lost_leads: lostLeads,
      lostLeads,
      pipeline_value_lakh: pipelineValueLakh,
      pipelineValueLakh,
      followups_due_today: dueToday,
      followupsDueToday: dueToday,
      followups_overdue: overdue,
      followupsOverdue: overdue,

      // Nested metrics preserving contract for e2e tests & intelligence reporting
      metrics: {
        totalLeads,
        totalCustomers,
        freshLeads,
        reApproachedLeads,
        activeLeads,
        pipelineValueLakh,
        byStatus: {
          new: Number(stats?.new_leads) || 0,
          contacted: Number(stats?.contacted) || 0,
          qualified: Number(stats?.qualified) || 0,
          follow_up: Number(stats?.follow_up) || 0,
          demo: Number(stats?.demo) || 0,
          proposal: Number(stats?.proposal) || 0,
          tender_discussion: Number(stats?.tender_discussion) || 0,
          negotiation: Number(stats?.negotiation) || 0,
          converted: convertedLeads,
          lost: lostLeads,
          on_hold: Number(stats?.on_hold) || 0,
        },
        followUps: {
          dueToday,
          overdue,
          upcoming,
          completed,
        },
      },
    };
  }

  async getSalespersonReport(user: AuthUser) {
    let query = this.db
      .selectFrom('users')
      .innerJoin('leads', 'leads.assigned_to', 'users.id')
      .leftJoin('regions', 'users.region_id', 'regions.id')
      .where('users.is_active', '=', true);

    if (user.role === 'sales') {
      query = query.where('users.id', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      query = query.where('users.region_id', '=', user.region_id);
    }

    const rows = await query
      .groupBy(['users.id', 'users.full_name', 'regions.name'])
      .select([
        'users.id as salesperson_id',
        'users.full_name as salesperson_name',
        'regions.name as region_name',
        sql<number>`count(leads.id)::int`.as('total_leads'),
        sql<number>`count(case when coalesce(leads.lead_type, 'fresh') = 'fresh' then 1 end)::int`.as('fresh_leads'),
        sql<number>`count(case when leads.lead_type = 're_approached' then 1 end)::int`.as('re_approached_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) not in ('converted', 'won', 'lost', 'dropped') then 1 end)::int`.as('active_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('converted', 'won') then 1 end)::int`.as('converted_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('lost', 'dropped') then 1 end)::int`.as('lost_leads'),
        sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('total_pipeline_lakh'),
      ])
      .orderBy('total_leads', 'desc')
      .execute();

    return rows;
  }

  async getZoneReport(user: AuthUser) {
    let query = this.db
      .selectFrom('zones')
      .innerJoin('organisations', 'organisations.zone_id', 'zones.id')
      .innerJoin('leads', 'leads.organisation_id', 'organisations.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id');

    if (user.role === 'regional_manager' && user.region_id) {
      query = query.where('organisations.region_id', '=', user.region_id);
    }

    const rows = await query
      .groupBy(['zones.id', 'zones.name', 'zones.code', 'regions.id', 'regions.name'])
      .select([
        'zones.id as zone_id',
        'zones.name as zone_name',
        'zones.code as zone_code',
        'regions.id as region_id',
        'regions.name as region_name',
        sql<number>`count(leads.id)::int`.as('total_leads'),
        sql<number>`count(case when coalesce(leads.lead_type, 'fresh') = 'fresh' then 1 end)::int`.as('fresh_leads'),
        sql<number>`count(case when leads.lead_type = 're_approached' then 1 end)::int`.as('re_approached_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) not in ('converted', 'won', 'lost', 'dropped') then 1 end)::int`.as('active_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('converted', 'won') then 1 end)::int`.as('converted_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('lost', 'dropped') then 1 end)::int`.as('lost_leads'),
      ])
      .orderBy('zones.name', 'asc')
      .execute();

    return rows;
  }

  async getProductReport(user: AuthUser) {
    // Count both leads.product_id and lead_product_interests, using union or distinct lead_id
    const rows = await this.db
      .selectFrom('products')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('leads')
            .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
            .select([
              'leads.id as lead_id',
              'leads.product_id as p_id',
              'leads.lead_status',
              'leads.status',
              'leads.value_lakh',
            ])
            .as('direct_leads'),
        (join) => join.onRef('direct_leads.p_id', '=', 'products.id'),
      )
      .groupBy(['products.id', 'products.name', 'products.category'])
      .select([
        'products.id as product_id',
        'products.name as product_name',
        'products.category as product_category',
        sql<number>`count(distinct direct_leads.lead_id)::int`.as('total_leads'),
        sql<number>`count(distinct case when lower(coalesce(direct_leads.lead_status, direct_leads.status)) not in ('converted', 'won', 'lost', 'dropped') then direct_leads.lead_id end)::int`.as('active_leads'),
        sql<number>`count(distinct case when lower(coalesce(direct_leads.lead_status, direct_leads.status)) in ('converted', 'won') then direct_leads.lead_id end)::int`.as('converted_leads'),
        sql<number>`coalesce(sum(direct_leads.value_lakh), 0)::float`.as('pipeline_value_lakh'),
      ])
      .orderBy('total_leads', 'desc')
      .execute();

    return rows.filter((r) => r.total_leads > 0);
  }

  async getInteractionReport(
    query: {
      from_date?: string;
      to_date?: string;
      employee_id?: string;
      organisation_id?: string;
    },
    user: AuthUser,
  ) {
    let baseQuery = this.db
      .selectFrom('interactions')
      .innerJoin('organisations', 'interactions.organisation_id', 'organisations.id')
      .leftJoin('users', 'interactions.employee_id', 'users.id');

    if (user.role === 'sales') {
      baseQuery = baseQuery.where('interactions.employee_id', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
    }

    if (query.from_date) {
      baseQuery = baseQuery.where('interactions.occurred_on', '>=', query.from_date);
    }

    if (query.to_date) {
      baseQuery = baseQuery.where('interactions.occurred_on', '<=', query.to_date);
    }

    if (query.employee_id) {
      baseQuery = baseQuery.where('interactions.employee_id', '=', query.employee_id);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('interactions.organisation_id', '=', query.organisation_id);
    }

    const byType = await baseQuery
      .groupBy('interactions.type')
      .select([
        'interactions.type as interaction_type',
        sql<number>`count(interactions.id)::int`.as('count'),
      ])
      .orderBy('count', 'desc')
      .execute();

    const byEmployee = await baseQuery
      .groupBy(['users.id', 'users.full_name'])
      .select([
        'users.id as employee_id',
        'users.full_name as employee_name',
        sql<number>`count(interactions.id)::int`.as('total_interactions'),
      ])
      .orderBy('total_interactions', 'desc')
      .execute();

    return {
      byType,
      byEmployee,
    };
  }
}
