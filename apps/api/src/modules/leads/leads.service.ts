import { calendarDay, todayInKolkata } from '../../common/utils/ist-date.util.js';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { assertRegionScope } from '../../common/utils/scope.util.js';
import { LeadWorkflowService } from './leads.workflow.js';
import { organisationScope } from '../organisations/organisation-scope.js';
import {
  cleanOrgText,
  isOrgDuplicateError,
  orgDedupeLockKey,
  orgDuplicateConflict,
  sameOrgNameAndCity,
} from '../organisations/organisation-dedupe.js';
import { resolveLocation } from '../organisations/india-geo.js';
import { CLOSED_LEAD_STATUSES } from '@arihant/shared';
import type { Database, AuthUser, PaginatedResult, LeadStatus, LeadCategory, LeadType, UserRole } from '@arihant/shared';
import type {
  CreateLeadDto,
  UpdateLeadDto,
  ChangeLeadStatusDto,
  AssignLeadDto,
  LeadFilterQueryDto,
  LeadListQueryDto,
} from './leads.dto.js';
import { containsPattern } from '../../common/utils/like-pattern.js';

/** Roles a lead may be owned by: the field sales team and Regional Managers (QA DEF-060). */
const LEAD_OWNER_ROLES: UserRole[] = ['sales', 'regional_manager'];
/** Closed lead statuses as a SQL text[] parameter (see CLOSED_LEAD_STATUSES). */
const CLOSED_STATUS_LIST: string[] = [...CLOSED_LEAD_STATUSES];
/** A lead's stage, lower-cased: `lead_status`, else the legacy `status`; a lead with neither is new. */
const LEAD_STAGE = sql<string>`lower(coalesce(leads.lead_status, leads.status, 'new'))`;
/** Open (not closed) leads — the active-lead definition behind the counts. */
const LEAD_IS_OPEN = sql<boolean>`${LEAD_STAGE} <> all(${CLOSED_STATUS_LIST}::text[])`;
/** Stages whose count folds in a legacy status, so filtering by the stage lists what its card counts. */
const LEAD_STAGE_ALIASES: Record<string, string[]> = { converted: ['converted', 'won'], lost: ['lost', 'dropped'] };
/** Follow-up filters answered from the follow-up queue: the due date of a pending follow-up versus today. */
const FOLLOWUP_DUE_OPERATOR: Record<string, '=' | '<' | '>'> = { due_today: '=', overdue: '<', upcoming: '>' };

/** A lead source as a slug: lower case, each run of other characters one underscore ('GeM / Direct' → gem_direct). */
const sourceSlug = (source: string) => source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const LEAD_SOURCE_SLUG = sql<string>`trim(both '_' from regexp_replace(lower(leads.source), '[^a-z0-9]+', '_', 'g'))`;

/** A filter dimension a KPI count represents (and so ignores, see filteredLeadsQuery). */
type LeadFilterDimension = 'status' | 'lead_type' | 'followup';

/** The lead is in this stage (aliases included). */
const leadStatusIs = (status: string) => {
  const target = status.toLowerCase();
  return sql<boolean>`${LEAD_STAGE} = any(${LEAD_STAGE_ALIASES[target] ?? [target]}::text[])`;
};

/** The lead is of this type; a lead without one is fresh. */
const leadTypeIs = (type: string) => sql<boolean>`coalesce(leads.lead_type, 'fresh') = ${type}`;

/**
 * Follow-up status of a lead, from the follow-up queue (Module 1 §7: pending follow-ups, overdue once past their due
 * date). due_today / overdue / upcoming count open leads only; no_followup is a lead with no pending follow-up.
 */
const leadFollowupIs = (followup: string, today: string) => {
  if (followup === 'no_followup') {
    return sql<boolean>`not exists (select 1 from follow_ups fu where fu.lead_id = leads.id and fu.status = 'pending')`;
  }
  const op = FOLLOWUP_DUE_OPERATOR[followup];
  if (!op) return null;
  return sql<boolean>`(${LEAD_IS_OPEN} and exists (select 1 from follow_ups fu where fu.lead_id = leads.id and fu.status = 'pending' and fu.due_date ${sql.raw(op)} ${today}::date))`;
};

