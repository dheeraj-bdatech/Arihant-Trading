import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, Transaction } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import {
  PROPOSAL_INACTIVITY_DAYS,
  type Database,
  type AuthUser,
  type PaginatedResult,
  type ProposalStatus,
} from '@arihant/shared';
import { ProposalsWorkflowService, type ProposalSettingsConfig } from './proposals.workflow.js';
import { AppEvents } from '../../common/events/event-names.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { ProposalTimelineProjection } from './consumers/timeline.projection.js';
import {
  CreateProposalDto,
  UpdateProposalDto,
  StartPreparationDto,
  SubmitForReviewDto,
  ApproveProposalDto,
  RequestChangesDto,
  ReviseInternalDto,
  SendProposalDto,
  FastTrackSendDto,
  RequestRevisionDto,
  MarkConvertedDto,
  MarkLostDto,
  CloseProposalDto,
  ReopenProposalDto,
  CreateProposalFollowupDto,
  PostponeFollowUpDto,
  CreateProposalVersionDto,
  ReassignProposalDto,
  BulkReassignDto,
  ProposalQueryDto,
  ProposalSettingsDto,
  ImportProposalSheetDto,
} from './proposals.dto.js';

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowService: ProposalsWorkflowService,
    private readonly outboxService: OutboxService,
    private readonly timelineProjection: ProposalTimelineProjection,
  ) {}

  /**
   * Helper to normalize statuses in SQL matching
   */
  private getStatusArray(status: string): string[] {
    const norm = this.workflowService.normalizeStatus(status);
    const legacyMap: Record<string, string[]> = {
      REQUESTED: ['REQUESTED', 'PROPOSAL_REQUESTED', 'requested'],
      PROPOSAL_REQUESTED: ['REQUESTED', 'PROPOSAL_REQUESTED', 'requested'],
      UNDER_PREPARATION: ['UNDER_PREPARATION', 'under_preparation'],
      READY_FOR_REVIEW: ['READY_FOR_REVIEW', 'ready_for_review'],
      APPROVED: ['APPROVED', 'approved'],
      SENT_TO_CUSTOMER: ['SENT_TO_CUSTOMER', 'sent'],
      FOLLOW_UP_REQUIRED: ['FOLLOW_UP_REQUIRED', 'followup_required'],
      CONVERTED: ['CONVERTED', 'converted'],
      CLOSED: ['CLOSED', 'closed'],
      LOST: ['LOST', 'lost'],
    };
    return legacyMap[norm] || [norm];
  }

  /**
   * Sanitize text input: trim whitespace, strip html, empty strings to null (E10)
   */
  private sanitizeText(val: string | null | undefined): string | null {
    if (val === undefined || val === null) return null;
    const trimmed = val.trim();
    if (trimmed.length === 0) return null;
    // Strip script and dangerous HTML tags
    return trimmed.replace(/<[^>]*>?/gm, '');
  }

  /**
   * Fetch current system settings for proposals
   */
  async getSettings(): Promise<any> {
    let settings = await this.db
      .selectFrom('proposal_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();

    if (!settings) {
      await this.db
        .insertInto('proposal_settings')
        .values({ id: 1 })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      settings = await this.db
        .selectFrom('proposal_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
    }
    return settings;
  }

  /**
   * Update proposal settings (admin only)
   */
  async updateSettings(dto: ProposalSettingsDto, user: AuthUser): Promise<any> {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only admin or management can update proposal settings');
    }

    await this.db
      .updateTable('proposal_settings')
      .set({
        ...dto,
        updated_at: new Date(),
      })
      .where('id', '=', 1)
      .execute();

    return this.getSettings();
  }

  /**
   * List proposals with server-side search, filtering, territorial scoping, and sorting
   */
  async findAll(query: ProposalQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const settings = await this.getSettings();

    let baseQuery = this.db
      .selectFrom('proposals')
      .innerJoin('organisations', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.customer_id', '=', eb.ref('organisations.id')),
            eb('proposals.organisation_id', '=', eb.ref('organisations.id')),
          ]),
        ),
      )
      .leftJoin('products', 'proposals.product_id', 'products.id')
      .leftJoin('users as requested_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.requested_by_id', '=', eb.ref('requested_user.id')),
            eb('proposals.requested_by', '=', eb.ref('requested_user.id')),
          ]),
        ),
      )
      .leftJoin('users as responsible_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.responsible_person_id', '=', eb.ref('responsible_user.id')),
            eb('proposals.responsible_id', '=', eb.ref('responsible_user.id')),
          ]),
        ),
      )
      .leftJoin('users as followup_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.follow_up_owner_id', '=', eb.ref('followup_user.id')),
            eb('proposals.followup_owner_id', '=', eb.ref('followup_user.id')),
          ]),
        ),
      )
      .where('proposals.is_deleted', '=', false);

    // Row-level visibility scoping (E49, 7.3)
    const role = (user.role || '').toLowerCase();
    const isGlobal = role === 'admin' || role === 'management';
    if (!isGlobal) {
      if (role === 'regional_manager' && user.region_id) {
        baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
      } else {
        baseQuery = baseQuery.where((eb) => {
          const conds = [
            eb('proposals.responsible_person_id', '=', user.id),
            eb('proposals.responsible_id', '=', user.id),
            eb('proposals.requested_by_id', '=', user.id),
            eb('proposals.requested_by', '=', user.id),
            eb('proposals.follow_up_owner_id', '=', user.id),
            eb('proposals.followup_owner_id', '=', user.id),
          ];
          if (user.region_id) {
            conds.push(eb('organisations.region_id', '=', user.region_id));
          }
          return eb.or(conds);
        });
      }
    }

    // Status filter
    if (query.status && query.status !== 'all') {
      const statuses = this.getStatusArray(query.status);
      baseQuery = baseQuery.where('proposals.status', 'in', statuses as any);
    }

    // Customer filter
    const custId = query.customer_id || query.organisation_id;
    if (custId) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([eb('proposals.customer_id', '=', custId), eb('proposals.organisation_id', '=', custId)]),
      );
    }

    // Product filter
    if (query.product_id) {
      baseQuery = baseQuery.where('proposals.product_id', '=', query.product_id);
    }

    // Sector / Department filter
    const sectorVal = query.sector || query.sectorId;
    if (query.sector_id) {
      baseQuery = baseQuery.where('proposals.sector_id', '=', query.sector_id);
    } else if (sectorVal && sectorVal !== 'all') {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sectorVal);
      if (isUUID) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([eb('proposals.sector', '=', sectorVal), eb('proposals.sector_id', '=', sectorVal)]),
        );
      } else {
        baseQuery = baseQuery.where('proposals.sector', '=', sectorVal);
      }
    }

    // Responsible person filter
    const respId = query.responsible_id || query.responsiblePersonId;
    if (respId) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([eb('proposals.responsible_person_id', '=', respId), eb('proposals.responsible_id', '=', respId)]),
      );
    }

    // Follow-up owner filter
    const ownerId = query.follow_up_owner_id || query.followup_owner_id;
    if (ownerId) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([eb('proposals.follow_up_owner_id', '=', ownerId), eb('proposals.followup_owner_id', '=', ownerId)]),
      );
    }

    // Flag filters (E44, 6a-f)
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings?.business_timezone || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    if (query.due_today === 'true' || query.due_today === '1') {
      baseQuery = baseQuery
        .where('proposals.status', 'in', ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'sent', 'followup_required'] as any)
        .where((eb) =>
          eb.or([eb('proposals.next_follow_up_date', '=', today), eb('proposals.next_followup', '=', today)]),
        );
    }

    if (query.overdue === 'true' || query.overdue === '1') {
      baseQuery = baseQuery
        .where('proposals.status', 'in', ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'sent', 'followup_required'] as any)
        .where((eb) =>
          eb.or([eb('proposals.next_follow_up_date', '<', today), eb('proposals.next_followup', '<', today)]),
        );
    }

    if (query.without_follow_up === 'true' || query.without_follow_up === '1') {
      const noFuDays = settings?.no_follow_up_after_days ?? 7;
      baseQuery = baseQuery
        .where('proposals.status', 'in', ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'sent', 'followup_required'] as any)
        .where((eb) =>
          eb.or([
            eb('proposals.next_follow_up_date', 'is', null),
            eb('proposals.follow_up_owner_id', 'is', null),
            eb('proposals.owner_inactive_flag', '=', true),
            eb('proposals.follow_up_count', '=', 0),
          ]),
        );
    }

    if (query.stale === 'true' || query.stale === '1') {
      baseQuery = baseQuery
        .where('proposals.status', 'not in', ['CONVERTED', 'LOST', 'CLOSED', 'converted', 'lost', 'closed'] as any)
        .where(sql<boolean>`proposals.last_activity_at <= NOW() - make_interval(days => ${PROPOSAL_INACTIVITY_DAYS})`);
    }

    if (query.urgent === 'true' || query.urgent === '1') {
      baseQuery = baseQuery.where('proposals.is_urgent', '=', true);
    }

    if (query.sent_late === 'true' || query.sent_late === '1') {
      baseQuery = baseQuery.where('proposals.sent_late', '=', true);
    }

    if (query.owner_inactive === 'true' || query.owner_inactive === '1') {
      baseQuery = baseQuery.where('proposals.owner_inactive_flag', '=', true);
    }

    // Date range filters
    if (query.from_request_date) baseQuery = baseQuery.where('proposals.request_date', '>=', query.from_request_date);
    if (query.to_request_date) baseQuery = baseQuery.where('proposals.request_date', '<=', query.to_request_date);
    if (query.from_required_date) baseQuery = baseQuery.where('proposals.required_date', '>=', query.from_required_date);
    if (query.to_required_date) baseQuery = baseQuery.where('proposals.required_date', '<=', query.to_required_date);
    if (query.from_sent_date) baseQuery = baseQuery.where('proposals.sent_date', '>=', query.from_sent_date);
    if (query.to_sent_date) baseQuery = baseQuery.where('proposals.sent_date', '<=', query.to_sent_date);
    if (query.from_next_follow_up) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('proposals.next_follow_up_date', '>=', query.from_next_follow_up!),
          eb('proposals.next_followup', '>=', query.from_next_follow_up!),
        ]),
      );
    }
    if (query.to_next_follow_up) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('proposals.next_follow_up_date', '<=', query.to_next_follow_up!),
          eb('proposals.next_followup', '<=', query.to_next_follow_up!),
        ]),
      );
    }

    // Free-text search (E10)
    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim().toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`LOWER(proposals.proposal_number) LIKE ${s}`,
          sql<boolean>`LOWER(proposals.proposal_no) LIKE ${s}`,
          sql<boolean>`LOWER(organisations.name) LIKE ${s}`,
          sql<boolean>`LOWER(products.name) LIKE ${s}`,
          sql<boolean>`LOWER(proposals.reference) LIKE ${s}`,
          sql<boolean>`LOWER(proposals.email_reference) LIKE ${s}`,
          sql<boolean>`LOWER(requested_user.full_name) LIKE ${s}`,
          sql<boolean>`LOWER(responsible_user.full_name) LIKE ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(proposals.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const sortField = query.sortBy || query.sort_by;
    let sortBy: any = 'proposals.last_activity_at';
    if (sortField === 'createdAt' || sortField === 'created_at') sortBy = 'proposals.created_at';
    else if (sortField === 'updatedAt' || sortField === 'updated_at') sortBy = 'proposals.updated_at';
    else if (sortField === 'request_date' || sortField === 'requestDate') sortBy = 'proposals.request_date';
    else if (sortField === 'required_date' || sortField === 'requiredDate') sortBy = 'proposals.required_date';
    else if (sortField === 'proposalSentDate' || sortField === 'sent_date' || sortField === 'sentDate') sortBy = 'proposals.sent_date';
    else if (sortField === 'nextFollowUp' || sortField === 'next_follow_up_date' || sortField === 'next_followup' || sortField === 'nextFollowup') sortBy = 'proposals.next_follow_up_date';

    const sortOrder = (query.sortOrder || query.sort_order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const items = await baseQuery
      .select([
        'proposals.id',
        'proposals.proposal_number',
        'proposals.proposal_no',
        'proposals.organisation_id',
        'proposals.customer_id',
        'proposals.lead_id',
        'proposals.product_id',
        'proposals.sector',
        'proposals.sector_id',
        'proposals.requested_by',
        'proposals.requested_by_id',
        'proposals.responsible_id',
        'proposals.responsible_person_id',
        'proposals.followup_owner_id',
        'proposals.follow_up_owner_id',
        'proposals.request_date',
        'proposals.required_date',
        'proposals.sent_date',
        'proposals.approved_at',
        'proposals.approved_by',
        'proposals.approved_by_id',
        'proposals.version',
        'proposals.current_version',
        'proposals.reference',
        'proposals.email_reference',
        'proposals.status',
        'proposals.last_followup',
        'proposals.last_follow_up_at',
        'proposals.next_followup',
        'proposals.next_follow_up_date',
        'proposals.next_follow_up_time',
        'proposals.review_cycle_count',
        'proposals.is_urgent',
        'proposals.sent_late',
        'proposals.outcome',
        'proposals.outcome_date',
        'proposals.lost_reason',
        'proposals.lost_reason_code',
        'proposals.lost_reason_text',
        'proposals.closure_reason_code',
        'proposals.closure_reason_text',
        'proposals.conversion_reference',
        'proposals.last_activity_at',
        'proposals.follow_up_count',
        'proposals.postpone_count',
        'proposals.owner_inactive_flag',
        'proposals.row_version',
        'proposals.remarks',
        'proposals.created_at',
        'proposals.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as organisation_city',
        'products.name as product_name',
        'requested_user.full_name as requested_by_name',
        'responsible_user.full_name as responsible_name',
        'followup_user.full_name as followup_owner_name',
      ])
      .orderBy(sortBy as any, sortOrder)
      .limit(limit)
      .offset(offset)
      .execute();

    // Attach calculated allowed_transitions for current user
    const enriched = items.map((p) => ({
      ...p,
      proposal_no: p.proposal_no || p.proposal_number,
      allowed_transitions: this.workflowService.getAllowedTransitions(p, user, settings),
    }));

    return buildPaginatedResult(enriched, total, page, limit);
  }

  /**
   * Find single proposal by ID with full relations, allowed_transitions and history
   */
  async findOne(id: string, user?: AuthUser): Promise<any> {
    const proposal = await this.db
      .selectFrom('proposals')
      .selectAll('proposals')
      .innerJoin('organisations', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.customer_id', '=', eb.ref('organisations.id')),
            eb('proposals.organisation_id', '=', eb.ref('organisations.id')),
          ]),
        ),
      )
      .leftJoin('products', 'proposals.product_id', 'products.id')
      .leftJoin('users as requested_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.requested_by_id', '=', eb.ref('requested_user.id')),
            eb('proposals.requested_by', '=', eb.ref('requested_user.id')),
          ]),
        ),
      )
      .leftJoin('users as responsible_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.responsible_person_id', '=', eb.ref('responsible_user.id')),
            eb('proposals.responsible_id', '=', eb.ref('responsible_user.id')),
          ]),
        ),
      )
      .leftJoin('users as followup_user', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.follow_up_owner_id', '=', eb.ref('followup_user.id')),
            eb('proposals.followup_owner_id', '=', eb.ref('followup_user.id')),
          ]),
        ),
      )
      .select([
        'organisations.name as organisation_name',
        'organisations.city as organisation_city',
        'organisations.region_id as organisation_region_id',
        'products.name as product_name',
        'requested_user.full_name as requested_by_name',
        'responsible_user.full_name as responsible_name',
        'followup_user.full_name as followup_owner_name',
      ])
      .where('proposals.id', '=', id)
      .where('proposals.is_deleted', '=', false)
      .executeTakeFirst();

    if (!proposal) {
      throw new NotFoundException(`Proposal not found`);
    }

    // Row-level scoping check (E64: 404 if outside user's scope)
    if (user) {
      const role = (user.role || '').toLowerCase();
      const isGlobal = role === 'admin' || role === 'management';
      if (!isGlobal) {
        if (role === 'regional_manager' && user.region_id) {
          if ((proposal as any).organisation_region_id !== user.region_id) {
            throw new NotFoundException(`Proposal not found`);
          }
        } else {
          const isParty =
            proposal.responsible_person_id === user.id ||
            proposal.responsible_id === user.id ||
            proposal.requested_by_id === user.id ||
            proposal.requested_by === user.id ||
            proposal.follow_up_owner_id === user.id ||
            proposal.followup_owner_id === user.id;
          if (!isParty && (proposal as any).organisation_region_id !== user.region_id) {
            throw new NotFoundException(`Proposal not found`);
          }
        }
      }
    }

    const settings = await this.getSettings();

    // Fetch products
    const products = await this.db
      .selectFrom('proposal_products')
      .innerJoin('products', 'proposal_products.product_id', 'products.id')
      .select([
        'proposal_products.id',
        'proposal_products.product_id',
        'proposal_products.is_primary',
        'products.name as product_name',
        'products.category as product_category',
      ])
      .where('proposal_products.proposal_id', '=', id)
      .execute();

    // Fetch versions
    const versions = await this.db
      .selectFrom('proposal_versions')
      .selectAll()
      .where('proposal_id', '=', id)
      .orderBy('version_no', 'desc')
      .execute();

    // Fetch follow-ups
    const followups = await this.db
      .selectFrom('proposal_follow_ups')
      .leftJoin('users', 'proposal_follow_ups.logged_by', 'users.id')
      .select([
        'proposal_follow_ups.id',
        'proposal_follow_ups.proposal_id',
        'proposal_follow_ups.contact_date',
        'proposal_follow_ups.mode',
        'proposal_follow_ups.contact_person',
        'proposal_follow_ups.summary',
        'proposal_follow_ups.response',
        'proposal_follow_ups.next_follow_up_date',
        'proposal_follow_ups.is_postpone',
        'proposal_follow_ups.postpone_reason',
        'proposal_follow_ups.logged_by',
        'proposal_follow_ups.created_at',
        'proposal_follow_ups.edited_at',
        'users.full_name as logged_by_name',
      ])
      .where('proposal_id', '=', id)
      .orderBy('contact_date', 'desc')
      .execute();

    // Fetch timeline
    const timeline = await this.db
      .selectFrom('proposal_timeline')
      .leftJoin('users', 'proposal_timeline.actor_id', 'users.id')
      .select([
        'proposal_timeline.id',
        'proposal_timeline.event_type',
        'proposal_timeline.category',
        'proposal_timeline.title',
        'proposal_timeline.description',
        'proposal_timeline.metadata',
        'proposal_timeline.occurred_at',
        'users.full_name as actor_name',
      ])
      .where('proposal_id', '=', id)
      .orderBy('occurred_at', 'desc')
      .execute();

    // Fetch status history
    const history = await this.db
      .selectFrom('proposal_status_history')
      .leftJoin('users', 'proposal_status_history.actor_id', 'users.id')
      .select([
        'proposal_status_history.id',
        'proposal_status_history.from_status',
        'proposal_status_history.to_status',
        'proposal_status_history.reason',
        'proposal_status_history.occurred_at',
        'users.full_name as actor_name',
      ])
      .where('proposal_id', '=', id)
      .orderBy('occurred_at', 'desc')
      .execute();

    return {
      ...proposal,
      proposal_no: proposal.proposal_no || proposal.proposal_number,
      products,
      versions,
      followups,
      timeline,
      history,
      allowed_transitions: user
        ? this.workflowService.getAllowedTransitions(proposal, user, settings)
        : [],
    };
  }

  /**
   * Create a new proposal with comprehensive validation and domain event enqueuing (E1-E12)
   */
  async create(dto: CreateProposalDto, user: AuthUser): Promise<any> {
    const settings = await this.getSettings();
    const customerId = dto.customer_id || dto.organisation_id;

    // E6: Customer (organisation) is required and must exist in master data
    if (!customerId) {
      throw new BadRequestException('Customer organisation is required');
    }
    const customer = await this.db
      .selectFrom('organisations')
      .selectAll()
      .where('id', '=', customerId)
      .executeTakeFirst();
    if (!customer) {
      throw new NotFoundException(`Customer organisation not found in master data`);
    }

    // Determine primary and secondary products (E7)
    const productList: { product_id: string; is_primary: boolean }[] = [];
    if (dto.products && dto.products.length > 0) {
      const primaryCount = dto.products.filter((p) => p.is_primary).length;
      if (primaryCount !== 1) {
        throw new BadRequestException('Exactly one primary product must be designated');
      }
      for (const p of dto.products) {
        productList.push({
          product_id: p.product_id,
          is_primary: !!p.is_primary,
        });
      }
    } else if (dto.product_id) {
      productList.push({ product_id: dto.product_id, is_primary: true });
    } else {
      throw new BadRequestException('At least one product is required for proposal');
    }

    // Validate no duplicate products (E7)
    const seenProd = new Set<string>();
    for (const p of productList) {
      if (seenProd.has(p.product_id)) {
        throw new BadRequestException('Duplicate products are not allowed');
      }
      seenProd.add(p.product_id);
    }
    const primaryProduct = productList.find((p) => p.is_primary) || productList[0];

    // E5: Verify all selected products exist in master data
    for (const p of productList) {
      const prodRecord = await this.db
        .selectFrom('products')
        .select('id')
        .where('id', '=', p.product_id)
        .executeTakeFirst();
      if (!prodRecord) {
        throw new NotFoundException(`Product with ID ${p.product_id} not found in master data`);
      }
    }

    // Date validation
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings?.business_timezone || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const requestDate = dto.request_date || today;
    const requiredDate = dto.required_date;

    // E2: Request date cannot be in the future
    if (requestDate > today) {
      throw new BadRequestException('Request date cannot be in the future');
    }

    // E1: Required date cannot be earlier than request date (HTTP 422)
    if (requiredDate < requestDate) {
      throw new HttpException(
        'Required date cannot be before request date (earlier than request date)',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // E4: Lead time urgency check (required_date - request_date <= urgent_days)
    const urgentDays = settings?.urgent_days ?? 1;
    const reqD = new Date(requiredDate);
    const reqstD = new Date(requestDate);
    const diffDays = Math.round((reqD.getTime() - reqstD.getTime()) / (1000 * 60 * 60 * 24));
    const isUrgent = diffDays <= urgentDays;

    // E12: Creating on behalf of someone requires permission
    const requestedById = dto.requested_by_id || dto.requested_by || user.id;
    if (requestedById !== user.id) {
      const role = (user.role || '').toLowerCase();
      const hasOnBehalfPerm = ['admin', 'management', 'regional_manager'].includes(role);
      if (!hasOnBehalfPerm) {
        throw new ForbiddenException('User lacks permission to create proposal on behalf of another person');
      }
      // E5: Ensure requested user exists and is active
      const reqUser = await this.db
        .selectFrom('users')
        .select(['id', 'is_active'])
        .where('id', '=', requestedById)
        .executeTakeFirst();
      if (!reqUser || reqUser.is_active === false) {
        throw new NotFoundException('The requested-by user is inactive or does not exist');
      }
    }

    // Responsible person (E13)
    const responsiblePersonId = dto.responsible_person_id || dto.responsible_id || null;
    if (responsiblePersonId) {
      const respUser = await this.db
        .selectFrom('users')
        .select(['id', 'is_active'])
        .where('id', '=', responsiblePersonId)
        .executeTakeFirst();
      if (!respUser || respUser.is_active === false) {
        throw new NotFoundException('Responsible proposal person not found or inactive');
      }
    }

    // Sector / Department
    let sectorId = dto.sector_id;
    let sector = dto.sector || customer.sector || 'General';
    if (!sectorId && sector) {
      const dept = await this.db
        .selectFrom('departments')
        .select('id')
        .where('code', '=', sector.toLowerCase())
        .executeTakeFirst();
      if (dept) sectorId = dept.id;
    }

    // E8: Duplicate detection
    const duplicateWindowDays = settings?.duplicate_window_days ?? 30;
    const windowStart = new Date(Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const duplicateMatch = await this.db
      .selectFrom('proposals')
      .selectAll()
      .where((eb) =>
        eb.or([eb('customer_id', '=', customerId), eb('organisation_id', '=', customerId)]),
      )
      .where('product_id', '=', primaryProduct.product_id)
      .where('status', 'not in', ['CONVERTED', 'LOST', 'CLOSED', 'converted', 'lost', 'closed'] as any)
      .where('request_date', '>=', windowStart)
      .where('is_deleted', '=', false)
      .executeTakeFirst();

    if (duplicateMatch && !dto.duplicate_override_reason && !dto.related_proposal_id) {
      throw new ConflictException({
        message: `Possible duplicate proposal detected with number ${duplicateMatch.proposal_no || duplicateMatch.proposal_number}. Provide duplicate_override_reason or link as related_proposal_id.`,
        duplicate_detected: true,
        existing_proposal_id: duplicateMatch.id,
        existing_proposal_no: duplicateMatch.proposal_no || duplicateMatch.proposal_number,
      });
    }

    // E9: Concurrency-safe number generation
    const seqResult = await sql<{ next_num: string }>`SELECT nextval('proposal_canonical_seq')::text as next_num`.execute(this.db);
    const seqNum = seqResult.rows[0]?.next_num || `${Date.now().toString().slice(-4)}`;
    const year = new Date().getFullYear();
    const canonicalNo = `PRP-${year}-${seqNum.padStart(5, '0')}`;
    const legacyNumber = `PROP-${year}-${seqNum.padStart(4, '0')}`;

    // Execute atomic transaction: proposal + products + version + outbox
    const createdId = await this.db.transaction().execute(async (trx) => {
      const sanitizedRemarks = this.sanitizeText(dto.remarks);
      const emailRef = this.sanitizeText(dto.email_reference || dto.reference);

      const inserted = await trx
        .insertInto('proposals')
        .values({
          proposal_no: canonicalNo,
          proposal_number: legacyNumber,
          customer_id: customerId,
          organisation_id: customerId,
          lead_id: dto.lead_id || null,
          product_id: primaryProduct.product_id,
          sector_id: sectorId || null,
          sector,
          requested_by_id: requestedById,
          requested_by: requestedById,
          created_by_id: user.id,
          created_by: user.id,
          responsible_person_id: responsiblePersonId,
          responsible_id: responsiblePersonId,
          follow_up_owner_id: dto.follow_up_owner_id || dto.followup_owner_id || null,
          followup_owner_id: dto.follow_up_owner_id || dto.followup_owner_id || null,
          request_date: requestDate,
          required_date: requiredDate,
          sent_date: dto.sent_date || null,
          current_version: 1,
          version: dto.version || 'v1.0',
          email_reference: emailRef,
          reference: emailRef,
          status: 'PROPOSAL_REQUESTED',
          next_follow_up_date: dto.next_follow_up_date || dto.next_followup || null,
          next_followup: dto.next_follow_up_date || dto.next_followup || null,
          remarks: sanitizedRemarks,
          is_urgent: isUrgent,
          review_cycle_count: 0,
          row_version: 1,
          source: 'manual',
          related_proposal_id: dto.related_proposal_id || null,
          last_activity_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Insert proposal_products
      for (const prod of productList) {
        await trx
          .insertInto('proposal_products')
          .values({
            proposal_id: inserted.id,
            product_id: prod.product_id,
            is_primary: prod.is_primary,
            created_at: new Date(),
          })
          .execute();
      }

      // Insert initial version 1
      await trx
        .insertInto('proposal_versions')
        .values({
          proposal_id: inserted.id,
          version_no: 1,
          change_summary: 'Initial proposal request created',
          email_references: JSON.stringify(emailRef ? [emailRef] : []) as any,
          document_links: JSON.stringify([]) as any,
          created_by: user.id,
          created_at: new Date(),
        })
        .execute();

      // Insert status history
      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: inserted.id,
          from_status: null,
          to_status: 'REQUESTED',
          reason: 'Initial proposal creation',
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      // Enqueue domain events in same transaction (E50)
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_REQUESTED,
        aggregateType: 'Proposal',
        aggregateId: inserted.id,
        aggregateSequence: 1,
        actorId: user.id,
        payload: {
          proposalId: inserted.id,
          proposalNo: canonicalNo,
          customerId,
          primaryProductId: primaryProduct.product_id,
          requestedById,
          responsiblePersonId,
          requiredDate,
          isUrgent,
        },
      });

      if (responsiblePersonId) {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.PROPOSAL_ASSIGNED,
          aggregateType: 'Proposal',
          aggregateId: inserted.id,
          aggregateSequence: 2,
          actorId: user.id,
          payload: {
            proposalId: inserted.id,
            proposalNo: canonicalNo,
            oldResponsibleId: null,
            newResponsibleId: responsiblePersonId,
            reason: 'Assigned upon proposal creation',
          },
        });
      }

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_STATUS_CHANGED,
        aggregateType: 'Proposal',
        aggregateId: inserted.id,
        aggregateSequence: responsiblePersonId ? 3 : 2,
        actorId: user.id,
        payload: {
          proposalId: inserted.id,
          fromStatus: null,
          toStatus: 'REQUESTED',
          reason: 'Initial creation',
        },
      });

      return inserted.id;
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    const record: any = await this.findOne(createdId, user);
    if (requiredDate < today) {
      record.warning = 'Required date is already in the past; proposal flagged in Preparation Overdue (E3)';
      record.warnings = [record.warning];
    }
    return record;
  }

  /**
   * Update non-status proposal fields with optimistic locking and invalidation rules (E23, E31, E32, E33, E61)
   */
  async update(id: string, dto: UpdateProposalDto, user: AuthUser): Promise<any> {
    const existing = await this.findOne(id, user);
    const settings = await this.getSettings();

    // E61: Optimistic concurrency locking
    if (dto.row_version !== undefined && dto.row_version !== existing.row_version) {
      throw new ConflictException({
        message: 'The proposal was modified by another user. Please refresh and retry.',
        latest_proposal: existing,
      });
    }

    // E31: Editing terminal proposal is restricted
    if (this.workflowService.isTerminal(existing.status)) {
      if (dto.remarks && !dto.customer_id && !dto.product_id && !dto.sector_id) {
        // Appending remarks is allowed
        const updatedRemarks = existing.remarks
          ? `${existing.remarks}\n[Note by ${user.email}]: ${dto.remarks}`
          : dto.remarks;
        await this.db
          .updateTable('proposals')
          .set({ remarks: updatedRemarks, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
        return this.findOne(id, user);
      }
      throw new ConflictException({
        message: 'Terminal proposal cannot be modified except for remarks appending.',
        allowed_transitions: existing.allowed_transitions,
      });
    }

    // E32: Changing customer after proposal has been dispatched is blocked
    const isDispatched = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'sent', 'followup_required'].includes(
      existing.status,
    );
    const newCustId = dto.customer_id || dto.organisation_id;
    if (isDispatched && newCustId && newCustId !== existing.customer_id && newCustId !== existing.organisation_id) {
      throw new ConflictException('Customer cannot be changed after proposal has been sent to customer');
    }

    // E33: Changing required date before sending requires reason
    if (dto.required_date && dto.required_date !== existing.required_date && !isDispatched) {
      if (!dto.required_date_change_reason) {
        throw new BadRequestException('A reason is mandatory when changing the required completion date');
      }
    }

    // E23: Material edit after approval invalidates approval
    let shouldInvalidateApproval = false;
    if (this.workflowService.normalizeStatus(existing.status) === 'APPROVED') {
      const isCustChanged = newCustId && newCustId !== existing.customer_id;
      const isProductChanged = dto.product_id && dto.product_id !== existing.product_id;
      if (isCustChanged || isProductChanged) {
        shouldInvalidateApproval = true;
      }
    }

    await this.db.transaction().execute(async (trx) => {
      const nextVersion = (existing.row_version || 1) + 1;
      const newStatus = shouldInvalidateApproval ? 'READY_FOR_REVIEW' : existing.status;

      const updateData: any = {
        row_version: nextVersion,
        updated_at: new Date(),
        updated_by: user.id,
      };

      if ((dto as any).version) updateData.version = (dto as any).version;
      if (newCustId) {
        updateData.customer_id = newCustId;
        updateData.organisation_id = newCustId;
      }
      if (dto.product_id) updateData.product_id = dto.product_id;
      if (dto.sector_id) updateData.sector_id = dto.sector_id;
      if (dto.sector) updateData.sector = dto.sector;
      if (dto.responsible_person_id || dto.responsible_id) {
        const rId = dto.responsible_person_id || dto.responsible_id;
        updateData.responsible_person_id = rId;
        updateData.responsible_id = rId;
      }
      if (dto.follow_up_owner_id || dto.followup_owner_id) {
        const oId = dto.follow_up_owner_id || dto.followup_owner_id;
        updateData.follow_up_owner_id = oId;
        updateData.followup_owner_id = oId;
      }
      if (dto.required_date) updateData.required_date = dto.required_date;
      if (dto.remarks) updateData.remarks = this.sanitizeText(dto.remarks);
      if (dto.email_reference || dto.reference) {
        const ref = this.sanitizeText(dto.email_reference || dto.reference);
        updateData.email_reference = ref;
        updateData.reference = ref;
      }

      if (shouldInvalidateApproval) {
        updateData.status = 'READY_FOR_REVIEW';
        updateData.approved_at = null;
        updateData.approved_by_id = null;
        updateData.approved_by = null;
      }

      await trx.updateTable('proposals').set(updateData).where('id', '=', id).execute();

      if (shouldInvalidateApproval) {
        await trx
          .insertInto('proposal_status_history')
          .values({
            proposal_id: id,
            from_status: 'APPROVED',
            to_status: 'READY_FOR_REVIEW',
            reason: 'Material edit invalidated approval',
            actor_id: user.id,
            occurred_at: new Date(),
          })
          .execute();

        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.PROPOSAL_APPROVAL_INVALIDATED,
          aggregateType: 'Proposal',
          aggregateId: id,
          actorId: user.id,
          payload: {
            proposalId: id,
            invalidationReason: 'Material edit (customer or product changed)',
            revertedToStatus: 'READY_FOR_REVIEW',
          },
        });
      } else {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.PROPOSAL_UPDATED,
          aggregateType: 'Proposal',
          aggregateId: id,
          actorId: user.id,
          payload: {
            proposalId: id,
            changes: { before: existing, after: updateData },
          },
        });
      }
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T1: Transition to UNDER_PREPARATION
   */
  async startPreparation(id: string, dto: StartPreparationDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    // Assign responsible person if provided
    let responsibleId = proposal.responsible_person_id || proposal.responsible_id;
    if (dto.responsible_person_id) {
      responsibleId = dto.responsible_person_id;
    }

    this.workflowService.validateTransition(
      { ...proposal, responsible_person_id: responsibleId, responsible_id: responsibleId },
      'UNDER_PREPARATION',
      user,
      {},
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'UNDER_PREPARATION',
          responsible_person_id: responsibleId,
          responsible_id: responsibleId,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'UNDER_PREPARATION',
          reason: 'Started preparation',
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_PREPARATION_STARTED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: { proposalId: id, responsiblePersonId: responsibleId },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T3: Submit for Review
   */
  async submitForReview(id: string, dto: SubmitForReviewDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(proposal, 'READY_FOR_REVIEW', user, {}, settings);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'READY_FOR_REVIEW',
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'READY_FOR_REVIEW',
          reason: dto.change_summary || 'Submitted for manager review',
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_SUBMITTED_FOR_REVIEW,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          changeSummary: dto.change_summary,
          documentLinks: dto.document_links,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T4: Approve Proposal (E21: guard self approval)
   */
  async approve(id: string, dto: ApproveProposalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(proposal, 'APPROVED', user, {}, settings);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'APPROVED',
          approved_by_id: user.id,
          approved_by: user.id,
          approved_at: new Date(),
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'APPROVED',
          reason: dto.remarks || 'Approved for customer dispatch',
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_APPROVED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          approvedById: user.id,
          responsiblePersonId: proposal.responsible_person_id || proposal.responsible_id,
          requestedById: proposal.requested_by_id || proposal.requested_by,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T5: Request Changes (E22: mandatory comment, review_cycle_count++)
   */
  async requestChanges(id: string, dto: RequestChangesDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'UNDER_PREPARATION',
      user,
      { comment: dto.comment },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      const cycleCount = (proposal.review_cycle_count || 0) + 1;

      await trx
        .updateTable('proposals')
        .set({
          status: 'UNDER_PREPARATION',
          review_cycle_count: cycleCount,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'UNDER_PREPARATION',
          reason: `Changes requested: ${dto.comment}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_CHANGES_REQUESTED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          comment: dto.comment,
          reviewCycleCount: cycleCount,
          responsiblePersonId: proposal.responsible_person_id || proposal.responsible_id,
          requestedById: proposal.requested_by_id || proposal.requested_by,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T6: Revise Internal before Send
   */
  async reviseInternal(id: string, dto: ReviseInternalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'UNDER_PREPARATION',
      user,
      { reason: dto.reason },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'UNDER_PREPARATION',
          approved_at: null,
          approved_by_id: null,
          approved_by: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'UNDER_PREPARATION',
          reason: `Internal revision before send: ${dto.reason}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_APPROVAL_INVALIDATED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          invalidationReason: dto.reason,
          revertedToStatus: 'UNDER_PREPARATION',
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T7: Send to Customer (E7, E26: sent_late flag, version immutable)
   */
  async send(id: string, dto: SendProposalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'SENT_TO_CUSTOMER',
      user,
      {
        sent_date: dto.sent_date,
        email_references: dto.email_references,
        follow_up_owner_id: dto.follow_up_owner_id,
        next_follow_up_date: dto.next_follow_up_date,
      },
      settings,
    );

    // E26: Determine sent_late flag
    const reqDateStr = (proposal.required_date as any) instanceof Date
      ? (proposal.required_date as any).toISOString().split('T')[0]
      : String(proposal.required_date || '').split('T')[0];
    const sentDateStr = (dto.sent_date as any) instanceof Date
      ? (dto.sent_date as any).toISOString().split('T')[0]
      : String(dto.sent_date || '').split('T')[0];
    const isSentLate = Boolean(reqDateStr && sentDateStr && sentDateStr > reqDateStr);

    await this.db.transaction().execute(async (trx) => {
      const emailRef = dto.email_references.join(', ');

      await trx
        .updateTable('proposals')
        .set({
          status: 'SENT_TO_CUSTOMER',
          sent_date: dto.sent_date,
          sent_late: isSentLate,
          follow_up_owner_id: dto.follow_up_owner_id,
          followup_owner_id: dto.follow_up_owner_id,
          next_follow_up_date: dto.next_follow_up_date,
          next_followup: dto.next_follow_up_date,
          email_reference: emailRef,
          reference: emailRef,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      // Record sent version snapshot
      const currentVer = proposal.current_version || 1;
      await trx
        .updateTable('proposal_versions')
        .set({
          sent_date: dto.sent_date,
          sent_by: user.id,
          email_references: JSON.stringify(dto.email_references) as any,
          document_links: JSON.stringify(dto.document_links || []) as any,
        })
        .where('proposal_id', '=', id)
        .where('version_no', '=', currentVer)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'SENT_TO_CUSTOMER',
          reason: `Dispatched to customer on ${dto.sent_date}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_SENT,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          sentDate: dto.sent_date,
          sentLate: isSentLate,
          followUpOwnerId: dto.follow_up_owner_id,
          nextFollowUpDate: dto.next_follow_up_date,
          versionNo: currentVer,
          requestedById: proposal.requested_by_id || proposal.requested_by,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T8: Fast-track send (E24: setting + permission)
   */
  async fastTrackSend(id: string, dto: FastTrackSendDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    if (!settings?.allow_fast_track) {
      throw new ForbiddenException('Fast-track send is disabled in proposal settings');
    }

    this.workflowService.validateTransition(
      proposal,
      'SENT_TO_CUSTOMER',
      user,
      {
        sent_date: dto.sent_date,
        email_references: dto.email_references,
        follow_up_owner_id: dto.follow_up_owner_id,
        next_follow_up_date: dto.next_follow_up_date,
        is_fast_track: true,
      },
      settings,
    );

    const reqDateStr = (proposal.required_date as any) instanceof Date
      ? (proposal.required_date as any).toISOString().split('T')[0]
      : String(proposal.required_date || '').split('T')[0];
    const sentDateStr = (dto.sent_date as any) instanceof Date
      ? (dto.sent_date as any).toISOString().split('T')[0]
      : String(dto.sent_date || '').split('T')[0];
    const isSentLate = Boolean(reqDateStr && sentDateStr && sentDateStr > reqDateStr);

    await this.db.transaction().execute(async (trx) => {
      const emailRef = dto.email_references.join(', ');

      await trx
        .updateTable('proposals')
        .set({
          status: 'SENT_TO_CUSTOMER',
          sent_date: dto.sent_date,
          sent_late: isSentLate,
          approved_by_id: user.id,
          approved_by: user.id,
          approved_at: new Date(),
          follow_up_owner_id: dto.follow_up_owner_id,
          followup_owner_id: dto.follow_up_owner_id,
          next_follow_up_date: dto.next_follow_up_date,
          next_followup: dto.next_follow_up_date,
          email_reference: emailRef,
          reference: emailRef,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'SENT_TO_CUSTOMER',
          reason: `Fast-track send: ${dto.reason}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_SENT,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          sentDate: dto.sent_date,
          sentLate: isSentLate,
          isFastTrack: true,
          fastTrackReason: dto.reason,
          approverId: user.id,
          followUpOwnerId: dto.follow_up_owner_id,
          nextFollowUpDate: dto.next_follow_up_date,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T10: Request revision from customer (E25: v+1, suspends follow-ups)
   */
  async requestRevision(id: string, dto: RequestRevisionDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'UNDER_PREPARATION',
      user,
      { reason: dto.revision_reason },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      const nextVer = (proposal.current_version || 1) + 1;

      // Suspends follow-up schedule by clearing next_follow_up_date (E25)
      await trx
        .updateTable('proposals')
        .set({
          status: 'UNDER_PREPARATION',
          current_version: nextVer,
          version: `v${nextVer}.0`,
          next_follow_up_date: null,
          next_followup: null,
          approved_at: null,
          approved_by_id: null,
          approved_by: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      // Insert new draft version
      await trx
        .insertInto('proposal_versions')
        .values({
          proposal_id: id,
          version_no: nextVer,
          change_summary: dto.change_summary || dto.revision_reason,
          email_references: JSON.stringify([]) as any,
          document_links: JSON.stringify([]) as any,
          created_by: user.id,
          created_at: new Date(),
        })
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'UNDER_PREPARATION',
          reason: `Customer requested revision: ${dto.revision_reason}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_REVISION_REQUESTED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          newVersionNo: nextVer,
          revisionReason: dto.revision_reason,
          responsiblePersonId: proposal.responsible_person_id || proposal.responsible_id,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T11: Mark Converted (E28: outcome_date >= sent_date and not in future)
   */
  async markConverted(id: string, dto: MarkConvertedDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'CONVERTED',
      user,
      { outcome_date: dto.outcome_date },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'CONVERTED',
          outcome: 'CONVERTED',
          outcome_date: dto.outcome_date,
          conversion_reference: dto.conversion_reference || null,
          converted_reference: dto.conversion_reference || null,
          converted_to: dto.converted_to || 'Purchase Order',
          status_before_terminal: proposal.status,
          next_follow_up_date: null,
          next_followup: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'CONVERTED',
          reason: dto.remarks || `Converted on ${dto.outcome_date}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_CONVERTED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          outcomeDate: dto.outcome_date,
          conversionReference: dto.conversion_reference,
          customerId: proposal.customer_id || proposal.organisation_id,
          primaryProductId: proposal.product_id,
          requestedById: proposal.requested_by_id || proposal.requested_by,
          responsiblePersonId: proposal.responsible_person_id || proposal.responsible_id,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T12: Mark Lost (E28: lost reason code + text required)
   */
  async markLost(id: string, dto: MarkLostDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    const outcomeDate = dto.outcome_date || new Date().toISOString().split('T')[0];

    this.workflowService.validateTransition(
      proposal,
      'LOST',
      user,
      {
        lost_reason_code: dto.lost_reason_code,
        lost_reason_text: dto.lost_reason_text,
        outcome_date: outcomeDate,
      },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'LOST',
          outcome: 'LOST',
          outcome_date: outcomeDate,
          lost_reason: dto.lost_reason_code,
          lost_reason_code: dto.lost_reason_code,
          lost_reason_text: dto.lost_reason_text,
          lost_remarks: dto.lost_reason_text,
          lost_to_competitor: dto.lost_to_competitor || null,
          status_before_terminal: proposal.status,
          next_follow_up_date: null,
          next_followup: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'LOST',
          reason: `${dto.lost_reason_code}: ${dto.lost_reason_text}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_LOST,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          outcomeDate,
          lostReasonCode: dto.lost_reason_code,
          lostReasonText: dto.lost_reason_text,
          competitor: dto.lost_to_competitor,
          requestedById: proposal.requested_by_id || proposal.requested_by,
          responsiblePersonId: proposal.responsible_person_id || proposal.responsible_id,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T2 / T13: Close Proposal (E28, E29: pre-send cancellation / closure)
   */
  async close(id: string, dto: CloseProposalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    const outcomeDate = new Date().toISOString().split('T')[0];

    this.workflowService.validateTransition(
      proposal,
      'CLOSED',
      user,
      {
        closure_reason_code: dto.closure_reason_code,
        closure_reason_text: dto.closure_reason_text,
        outcome_date: outcomeDate,
      },
      settings,
    );

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: 'CLOSED',
          outcome: 'CLOSED',
          outcome_date: outcomeDate,
          closure_reason_code: dto.closure_reason_code,
          closure_reason_text: dto.closure_reason_text,
          status_before_terminal: proposal.status,
          next_follow_up_date: null,
          next_followup: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: 'CLOSED',
          reason: `${dto.closure_reason_code}: ${dto.closure_reason_text}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_CLOSED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          outcomeDate,
          closureReasonCode: dto.closure_reason_code,
          closureReasonText: dto.closure_reason_text,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * T14: Reopen Terminal Proposal (E30: within reopen_window_days, manager/admin only)
   */
  async reopen(id: string, dto: ReopenProposalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    this.workflowService.validateTransition(
      proposal,
      'REQUESTED',
      user,
      { reopen_reason: dto.reopen_reason },
      settings,
    );

    const targetStatus = proposal.status_before_terminal || 'REQUESTED';

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          status: targetStatus,
          outcome: null,
          outcome_date: null,
          status_before_terminal: null,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('proposal_status_history')
        .values({
          proposal_id: id,
          from_status: proposal.status,
          to_status: targetStatus,
          reason: `Reopened: ${dto.reopen_reason}`,
          actor_id: user.id,
          occurred_at: new Date(),
        })
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_REOPENED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          previousStatus: proposal.status,
          reopenedToStatus: targetStatus,
          reopenReason: dto.reopen_reason,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * Log Follow-up interaction (E36, E37, E38, E39, E45)
   */
  async addFollowup(id: string, dto: CreateProposalFollowupDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    // Proposal must be dispatched or active in follow-up
    const currentStatus = this.workflowService.normalizeStatus(proposal.status);
    if (!['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'].includes(currentStatus)) {
      throw new BadRequestException('Follow-ups can only be logged on proposals sent to customers');
    }

    const contactDate = dto.contact_date || dto.followup_date || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // E36: contact_date <= now
    if (contactDate > today) {
      throw new BadRequestException('Contact date cannot be in the future');
    }
    if (proposal.sent_date && contactDate < proposal.sent_date) {
      throw new BadRequestException('Contact date cannot be earlier than the proposal sent date');
    }

    const summary = this.sanitizeText(dto.summary || dto.remarks);
    if (!summary) {
      throw new BadRequestException('Follow-up interaction summary is required');
    }

    // E36: User must either set a future next date OR record an outcome transition
    const nextDate = dto.next_follow_up_date || dto.next_followup_date;
    const hasOutcome = dto.record_converted || dto.record_lost || dto.record_closed;

    if (!nextDate && !hasOutcome) {
      throw new BadRequestException(
        'You must either set a next follow-up date or record an outcome transition',
      );
    }

    // E37: next date validation
    if (nextDate) {
      if (nextDate < today) {
        throw new BadRequestException('Next follow-up date cannot be in the past');
      }
      const maxHorizon = settings?.max_follow_up_horizon_days ?? 90;
      const nD = new Date(nextDate);
      const tD = new Date(today);
      const diffHorizon = Math.round((nD.getTime() - tD.getTime()) / (1000 * 60 * 60 * 24));
      if (diffHorizon > maxHorizon && !dto.postpone_reason) {
        throw new BadRequestException(
          `Scheduling a follow-up beyond ${maxHorizon} days requires a documented justification reason`,
        );
      }
    }

    let fuRecord: any;
    await this.db.transaction().execute(async (trx) => {
      const mode = dto.mode || 'Call';
      const response = dto.response || 'Neutral';

      // Insert into proposal_follow_ups
      fuRecord = await trx
        .insertInto('proposal_follow_ups')
        .values({
          proposal_id: id,
          contact_date: contactDate,
          mode,
          contact_person: this.sanitizeText(dto.contact_person),
          summary,
          response,
          next_follow_up_date: nextDate || null,
          is_postpone: !!dto.is_postpone,
          postpone_reason: dto.postpone_reason || null,
          logged_by: user.id,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Also insert into proposal_followups for legacy table compatibility
      await trx
        .insertInto('proposal_followups')
        .values({
          proposal_id: id,
          followup_date: contactDate,
          owner_id: user.id,
          remarks: summary,
          outcome: response,
          next_followup_date: nextDate || null,
          created_by: user.id,
          created_at: new Date(),
        })
        .execute();

      // If first follow-up while SENT_TO_CUSTOMER, transition to FOLLOW_UP_REQUIRED
      let targetStatus = proposal.status;
      if (currentStatus === 'SENT_TO_CUSTOMER') {
        targetStatus = 'FOLLOW_UP_REQUIRED';
      }

      const fuCount = (proposal.follow_up_count || 0) + 1;

      await trx
        .updateTable('proposals')
        .set({
          status: targetStatus,
          next_follow_up_date: nextDate || null,
          next_followup: nextDate || null,
          last_follow_up_at: new Date(),
          last_followup: contactDate,
          follow_up_count: fuCount,
          last_activity_at: new Date(), // E45: follow-up is meaningful activity
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      // Enqueue domain event
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_FOLLOWUP_LOGGED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          followUpId: fuRecord.id,
          contactDate,
          mode,
          summary,
          response,
          nextFollowUpDate: nextDate,
          followUpOwnerId: proposal.follow_up_owner_id || proposal.followup_owner_id,
          loggedBy: user.id,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});

    // Handle embedded outcome if provided (E36)
    if (dto.record_converted) {
      return this.markConverted(id, dto.record_converted, user);
    } else if (dto.record_lost) {
      return this.markLost(id, dto.record_lost, user);
    } else if (dto.record_closed) {
      return this.close(id, dto.record_closed, user);
    }

    const updated = await this.findOne(id, user);
    return {
      ...updated,
      followup: {
        ...fuRecord,
        remarks: fuRecord.summary,
      },
      proposal: updated,
    };
  }

  /**
   * Postpone follow-up without contact (E43)
   */
  async postponeFollowup(id: string, dto: PostponeFollowUpDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const settings = await this.getSettings();

    const today = new Date().toISOString().split('T')[0];
    if (dto.new_follow_up_date < today) {
      throw new BadRequestException('New follow-up date cannot be in the past');
    }

    await this.db.transaction().execute(async (trx) => {
      const postponeCount = (proposal.postpone_count || 0) + 1;
      const maxPostpones = settings?.max_postpones_before_flag ?? 3;

      await trx
        .insertInto('proposal_follow_ups')
        .values({
          proposal_id: id,
          contact_date: today,
          mode: 'Other',
          summary: `Rescheduled without contact: ${dto.postpone_reason}`,
          response: 'Neutral',
          next_follow_up_date: dto.new_follow_up_date,
          is_postpone: true,
          postpone_reason: dto.postpone_reason,
          logged_by: user.id,
          created_at: new Date(),
        })
        .execute();

      await trx
        .updateTable('proposals')
        .set({
          next_follow_up_date: dto.new_follow_up_date,
          next_followup: dto.new_follow_up_date,
          postpone_count: postponeCount,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_FOLLOWUP_POSTPONED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          proposalNo: proposal.proposal_no || proposal.proposal_number,
          postponeReason: dto.postpone_reason,
          postponeCount,
          newDate: dto.new_follow_up_date,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * Reassign responsible person or follow-up owner (E15, E17)
   */
  async reassign(id: string, dto: ReassignProposalDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);

    const oldRespId = proposal.responsible_person_id || proposal.responsible_id;
    const oldOwnerId = proposal.follow_up_owner_id || proposal.followup_owner_id;

    await this.db.transaction().execute(async (trx) => {
      const updateData: any = { updated_at: new Date() };

      if (dto.responsible_person_id) {
        updateData.responsible_person_id = dto.responsible_person_id;
        updateData.responsible_id = dto.responsible_person_id;
      }
      if (dto.follow_up_owner_id) {
        updateData.follow_up_owner_id = dto.follow_up_owner_id;
        updateData.followup_owner_id = dto.follow_up_owner_id;
      }

      // Reassignment clears owner_inactive_flag if both owners are active
      updateData.owner_inactive_flag = false;

      // Note: Reassignment does NOT reset last_activity_at for staleness (E15, E45)
      await trx.updateTable('proposals').set(updateData).where('id', '=', id).execute();

      if (dto.responsible_person_id && dto.responsible_person_id !== oldRespId) {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.PROPOSAL_ASSIGNED,
          aggregateType: 'Proposal',
          aggregateId: id,
          actorId: user.id,
          payload: {
            proposalId: id,
            proposalNo: proposal.proposal_no || proposal.proposal_number,
            oldResponsibleId: oldRespId,
            newResponsibleId: dto.responsible_person_id,
            reason: dto.reason,
          },
        });
      }

      if (dto.follow_up_owner_id && dto.follow_up_owner_id !== oldOwnerId) {
        await this.outboxService.queueEvent(trx, {
          eventType: AppEvents.PROPOSAL_FOLLOWUP_OWNER_CHANGED,
          aggregateType: 'Proposal',
          aggregateId: id,
          actorId: user.id,
          payload: {
            proposalId: id,
            proposalNo: proposal.proposal_no || proposal.proposal_number,
            oldOwnerId,
            newOwnerId: dto.follow_up_owner_id,
            reason: dto.reason,
          },
        });
      }
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * Bulk reassign proposals (E17)
   */
  async bulkReassign(
    dto: BulkReassignDto,
    user: AuthUser,
  ): Promise<{ successCount: number; failureCount: number; errors: any[] }> {
    let successCount = 0;
    let failureCount = 0;
    const errors: any[] = [];

    for (const propId of dto.proposal_ids) {
      try {
        await this.reassign(
          propId,
          {
            responsible_person_id: dto.responsible_person_id,
            follow_up_owner_id: dto.follow_up_owner_id,
            reason: dto.reason,
          },
          user,
        );
        successCount++;
      } catch (err: any) {
        failureCount++;
        errors.push({ proposal_id: propId, error: err.message });
      }
    }

    return { successCount, failureCount, errors };
  }

  /**
   * Create a new proposal version
   */
  async createVersion(id: string, dto: CreateProposalVersionDto, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const nextVer = (proposal.current_version || 1) + 1;

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('proposal_versions')
        .values({
          proposal_id: id,
          version_no: nextVer,
          change_summary: dto.change_summary,
          email_references: JSON.stringify(dto.email_references || []) as any,
          document_links: JSON.stringify(dto.document_links || []) as any,
          created_by: user.id,
          created_at: new Date(),
        })
        .execute();

      await trx
        .updateTable('proposals')
        .set({
          current_version: nextVer,
          version: `v${nextVer}.0`,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_VERSION_CREATED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: {
          proposalId: id,
          versionNo: nextVer,
          changeSummary: dto.change_summary,
        },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return this.findOne(id, user);
  }

  /**
   * Soft delete draft proposal (E35: admin only, only if never sent)
   */
  async delete(id: string, user: AuthUser): Promise<any> {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only system administrators or management can delete proposals');
    }

    const proposal = await this.findOne(id, user);
    if (proposal.sent_date) {
      throw new BadRequestException(
        'Proposals that have already been dispatched to customers cannot be deleted. Close the proposal instead.',
      );
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('proposals')
        .set({
          is_deleted: true,
          deleted_at: new Date(),
          deleted_by: user.id,
        })
        .where('id', '=', id)
        .execute();

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.PROPOSAL_DELETED,
        aggregateType: 'Proposal',
        aggregateId: id,
        actorId: user.id,
        payload: { proposalId: id, proposalNo: proposal.proposal_no || proposal.proposal_number },
      });
    });

    await this.outboxService.processPendingEvents().catch(() => {});
    return { success: true, message: 'Proposal soft-deleted successfully' };
  }

  /**
   * Executive Dashboard Statistics (Section 6 & E44-E49)
   */
  async getDashboardStats(user: AuthUser): Promise<any> {
    const settings = await this.getSettings();
    const tz = settings?.business_timezone || 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    let baseQuery = this.db
      .selectFrom('proposals')
      .innerJoin('organisations', (join) =>
        join.on((eb) =>
          eb.or([
            eb('proposals.customer_id', '=', eb.ref('organisations.id')),
            eb('proposals.organisation_id', '=', eb.ref('organisations.id')),
          ]),
        ),
      )
      .where('proposals.is_deleted', '=', false);

    // Visibility scoping
    const role = (user.role || '').toLowerCase();
    const isGlobal = role === 'admin' || role === 'management';
    if (!isGlobal) {
      if (role === 'regional_manager' && user.region_id) {
        baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
      } else {
        baseQuery = baseQuery.where((eb) => {
          const conds = [
            eb('proposals.responsible_person_id', '=', user.id),
            eb('proposals.responsible_id', '=', user.id),
            eb('proposals.requested_by_id', '=', user.id),
            eb('proposals.requested_by', '=', user.id),
            eb('proposals.follow_up_owner_id', '=', user.id),
            eb('proposals.followup_owner_id', '=', user.id),
          ];
          if (user.region_id) {
            conds.push(eb('organisations.region_id', '=', user.region_id));
          }
          return eb.or(conds);
        });
      }
    }

    const allProposals = await baseQuery.selectAll('proposals').execute();

    let proposal_requested = 0;
    let pending_preparation = 0;
    let ready_for_review = 0;
    let approved = 0;
    let sent_to_customer = 0;
    let followup_required = 0;
    let converted = 0;
    let closed = 0;
    let lost = 0;

    let due_today = 0;
    let overdue = 0;
    let no_followup = 0;
    let old_no_movement = 0;
    let unassigned = 0;
    let prep_overdue = 0;
    let required_date_approaching = 0;
    let pending_approval_queue = 0;
    let owner_inactive = 0;
    let suggest_closure = 0;

    const dispatchedStatuses = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'sent', 'followup_required'];
    const closedStatuses = ['CONVERTED', 'LOST', 'CLOSED', 'converted', 'lost', 'closed'];

    const noFuThreshold = settings?.no_follow_up_after_days ?? 7;
    const suggestClosureDays = settings?.suggest_closure_after_days ?? 60;
    const warningDays = settings?.required_date_warning_days ?? 2;
    const now = new Date();

    for (const p of allProposals) {
      const status = (p.status || '').toUpperCase();

      if (status === 'REQUESTED' || status === 'PROPOSAL_REQUESTED') proposal_requested++;
      else if (status === 'UNDER_PREPARATION') pending_preparation++;
      else if (status === 'READY_FOR_REVIEW') ready_for_review++;
      else if (status === 'APPROVED') approved++;
      else if (status === 'SENT_TO_CUSTOMER' || status === 'SENT') sent_to_customer++;
      else if (status === 'FOLLOW_UP_REQUIRED' || status === 'FOLLOWUP_REQUIRED') followup_required++;
      else if (status === 'CONVERTED') converted++;
      else if (status === 'CLOSED') closed++;
      else if (status === 'LOST') lost++;

      const isDispatched = dispatchedStatuses.includes(p.status || '');
      const isClosed = closedStatuses.includes(p.status || '');

      // Unassigned (6f)
      if ((status === 'REQUESTED' || status === 'PROPOSAL_REQUESTED') && !p.responsible_person_id && !p.responsible_id) {
        unassigned++;
      }

      // Preparation overdue (6f)
      if (!isDispatched && !isClosed && p.required_date && p.required_date < today) {
        prep_overdue++;
      }

      // Required date approaching (6f)
      if (!isDispatched && !isClosed && p.required_date && p.required_date >= today) {
        const reqD = new Date(p.required_date);
        const tD = new Date(today);
        const diffDays = Math.round((reqD.getTime() - tD.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= warningDays) {
          required_date_approaching++;
        }
      }

      // Pending approval queue (6f)
      if (status === 'READY_FOR_REVIEW') {
        pending_approval_queue++;
      }

      // Owner inactive (6f, E14)
      if (p.owner_inactive_flag && !isClosed) {
        owner_inactive++;
      }

      // Follow-up buckets (6a, 6b, 6c)
      if (isDispatched) {
        const fuDate = p.next_follow_up_date || p.next_followup;
        if (fuDate === today) due_today++;
        else if (fuDate && fuDate < today) overdue++;

        // Without follow-up (6a)
        const isOwnerInactive = p.owner_inactive_flag;
        let sentDaysAgo = 0;
        if (p.sent_date) {
          sentDaysAgo = Math.floor((now.getTime() - new Date(p.sent_date).getTime()) / (1000 * 60 * 60 * 24));
        }
        if (!fuDate || isOwnerInactive || (sentDaysAgo > noFuThreshold && (p.follow_up_count || 0) === 0)) {
          no_followup++;
        }

        // Suggest closure (6f, E41)
        if (sentDaysAgo >= suggestClosureDays && !isClosed) {
          suggest_closure++;
        }
      }

      // Stale without movement (6d, E45)
      if (!isClosed) {
        let thresh = 7;
        if (status.includes('REQUESTED')) thresh = settings?.stale_requested_days ?? 2;
        else if (status === 'UNDER_PREPARATION') thresh = settings?.stale_preparation_days ?? 7;
        else if (status === 'READY_FOR_REVIEW') thresh = settings?.stale_review_days ?? 2;
        else if (status === 'APPROVED') thresh = settings?.stale_approved_days ?? 2;
        else if (isDispatched) thresh = settings?.stale_followup_days ?? 21;

        const lastActive = p.last_activity_at ? new Date(p.last_activity_at) : new Date(p.created_at);
        const inactiveDays = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
        if (inactiveDays >= thresh) {
          old_no_movement++;
        }
      }
    }

    return {
      total_proposals: allProposals.length,
      proposal_requested,
      pending_preparation,
      ready_for_review,
      approved,
      sent_to_customer,
      followup_required,
      converted,
      closed,
      lost,
      due_today,
      overdue,
      no_followup,
      old_no_movement,
      unassigned,
      prep_overdue,
      required_date_approaching,
      pending_approval_queue,
      owner_inactive,
      suggest_closure,
    };
  }

  /**
   * Outcome Report and Win-Rate analysis (Section 6e, E47, E48)
   */
  async getOutcomeReport(filter: any, user: AuthUser): Promise<any> {
    const list = await this.findAll({ ...filter, limit: 1000 }, user);
    const proposals = list.data;

    let convertedCount = 0;
    let lostCount = 0;
    let closedCount = 0;
    let sentLateCount = 0;
    let totalSentCount = 0;

    let totalTurnaroundDays = 0;
    let turnaroundItems = 0;
    let totalSentToOutcomeDays = 0;
    let sentToOutcomeItems = 0;

    const lostReasonsMap: Record<string, number> = {};

    for (const p of proposals) {
      const status = (p.status || '').toUpperCase();
      if (status === 'CONVERTED') convertedCount++;
      else if (status === 'LOST') {
        lostCount++;
        const reason = p.lost_reason_code || p.lost_reason || 'Other';
        lostReasonsMap[reason] = (lostReasonsMap[reason] || 0) + 1;
      } else if (status === 'CLOSED') {
        closedCount++;
      }

      if (p.sent_date) {
        totalSentCount++;
        if (p.sent_late) sentLateCount++;

        if (p.request_date) {
          const reqD = new Date(p.request_date);
          const sD = new Date(p.sent_date);
          const turn = Math.max(0, Math.round((sD.getTime() - reqD.getTime()) / (1000 * 60 * 60 * 24)));
          totalTurnaroundDays += turn;
          turnaroundItems++;
        }

        if (p.outcome_date) {
          const sD = new Date(p.sent_date);
          const oD = new Date(p.outcome_date);
          const outTime = Math.max(0, Math.round((oD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)));
          totalSentToOutcomeDays += outTime;
          sentToOutcomeItems++;
        }
      }
    }

    // Win rate = Converted / (Converted + Lost) (E47)
    const denominator = convertedCount + lostCount;
    const winRateFormatted =
      denominator === 0 ? '—' : `${((convertedCount / denominator) * 100).toFixed(1)}%`;

    const avgTurnaroundDays =
      turnaroundItems === 0 ? 0 : Math.round(totalTurnaroundDays / turnaroundItems);
    const avgSentToOutcomeDays =
      sentToOutcomeItems === 0 ? 0 : Math.round(totalSentToOutcomeDays / sentToOutcomeItems);
    const sentLatePercentage =
      totalSentCount === 0 ? '0%' : `${((sentLateCount / totalSentCount) * 100).toFixed(1)}%`;

    return {
      converted_count: convertedCount,
      total_converted: convertedCount,
      lost_count: lostCount,
      total_lost: lostCount,
      closed_count: closedCount,
      total_closed: closedCount,
      win_rate: winRateFormatted,
      win_rate_denominator: denominator,
      average_turnaround_days: avgTurnaroundDays,
      average_sent_to_outcome_days: avgSentToOutcomeDays,
      sent_late_percentage: sentLatePercentage,
      lost_reasons_breakdown: lostReasonsMap,
    };
  }

  /**
   * Export Proposals with Formula Injection sanitization and row limits (E63, E65)
   */
  async exportData(query: ProposalQueryDto, user: AuthUser): Promise<string> {
    const maxLimit = 5000;
    const res = await this.findAll({ ...query, limit: maxLimit, page: 1 }, user);
    const proposals = res.data;

    // Formula injection sanitizer (E65)
    const sanitizeCell = (val: any): string => {
      if (val === null || val === undefined) return '';
      let str = String(val);
      if (/^[=+\-@]/.test(str)) {
        str = `'${str}`; // Escape formula trigger
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'Proposal No',
      'Customer',
      'Product',
      'Sector',
      'Status',
      'Reference',
      'Remarks',
      'Request Date',
      'Required Date',
      'Sent Date',
      'Next Follow-up Date',
      'Outcome Date',
      'Responsible Person',
      'Follow-up Owner',
      'Is Urgent',
      'Sent Late',
    ];

    const lines: string[] = [headers.join(',')];

    for (const p of proposals) {
      lines.push(
        [
          sanitizeCell(p.proposal_no || p.proposal_number),
          sanitizeCell(p.organisation_name),
          sanitizeCell(p.product_name),
          sanitizeCell(p.sector),
          sanitizeCell(p.status),
          sanitizeCell(p.reference || p.email_reference),
          sanitizeCell(p.remarks),
          sanitizeCell(p.request_date),
          sanitizeCell(p.required_date),
          sanitizeCell(p.sent_date),
          sanitizeCell(p.next_follow_up_date || p.next_followup),
          sanitizeCell(p.outcome_date),
          sanitizeCell(p.responsible_name),
          sanitizeCell(p.followup_owner_name),
          sanitizeCell(p.is_urgent ? 'YES' : 'NO'),
          sanitizeCell(p.sent_late ? 'YES' : 'NO'),
        ].join(','),
      );
    }

    if (res.total > maxLimit) {
      lines.push(
        `"# NOTE: Export capped at ${maxLimit} rows. Total matching rows in database: ${res.total}"`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Import Proposals with Dry-Run and Idempotent Deduplication (E67)
   */
  async importProposals(dto: ImportProposalSheetDto, user: AuthUser): Promise<any> {
    const rows = dto.rows || [];
    const isDryRun = dto.dry_run === true || dto.commit !== true;

    const rowReports: any[] = [];
    let validCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let insertedCount = 0;

    const seenInBatch = new Set<string>();

    // Preload lookup tables for fast in-memory matching
    const organisations = await this.db.selectFrom('organisations').select(['id', 'name']).execute();
    const products = await this.db.selectFrom('products').select(['id', 'name']).execute();
    const users = await this.db.selectFrom('users').select(['id', 'email', 'full_name', 'is_active']).execute();
    const existingProposals = await this.db
      .selectFrom('proposals')
      .select(['id', 'external_ref', 'reference', 'proposal_no', 'proposal_number'])
      .execute();

    const existingRefMap = new Map<string, string>();
    for (const ep of existingProposals) {
      if (ep.external_ref) existingRefMap.set(ep.external_ref.toLowerCase(), ep.id);
      if (ep.reference) existingRefMap.set(ep.reference.toLowerCase(), ep.id);
    }

    const rowsToInsert: any[] = [];

    let rowIndex = 0;
    for (const raw of rows) {
      rowIndex++;
      const errors: string[] = [];

      // Extract raw fields
      const externalRef = String(raw.external_ref || raw.reference || raw['External Ref'] || raw['Reference'] || '').trim();
      const customerInput = String(raw.customer_id || raw.organisation_id || raw.customer || raw.organisation || raw['Customer'] || raw['Organisation'] || '').trim();
      const productInput = String(raw.product_id || raw.product || raw['Product'] || '').trim();
      const sectorInput = String(raw.sector_id || raw.sector || raw['Sector'] || 'Commercial').trim();
      const requiredDateInput = raw.required_date || raw['Required Date'] || raw.target_date;
      const requestDateInput = raw.request_date || raw['Request Date'] || new Date().toISOString().split('T')[0];
      const statusInput = String(raw.status || raw['Status'] || 'REQUESTED').trim();
      const responsibleInput = String(raw.responsible_id || raw.responsible_person_id || raw.responsible || raw['Responsible Person'] || '').trim();
      const remarksInput = String(raw.remarks || raw['Remarks'] || '').trim();

      if (!customerInput) errors.push('Customer is required');
      if (!productInput) errors.push('Product is required');
      if (!requiredDateInput) errors.push('Required completion date is required');

      // Resolve customer
      const matchedOrg = organisations.find(
        (o) =>
          o.id === customerInput ||
          o.name.toLowerCase() === customerInput.toLowerCase() ||
          o.name.toLowerCase().includes(customerInput.toLowerCase()),
      );
      if (!matchedOrg) {
        errors.push(`Customer not found in master data: "${customerInput}"`);
      } else if ((matchedOrg as any).is_active === false) {
        errors.push(`Customer "${matchedOrg.name}" is inactive (E5)`);
      }

      // Resolve product
      const matchedProduct = products.find(
        (p) =>
          p.id === productInput ||
          p.name.toLowerCase() === productInput.toLowerCase() ||
          p.name.toLowerCase().includes(productInput.toLowerCase()),
      );
      if (!matchedProduct) {
        errors.push(`Product not found in master data: "${productInput}"`);
      } else if ((matchedProduct as any).is_active === false) {
        errors.push(`Product "${matchedProduct.name}" is inactive (E5)`);
      }

      // Resolve responsible person
      let matchedUser = null;
      if (responsibleInput) {
        matchedUser = users.find(
          (u) =>
            u.id === responsibleInput ||
            u.email.toLowerCase() === responsibleInput.toLowerCase() ||
            u.full_name.toLowerCase().includes(responsibleInput.toLowerCase()),
        );
        if (!matchedUser) {
          errors.push(`Responsible user not found: "${responsibleInput}"`);
        }
      }
      const responsiblePersonId = matchedUser?.id || user.id;

      // Duplicate check inside sheet batch
      const dedupeKey = externalRef ? externalRef.toLowerCase() : `${customerInput.toLowerCase()}_${productInput.toLowerCase()}_${requiredDateInput}`;
      if (seenInBatch.has(dedupeKey)) {
        errors.push(`Duplicate row inside batch for "${dedupeKey}"`);
      } else {
        seenInBatch.add(dedupeKey);
      }

      // Duplicate check against existing records in DB (E67)
      let isExistingDuplicate = false;
      if (externalRef && existingRefMap.has(externalRef.toLowerCase())) {
        isExistingDuplicate = true;
        duplicateCount++;
      }

      if (errors.length > 0) {
        errorCount++;
        rowReports.push({
          row: rowIndex,
          external_ref: externalRef || null,
          status: 'ERROR',
          errors,
        });
      } else if (isExistingDuplicate) {
        rowReports.push({
          row: rowIndex,
          external_ref: externalRef,
          status: 'DUPLICATE_SKIPPED',
          message: `Proposal with external reference "${externalRef}" already exists.`,
        });
      } else {
        validCount++;
        const mappedStatus = this.workflowService.normalizeStatus(statusInput) || 'REQUESTED';
        const parsedReqDate = new Date(requestDateInput).toISOString().split('T')[0];
        const parsedCompDate = new Date(requiredDateInput).toISOString().split('T')[0];

        rowReports.push({
          row: rowIndex,
          external_ref: externalRef || null,
          status: 'VALID',
          customer_name: matchedOrg?.name,
          product_name: matchedProduct?.name,
          resolved_status: mappedStatus,
        });

        rowsToInsert.push({
          customer_id: matchedOrg!.id,
          product_id: matchedProduct!.id,
          sector: sectorInput,
          requested_by_id: user.id,
          created_by_id: user.id,
          responsible_person_id: responsiblePersonId,
          request_date: parsedReqDate,
          required_date: parsedCompDate,
          status: mappedStatus,
          remarks: remarksInput,
          external_ref: externalRef || null,
          reference: externalRef || null,
        });
      }
    }

    if (!isDryRun && rowsToInsert.length > 0) {
      for (const item of rowsToInsert) {
        try {
          const year = new Date().getFullYear();
          const seqResult = await sql<{ next_num: string }>`SELECT nextval('proposal_canonical_seq')::text as next_num`.execute(this.db);
          const seqNum = seqResult.rows[0]?.next_num || `${Date.now().toString().slice(-4)}`;
          const canonicalNo = `PRP-${year}-${seqNum.padStart(5, '0')}`;
          const legacyNumber = `PROP-${year}-${seqNum.padStart(4, '0')}`;

          await this.db.transaction().execute(async (trx) => {
            const inserted = await trx
              .insertInto('proposals')
              .values({
                proposal_no: canonicalNo,
                proposal_number: legacyNumber,
                customer_id: item.customer_id,
                organisation_id: item.customer_id,
                product_id: item.product_id,
                sector: item.sector,
                requested_by_id: item.requested_by_id,
                requested_by: item.requested_by_id,
                created_by_id: item.created_by_id,
                created_by: item.created_by_id,
                responsible_person_id: item.responsible_person_id,
                responsible_id: item.responsible_person_id,
                request_date: item.request_date,
                required_date: item.required_date,
                status: item.status,
                remarks: item.remarks,
                source: 'import',
                external_ref: item.external_ref,
                reference: item.reference,
                current_version: 1,
                version: 'v1.0',
                is_urgent: false,
                row_version: 1,
                last_activity_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
              })
              .returningAll()
              .executeTakeFirstOrThrow();

            await trx
              .insertInto('proposal_products')
              .values({
                proposal_id: inserted.id,
                product_id: item.product_id,
                is_primary: true,
                created_at: new Date(),
              })
              .execute();

            await trx
              .insertInto('proposal_versions')
              .values({
                proposal_id: inserted.id,
                version_no: 1,
                change_summary: 'Imported from legacy records',
                email_references: JSON.stringify([]) as any,
                document_links: JSON.stringify([]) as any,
                created_by: user.id,
                created_at: new Date(),
              })
              .execute();

            // E67: Events carry suppress_notifications = true
            await this.outboxService.queueEvent(trx, {
              eventType: AppEvents.PROPOSAL_IMPORTED,
              aggregateType: 'Proposal',
              aggregateId: inserted.id,
              aggregateSequence: 1,
              actorId: user.id,
              suppressNotifications: true,
              payload: {
                proposalId: inserted.id,
                proposalNo: canonicalNo,
                externalRef: item.external_ref,
                source: 'import',
              },
            });
          });

          insertedCount++;
        } catch (err: any) {
          errorCount++;
          rowReports.push({
            external_ref: item.external_ref,
            status: 'INSERT_FAILED',
            error: err.message,
          });
        }
      }

      await this.outboxService.processPendingEvents().catch(() => {});
    }

    return {
      dry_run: isDryRun,
      total_rows: rows.length,
      valid_rows: validCount,
      inserted_rows: insertedCount,
      duplicate_skipped: duplicateCount,
      error_rows: errorCount,
      row_reports: rowReports,
    };
  }

  /**
   * Rebuild Projections command (E59)
   */
  async rebuildProjections(user: AuthUser): Promise<any> {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only system administrators can rebuild projections');
    }
    const res = await this.timelineProjection.rebuildProjections();
    return {
      success: true,
      rebuiltCount: res.rebuiltCount,
      rebuiltProposals: res.rebuiltCount,
    };
  }

  /**
   * Dead-letter management: List failed events
   */
  async getDeadLetterEvents(options: any, user: AuthUser): Promise<any> {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only system administrators can view dead-letter events');
    }
    const events = await this.outboxService.getDeadLetterEvents(options);
    return { data: events, total: events.length };
  }

  /**
   * Dead-letter management: Replay failed event (E53)
   */
  async replayDeadLetterEvent(id: string, user: AuthUser): Promise<any> {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only system administrators can replay dead-letter events');
    }
    const success = await this.outboxService.replayDeadLetterEvent(id, user.id);
    if (!success) {
      throw new NotFoundException(`Dead-letter event ${id} not found`);
    }
    return { success: true, message: `Replayed dead-letter event ${id}` };
  }

  /**
   * Fallback method for legacy changeStatus route
   */
  async changeStatus(id: string, dto: any, user: AuthUser): Promise<any> {
    const proposal = await this.findOne(id, user);
    const current = this.workflowService.normalizeStatus(proposal.status);
    const target = this.workflowService.normalizeStatus(dto.status);

    if ((current === 'REQUESTED' || current === 'PROPOSAL_REQUESTED') && target === 'APPROVED') {
      throw new BadRequestException(`Cannot move proposal from ${proposal.status} directly to APPROVED`);
    }

    if (target === 'LOST' && !dto.lost_reason && !dto.lost_reason_code) {
      throw new BadRequestException('Lost reason is required');
    }

    switch (target) {
      case 'UNDER_PREPARATION':
        return this.startPreparation(id, {}, user);
      case 'READY_FOR_REVIEW':
        return this.submitForReview(id, { change_summary: dto.remarks }, user);
      case 'APPROVED':
        return this.approve(id, { remarks: dto.remarks }, user);
      case 'SENT_TO_CUSTOMER':
        return this.send(
          id,
          {
            sent_date: dto.sent_date || new Date().toISOString().split('T')[0],
            email_references: [dto.reference || 'Dispatch'],
            follow_up_owner_id: user.id,
            next_follow_up_date:
              dto.next_followup || new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
          },
          user,
        );
      case 'CONVERTED':
        return this.markConverted(
          id,
          {
            outcome_date: dto.sent_date || new Date().toISOString().split('T')[0],
            conversion_reference: dto.converted_reference,
            converted_to: dto.converted_to,
            remarks: dto.remarks,
          },
          user,
        );
      case 'LOST':
        return this.markLost(
          id,
          {
            lost_reason_code: dto.lost_reason || 'Other',
            lost_reason_text: dto.lost_remarks || dto.lost_reason || 'Lost',
            remarks: dto.remarks,
          },
          user,
        );
      case 'CLOSED':
        return this.close(
          id,
          {
            closure_reason_code: 'Other',
            closure_reason_text: dto.remarks || 'Closed',
          },
          user,
        );
      default:
        throw new BadRequestException(`Unsupported transition to ${dto.status}`);
    }
  }

  async getFollowups(id: string): Promise<any> {
    return this.db
      .selectFrom('proposal_follow_ups')
      .selectAll()
      .where('proposal_id', '=', id)
      .orderBy('contact_date', 'desc')
      .execute();
  }

  async getHistory(id: string): Promise<any> {
    const list = await this.db
      .selectFrom('proposal_status_history')
      .selectAll()
      .where('proposal_id', '=', id)
      .orderBy('occurred_at', 'asc')
      .execute();
    return list.map((h: any) => ({
      ...h,
      action: !h.from_status || (h.from_status === 'REQUESTED' && h.to_status === 'REQUESTED') ? 'CREATED' : 'STATUS_CHANGE',
    }));
  }

  async getVersions(id: string): Promise<any> {
    return this.db
      .selectFrom('proposal_versions')
      .selectAll()
      .where('proposal_id', '=', id)
      .orderBy('version_no', 'desc')
      .execute();
  }

  async getActivity(id: string): Promise<any> {
    return this.db
      .selectFrom('proposal_timeline')
      .leftJoin('users', 'proposal_timeline.actor_id', 'users.id')
      .select([
        'proposal_timeline.id',
        'proposal_timeline.event_type',
        'proposal_timeline.category',
        'proposal_timeline.title',
        'proposal_timeline.description',
        'proposal_timeline.metadata',
        'proposal_timeline.occurred_at',
        'users.full_name as actor_name',
      ])
      .where('proposal_timeline.proposal_id', '=', id)
      .orderBy('proposal_timeline.occurred_at', 'asc')
      .execute();
  }

  async updateFollowup(id: string, dto: any, user: AuthUser): Promise<any> {
    if (dto.contact_date && dto.summary) {
      return this.addFollowup(id, dto, user);
    }
    if (dto.postpone_reason) {
      return this.postponeFollowup(id, dto, user);
    }
    const nextDate = dto.next_follow_up_date || dto.nextFollowUp || dto.next_followup;
    const ownerId = dto.follow_up_owner_id || dto.followUpOwner || dto.followup_owner_id;

    await this.db
      .updateTable('proposals')
      .set({
        ...(nextDate ? { next_follow_up_date: nextDate, next_followup: nextDate } : {}),
        ...(ownerId ? { follow_up_owner_id: ownerId, followup_owner_id: ownerId } : {}),
        last_activity_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return this.findOne(id, user);
  }
}