/** Roles that may supervise a lead as its Regional Manager. */
const LEAD_RM_ROLES: UserRole[] = ['regional_manager', 'management'];
/** A double-submitted form arrives within this window; the second request returns the lead the first one created. */
const DUPLICATE_SUBMIT_WINDOW_SECONDS = 30;

/** Mobile number as stored: the 10-digit national number (spaces, hyphens and the +91 / 0 prefix removed). */
const normaliseMobile = (mobile: string) => mobile.replace(/\D/g, '').slice(-10);

@Injectable()
export class LeadsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly outboxService: OutboxService,
    private readonly workflowService: LeadWorkflowService,
  ) {}

  /**
   * The lead register query: role territory scope plus every active filter. The list and its KPI counts
   * (getDashboard) both start here, so a card always counts what clicking it lists. `omit` drops the one filter
   * dimension a count represents (status counts ignore the status filter, so picking one stage keeps the others).
   */
  private filteredLeadsQuery(query: LeadFilterQueryDto, user: AuthUser, omit?: LeadFilterDimension) {
    let baseQuery = this.db
      .selectFrom('leads')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .leftJoin('contacts', 'leads.primary_contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .leftJoin('users as rm', 'leads.regional_manager_id', 'rm.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id')
      .leftJoin('zones', 'organisations.zone_id', 'zones.id');

    // Role territory scoping — a Regional Manager also sees the leads of their direct reports (scope ⊇ team)
    if (user.role === 'sales') {
      baseQuery = baseQuery.where('leads.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      if (user.region_id) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb('organisations.region_id', '=', user.region_id),
            eb('leads.regional_manager_id', '=', user.id),
            eb('leads.assigned_to', '=', user.id),
            eb('assignee.reporting_manager_id', '=', user.id),
          ]),
        );
      }
    }

    if (query.search) {
      const s = containsPattern(query.search);
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

    const statusTarget = query.lead_status || query.status;
    if (statusTarget && omit !== 'status') {
      baseQuery = baseQuery.where(leadStatusIs(statusTarget));
    }

    if (query.lead_type && omit !== 'lead_type') {
      baseQuery = baseQuery.where(leadTypeIs(query.lead_type));
    }

    if (query.category) {
      baseQuery = baseQuery.where('leads.category', '=', query.category as any);
    }

    if (query.probability) {
      baseQuery = baseQuery.where('leads.probability', '=', query.probability as any);
    }

    // Sources are matched as slugs, so legacy labels ('Field Visit', 'GeM / Direct') match field_visit / gem_direct
    if (query.source) {
      baseQuery = baseQuery.where(sql<boolean>`${LEAD_SOURCE_SLUG} = ${sourceSlug(query.source)}`);
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

    if (query.followup && omit !== 'followup') {
      const condition = leadFollowupIs(query.followup, todayInKolkata());
      if (condition) baseQuery = baseQuery.where(condition);
    }

    return baseQuery;
  }

  async findAll(query: LeadListQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const baseQuery = this.filteredLeadsQuery(query, user);

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
        'assignee.reporting_manager_id as assignee_reporting_manager_id',
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
      if (
        lead.regional_manager_id !== user.id &&
        lead.assigned_to !== user.id &&
        lead.assignee_reporting_manager_id !== user.id
      ) {
        assertRegionScope(user, lead.region_id, lead.zone_id);
      }
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
    const allowedTransitions = this.workflowService.getAllowedTransitions(
      currentStatus,
      user.role,
      await this.hasReachedCommercialStage(id),
    );
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

  /**
   * True once the lead has been through a commercial stage (proposal / tender discussion / negotiation) — recorded
   * by changeStatus as an interaction outcome "Stage progressed from X to Y" — or has a proposal raised against it.
   * Unlocks negotiation / conversion from the follow-up, demo and on-hold side stages (QA DEF-097).
   */
  private async hasReachedCommercialStage(leadId: string): Promise<boolean> {
    const stage = await this.db
      .selectFrom('interactions')
      .select('id')
      .where('lead_id', '=', leadId)
      .where(sql<boolean>`outcome ~ ' to (proposal|tender_discussion|negotiation)$'`)
      .executeTakeFirst();
    if (stage) return true;
    const proposal = await this.db
      .selectFrom('proposals')
      .select('id')
      .where('lead_id', '=', leadId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    return Boolean(proposal);
  }

  /**
   * Calendar rules for a lead's dates, all in IST (QA DEF-057, DEF-058): the last interaction cannot be in the future,
   * and the next follow-up must be today or later and not before the last interaction.
   */
  private assertLeadDates(lastInteractionDate: string | null, nextFollowupDate: string | null) {
    const today = todayInKolkata();
    const last = calendarDay(lastInteractionDate);
    const next = calendarDay(nextFollowupDate);
    if (last && last > today) {
      throw new BadRequestException('Last interaction date cannot be in the future.');
    }
    if (next && next < today) {
      throw new BadRequestException('Next follow-up date cannot be in the past — choose today or a later date.');
    }
    if (next && last && next < last) {
      throw new BadRequestException('Next follow-up date cannot be before the last interaction date.');
    }
  }

  /**
   * Who may own / supervise a new lead (QA DEF-060, DEF-100):
   * - sales            → only themselves;
   * - regional_manager → themselves or an active salesperson in their team / region;
   * - management/admin → any active salesperson or Regional Manager (or themselves).
   * The Regional Manager must be an active Regional Manager (or management); by default it is the owner's manager.
   */
  private async resolveLeadOwnership(dto: { assigned_to?: string; regional_manager_id?: string }, user: AuthUser) {
    const assignedTo = dto.assigned_to || user.id;
    if (user.role === 'sales' && assignedTo !== user.id) {
      throw new ForbiddenException('Sales executives can register leads only in their own name.');
    }

    const assignee = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'role', 'reporting_manager_id', 'region_id', 'is_active'])
      .where('id', '=', assignedTo)
      .executeTakeFirst();
    if (!assignee || !assignee.is_active) {
      throw new BadRequestException('The selected salesperson does not exist or is inactive.');
    }
    if (assignee.id !== user.id && !LEAD_OWNER_ROLES.includes(assignee.role as UserRole)) {
      throw new BadRequestException(`${assignee.full_name} is not in the sales team — a lead can be assigned only to a salesperson or Regional Manager.`);
    }
    if (
      user.role === 'regional_manager' &&
      assignee.id !== user.id &&
      assignee.reporting_manager_id !== user.id &&
      (!user.region_id || assignee.region_id !== user.region_id)
    ) {
      throw new ForbiddenException(`${assignee.full_name} is not in your team — assign the lead to one of your salespeople.`);
    }

    const rmId = dto.regional_manager_id || assignee.reporting_manager_id || null;
    if (dto.regional_manager_id) {
      const rm = await this.db
        .selectFrom('users')
        .select(['id', 'full_name', 'role', 'is_active'])
        .where('id', '=', dto.regional_manager_id)
        .executeTakeFirst();
      if (!rm || !rm.is_active || !LEAD_RM_ROLES.includes(rm.role as UserRole)) {
        throw new BadRequestException('The selected Regional Manager is not an active Regional Manager.');
      }
    }

    return { assignedTo, rmId };
  }

  /**
   * A lead registered against an EXISTING account only completes it: location / territory / sector / department
   * that the account does not have yet are taken from the form, but values already on the account are never
   * overwritten by the rep's entry (the account register is the source of truth, Module 1 §3.1).
   * A city is not filled in when it would turn the account into a duplicate of another unit of the same name.
   */
  private async fillEmptyOrganisationFields(
    trx: Transaction<Database>,
    org: {
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      zone_id: string | null;
      region_id: string | null;
      sector: string | null;
      department: string | null;
    },
    location: { city: string | null; state: string | null } | null,
    dto: CreateLeadDto,
  ) {
    const updates: Record<string, unknown> = {};
    if (location?.city && !org.city?.trim() && (!org.state || !location.state || org.state === location.state)) {
      const clash = await trx
        .selectFrom('organisations')
        .select('id')
        .where('id', '<>', org.id)
        .where(sameOrgNameAndCity(org.name, location.city))
        .executeTakeFirst();
      if (!clash) updates.city = location.city;
    }
    if (location?.state && !org.state?.trim()) updates.state = location.state;
    if (dto.zone_id && !org.zone_id) updates.zone_id = dto.zone_id;
    if (dto.region_id && !org.region_id) updates.region_id = dto.region_id;
    if (dto.sector?.trim() && !org.sector?.trim()) updates.sector = dto.sector.trim();
    if (dto.department?.trim() && !org.department?.trim()) updates.department = dto.department.trim();

    if (Object.keys(updates).length > 0) {
      await trx
        .updateTable('organisations')
        .set({ ...updates, updated_at: new Date() })
        .where('id', '=', org.id)
        .execute();
    }
  }

  async create(dto: CreateLeadDto, user: AuthUser) {
    if (!dto.organisation_id && !dto.organisation_name?.trim()) {
      throw new BadRequestException('Organisation name is required');
    }

    // A new lead starts at the beginning of the lifecycle; later stages are reached through it (QA DEF-059)
    const requestedStatus = (dto.lead_status || dto.status || 'new').toLowerCase();
    if (!this.workflowService.INITIAL_STATUSES.includes(requestedStatus)) {
      throw new BadRequestException(
        'A new lead can only be registered as New, Contacted or Qualified. Use the lifecycle actions on the lead to progress it further.',
      );
    }

    this.assertLeadDates(dto.last_interaction_date || todayInKolkata(), dto.next_followup_date || null);

    // Location: valid state, and a well-known city must sit in that state (QA DEF-099)
    let location: { city: string | null; state: string | null } | null = null;
    if (dto.city !== undefined || dto.state !== undefined) {
      const resolved = resolveLocation(dto.city, dto.state);
      if (resolved.error) {
        throw new BadRequestException(resolved.error);
      }
      location = resolved;
    }

    // 1. Resolve assigned salesperson and regional manager
    const { assignedTo, rmId } = await this.resolveLeadOwnership(dto, user);
    const contactMobile = dto.contact_mobile?.trim() ? normaliseMobile(dto.contact_mobile) : null;

    // 2. Resolve primary product ID and product list
    const productIds = new Set<string>();
    if (dto.product_id) productIds.add(dto.product_id);
    if (dto.product_ids && Array.isArray(dto.product_ids)) {
      for (const pid of dto.product_ids) {
        if (pid) productIds.add(pid);
      }
    }
    const primaryProductId = dto.product_id || (productIds.size > 0 ? Array.from(productIds)[0] : null);

    const leadStatus = requestedStatus as LeadStatus;
    const initialStatus = leadStatus;

    const lastInteractionDate = dto.last_interaction_date || todayInKolkata();
    const lastInteractionAt = new Date(lastInteractionDate);
    const nextFollowupDate = dto.next_followup_date || null;
    const nextFollowupAt = nextFollowupDate ? new Date(nextFollowupDate) : null;

    const valueLakh =
      dto.value_lakh !== undefined && dto.value_lakh !== null
        ? dto.value_lakh
        : dto.estimated_value_lakh !== undefined && dto.estimated_value_lakh !== null
        ? dto.estimated_value_lakh
        : dto.estimated_value !== undefined && dto.estimated_value !== null
        ? Number(dto.estimated_value) > 1000
          ? Number(dto.estimated_value) / 100000
          : Number(dto.estimated_value)
        : null;

    // 3. Execute within a transactional boundary
    let duplicateOf: string | null = null;
    const typedOrgName = cleanOrgText(dto.organisation_name);
    const orgCity = location?.city ?? null;
    const result = await this.db.transaction().execute(async (trx) => {
      let orgId = dto.organisation_id;
      let orgName = typedOrgName;

      // Serialise registrations for the same account so a double-clicked submit (QA DEF-012) or two people typing the
      // same new organisation cannot create two leads / two organisations side by side.
      const lockKey = `lead-create:${orgId || orgDedupeLockKey(orgName, orgCity)}`;
      await sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`.execute(trx);

      // The same user registering the same opportunity again within a few seconds is a repeated submit: hand back the
      // lead the first request created instead of a second copy.
      const recent = await trx
        .selectFrom('leads')
        .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
        .select('leads.id')
        .where('leads.assigned_to', '=', assignedTo)
        .where(sql<boolean>`leads.created_at > now() - make_interval(secs => ${DUPLICATE_SUBMIT_WINDOW_SECONDS})`)
        .where((eb) =>
          orgId
            ? eb('leads.organisation_id', '=', orgId)
            : sameOrgNameAndCity(orgName, orgCity),
        )
        .where(sql<boolean>`leads.product_id is not distinct from ${primaryProductId}::uuid`)
        .where(sql<boolean>`leads.value_lakh is not distinct from ${valueLakh}::numeric`)
        .where(sql<boolean>`leads.next_followup_date is not distinct from ${nextFollowupDate}::date`)
        .where(sql<boolean>`leads.remarks is not distinct from ${dto.remarks || null}::text`)
        .orderBy('leads.created_at', 'desc')
        .executeTakeFirst();
      if (recent) {
        duplicateOf = recent.id;
        return null;
      }

      if (orgId) {
        const existingOrg = await trx
          .selectFrom('organisations')
          .selectAll()
          .where('id', '=', orgId)
          .executeTakeFirst();

        if (!existingOrg) {
          throw new NotFoundException(`Organisation with id '${orgId}' not found`);
        }
        orgName = existingOrg.name;
        await this.fillEmptyOrganisationFields(trx, existingOrg, location, dto);
      } else {
        // Find the existing account by name + city (case / spacing-insensitive deduplication) or create a new one
        const existingOrg = await trx
          .selectFrom('organisations')
          .selectAll()
          .where(sameOrgNameAndCity(orgName, orgCity))
          .orderBy('created_at', 'asc')
          .executeTakeFirst();

        if (existingOrg) {
          orgId = existingOrg.id;
          orgName = existingOrg.name;
          await this.fillEmptyOrganisationFields(trx, existingOrg, location, dto);
        } else {
          // A brand-new account must name the officer the opportunity is with (QA DEF-056)
          if (!dto.primary_contact_id && !dto.contact_name?.trim()) {
            throw new BadRequestException('Contact person name is required for a new organisation.');
          }
          const newOrg = await trx
            .insertInto('organisations')
            .values({
              name: orgName,
              city: location?.city || null,
              state: location?.state || null,
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
        if (contactMobile && contact.mobile !== contactMobile) contactUpdates.mobile = contactMobile;
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
          if (contactMobile && existingContact.mobile !== contactMobile) contactUpdates.mobile = contactMobile;
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
              mobile: contactMobile,
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
          value_lakh: valueLakh,
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
    }).catch((err) => {
      // Two registrations racing to create the same name + city account (QA DEF-012): a friendly 409, not raw SQL detail
      if (isOrgDuplicateError(err)) throw orgDuplicateConflict(typedOrgName, orgCity);
      throw err;
    });

    if (!result) {
      return this.findOne(duplicateOf!, user);
    }

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

    // The stage only moves through the lifecycle (PATCH /leads/:id/status), never through a plain edit
    const currentStatus = (existing.lead_status || existing.status || 'new').toLowerCase();
    const editedStatus = (dto.lead_status || dto.status || '').toLowerCase();
    if (editedStatus && editedStatus !== currentStatus) {
      throw new BadRequestException("Use the lead's lifecycle actions to change its stage.");
    }
    // Ownership only changes through reassignment (PATCH /leads/:id/assign), which records the history
    if (
      (dto.assigned_to && dto.assigned_to !== existing.assigned_to) ||
      (dto.regional_manager_id && dto.regional_manager_id !== existing.regional_manager_id)
    ) {
      throw new BadRequestException('Use Reassign to change the salesperson or Regional Manager of a lead.');
    }
    if (dto.next_followup_date) {
      this.assertLeadDates(existing.last_contact_date ? calendarDay(existing.last_contact_date as any) : null, dto.next_followup_date);
    }

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
    this.workflowService.validateTransition(fromStatus, toStatus, user.role, dto.loss_reason, {
      commercialStageReached: await this.hasReachedCommercialStage(id),
      poReference: dto.po_reference,
    });
    // CONVERTED and legacy WON are both wins: same PO / order date / order value handling
    const isWin = this.workflowService.isWinStatus(toStatus);
    if (isWin && dto.order_date && calendarDay(dto.order_date)! > todayInKolkata()) {
      throw new BadRequestException('Order date cannot be in the future.');
    }
    const poReference = dto.po_reference?.trim() || null;
    const winDetails =
      isWin
        ? ` Won on PO / supply order ${poReference}${dto.order_date ? ` dated ${dto.order_date}` : ''}${
            dto.order_value_lakh ? ` for ₹${dto.order_value_lakh} Lakh` : ''
          }.`
        : '';
    const lossDetails = toStatus === 'lost' && dto.loss_remarks?.trim() ? ` ${dto.loss_remarks.trim()}` : '';

    // 2. Execute transition in transaction
    const result = await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('leads')
        .set({
          lead_status: toStatus as LeadStatus,
          status: toStatus,
          loss_reason: toStatus === 'lost' ? (dto.loss_reason as any) : null,
          // Win details on the lead (Module 1 §6); the order value / date go to the interaction ledger and audit log
          ...(isWin
            ? { order_status: `PO Received — ${poReference}` }
            : {}),
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
          occurred_on: todayInKolkata(),
          remarks: `Status updated to ${toStatus.toUpperCase()}${dto.loss_reason ? ` (Reason: ${dto.loss_reason})` : ''}.${lossDetails}${winDetails} ${dto.remarks || ''}`.trim(),
          outcome: `Stage progressed from ${fromStatus} to ${toStatus}`,
          next_action: isWin ? 'Initiate customer onboarding and proposal fulfillment' : null,
        })
        .execute();

      // Contacting the lead fulfils any pending follow-ups on it, keeping the Follow-ups Desk in sync
      if (toStatus === 'contacted') {
        const completedFollowUps = await trx
          .updateTable('follow_ups')
          .set({
            status: 'completed',
            outcome: 'Lead marked as Contacted',
            completed_at: new Date(),
            completed_by: user.id,
            updated_at: new Date(),
          })
          .where('lead_id', '=', id)
          .where('status', '=', 'pending')
          .returning('id')
          .execute();

        if (completedFollowUps.length > 0) {
          await trx
            .updateTable('leads')
            .set({ next_followup_at: null, next_followup_date: null })
            .where('id', '=', id)
            .execute();

          for (const fu of completedFollowUps) {
            await this.outboxService.queueEvent(trx, {
              eventType: AppEvents.FOLLOWUP_COMPLETED,
              aggregateType: 'FOLLOW_UP',
              aggregateId: fu.id,
              actorId: user.id,
              payload: {
                followUpId: fu.id,
                leadId: id,
                organisationId: lead.organisation_id,
                outcome: 'Lead marked as Contacted',
                completedBy: user.id,
              },
            });
          }
        }
      }

      // A lost lead has nothing left to follow up: its pending follow-ups are cancelled (QA DEF-096)
      if (toStatus === 'lost' || toStatus === 'dropped') {
        const cancelled = await trx
          .updateTable('follow_ups')
          .set({
            status: 'cancelled',
            remarks: sql<string>`trim(coalesce(remarks, '') || ${`\nCancelled: lead marked ${toStatus.toUpperCase()}${dto.loss_reason ? ` (${dto.loss_reason})` : ''}`})`,
            updated_at: new Date(),
          })
          .where('lead_id', '=', id)
          .where('status', '=', 'pending')
          .returning('id')
          .execute();
        if (cancelled.length > 0) {
          await trx
            .updateTable('leads')
            .set({ next_followup_at: null, next_followup_date: null })
            .where('id', '=', id)
            .execute();
        }
      }

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
          actorId: user.id,
        },
      });

      // Special Domain Events
      if (isWin) {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.LEAD_CONVERTED,
          aggregateType: 'LEAD',
          aggregateId: id,
          actorId: user.id,
          payload: {
            leadId: id,
            organisationId: lead.organisation_id,
            assignedTo: lead.assigned_to,
            valueLakh: dto.order_value_lakh ?? lead.value_lakh,
            poReference,
            orderDate: dto.order_date || null,
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
      newValue: {
        status: toStatus,
        loss_reason: dto.loss_reason,
        ...(isWin ? { po_reference: poReference, order_value_lakh: dto.order_value_lakh, order_date: dto.order_date } : {}),
      },
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

  /**
   * Lead KPI counts under the register's filters (the same query as findAll). Each count ignores only the filter
   * dimension it represents: stage counts ignore the stage filter, fresh / re-approached the type filter, follow-up
   * counts the follow-up filter. Totals and pipeline value apply every filter, so total_leads equals the list total.
   */
  async getDashboard(query: LeadFilterQueryDto, user: AuthUser) {
    const today = todayInKolkata();
    const countWhere = (condition: RawBuilder<boolean>) => sql<number>`count(case when ${condition} then 1 end)::int`;

    const [totals, typeStats, stats, leadFollowUps] = await Promise.all([
      this.filteredLeadsQuery(query, user)
        .select([
          sql<number>`count(leads.id)::int`.as('total_leads'),
          sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('pipeline_value_lakh'),
        ])
        .executeTakeFirst(),
      this.filteredLeadsQuery(query, user, 'lead_type')
        .select([
          countWhere(leadTypeIs('fresh')).as('fresh_leads'),
          countWhere(leadTypeIs('re_approached')).as('re_approached_leads'),
        ])
        .executeTakeFirst(),
      this.filteredLeadsQuery(query, user, 'status')
        .select([
          countWhere(LEAD_IS_OPEN).as('active_leads'),
          countWhere(leadStatusIs('new')).as('new_leads'),
          countWhere(leadStatusIs('contacted')).as('contacted'),
          countWhere(leadStatusIs('qualified')).as('qualified'),
          countWhere(leadStatusIs('follow_up')).as('follow_up'),
          countWhere(leadStatusIs('demo')).as('demo'),
          countWhere(leadStatusIs('proposal')).as('proposal'),
          countWhere(leadStatusIs('tender_discussion')).as('tender_discussion'),
          countWhere(leadStatusIs('negotiation')).as('negotiation'),
          countWhere(leadStatusIs('converted')).as('converted'),
          countWhere(leadStatusIs('lost')).as('lost'),
          countWhere(leadStatusIs('on_hold')).as('on_hold'),
        ])
        .executeTakeFirst(),
      this.filteredLeadsQuery(query, user, 'followup')
        .select([
          countWhere(leadFollowupIs('due_today', today)!).as('due_today'),
          countWhere(leadFollowupIs('overdue', today)!).as('overdue'),
          countWhere(leadFollowupIs('upcoming', today)!).as('upcoming'),
        ])
        .executeTakeFirst(),
    ]);

    // Customer accounts count — the same territorial scope as the Customer Register list (QA DEF-034)
    let orgQuery = this.db.selectFrom('organisations').where('organisations.id', '<>', '00000000-0000-4000-8000-0000000000a1');
    const orgScope = organisationScope(user);
    if (orgScope) {
      orgQuery = orgQuery.where(orgScope);
    }
    const orgStats = await orgQuery
      .select(sql<number>`count(distinct organisations.id)::int`.as('total_customers'))
      .executeTakeFirst();
    const totalCustomers = Number(orgStats?.total_customers) || 0;

    const totalLeads = Number(totals?.total_leads) || 0;
    const freshLeads = Number(typeStats?.fresh_leads) || 0;
    const reApproachedLeads = Number(typeStats?.re_approached_leads) || 0;
    const convertedLeads = Number(stats?.converted) || 0;
    const lostLeads = Number(stats?.lost) || 0;
    const activeLeads = Number(stats?.active_leads) || 0;
    const pipelineValueLakh = Math.round((Number(totals?.pipeline_value_lakh) || 0) * 100) / 100;

    // Leads with a pending follow-up in the queue — the same definition as the `followup` list filter
    const dueToday = Number(leadFollowUps?.due_today) || 0;
    const overdue = Number(leadFollowUps?.overdue) || 0;
    const upcoming = Number(leadFollowUps?.upcoming) || 0;

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
        },
      },
    };
  }

  /*
   * Executive Intelligence Reports. Sales see their own pipeline, Regional Managers their region and team, everyone
   * else the whole country (QA DEF-052). Field names match the Reports tab (re-approached, follow-up counts …).
   */
  async getSalespersonReport(user: AuthUser) {
    const today = todayInKolkata();
    let query = this.db
      .selectFrom('users')
      .innerJoin('leads', 'leads.assigned_to', 'users.id')
      .leftJoin('regions', 'users.region_id', 'regions.id')
      .where('users.is_active', '=', true);

    if (user.role === 'sales') {
      query = query.where('users.id', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      query = query.where((eb) =>
        eb.or([
          eb('users.region_id', '=', user.region_id),
          eb('users.reporting_manager_id', '=', user.id),
          eb('users.id', '=', user.id),
        ]),
      );
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
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) <> all(${CLOSED_STATUS_LIST}::text[]) then 1 end)::int`.as('active_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('converted', 'won') then 1 end)::int`.as('converted_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('lost', 'dropped') then 1 end)::int`.as('lost_leads'),
        sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('total_pipeline_lakh'),
        sql<number>`(select count(*)::int from follow_ups f where f.assigned_to = users.id and f.status = 'pending')`.as('pending_followups'),
        sql<number>`(select count(*)::int from follow_ups f where f.assigned_to = users.id and f.status = 'pending' and f.due_date < ${today}::date)`.as('overdue_followups'),
      ])
      .orderBy('total_leads', 'desc')
      .execute();

    return rows.map((r) => ({ ...r, reapproached_leads: r.re_approached_leads }));
  }

  async getZoneReport(user: AuthUser) {
    let query = this.db
      .selectFrom('zones')
      .innerJoin('organisations', 'organisations.zone_id', 'zones.id')
      .innerJoin('leads', 'leads.organisation_id', 'organisations.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id');

    if (user.role === 'sales') {
      query = query.where('leads.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      query = query.where((eb) =>
        eb.or([
          eb('organisations.region_id', '=', user.region_id),
          eb('leads.regional_manager_id', '=', user.id),
          eb('leads.assigned_to', '=', user.id),
          eb('assignee.reporting_manager_id', '=', user.id),
        ]),
      );
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
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) <> all(${CLOSED_STATUS_LIST}::text[]) then 1 end)::int`.as('active_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('converted', 'won') then 1 end)::int`.as('converted_leads'),
        sql<number>`count(case when lower(coalesce(leads.lead_status, leads.status)) in ('lost', 'dropped') then 1 end)::int`.as('lost_leads'),
      ])
      .orderBy('zones.name', 'asc')
      .execute();

    return rows.map((r) => ({ ...r, reapproached_leads: r.re_approached_leads }));
  }

  async getProductReport(user: AuthUser) {
    // Count both leads.product_id and lead_product_interests, using union or distinct lead_id
    const rows = await this.db
      .selectFrom('products')
      .leftJoin(
        (eb) => {
          let scoped = eb
            .selectFrom('leads')
            .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
            .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id');
          if (user.role === 'sales') {
            scoped = scoped.where('leads.assigned_to', '=', user.id);
          } else if (user.role === 'regional_manager' && user.region_id) {
            scoped = scoped.where((w) =>
              w.or([
                w('organisations.region_id', '=', user.region_id),
                w('leads.regional_manager_id', '=', user.id),
                w('leads.assigned_to', '=', user.id),
                w('assignee.reporting_manager_id', '=', user.id),
              ]),
            );
          }
          return scoped
            .select([
              'leads.id as lead_id',
              'leads.product_id as p_id',
              'leads.lead_status',
              'leads.status',
              'leads.value_lakh',
            ])
            .as('direct_leads');
        },
        (join) => join.onRef('direct_leads.p_id', '=', 'products.id'),
      )
      .groupBy(['products.id', 'products.name', 'products.category'])
      .select([
        'products.id as product_id',
        'products.name as product_name',
        'products.category as product_category',
        'products.category as category',
        sql<number>`count(distinct direct_leads.lead_id)::int`.as('total_leads'),
        sql<number>`count(distinct case when lower(coalesce(direct_leads.lead_status, direct_leads.status)) <> all(${CLOSED_STATUS_LIST}::text[]) then direct_leads.lead_id end)::int`.as('active_leads'),
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
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('organisations.region_id', '=', user.region_id),
          eb('interactions.employee_id', '=', user.id),
          eb('users.reporting_manager_id', '=', user.id),
        ]),
      );
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
        sql<number>`count(interactions.id)::int`.as('total_interactions'),
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
