import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { isUUID } from 'class-validator';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { assertRegionScope, checkRegionScope, assertNotSelfApproval } from '../../common/utils/scope.util.js';
import { calendarDay } from '../../common/utils/ist-date.util.js';
import {
  TENDER_UPCOMING_DAYS,
  TENDER_URGENT_HOURS,
  todayInKolkata,
  istDateOf,
  istDateTime,
  istEndOfDay,
  isoDaysBetween,
  type Database,
  type AuthUser,
  type PaginatedResult,
  type TenderStatus,
} from '@arihant/shared';
import { AppEvents } from '../../common/events/event-names.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { TendersWorkflowService, StandardTenderStatus } from './tenders.workflow.js';
import {
  CreateTenderDto,
  UpdateTenderDto,
  ChangeTenderStatusDto,
  ApproveTenderDto,
  RecordTenderOutcomeDto,
  CreateTenderPortalIssueDto,
  UpdateTenderPortalIssueDto,
  TenderQueryDto,
  TransitionTenderDto,
  HoldTenderDto,
  ResumeTenderDto,
  ChangeDeadlineDto,
  RecordTenderResultDto,
  ReopenTenderDto,
  UpdateTenderSettingsDto,
  AddApproverDto,
  CreateLossReasonDto,
  UpdateLossReasonDto,
  UpdateTenderStatusLabelDto,
  CreateTenderCategoryDto,
  UpdateTenderCategoryDto,
  ImportTenderSheetDto,
  CreateTenderLineItemDto,
  UpdateTenderLineItemDto,
  CreateTenderDocumentDto,
  UpdateTenderDocumentDto,
  CreateTenderCorrigendumDto,
  CreateTenderFinancialInstrumentDto,
  UpdateTenderFinancialInstrumentDto,
  CreateTenderCommentDto,
  CreateTenderDelegationDto,
  CreateApprovalRuleDto,
  CreateLinkedTenderDto,
  CreateSalesOrderFromTenderDto,
  CreateCompetitorDto,
  CreateTenderPortalDto,
  CreateRegionMappingDto,
} from './tenders.dto.js';
import { teamIds } from '../dashboard/dashboard-metrics.js';
import { containsPattern } from '../../common/utils/like-pattern.js';

/** A GeM bid / RA number (GEM/2026/B/8123456): GeM issues each one once, nationally. */
const GEM_BID_NO_RE = /^GEM\/\d{4}\/[A-Z]\/\d+$/i;

/**
 * QA DEF-037 / DEF-038: a regional manager's bids are their zone's bids plus bids owned by their field team (reps'
 * bids that carry no zone tag). Same rule as dashboard-metrics `territoryTenders`, so the tenders screens, the RM
 * dashboard and Zonal Command count the same bids.
 */
function rmTenderScope(user: AuthUser) {
  const team = teamIds(user.id, user.zone_id ?? null);
  // An RM without a zone has no geography — only the bids their team owns (never all-India).
  const zone = user.zone_id ? sql`tenders.zone_id = ${user.zone_id}` : sql`false`;
  return sql<boolean>`(${zone} or tenders.assigned_to in ${team} or tenders.owner in ${team} or tenders.tender_owner_id in ${team})`;
}

/**
 * Report scope (B4): a regional manager sees the bids their tender list shows; a salesperson only their own bids
 * (same rule as the list); management / admin / tender team see everything.
 */
function tenderReportScope(user: AuthUser) {
  if (user.role === 'regional_manager') return rmTenderScope(user);
  if (user.role === 'sales') {
    return sql<boolean>`(tenders.assigned_to = ${user.id} or tenders.owner = ${user.id} or tenders.tender_owner_id = ${user.id} or tenders.created_by = ${user.id})`;
  }
  return sql<boolean>`true`;
}

/** §27 report definitions — one source for the dashboard and every pipeline report. */
const TENDER_TERMINAL_STATUSES = ['won', 'lost', 'cancelled', 'rejected_internally'];
const TENDER_SUBMITTED_STATUSES = ['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'];
const TENDER_WORKED_UPON_STATUSES = ['under_preparation', ...TENDER_SUBMITTED_STATUSES];
/** Pre-submission stages: the only ones whose submission deadline can still be missed (B2/B3). */
const TENDER_PRE_SUBMISSION_STATUSES = ['identified', 'awaiting_approval', 'under_preparation', 'pq_qualified'];
const sqlList = (values: string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);
const TERMINAL_SQL = sqlList(TENDER_TERMINAL_STATUSES);
const SUBMITTED_SQL = sqlList(TENDER_SUBMITTED_STATUSES);
const WORKED_UPON_SQL = sqlList(TENDER_WORKED_UPON_STATUSES);
const PRE_SUBMISSION_SQL = sqlList(TENDER_PRE_SUBMISSION_STATUSES);
/** Approvals Inbox rule: awaiting approval and not on hold. Shared by the inbox and the Pending Approvals KPI. */
const TENDER_PENDING_APPROVAL_SQL = sql<boolean>`tenders.status = 'awaiting_approval' and coalesce(tenders.on_hold, false) = false`;

/** Stages that need the bids opened, so a submitted bid can only reach them after its closing time. */
const BID_OPENING_TARGETS: StandardTenderStatus[] = [
  'TECHNICAL_EVALUATION',
  'COMMERCIAL_EVALUATION',
  'WON',
  'LOST',
];

@Injectable()
export class TendersService {
  private readonly logger = new Logger(TendersService.name);

  /**
   * R3: may this user open / act on this tender? Every other role keeps the shared region rule (assertRegionScope).
   * A regional manager additionally reaches every bid their tender list shows (rmTenderScope: their zone's bids plus
   * bids assigned to / owned by their field team), so a team member's bid tagged to another zone can be inspected and
   * worked on instead of appearing in the list and then failing with 403.
   */
  private async assertTenderVisible(
    user: AuthUser,
    tender: { id: string; region_id?: string | null; zone_id?: string | null; assigned_to?: string | null; owner?: string | null; tender_owner_id?: string | null },
  ): Promise<void> {
    const scope = {
      entityZoneId: tender.zone_id,
      entityAssignedTo: tender.assigned_to,
      entityOwnerId: tender.owner || tender.tender_owner_id,
    };
    if (user.role !== 'regional_manager') {
      assertRegionScope(user, tender.region_id, scope);
      return;
    }
    if (checkRegionScope(user, tender.region_id, scope)) return;
    if (tender.tender_owner_id && tender.tender_owner_id === user.id) return;
    const inList = await this.db
      .selectFrom('tenders')
      .select('tenders.id')
      .where('tenders.id', '=', tender.id)
      .where(rmTenderScope(user))
      .executeTakeFirst();
    if (!inList) {
      throw new ForbiddenException('Access denied: this tender is outside your zone and your team (IDOR protection)');
    }
  }

  /** A DATE column / 'YYYY-MM-DD' / instant as its IST calendar day ('YYYY-MM-DD'). */
  private istDay(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    // A pg DATE parsed by node-pg arrives as midnight UTC: that calendar day is the stored day.
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
      return d.toISOString().slice(0, 10);
    }
    return istDateOf(d);
  }

  /**
   * While the bid has not closed yet: its closing as IST text ('YYYY-MM-DD HH:mm', or the IST day for a date-only
   * legacy deadline stored at UTC midnight). Null once the bid has closed or when no closing date is recorded.
   */
  private bidClosingBlock(tender: { submission_deadline?: any; bid_closing_date?: any }, now: Date = new Date()): string | null {
    const raw = tender.submission_deadline || tender.bid_closing_date;
    if (!raw) return null;
    const closing = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(closing.getTime())) return null;
    const dateOnly =
      closing.getUTCHours() === 0 && closing.getUTCMinutes() === 0 && closing.getUTCSeconds() === 0 && closing.getUTCMilliseconds() === 0;
    if (dateOnly) {
      // A date-only closing has no real time: the bid counts as closed from that IST day.
      const closingDay = calendarDay(closing.toISOString().slice(0, 10));
      return closingDay && todayInKolkata() < closingDay ? closingDay : null;
    }
    return now < closing ? this.istLabel(closing) : null;
  }

  /** An instant as 'YYYY-MM-DD HH:mm' IST wall clock (for notification text). */
  private istLabel(d: Date): string {
    return new Date(d.getTime() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 16);
  }

  /** Whole IST calendar days from today to the deadline's IST day (0 = due today, negative = overdue). */
  private istDaysLeft(deadline: Date, now: Date = new Date()): number {
    return isoDaysBetween(istDateOf(now), istDateOf(deadline));
  }

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
    private readonly workflowService: TendersWorkflowService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to parse and convert date/time string into a UTC Date object.
   * If entered without timezone offset (e.g. '2026-10-15 15:00'), treats as IST (Asia/Kolkata, +05:30).
   */
  private parseDateTimeIST(dateStr: string | Date | number | undefined | null): Date | null {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
    if (typeof dateStr === 'number') {
      return new Date(Math.round((dateStr - 25569) * 86400 * 1000));
    }
    const trimmed = String(dateStr).trim();
    if (!trimmed) return null;

    // Check DD-MM-YYYY or DD/MM/YYYY format (with optional time)
    const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (ddmmyyyyMatch) {
      const day = ddmmyyyyMatch[1].padStart(2, '0');
      const month = ddmmyyyyMatch[2].padStart(2, '0');
      const year = ddmmyyyyMatch[3];
      const hour = (ddmmyyyyMatch[4] || '15').padStart(2, '0');
      const min = (ddmmyyyyMatch[5] || '00').padStart(2, '0');
      const sec = (ddmmyyyyMatch[6] || '00').padStart(2, '0');
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}+05:30`);
    }

    // Check if timezone or Z is present
    const hasTz = trimmed.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(trimmed);
    if (hasTz) {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    }

    // Treat as IST: replace space with T if needed and append +05:30
    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const withTz = normalized.length <= 10 ? `${normalized}T15:00:00+05:30` : (normalized.length <= 16 ? `${normalized}:00+05:30` : `${normalized}+05:30`);
    const d = new Date(withTz);
    if (!isNaN(d.getTime())) return d;
    // Last resort: the engine's own parser; unreadable text is null (callers report it), never an Invalid Date.
    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  /**
   * Helper to calculate deadline urgency tag
   */
  private calculateDeadlineTag(bidClosingDate?: string | Date | null, status?: string): string {
    if (!bidClosingDate) return 'normal';
    if (['won', 'lost', 'cancelled'].includes((status || '').toLowerCase())) {
      return 'completed';
    }

    const now = new Date();
    const deadline = new Date(bidClosingDate);
    const diffMs = deadline.getTime() - now.getTime();

    if (diffMs < 0) return 'overdue';
    if (diffMs <= TENDER_URGENT_HOURS * 3600 * 1000) return 'urgent_48h';
    if (diffMs <= TENDER_UPCOMING_DAYS * 24 * 3600 * 1000) return 'upcoming_7d';
    return 'normal';
  }

  /**
   * Next free internal reference for the current IST year: TND-YYYY-NNNNN, one above the highest reference already
   * used that year (soft-deleted tenders included, so a reference is never reused). Computed from the table itself,
   * so it can never collide with refs back-filled by migrations or imported rows. Callers insert inside a
   * transaction and retry on a unique violation (two registrations racing for the same number).
   */
  private async nextInternalRef(executor: Kysely<Database> = this.db): Promise<string> {
    const prefix = `TND-${todayInKolkata().slice(0, 4)}-`;
    // The start offset MUST be cast to int: an untyped parameter makes Postgres pick substring(text FROM pattern)
    // (a regex match), which returns e.g. "10" out of "TND-2026-01092" and re-issues an old reference.
    const start = prefix.length + 1;
    const res = await sql<{ n: number }>`
      select coalesce(max(substring(internal_ref from ${start}::int)::bigint), 0)::int as n
      from tenders
      where internal_ref like ${`${prefix}%`}
        and substring(internal_ref from ${start}::int) ~ '^[0-9]+$'
    `.execute(executor);
    const next = Number(res.rows[0]?.n || 0) + 1;
    return `${prefix}${String(next).padStart(5, '0')}`;
  }

  /** True for a Postgres unique violation, optionally on one named constraint. */
  private isUniqueViolation(err: any, constraint?: string): boolean {
    if (err?.code !== '23505') return false;
    return constraint ? String(err?.constraint || '') === constraint : true;
  }

  /**
   * Turns raw database errors from tender writes into human messages (never the raw "Key (...)=(...)" detail):
   * unique violations → 409, trigger validations (RAISE EXCEPTION) and constraint failures → 400.
   */
  private toFriendlyDbError(err: any, context = 'save the tender'): Error {
    if (err instanceof HttpException) return err;
    const code = err?.code;
    const constraint = String(err?.constraint || '');
    if (code === '23505') {
      if (constraint.includes('internal_ref')) {
        return new ConflictException('Could not allocate a tender reference number. Please try again.');
      }
      if (constraint.includes('tender_no') || constraint.includes('tender_number')) {
        return new ConflictException('A tender with this tender number is already registered for this organisation.');
      }
      return new ConflictException(`Could not ${context}: a record with the same details already exists.`);
    }
    if (code === 'P0001' && err?.message) {
      // Business rules enforced by the tenders integrity trigger (e.g. region/zone mismatch).
      return new BadRequestException(String(err.message));
    }
    if (code === '23514') {
      return new BadRequestException(`Could not ${context}: one of the values is not allowed.`);
    }
    if (code === '23503') {
      return new BadRequestException(`Could not ${context}: a referenced record (user, product, region…) does not exist.`);
    }
    return err;
  }

  // =========================================================================
  // 1. Master Configuration Endpoints (Admin Editable)
  // =========================================================================

  async getSettings() {
    let settings = await this.db
      .selectFrom('tender_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();

    if (!settings) {
      await this.db
        .insertInto('tender_settings')
        .values({
          id: 1,
          upcoming_days: 7,
          approaching_days: 3,
          approval_sla_hours: 24,
          result_followup_days: 15,
          allow_self_approval: false,
          require_won_value: true,
          escalation_user_ids: '[]' as any,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      settings = await this.db
        .selectFrom('tender_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
    }

    return settings;
  }

  async updateSettings(dto: UpdateTenderSettingsDto) {
    const updateData: any = { updated_at: new Date() };
    if (dto.upcoming_days !== undefined) updateData.upcoming_days = dto.upcoming_days;
    if (dto.approaching_days !== undefined) updateData.approaching_days = dto.approaching_days;
    if (dto.approval_sla_hours !== undefined) updateData.approval_sla_hours = dto.approval_sla_hours;
    if (dto.result_followup_days !== undefined) updateData.result_followup_days = dto.result_followup_days;
    if (dto.allow_self_approval !== undefined) updateData.allow_self_approval = dto.allow_self_approval;
    if (dto.require_won_value !== undefined) updateData.require_won_value = dto.require_won_value;
    if (dto.escalation_user_ids !== undefined) updateData.escalation_user_ids = JSON.stringify(dto.escalation_user_ids);

    await this.db
      .updateTable('tender_settings')
      .set(updateData)
      .where('id', '=', 1)
      .execute();

    return this.getSettings();
  }

  async getApprovers() {
    return this.db
      .selectFrom('tender_approvers')
      .innerJoin('users', 'tender_approvers.user_id', 'users.id')
      .select([
        'tender_approvers.id',
        'tender_approvers.user_id',
        'tender_approvers.created_at',
        'users.full_name',
        'users.email',
        'users.role',
      ])
      .orderBy('users.full_name', 'asc')
      .execute();
  }

  async addApprover(dto: AddApproverDto) {
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', dto.user_id)
      .executeTakeFirst();
    if (!user) {
      throw new NotFoundException(`User with ID ${dto.user_id} not found`);
    }

    await this.db
      .insertInto('tender_approvers')
      .values({ user_id: dto.user_id })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();

    return this.getApprovers();
  }

  async removeApprover(userId: string) {
    await this.db
      .deleteFrom('tender_approvers')
      .where('user_id', '=', userId)
      .execute();
    return { success: true };
  }

  async getLossReasons() {
    return this.db
      .selectFrom('loss_reasons')
      .selectAll()
      .orderBy('sort_order', 'asc')
      .execute();
  }

  async createLossReason(dto: CreateLossReasonDto) {
    const code = dto.code.toUpperCase().trim();
    return this.db
      .insertInto('loss_reasons')
      .values({
        code,
        label: dto.label.trim(),
        sort_order: dto.sort_order || 0,
        active: true,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async updateLossReason(id: string, dto: UpdateLossReasonDto) {
    const updateData: any = {};
    if (dto.label !== undefined) updateData.label = dto.label.trim();
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;

    const res = await this.db
      .updateTable('loss_reasons')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!res) throw new NotFoundException(`Loss reason with ID ${id} not found`);
    return res;
  }

  async getStatuses() {
    return this.db
      .selectFrom('tender_statuses')
      .selectAll()
      .orderBy('sort_order', 'asc')
      .execute();
  }

  async updateStatusLabel(code: string, dto: UpdateTenderStatusLabelDto) {
    const c = code.toUpperCase().trim();
    const updateData: any = { updated_at: new Date() };
    if (dto.label) updateData.label = dto.label.trim();
    if (dto.color) updateData.color = dto.color;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;

    const res = await this.db
      .updateTable('tender_statuses')
      .set(updateData)
      .where('code', '=', c)
      .returningAll()
      .executeTakeFirst();

    if (!res) throw new NotFoundException(`Status code "${code}" not found`);
    return res;
  }

  async getCategories() {
    return this.db
      .selectFrom('tender_categories')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('sort_order', 'asc')
      .execute();
  }

  async getAllCategoriesAdmin() {
    return this.db
      .selectFrom('tender_categories')
      .selectAll()
      .orderBy('sort_order', 'asc')
      .execute();
  }

  async createCategory(dto: CreateTenderCategoryDto) {
    const code = dto.code.toLowerCase().trim();
    return this.db
      .insertInto('tender_categories')
      .values({
        code,
        name: dto.name.trim(),
        requires_pq: dto.requires_pq ?? (code === 'pq'),
        description: dto.description || null,
        is_active: true,
        active: true,
        sort_order: dto.sort_order || 0,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async updateCategory(id: string, dto: UpdateTenderCategoryDto) {
    const updateData: any = { updated_at: new Date() };
    if (dto.name) updateData.name = dto.name.trim();
    if (dto.requires_pq !== undefined) updateData.requires_pq = dto.requires_pq;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;
    if (dto.active !== undefined || dto.is_active !== undefined) {
      const activeVal = dto.active ?? dto.is_active;
      updateData.active = activeVal;
      updateData.is_active = activeVal;
    }

    const res = await this.db
      .updateTable('tender_categories')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!res) throw new NotFoundException(`Tender category ${id} not found`);
    return res;
  }

  /**
   * Section 1: "A category that is in use can only be deactivated, never deleted."
   */
  async deactivateCategory(id: string) {
    // Check if category is in use
    const inUse = await this.db
      .selectFrom('tenders')
      .select('id')
      .where('category_id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst();

    if (inUse) {
      // In use: deactivate, do not delete
      await this.db
        .updateTable('tender_categories')
        .set({ is_active: false, active: false, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      return { success: true, message: 'Category is in use by existing tenders and has been deactivated.' };
    }

    // Not in use: allow delete
    await this.db
      .deleteFrom('tender_categories')
      .where('id', '=', id)
      .execute();
    return { success: true, message: 'Category removed successfully.' };
  }

  async getZones() {
    return this.db
      .selectFrom('zones')
      .selectAll()
      .where('active', '=', true)
      .orderBy('name', 'asc')
      .execute();
  }

  async getRegions(zoneId?: string) {
    let q = this.db
      .selectFrom('regions')
      .selectAll()
      .where('active', '=', true);
    if (zoneId) q = q.where('zone_id', '=', zoneId);
    return q.orderBy('name', 'asc').execute();
  }

  // =========================================================================
  // 2. Tender Register & CRUD
  // =========================================================================

  /**
   * Rows matching one Stage-filter option. On Hold is the `on_hold` flag (the held bid keeps its stage in `status`),
   * so `on_hold` matches held bids and every other stage leaves them out — a held bid is On Hold, not in its old stage.
   */
  private tenderStageMatch(status: string) {
    const raw = status.toLowerCase().trim();
    if (raw === 'on_hold') return sql<boolean>`coalesce(tenders.on_hold, false) = true`;

    let match;
    if (raw === 'results') {
      match = sql`tenders.status in ${sqlList(['won', 'lost', 'technical_eval', 'commercial_eval'])}`;
    } else if (raw === 'under_preparation') {
      match = sql`tenders.status in ${sqlList(['under_preparation', 'pq_submitted', 'pq_qualified'])}`;
    } else if (raw.includes(',')) {
      const statuses = raw.split(',').map((s) => s.trim()).filter(Boolean);
      match = sql`tenders.status::text in (${sql.join(statuses)})`;
    } else {
      const norm = this.workflowService.normalizeStatus(status);
      const leg = this.workflowService.toLegacyStatus(status);
      match = sql`(tenders.status::text = ${norm.toLowerCase()} or tenders.status::text = ${leg} or upper(tenders.status::text) = ${norm})`;
    }
    return sql<boolean>`(${match}) and coalesce(tenders.on_hold, false) = false`;
  }

  /** Rows matching one Deadline-filter option: pre-submission bids only (a submitted bid has no open submission deadline). */
  private tenderDeadlineMatch(deadline: string, now: Date) {
    const from = now.toISOString();
    let window;
    if (deadline === 'due_today') {
      // "Today" is the IST calendar day (the server clock is UTC).
      const istToday = todayInKolkata(now);
      window = sql`tenders.submission_deadline >= ${istDateTime(istToday, '00:00:00').toISOString()} and tenders.submission_deadline <= ${istEndOfDay(istToday).toISOString()}`;
    } else if (deadline === 'urgent_48h') {
      // §24 "Urgent closing (≤ 48 hours)" — the same window as the main dashboard's "Close ≤ 48h".
      const until = new Date(now.getTime() + TENDER_URGENT_HOURS * 3600 * 1000).toISOString();
      window = sql`tenders.submission_deadline >= ${from} and tenders.submission_deadline <= ${until}`;
    } else if (deadline === 'upcoming_7d') {
      const until = new Date(now.getTime() + TENDER_UPCOMING_DAYS * 24 * 3600 * 1000).toISOString();
      window = sql`tenders.submission_deadline >= ${from} and tenders.submission_deadline <= ${until}`;
    } else if (deadline === 'overdue') {
      window = sql`tenders.submission_deadline < ${from}`;
    } else {
      return null;
    }
    return sql<boolean>`tenders.status in ${PRE_SUBMISSION_SQL} and ${window}`;
  }

  /** Rows matching one Category-filter option (the tender's category enum or its master category code). */
  private tenderCategoryMatch(category: string) {
    const cat = category.toLowerCase().trim();
    return sql<boolean>`(tenders.category::text = ${cat} or lower(tender_categories.code) = ${cat})`;
  }

  /**
   * The tender register in the caller's scope with the list filters applied — one source for the list and for the
   * /tenders/dashboard counts. `except` leaves one filter dimension out, so the counts of that dimension's options
   * (stage, deadline or category) are not narrowed by the option currently picked.
   */
  private filteredTenders(
    query: TenderQueryDto,
    user: AuthUser,
    except?: 'status' | 'deadline' | 'category',
    now: Date = new Date(),
  ) {
    let baseQuery = this.db
      .selectFrom('tenders')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .leftJoin('products', 'tenders.product_id', 'products.id')
      .leftJoin('zones', 'tenders.zone_id', 'zones.id')
      .leftJoin('regions', 'tenders.region_id', 'regions.id')
      .leftJoin('tender_categories', 'tenders.category_id', 'tender_categories.id')
      .leftJoin('users as assignee', 'tenders.assigned_to', 'assignee.id')
      .leftJoin('users as owner', 'tenders.owner', 'owner.id')
      .where('tenders.is_deleted', '=', false);

    // Territorial scoping
    if (user.role === 'regional_manager') {
      baseQuery = baseQuery.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
        ]),
      );
    }

    // Direct filters
    const zone = (query.zone_id || query.zone || '').trim();
    if (zone) {
      // A zone id, or a zone name / code ("North", "NE") — never a uuid cast error.
      baseQuery = isUUID(zone)
        ? baseQuery.where('tenders.zone_id', '=', zone)
        : baseQuery.where(sql<boolean>`(lower(zones.name) = ${zone.toLowerCase()} or lower(zones.code) = ${zone.toLowerCase()})`);
    }

    const regionId = query.region_id || query.region;
    if (regionId) baseQuery = baseQuery.where('tenders.region_id', '=', regionId);

    const orgId = query.organisation_id;
    if (orgId) baseQuery = baseQuery.where('tenders.organisation_id', '=', orgId);

    if (query.organisation) {
      const orgStr = containsPattern(query.organisation);
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(tenders.organisation) like ${orgStr}`,
          sql<boolean>`lower(organisations.name) like ${orgStr}`,
        ]),
      );
    }

    if (query.product_id) baseQuery = baseQuery.where('tenders.product_id', '=', query.product_id);
    if (query.department) baseQuery = baseQuery.where('tenders.department', '=', query.department);
    if (query.city) baseQuery = baseQuery.where('tenders.city', '=', query.city);
    if (query.state) baseQuery = baseQuery.where('tenders.state', '=', query.state);

    if (query.status?.trim() && except !== 'status') {
      baseQuery = baseQuery.where(this.tenderStageMatch(query.status));
    }

    if (query.category?.trim() && except !== 'category') {
      baseQuery = baseQuery.where(this.tenderCategoryMatch(query.category));
    }

    const assigned = query.assigned_to || query.assignedPerson;
    if (assigned) {
      baseQuery = baseQuery.where('tenders.assigned_to', '=', assigned);
    }

    const ownerId = query.tender_owner_id || query.tenderOwner;
    if (ownerId) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('tenders.owner', '=', ownerId),
          eb('tenders.tender_owner_id', '=', ownerId),
        ]),
      );
    }

    const deadlineMatch = query.deadline && except !== 'deadline' ? this.tenderDeadlineMatch(query.deadline, now) : null;
    if (deadlineMatch) baseQuery = baseQuery.where(deadlineMatch);

    // Search query
    if (query.search && query.search.trim()) {
      const s = containsPattern(query.search);
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(coalesce(tenders.tender_number, tenders.tender_no)) like ${s}`,
          sql<boolean>`lower(coalesce(tenders.organisation, organisations.name)) like ${s}`,
          sql<boolean>`lower(tenders.requirement_text) like ${s}`,
          sql<boolean>`lower(tenders.city) like ${s}`,
          sql<boolean>`lower(assignee.full_name) like ${s}`,
        ]),
      );
    }

    // Date range filter
    if (query.from_date || query.to_date) {
      const dateCol = query.date_field === 'submission_deadline' ? 'tenders.submission_deadline' : 'tenders.publication_date';
      if (query.from_date) {
        baseQuery = baseQuery.where(sql<boolean>`${sql.ref(dateCol)} >= ${query.from_date}`);
      }
      if (query.to_date) {
        baseQuery = baseQuery.where(sql<boolean>`${sql.ref(dateCol)} <= ${query.to_date}`);
      }
    }

    return baseQuery;
  }

  async findAll(query: TenderQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams({
      page: Number(query.page || 1),
      limit: Number(query.limit || 20),
    });

    const baseQuery = this.filteredTenders(query, user);

    const countRes = await baseQuery
      .select(sql<number>`count(tenders.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const sortField = query.sortBy || 'submission_deadline';
    const sortDirection = (query.sortOrder || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    let orderQuery = baseQuery;

    if (sortField === 'created_at') {
      orderQuery = orderQuery.orderBy('tenders.created_at', sortDirection);
    } else if (sortField === 'tender_number' || sortField === 'tender_no') {
      orderQuery = orderQuery.orderBy('tenders.tender_no', sortDirection);
    } else if (sortField === 'publication_date' || sortField === 'publish_date') {
      orderQuery = orderQuery
        .orderBy(sql`case when tenders.publication_date is null then 1 else 0 end`, 'asc')
        .orderBy('tenders.publication_date', sortDirection);
    } else if (sortField === 'updated_at' || sortField === 'last_activity_at') {
      orderQuery = orderQuery.orderBy('tenders.last_activity_at', sortDirection);
    } else if (sortField === 'estimated_value') {
      orderQuery = orderQuery.orderBy(
        sql`coalesce(tenders.estimated_value, 0)`,
        sortDirection,
      );
    } else {
      orderQuery = orderQuery
        .orderBy(sql`case when tenders.submission_deadline is null then 1 else 0 end`, 'asc')
        .orderBy('tenders.submission_deadline', sortDirection);
    }

    const items = await orderQuery
      .select([
        'tenders.id',
        'tenders.tender_no',
        'tenders.tender_number',
        'tenders.organisation_id',
        'tenders.organisation',
        'tenders.department',
        'tenders.product_id',
        'tenders.requirement_text',
        'tenders.city',
        'tenders.state',
        'tenders.zone_id',
        'tenders.region_id',
        'tenders.category',
        'tenders.category_id',
        'tenders.quantity',
        'tenders.bidder_turnover',
        'tenders.oem_turnover',
        'tenders.emd_fee',
        'tenders.emd_amount',
        'tenders.publish_date',
        'tenders.publication_date',
        'tenders.bid_closing_date',
        'tenders.submission_deadline',
        'tenders.submission_date',
        'tenders.result_date',
        'tenders.assigned_to',
        'tenders.assigned_person_id',
        'tenders.tender_owner_id',
        'tenders.owner',
        'tenders.status',
        'tenders.on_hold',
        'tenders.status_before_hold',
        'tenders.prep_checklist_done',
        'tenders.estimated_value',
        'tenders.tender_value',
        'tenders.portal',
        'tenders.tender_url',
        'tenders.remarks',
        'tenders.rejection_reason',
        'tenders.loss_reason',
        'tenders.competitor',
        'tenders.version',
        'tenders.last_activity_at',
        'tenders.created_at',
        'tenders.updated_at',
        'organisations.name as organisation_name',
        'products.name as product_name',
        'zones.name as zone_name',
        'regions.name as region_name',
        'tender_categories.name as category_name',
        'tender_categories.code as category_code',
        'tender_categories.requires_pq as category_requires_pq',
        'assignee.full_name as assigned_to_name',
        'owner.full_name as tender_owner_name',
        // BOQ size for the register's "Qty & Value" column (the tenders.quantity header field is often left at 1).
        sql<number | null>`(select sum(li.quantity) from tender_line_items li where li.tender_id = tenders.id)`.as('line_items_quantity'),
      ])
      .limit(limit)
      .offset(offset)
      .execute();

    const now = new Date();
    const mapped = items.map((t) => {
      const deadline = t.submission_deadline || t.bid_closing_date;
      let daysLeft: number | null = null;
      let hoursLeft: number | null = null;
      if (deadline) {
        const diffMs = new Date(deadline).getTime() - now.getTime();
        daysLeft = this.istDaysLeft(new Date(deadline), now);
        hoursLeft = Math.round(diffMs / (3600 * 1000));
      }

      const catVal = (t as any).category_code || t.category || (t.category_requires_pq ? 'pq' : 'general_mha');

      return {
        ...t,
        category: catVal,
        tender_number: t.tender_number || t.tender_no,
        organisation: t.organisation || t.organisation_name || 'Arihant Customer',
        days_left: daysLeft,
        hours_left: hoursLeft,
        deadline_tag: this.calculateDeadlineTag(deadline, t.status),
      };
    });

    return buildPaginatedResult(mapped, total, page, limit);
  }

  async findOne(id: string, user?: AuthUser) {
    const tender = await this.db
      .selectFrom('tenders')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .leftJoin('products', 'tenders.product_id', 'products.id')
      .leftJoin('zones', 'tenders.zone_id', 'zones.id')
      .leftJoin('regions', 'tenders.region_id', 'regions.id')
      .leftJoin('tender_categories', 'tenders.category_id', 'tender_categories.id')
      .leftJoin('users as assignee', 'tenders.assigned_to', 'assignee.id')
      .leftJoin('users as owner', 'tenders.owner', 'owner.id')
      .leftJoin('users as approver', 'tenders.internal_approval_by', 'approver.id')
      .selectAll('tenders')
      .select([
        'organisations.name as organisation_name',
        'products.name as product_name',
        'zones.name as zone_name',
        'regions.name as region_name',
        'tender_categories.name as category_name',
        'tender_categories.code as category_code',
        'tender_categories.requires_pq as category_requires_pq',
        'assignee.full_name as assigned_to_name',
        'owner.full_name as tender_owner_name',
        'approver.full_name as internal_approval_by_name',
      ])
      .where('tenders.id', '=', id)
      .where('tenders.is_deleted', '=', false)
      .executeTakeFirst();

    if (!tender) {
      throw new NotFoundException(`Tender with ID ${id} not found`);
    }

    if (
      user &&
      user.role === 'sales' &&
      tender.assigned_to !== user.id &&
      tender.owner !== user.id &&
      tender.tender_owner_id !== user.id &&
      tender.created_by !== user.id
    ) {
      throw new ForbiddenException('You only have access to tenders assigned to you');
    }
    // A regional manager's detail view is bounded by the same rule as their list (zone + team-owned bids).
    if (user && user.role === 'regional_manager') {
      await this.assertTenderVisible(user, tender);
    }

    // Parallel child queries
    const [
      history,
      outcomes,
      resultRow,
      approvals,
      portalIssues,
      deadlineChanges,
      activities,
      lineItems,
      documents,
      corrigenda,
      financialInstruments,
      comments,
    ] = await Promise.all([
      this.db
        .selectFrom('tender_status_history')
        .leftJoin('users', 'tender_status_history.changed_by', 'users.id')
        .selectAll('tender_status_history')
        .select('users.full_name as changed_by_name')
        .where('tender_id', '=', id)
        .orderBy('tender_status_history.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_outcomes')
        .selectAll()
        .where('tender_id', '=', id)
        .executeTakeFirst(),
      this.db
        .selectFrom('tender_results')
        .leftJoin('zones', 'tender_results.zone_id', 'zones.id')
        .leftJoin('regions', 'tender_results.region_id', 'regions.id')
        .leftJoin('users', 'tender_results.assigned_to', 'users.id')
        .selectAll('tender_results')
        .select([
          'zones.name as snapshot_zone_name',
          'regions.name as snapshot_region_name',
          'users.full_name as snapshot_assigned_to_name',
        ])
        .where('tender_id', '=', id)
        .executeTakeFirst(),
      this.db
        .selectFrom('tender_approvals')
        .leftJoin('users as req', 'tender_approvals.requested_by', 'req.id')
        .leftJoin('users as app', 'tender_approvals.approver_id', 'app.id')
        .selectAll('tender_approvals')
        .select([
          'req.full_name as requested_by_name',
          'app.full_name as approver_name',
        ])
        .where('tender_id', '=', id)
        .orderBy('tender_approvals.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_portal_issues')
        .leftJoin('users as rep', 'tender_portal_issues.reported_by', 'rep.id')
        .leftJoin('users as resp', 'tender_portal_issues.responsible_person_id', 'resp.id')
        .selectAll('tender_portal_issues')
        .select([
          'rep.full_name as reported_by_name',
          'resp.full_name as responsible_name',
        ])
        .where('tender_id', '=', id)
        .orderBy('tender_portal_issues.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_deadline_changes')
        .leftJoin('users', 'tender_deadline_changes.changed_by', 'users.id')
        .selectAll('tender_deadline_changes')
        .select('users.full_name as changed_by_name')
        .where('tender_id', '=', id)
        .orderBy('tender_deadline_changes.changed_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_activities')
        .leftJoin('users', 'tender_activities.performed_by', 'users.id')
        .selectAll('tender_activities')
        .select('users.full_name as performed_by_name')
        .where('tender_id', '=', id)
        .orderBy('tender_activities.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_line_items')
        .leftJoin('products', 'tender_line_items.product_id', 'products.id')
        .selectAll('tender_line_items')
        .select([
          'products.name as product_name',
          'products.gem_listed as product_gem_listed',
          'products.gem_catalogue_id as product_gem_catalogue_id',
        ])
        .where('tender_line_items.tender_id', '=', id)
        .orderBy('tender_line_items.created_at', 'asc')
        .execute(),
      this.db
        .selectFrom('tender_documents')
        .leftJoin('users', 'tender_documents.owner_id', 'users.id')
        .selectAll('tender_documents')
        .select('users.full_name as owner_name')
        .where('tender_documents.tender_id', '=', id)
        .orderBy('tender_documents.created_at', 'asc')
        .execute(),
      this.db
        .selectFrom('tender_corrigenda')
        .leftJoin('users', 'tender_corrigenda.created_by', 'users.id')
        .selectAll('tender_corrigenda')
        .select('users.full_name as created_by_name')
        .where('tender_corrigenda.tender_id', '=', id)
        .orderBy('tender_corrigenda.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_financial_instruments')
        .leftJoin('users', 'tender_financial_instruments.finance_owner_id', 'users.id')
        .selectAll('tender_financial_instruments')
        .select('users.full_name as finance_owner_name')
        .where('tender_financial_instruments.tender_id', '=', id)
        .orderBy('tender_financial_instruments.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('tender_comments')
        .leftJoin('users', 'tender_comments.author_id', 'users.id')
        .selectAll('tender_comments')
        .select(['users.full_name as author_name', 'users.email as author_email'])
        .where('tender_comments.tender_id', '=', id)
        .orderBy('tender_comments.created_at', 'asc')
        .execute(),
    ]);

    const deadline = tender.submission_deadline || tender.bid_closing_date;
    const now = new Date();
    let daysLeft: number | null = null;
    let hoursLeft: number | null = null;
    // A closed tender (won, lost, cancelled …) has no live countdown: the deadline is history, not "3d left".
    const isClosed = this.isClosedStatus(tender.status);
    if (deadline && !isClosed) {
      const diffMs = new Date(deadline).getTime() - now.getTime();
      daysLeft = this.istDaysLeft(new Date(deadline), now);
      hoursLeft = Math.round(diffMs / (3600 * 1000));
    }

    // Readiness = mandatory documents Ready / mandatory required (template when no checklist yet). Never 100% by default.
    const readiness = await this.computeDocumentReadiness(
      { id, category: tender.category, category_code: tender.category_code, category_name: tender.category_name },
      documents,
    );

    return {
      ...tender,
      tender_number: tender.tender_number || tender.tender_no,
      organisation: tender.organisation || tender.organisation_name || 'Arihant Customer',
      status: tender.status,
      result: outcomes?.result || resultRow?.outcome || (['won', 'lost'].includes(tender.status) ? tender.status : null),
      loss_reason: tender.loss_reason || outcomes?.reason || resultRow?.loss_reasons?.[0] || null,
      days_left: daysLeft,
      hours_left: hoursLeft,
      deadline_tag: this.calculateDeadlineTag(deadline, tender.status),
      history,
      outcome: outcomes || resultRow || null,
      tender_result: resultRow || null,
      approvals,
      portal_issues: portalIssues,
      deadline_changes: deadlineChanges,
      activities,
      line_items: lineItems,
      documents,
      document_completion_percentage: readiness.percentage,
      document_readiness: readiness,
      corrigenda,
      financial_instruments: financialInstruments,
      comments,
    };
  }

  /**
   * Create tender with Section 2 constraints, deduplication, and IST timezone handling.
   */
  async create(dto: CreateTenderDto, user: AuthUser) {
    // 1. Validate required trimmed fields
    const tenderNumber = (dto.tender_number || dto.tender_no || '').trim();
    if (!tenderNumber) {
      throw new BadRequestException('Tender number is required and cannot be blank or whitespace only');
    }

    let orgName = (dto.organisation || '').trim();
    let orgId = dto.organisation_id || null;

    if (!orgName && !orgId) {
      throw new BadRequestException('Organisation is required and cannot be blank or whitespace only');
    }

    if (!orgName && orgId) {
      const orgRecord = await this.db
        .selectFrom('organisations')
        .select('name')
        .where('id', '=', orgId)
        .executeTakeFirst();
      if (orgRecord) orgName = orgRecord.name;
    } else if (orgName && !orgId) {
      // Find or create organisation
      const existingOrg = await this.db
        .selectFrom('organisations')
        .select('id')
        .where(sql`lower(trim(name))`, '=', orgName.toLowerCase())
        .executeTakeFirst();
      if (existingOrg) {
        orgId = existingOrg.id;
      }
    }

    if (!orgName) orgName = 'Arihant Customer';

    // 2. Validate deduplication: Unique on (lower(trim(tender_number)), lower(trim(organisation))) WHERE is_deleted = false.
    // A GeM bid number (GEM/2026/B/8123456) is issued once nationally, so it is unique across buyers too (QA BUG-005).
    const isGemBidNo = GEM_BID_NO_RE.test(tenderNumber);
    const duplicate = await this.db
      .selectFrom('tenders')
      .select(['id', 'internal_ref', 'organisation'])
      .where(sql`lower(trim(coalesce(tender_number, tender_no)))`, '=', tenderNumber.toLowerCase())
      .$if(!isGemBidNo, (qb) => qb.where(sql`lower(trim(coalesce(organisation, '')))`, '=', orgName.toLowerCase()))
      .where('is_deleted', '=', false)
      .executeTakeFirst();

    if (duplicate) {
      throw new ConflictException(
        isGemBidNo
          ? `GeM bid number "${tenderNumber}" is already registered${duplicate.internal_ref ? ` as ${duplicate.internal_ref}` : ''}${duplicate.organisation ? ` (buyer: ${duplicate.organisation})` : ''}.`
          : `Tender "${tenderNumber}" for organisation "${orgName}" is already registered.`,
      );
    }

    // 3. Dates validation
    const rawDeadline = dto.submission_deadline || dto.bid_closing_date;
    if (!rawDeadline) {
      throw new BadRequestException('Submission deadline is required (date + time)');
    }

    const submissionDeadline = this.parseDateTimeIST(rawDeadline);
    if (!submissionDeadline) {
      throw new BadRequestException('Invalid submission deadline format');
    }

    const rawPubDate = dto.publication_date || dto.publish_date;
    const publicationDate = rawPubDate ? this.istDay(rawPubDate as any) : null;

    if (publicationDate && submissionDeadline) {
      const deadlineDateStr = istDateOf(submissionDeadline);
      if (publicationDate > deadlineDateStr) {
        throw new BadRequestException('Submission deadline cannot be earlier than publication date');
      }
    }

    // Block creating tender with deadline in the past unless in historical/import mode
    const isHistorical = Boolean((dto as any).extra_fields?.is_historical || (dto as any).is_historical);
    if (!isHistorical && submissionDeadline < new Date()) {
      throw new BadRequestException('Cannot create a tender with a submission deadline already in the past');
    }

    // 3b. Numeric fields: quantities are whole units ≥ 1, money is never negative.
    this.assertTenderNumbers(dto);
    if (Array.isArray(dto.line_items)) {
      dto.line_items.forEach((li: any, i: number) => this.assertLineItemNumbers(li, `Line item ${i + 1}: `));
    }

    // 4. Zone & Region validation:
    // Region without zone is rejected. Region must belong to selected zone. Empty string stored as null.
    let zoneId = dto.zone_id ? dto.zone_id.trim() || null : null;
    let regionId = dto.region_id ? dto.region_id.trim() || null : null;

    if (!zoneId && dto.zone) {
      const zMatch = await this.db
        .selectFrom('zones')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('code', '=', dto.zone!.trim().toUpperCase()),
            eb(sql`lower(name)`, '=', dto.zone!.trim().toLowerCase()),
          ]),
        )
        .executeTakeFirst();
      if (zMatch) zoneId = zMatch.id;
    }

    if (!regionId && dto.region) {
      const rMatch = await this.db
        .selectFrom('regions')
        .select('id')
        .where(sql`lower(name)`, '=', dto.region!.trim().toLowerCase())
        .executeTakeFirst();
      if (rMatch) regionId = rMatch.id;
    }

    if (regionId && !zoneId) {
      throw new BadRequestException('Region without zone is rejected. Please select the zone for this region.');
    }

    if (regionId && zoneId) {
      const regionRec = await this.db
        .selectFrom('regions')
        .select('zone_id')
        .where('id', '=', regionId)
        .executeTakeFirst();
      if (!regionRec || regionRec.zone_id !== zoneId) {
        throw new BadRequestException('Selected region does not belong to the selected zone.');
      }
    }

    // 5. Category resolution
    let categoryCode = (dto.category || dto.tender_category || 'general_mha').toLowerCase().trim();
    let categoryId = (dto as any).category_id || null;

    if (categoryId) {
      const catRec = await this.db
        .selectFrom('tender_categories')
        .select(['id', 'code'])
        .where('id', '=', categoryId)
        .executeTakeFirst();
      if (catRec) categoryCode = catRec.code.toLowerCase();
    } else {
      const catRec = await this.db
        .selectFrom('tender_categories')
        .select(['id', 'code'])
        .where(sql`lower(code)`, '=', categoryCode)
        .executeTakeFirst();
      if (catRec) categoryId = catRec.id;
    }

    const assignedTo = dto.assigned_to || dto.assigned_person_id || null;
    const owner = dto.tender_owner_id || (dto as any).owner || user.id;
    const initialStatus = 'identified';
    const estValue = dto.estimated_value ?? (dto.estimated_value_lakh ? Number(dto.estimated_value_lakh) * 100000 : null);

    let portalId = dto.portal_id || null;
    if (!portalId && (dto.portal || dto.tender_portal_url)) {
      const pRec = await this.db
        .selectFrom('tender_portals')
        .select('id')
        .where((eb) =>
          eb.or([
            eb(sql`lower(name)`, '=', (dto.portal || 'gem').toLowerCase().trim()),
            eb(sql`lower(code)`, '=', (dto.portal || 'gem').toLowerCase().trim()),
          ]),
        )
        .executeTakeFirst();
      if (pRec) portalId = pRec.id;
    }

    // The internal reference is allocated inside the transaction from the highest ref in use; if a concurrent
    // registration takes the same number first, the unique constraint rejects ours and the whole insert is retried.
    const MAX_REF_ATTEMPTS = 3;
    let created: any = null;
    for (let attempt = 1; !created; attempt++) {
      try {
        created = await this.createTenderInTransaction(dto, user, {
          tenderNumber,
          orgId,
          orgName,
          zoneId,
          regionId,
          categoryId,
          categoryCode,
          assignedTo,
          owner,
          initialStatus,
          estValue,
          portalId,
          publicationDate,
          submissionDeadline,
        });
      } catch (err: any) {
        if (this.isUniqueViolation(err, 'uq_tenders_internal_ref') && attempt < MAX_REF_ATTEMPTS) {
          this.logger.warn(`Internal reference collision on tender create (attempt ${attempt}); retrying.`);
          continue;
        }
        throw this.toFriendlyDbError(err, 'register the tender');
      }
    }

    this.outboxService.triggerImmediate();
    return this.findOne(created.id);
  }

  /** One attempt at registering a tender: the row, its line items, checklist, EMD request, history and outbox event. */
  private async createTenderInTransaction(
    dto: CreateTenderDto,
    user: AuthUser,
    p: {
      tenderNumber: string;
      orgId: string | null;
      orgName: string;
      zoneId: string | null;
      regionId: string | null;
      categoryId: string | null;
      categoryCode: string;
      assignedTo: string | null;
      owner: string;
      initialStatus: 'identified';
      estValue: number | null;
      portalId: string | null;
      publicationDate: string | null;
      submissionDeadline: Date;
    },
  ) {
    const {
      tenderNumber,
      orgId,
      orgName,
      zoneId,
      regionId,
      categoryId,
      categoryCode,
      assignedTo,
      owner,
      initialStatus,
      estValue,
      portalId,
      publicationDate,
      submissionDeadline,
    } = p;
    return this.db.transaction().execute(async (trx) => {
      const internalRef = await this.nextInternalRef(trx);
      const tender = await trx
        .insertInto('tenders')
        .values({
          internal_ref: internalRef,
          tender_no: tenderNumber,
          tender_number: tenderNumber,
          tender_title: dto.tender_title || dto.requirement_text || tenderNumber,
          portal_id: portalId,
          tender_portal_url: dto.tender_portal_url || (dto as any).tender_url || null,
          buyer_contact_id: dto.buyer_contact_id || null,
          organisation_id: orgId,
          organisation: orgName,
          department: dto.department?.trim() || null,
          product_id: dto.product_id || null,
          requirement_text: dto.requirement_text || null,
          city: dto.city?.trim() || null,
          state: dto.state?.trim() || null,
          zone_id: zoneId,
          region_id: regionId,
          tender_category_id: categoryId,
          category: categoryCode as any,
          category_id: categoryId,
          tender_type: dto.tender_type || 'Open',
          salesperson_id: dto.salesperson_id || null,
          quantity: dto.quantity || 1,
          bidder_turnover: dto.bidder_turnover || null,
          oem_turnover: dto.oem_turnover || null,
          emd_required: dto.emd_required ?? false,
          emd_fee: dto.emd_fee || dto.emd_amount || 0,
          emd_amount: dto.emd_amount || dto.emd_fee || 0,
          emd_mode: dto.emd_mode || 'Online',
          emd_exemption_reason: dto.emd_exemption_reason || null,
          tender_fee_amount: dto.tender_fee_amount || null,
          publish_date: publicationDate || null,
          publication_date: publicationDate || null,
          bid_closing_date: submissionDeadline.toISOString(),
          submission_deadline: submissionDeadline.toISOString(),
          pre_bid_meeting_date: dto.pre_bid_meeting_date ? new Date(dto.pre_bid_meeting_date).toISOString() : null,
          query_submission_deadline: dto.query_submission_deadline ? new Date(dto.query_submission_deadline).toISOString() : null,
          technical_opening_date: dto.technical_opening_date ? new Date(dto.technical_opening_date).toISOString() : null,
          commercial_opening_date: dto.commercial_opening_date ? new Date(dto.commercial_opening_date).toISOString() : null,
          bid_validity_days: dto.bid_validity_days || null,
          assigned_to: assignedTo,
          assigned_person_id: assignedTo,
          tender_owner_id: owner,
          owner: owner,
          priority: dto.priority || 'Medium',
          source: dto.source || 'Manual Entry',
          status: initialStatus,
          on_hold: false,
          prep_checklist_done: false,
          estimated_value: estValue,
          tender_value: dto.tender_value || null,
          portal: dto.portal || 'GeM',
          tender_url: (dto as any).tender_url || dto.tender_portal_url || null,
          parent_tender_id: dto.parent_tender_id || null,
          linked_pq_tender_id: dto.linked_pq_tender_id || null,
          remarks: dto.remarks || null,
          created_by: user.id,
          version: 1,
          last_activity_at: new Date(),
          extra_fields: (dto as any).extra_fields ? JSON.stringify((dto as any).extra_fields) : ('{}' as any),
          custom_fields: dto.custom_fields ? JSON.stringify(dto.custom_fields) : ('{}' as any),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Insert line items if provided
      if (Array.isArray(dto.line_items) && dto.line_items.length > 0) {
        for (const li of dto.line_items) {
          await trx
            .insertInto('tender_line_items')
            .values({
              tender_id: tender.id,
              product_id: li.product_id || null,
              product_description: li.product_description || null,
              quantity: li.quantity || 1,
              unit: li.unit || 'Nos',
              specification_summary: li.specification_summary || null,
              is_compliant: li.is_compliant || 'Not Checked',
              compliance_remarks: li.compliance_remarks || null,
              quoted_unit_price: li.quoted_unit_price ?? null,
              // The total is always quantity × unit price when a price is given (never trusted from the client).
              quoted_total:
                li.quoted_unit_price !== undefined && li.quoted_unit_price !== null
                  ? Number(li.quoted_unit_price) * Number(li.quantity || 1)
                  : li.quoted_total ?? null,
            })
            .execute();
        }
      }

      // Auto-initialize document checklist for category (same resolution as the readiness gate: general_mha → MHA
      // template, unknown → general; de-duplicated by document type).
      const { items: templates } = await this.getChecklistTemplate(categoryCode, null, trx);

      for (const t of templates) {
        await trx
          .insertInto('tender_documents')
          .values({
            tender_id: tender.id,
            document_type: t.document_type,
            is_mandatory: t.is_mandatory,
            status: 'Not Started',
            owner_id: assignedTo || user.id,
          })
          .execute();
      }

      // Auto-create EMD financial instrument if required
      if (dto.emd_required) {
        await trx
          .insertInto('tender_financial_instruments')
          .values({
            tender_id: tender.id,
            instrument_type: 'EMD',
            // Instruments are never ₹0 (CHECK amount > 0, migration 035): an EMD without a figure yet is NULL for
            // Finance to fill in. (shared types still declare amount non-null, hence the cast.)
            amount: Number(dto.emd_amount || dto.emd_fee) > 0 ? Number(dto.emd_amount || dto.emd_fee) : null,
            mode: dto.emd_mode || 'Online',
            status: 'Requested',
            remarks: dto.emd_exemption_reason || null,
          })
          .execute();
      }

      // Initial status history
      await trx
        .insertInto('tender_status_history')
        .values({
          tender_id: tender.id,
          from_status: null,
          to_status: initialStatus,
          changed_by: user.id,
          remarks: 'Tender identified and registered',
        })
        .execute();

      // Activity record
      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: tender.id,
          event_type: 'IDENTIFIED',
          description: `Tender ${tenderNumber} registered for ${orgName}`,
          performed_by: user.id,
          metadata: { status: initialStatus, category: categoryCode },
        })
        .execute();

      // Outbox domain event
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.TENDER_CREATED,
        aggregateType: 'TENDER',
        aggregateId: tender.id,
        actorId: user.id,
        payload: {
          tenderId: tender.id,
          tenderNo: tenderNumber,
          organisation: orgName,
          submissionDeadline: submissionDeadline.toISOString(),
          assignedTo,
          owner,
          // Keys the notification listener reads (assignee alert, skipped when they created it themselves).
          orgName,
          assignedPersonId: assignedTo,
          tenderOwnerId: owner,
          actorId: user.id,
        },
      });

      return tender;
    });
  }

  /** True for a terminal (closed) tender stage; unknown legacy values count as open rather than throwing. */
  private isClosedStatus(status?: string | null): boolean {
    try {
      return this.workflowService.isTerminal(status || 'identified');
    } catch {
      return false;
    }
  }

  /**
   * The BOQ (line items) is locked once the tender is closed (won, lost, cancelled, rejected …): the Lifecycle tab
   * already says a terminal tender takes no further changes. On a won tender the award columns (awarded quantity /
   * unit price) may still be completed when `allowAwardFields` is set.
   */
  private assertBoqEditable(tender: { status?: string | null }, opts?: { allowAwardFields?: boolean }) {
    if (!this.isClosedStatus(tender.status)) return;
    const status = this.workflowService.normalizeStatus(tender.status as string);
    if (opts?.allowAwardFields && status === 'WON') return;
    throw new BadRequestException(
      `Line items are locked: the tender is ${this.workflowService.getStatusLabel(status)} (closed). Reopen the tender to change its BOQ.`,
    );
  }

  /** Tender-level numbers: quantity is a whole number ≥ 1; values, EMD and fees are never negative. */
  private assertTenderNumbers(dto: {
    quantity?: number | null;
    estimated_value?: number | null;
    estimated_value_lakh?: number | null;
    emd_fee?: number | null;
    emd_amount?: number | null;
    tender_fee_amount?: number | null;
    tender_value?: number | null;
    emd_required?: boolean | null;
  }) {
    const num = (v: unknown) => (v === undefined || v === null || (v as any) === '' ? null : Number(v));
    const qty = num(dto.quantity);
    if (qty !== null && (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty))) {
      throw new BadRequestException('Quantity must be a whole number of at least 1.');
    }
    const nonNegative: [unknown, string][] = [
      [dto.estimated_value, 'Estimated value'],
      [dto.estimated_value_lakh, 'Estimated value (₹ Lakh)'],
      [dto.emd_fee, 'EMD fee'],
      [dto.emd_amount, 'EMD amount'],
      [dto.tender_fee_amount, 'Tender fee'],
      [dto.tender_value, 'Tender value'],
    ];
    for (const [v, label] of nonNegative) {
      const n = num(v);
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        throw new BadRequestException(`${label} cannot be negative.`);
      }
    }
    if (dto.emd_required) {
      const emd = num(dto.emd_amount) ?? num(dto.emd_fee);
      if (emd === null || emd <= 0) {
        throw new BadRequestException('EMD amount must be greater than zero when EMD is required.');
      }
    }
  }

  /** Line-item numbers: quantity ≥ 1 (whole units); unit price and totals ≥ 0. */
  private assertLineItemNumbers(
    li: {
      quantity?: number | null;
      quoted_unit_price?: number | null;
      quoted_total?: number | null;
      awarded_quantity?: number | null;
      awarded_unit_price?: number | null;
    },
    prefix = '',
  ) {
    const num = (v: unknown) => (v === undefined || v === null || (v as any) === '' ? null : Number(v));
    const qty = num(li.quantity);
    if (qty !== null && (!Number.isFinite(qty) || qty < 1)) {
      throw new BadRequestException(`${prefix}Quantity must be at least 1.`);
    }
    const checks: [unknown, string][] = [
      [li.quoted_unit_price, 'Quoted unit price'],
      [li.quoted_total, 'Quoted total'],
      [li.awarded_unit_price, 'Awarded unit price'],
      [li.awarded_quantity, 'Awarded quantity'],
    ];
    for (const [v, label] of checks) {
      const n = num(v);
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        throw new BadRequestException(`${prefix}${label} cannot be negative.`);
      }
    }
  }

  async update(id: string, dto: UpdateTenderDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);

    // Optimistic locking check
    if ((dto as any).expected_version !== undefined && existing.version !== (dto as any).expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    if (existing.is_deleted) {
      throw new BadRequestException('Cannot update a deleted tender');
    }

    this.assertTenderNumbers({
      estimated_value: dto.estimated_value,
      estimated_value_lakh: dto.estimated_value_lakh,
    });

    const updatePayload: Record<string, any> = {
      updated_at: new Date(),
      last_activity_at: new Date(),
      version: (existing.version || 1) + 1,
    };

    if (dto.tender_number || dto.tender_no) {
      const num = (dto.tender_number || dto.tender_no)!.trim();
      updatePayload.tender_no = num;
      updatePayload.tender_number = num;
    }

    if (dto.organisation) {
      updatePayload.organisation = dto.organisation.trim();
    }

    if (dto.department !== undefined) updatePayload.department = dto.department?.trim() || null;
    if (dto.product_id !== undefined) updatePayload.product_id = dto.product_id;
    if (dto.requirement_text !== undefined) updatePayload.requirement_text = dto.requirement_text;
    if (dto.city !== undefined) updatePayload.city = dto.city?.trim() || null;
    if (dto.state !== undefined) updatePayload.state = dto.state?.trim() || null;
    if (dto.portal !== undefined) updatePayload.portal = dto.portal;
    if ((dto as any).tender_url !== undefined) updatePayload.tender_url = (dto as any).tender_url || null;
    if (dto.remarks !== undefined) updatePayload.remarks = dto.remarks;
    if ((dto as any).prep_checklist_done !== undefined) {
      updatePayload.prep_checklist_done = (dto as any).prep_checklist_done;
    }

    if (dto.zone_id !== undefined) updatePayload.zone_id = dto.zone_id;
    if (dto.region_id !== undefined) updatePayload.region_id = dto.region_id;

    // Validate zone/region consistency if updating either
    const finalZoneId = updatePayload.zone_id !== undefined ? updatePayload.zone_id : existing.zone_id;
    const finalRegionId = updatePayload.region_id !== undefined ? updatePayload.region_id : existing.region_id;

    if (finalRegionId && !finalZoneId) {
      throw new BadRequestException('Region without zone is rejected.');
    }
    if (finalRegionId && finalZoneId) {
      const reg = await this.db
        .selectFrom('regions')
        .select('zone_id')
        .where('id', '=', finalRegionId)
        .executeTakeFirst();
      if (!reg || reg.zone_id !== finalZoneId) {
        throw new BadRequestException('Selected region does not belong to the selected zone.');
      }
    }

    if (dto.assigned_to !== undefined || dto.assigned_person_id !== undefined) {
      const a = dto.assigned_to || dto.assigned_person_id || null;
      updatePayload.assigned_to = a;
      updatePayload.assigned_person_id = a;
    }

    if (dto.tender_owner_id !== undefined || (dto as any).owner !== undefined) {
      const o = dto.tender_owner_id || (dto as any).owner || null;
      updatePayload.tender_owner_id = o;
      updatePayload.owner = o;
    }

    if (dto.estimated_value !== undefined) updatePayload.estimated_value = dto.estimated_value;
    else if (dto.estimated_value_lakh !== undefined) {
      updatePayload.estimated_value = Number(dto.estimated_value_lakh) * 100000;
    }

    try {
      await this.db
        .updateTable('tenders')
        .set(updatePayload)
        .where('id', '=', id)
        .execute();
    } catch (err: any) {
      throw this.toFriendlyDbError(err, 'update the tender');
    }

    if (dto.assigned_to !== undefined || dto.assigned_person_id !== undefined || dto.tender_owner_id !== undefined || (dto as any).owner !== undefined) {
      await this.logActivity(id, 'TEAM_REASSIGNED', 'Updated tender team ownership / assignment', user.id);
    }

    const { updated_at, last_activity_at, version, assigned_person_id, owner, ...businessFields } = updatePayload;
    const diff = this.changedFields(existing, businessFields);
    if (diff) {
      const teamOnly = Object.keys(diff.next).every((k) => k === 'assigned_to' || k === 'tender_owner_id');
      this.audit(user.id, id, teamOnly ? 'tender_reassigned' : 'tender_updated', diff.previous, diff.next);
    }

    return this.findOne(id);
  }

  async softDelete(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);
    await this.db
      .updateTable('tenders')
      .set({
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: user.id,
      })
      .where('id', '=', id)
      .execute();

    await this.db
      .insertInto('tender_activities')
      .values({
        tender_id: id,
        event_type: 'DELETED',
        description: `Tender ${existing.tender_number} soft-deleted by ${user.full_name}`,
        performed_by: user.id,
      })
      .execute();

    this.audit(user.id, id, 'tender_deleted', { status: existing.status, is_deleted: false }, { is_deleted: true });
    return { success: true };
  }

  // =========================================================================
  // 3. Centralized Workflow State Machine Engine (Section 3)
  // =========================================================================

  /**
   * Transition tender through single server-side endpoint / function
   * transition_tender(tender_id, to_status, note, expected_version)
   */
  async transitionTender(
    id: string,
    dto: TransitionTenderDto,
    user: AuthUser,
    options?: {
      isApprovalAction?: boolean;
      isRecordResultAction?: boolean;
      rejection_reason?: string;
      approval_remarks?: string | null;
      /** Extra writes that must commit (or roll back) together with the stage change, e.g. the result snapshot. */
      inTransaction?: (trx: Kysely<Database>) => Promise<void>;
      /** Extra fields for the specific domain event (tender.won / tender.lost …). */
      eventPayload?: Record<string, any>;
    },
  ) {
    const rawTarget = dto.to_status || dto.target_status;
    if (!rawTarget) {
      throw new BadRequestException('Target status (to_status) is required');
    }
    const targetStatus = this.workflowService.normalizeStatus(rawTarget);
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);
    const currentStatus = this.workflowService.normalizeStatus(existing.status);

    // Fetch settings for self approval check
    const settings = await this.getSettings();

    // Fetch approvers for authorization check
    const isApproverRec = await this.db
      .selectFrom('tender_approvers')
      .select('id')
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    const isApproverUser = Boolean(isApproverRec);

    // Determine category requires_pq
    let categoryRequiresPq = false;
    if (existing.category_id) {
      const cat = await this.db
        .selectFrom('tender_categories')
        .select('requires_pq')
        .where('id', '=', existing.category_id)
        .executeTakeFirst();
      if (cat) categoryRequiresPq = cat.requires_pq;
    } else {
      categoryRequiresPq = (existing.category || '').toLowerCase() === 'pq';
    }

    // Call state machine assertion
    const { from, to } = this.workflowService.assertValidTransition(
      {
        id: existing.id,
        status: currentStatus,
        on_hold: existing.on_hold,
        status_before_hold: existing.status_before_hold,
        category: existing.category,
        category_requires_pq: categoryRequiresPq,
        submission_deadline: existing.submission_deadline,
        assigned_to: existing.assigned_to,
        created_by: existing.created_by,
        tender_owner_id: existing.tender_owner_id || existing.owner,
        version: existing.version,
      },
      targetStatus,
      user,
      {
        isApprovalAction: options?.isApprovalAction,
        isRecordResultAction: options?.isRecordResultAction,
        expected_version: dto.expected_version,
        rejection_reason: dto.rejection_reason || options?.rejection_reason,
        loss_reasons: dto.loss_reasons,
        loss_reason: dto.loss_reason,
        isApproverUser,
        allowSelfApproval: settings?.allow_self_approval,
        requestedBy:
          existing.approvals?.find((a: any) => a.status === 'PENDING')?.requested_by ||
          existing.approvals?.[0]?.requested_by,
      },
    );

    // Bids are opened only after the bid closes (Module 4: submitted → technical evaluation → commercial evaluation →
    // result). A submitted bid cannot enter evaluation or take a result before its closing time, otherwise it is
    // stuck there: Record Result requires a result date on or after the bid closing date.
    if (from !== to && from === 'TENDER_SUBMITTED' && BID_OPENING_TARGETS.includes(to)) {
      const closing = this.bidClosingBlock(existing);
      if (closing) {
        throw new BadRequestException(
          `Cannot move to "${this.workflowService.getStatusLabel(to)}" yet: bids are opened only after the bid closes on ${closing} IST. ` +
            'Record the evaluation or result after the closing time (or record a corrigendum if the closing date changed).',
        );
      }
    }

    // Document gate (always on): a bid / PQ cannot be submitted until the mandatory checklist exists and every
    // mandatory document is Ready. Zero documents is "not initialised", never "100% ready".
    if (from !== to && (to === 'TENDER_SUBMITTED' || to === 'PQ_SUBMITTED')) {
      await this.assertSubmissionReadiness(existing, to);
    }

    const legacyStatus = this.workflowService.toLegacyStatus(to);
    const noteText = dto.note || dto.remarks || null;

    const updated = await this.db.transaction().execute(async (trx) => {
      // Row update
      const updateData: Record<string, any> = {
        status: legacyStatus,
        version: (existing.version || 1) + 1,
        last_activity_at: new Date(),
        updated_at: new Date(),
      };

      if ((to === 'TENDER_SUBMITTED' || to === 'PQ_SUBMITTED') && (dto as any).submission_date) {
        updateData.submission_date = (dto as any).submission_date;
      }
      // Go decision: the dossier's Decision panel shows who signed off and when.
      if (from === 'AWAITING_INTERNAL_APPROVAL' && to === 'UNDER_PREPARATION') {
        updateData.internal_approval_by = user.id;
        updateData.internal_approval_at = new Date();
      }

      await trx
        .updateTable('tenders')
        .set(updateData)
        .where('id', '=', id)
        .execute();

      // Write status history
      await trx
        .insertInto('tender_status_history')
        .values({
          tender_id: id,
          from_status: from.toLowerCase(),
          to_status: to.toLowerCase(),
          changed_by: user.id,
          remarks: noteText,
        })
        .execute();

      // Approval ledger kept in step with the stage, in the same transaction:
      // entering Awaiting Internal Approval opens exactly one PENDING request (any older open one is superseded);
      // leaving it closes the open request with the outcome. So `tender_approvals` can never hold a PENDING row for
      // a tender that is no longer awaiting approval (the stale-inbox bug).
      if (from !== to && to === 'AWAITING_INTERNAL_APPROVAL') {
        await trx
          .updateTable('tender_approvals')
          .set({ status: 'SUPERSEDED', decision: 'Superseded', updated_at: new Date() })
          .where('tender_id', '=', id)
          .where('status', '=', 'PENDING')
          .execute();
        const prevRound = await trx
          .selectFrom('tender_approvals')
          .select(sql<number>`coalesce(max(approval_round), 0)::int`.as('r'))
          .where('tender_id', '=', id)
          .executeTakeFirst();
        await trx
          .insertInto('tender_approvals')
          .values({
            tender_id: id,
            requested_by: user.id,
            submitted_by: user.id,
            approver_id: null,
            status: 'PENDING',
            decision: 'Pending',
            remarks: noteText,
            submission_note: noteText,
            approval_round: Number(prevRound?.r || 0) + 1,
            responded_at: null,
            rejection_reason: null,
          })
          .execute();
      } else if (from === 'AWAITING_INTERNAL_APPROVAL' && to !== from) {
        const outcome =
          to === 'UNDER_PREPARATION'
            ? { status: 'APPROVED', decision: 'Approved' }
            : to === 'REJECTED_INTERNALLY'
              ? { status: 'REJECTED', decision: 'Rejected' }
              : to === 'IDENTIFIED'
                ? { status: 'RETURNED', decision: 'Returned' }
                : { status: 'WITHDRAWN', decision: 'Withdrawn' };
        const rejection = to === 'REJECTED_INTERNALLY' ? dto.rejection_reason || options?.rejection_reason || null : null;
        await trx
          .updateTable('tender_approvals')
          .set({
            ...outcome,
            approver_id: user.id,
            responded_at: new Date(),
            decided_at: new Date(),
            remarks: options?.approval_remarks ?? noteText,
            decision_reason: rejection || noteText,
            rejection_reason: rejection,
            approval_conditions: to === 'UNDER_PREPARATION' ? options?.approval_remarks || null : null,
            updated_at: new Date(),
          })
          .where('tender_id', '=', id)
          .where('status', '=', 'PENDING')
          .execute();
      } else if (from !== to) {
        // Any request still PENDING while the tender is not awaiting approval is stale (e.g. legacy rows on a
        // tender that has since been won/lost): close it so it never shows as an open approval round.
        await trx
          .updateTable('tender_approvals')
          .set({
            status: 'WITHDRAWN',
            decision: 'Withdrawn',
            decision_reason: `Closed without a decision: tender moved to ${this.workflowService.getStatusLabel(to)}`,
            responded_at: new Date(),
            decided_at: new Date(),
            updated_at: new Date(),
          })
          .where('tender_id', '=', id)
          .where('status', '=', 'PENDING')
          .execute();
      }

      // Writes that belong to this stage change (result snapshot, finance follow-ups …) commit with it.
      if (options?.inTransaction) {
        await options.inTransaction(trx);
      }

      // Write activity timeline
      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: `STATUS_${to}`,
          description: `Stage moved from ${this.workflowService.getStatusLabel(from)} to ${this.workflowService.getStatusLabel(to)}`,
          performed_by: user.id,
          metadata: { from, to, note: noteText },
        })
        .execute();

      // The specific lifecycle event for this move (consumed by notifications, realtime and the audit trail).
      const specificEvent = from === to ? null : this.lifecycleEventFor(from, to);

      // Outbox domain event
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.TENDER_STATUS_CHANGED,
        aggregateType: 'TENDER',
        aggregateId: id,
        actorId: user.id,
        payload: {
          tenderId: id,
          tenderNo: existing.tender_number,
          fromStatus: from,
          toStatus: to,
          note: noteText,
          tenderOwnerId: existing.tender_owner_id || existing.owner || existing.assigned_to || null,
          actorId: user.id,
          // The decision event queued alongside (if any): the audit trail records the move once, under that event.
          decisionEvent: specificEvent,
        },
      });

      if (specificEvent) {
        await this.outboxService.queueEvent(trx, {
          eventType: specificEvent,
          aggregateType: 'TENDER',
          aggregateId: id,
          actorId: user.id,
          payload: {
            tenderId: id,
            tenderNo: existing.tender_number,
            orgName: existing.organisation_name || existing.organisation || null,
            fromStatus: from,
            toStatus: to,
            note: noteText,
            estimatedValue: existing.estimated_value ?? null,
            tenderOwnerId: existing.tender_owner_id || existing.owner || null,
            assignedPersonId: existing.assigned_to || null,
            approverId: options?.isApprovalAction ? user.id : undefined,
            reason: to === 'REJECTED_INTERNALLY' ? dto.rejection_reason || options?.rejection_reason || null : undefined,
            submissionDate: to === 'TENDER_SUBMITTED' ? (dto as any).submission_date || null : undefined,
            actorId: user.id,
            ...(options?.eventPayload || {}),
          },
        });
      }
    });

    this.outboxService.triggerImmediate();
    return this.findOne(id);
  }

  /** Domain event name for a lifecycle move (in addition to the generic tender.status_changed). */
  private lifecycleEventFor(from: StandardTenderStatus, to: StandardTenderStatus): string | null {
    switch (to) {
      case 'AWAITING_INTERNAL_APPROVAL':
        return AppEvents.TENDER_APPROVAL_REQUESTED;
      case 'UNDER_PREPARATION':
        return from === 'AWAITING_INTERNAL_APPROVAL' || from === 'IDENTIFIED'
          ? AppEvents.TENDER_APPROVED
          : AppEvents.TENDER_PREPARATION_STARTED;
      case 'REJECTED_INTERNALLY':
        return AppEvents.TENDER_REJECTED;
      case 'PQ_SUBMITTED':
        return AppEvents.TENDER_PQ_SUBMITTED;
      case 'PQ_QUALIFIED':
        return AppEvents.TENDER_PQ_QUALIFIED;
      case 'TENDER_SUBMITTED':
        return AppEvents.TENDER_SUBMITTED;
      case 'WON':
        return AppEvents.TENDER_WON;
      case 'LOST':
        return AppEvents.TENDER_LOST;
      case 'CANCELLED':
        return AppEvents.TENDER_CANCELLED;
      default:
        return null;
    }
  }

  /**
   * Backwards compatible changeStatus handler
   */
  async changeStatus(id: string, dto: ChangeTenderStatusDto, user: AuthUser) {
    const target = dto.status || dto.target_status;
    if (!target) throw new BadRequestException('Target status is required');

    return this.transitionTender(
      id,
      {
        to_status: target,
        note: dto.remarks,
        rejection_reason: dto.rejection_reason,
        loss_reason: dto.loss_reason,
        result_date: dto.result_date,
        value: dto.value_lakh ? dto.value_lakh * 100000 : undefined,
      },
      user,
    );
  }

  /**
   * Hold Tender: sets on_hold flag, stores status_before_hold.
   * "ON HOLD is a flag, not a status. While on hold, every transition is blocked except CANCELLED."
   */
  async holdTender(id: string, dto: HoldTenderDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);

    if (dto.expected_version !== undefined && existing.version !== dto.expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    if (existing.is_deleted) {
      throw new BadRequestException('Cannot hold a deleted tender');
    }

    if (this.workflowService.isTerminal(existing.status)) {
      throw new BadRequestException('Terminal tenders cannot be put on hold');
    }

    if (existing.on_hold) {
      throw new BadRequestException('Tender is already on hold. A tender cannot be held twice.');
    }

    const note = dto.reason ? `HOLD: ${dto.reason.trim()}` : 'Tender placed on hold';

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('tenders')
        .set({
          on_hold: true,
          status_before_hold: existing.status,
          version: (existing.version || 1) + 1,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('tender_status_history')
        .values({
          tender_id: id,
          from_status: existing.status,
          to_status: `${existing.status}_ON_HOLD`,
          changed_by: user.id,
          remarks: note,
        })
        .execute();

      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: 'ON_HOLD',
          description: `Tender put on hold. ${dto.reason || ''}`,
          performed_by: user.id,
          metadata: { status_before_hold: existing.status, reason: dto.reason },
        })
        .execute();
    });

    this.audit(user.id, id, 'tender_put_on_hold', { status: existing.status, on_hold: false }, { status: existing.status, on_hold: true, reason: dto.reason || null });
    return this.findOne(id);
  }

  /**
   * Resume Tender: restores stage from status_before_hold, clears on_hold flag.
   */
  async resumeTender(id: string, dto: ResumeTenderDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);

    if (dto.expected_version !== undefined && existing.version !== dto.expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    if (!existing.on_hold) {
      throw new BadRequestException('Tender is not currently on hold');
    }

    const restoredStatus = existing.status_before_hold || existing.status || 'identified';
    const resumeRemarks = (dto.remarks || dto.reason || '').trim();
    const note = resumeRemarks
      ? `RESUME: Tender resumed from on hold — ${resumeRemarks}`
      : 'RESUME: Tender resumed from on hold';

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('tenders')
        .set({
          on_hold: false,
          status: restoredStatus as any,
          status_before_hold: null,
          version: (existing.version || 1) + 1,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('tender_status_history')
        .values({
          tender_id: id,
          from_status: `${restoredStatus}_ON_HOLD`,
          to_status: restoredStatus,
          changed_by: user.id,
          remarks: note,
        })
        .execute();

      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: 'RESUMED',
          description: `Tender resumed to ${this.workflowService.getStatusLabel(restoredStatus)}${resumeRemarks ? ` — ${resumeRemarks}` : ''}`,
          performed_by: user.id,
        })
        .execute();
    });

    this.audit(user.id, id, 'tender_resumed', { status: existing.status, on_hold: true }, { status: restoredStatus, on_hold: false });
    return this.findOne(id);
  }

  /**
   * Request Internal Approval
   * Rule: "Submit for approval requires assigned_to to be set."
   */
  async requestApproval(id: string, remarks: string | undefined, user: AuthUser, expected_version?: number) {
    const existing = await this.findOne(id, user);

    if (!existing.assigned_to) {
      throw new BadRequestException('Approval requested with no assignee is blocked. Please assign a salesperson first.');
    }

    // transitionTender opens the PENDING tender_approvals request in the same transaction as the stage change.
    return this.transitionTender(
      id,
      {
        to_status: 'AWAITING_INTERNAL_APPROVAL',
        note: remarks || 'Internal participation approval requested',
        expected_version,
      },
      user,
    );
  }

  /**
   * Decide Internal Approval (Approve / Reject)
   */
  async approveParticipation(id: string, dto: ApproveTenderDto, user: AuthUser) {
    if (user.role !== 'management' && user.role !== 'admin') {
      throw new ForbiddenException(
        'Strict Governance: Only Management and Admin roles are authorized to approve or reject tender participation during internal review.',
      );
    }

    const existing = await this.findOne(id, user);
    const normStatus = this.workflowService.normalizeStatus(existing.status);

    if (normStatus !== 'AWAITING_INTERNAL_APPROVAL' && normStatus !== 'IDENTIFIED') {
      throw new BadRequestException(
        `Approval decisions can only be made while tender is in "Awaiting Internal Approval" or "Identified" stage (currently "${this.workflowService.getStatusLabel(normStatus)}").`,
      );
    }

    if (!existing.assigned_to && user.id) {
      await this.db
        .updateTable('tenders')
        .set({ assigned_to: user.id })
        .where('id', '=', id)
        .execute();
    }

    const rawDecision = dto.decision || 'approved';
    const decision = rawDecision.toLowerCase().trim();
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new BadRequestException('Decision must be either "approved" or "rejected"');
    }

    if (decision === 'rejected') {
      const reason = dto.rejection_reason || dto.remarks;
      if (!reason?.trim()) {
        throw new BadRequestException('A rejection reason is mandatory when rejecting tender participation');
      }
    }

    const targetStatus = decision === 'approved' ? 'UNDER_PREPARATION' : 'REJECTED_INTERNALLY';

    const updated = await this.transitionTender(
      id,
      {
        to_status: targetStatus,
        note: `Internal decision: ${decision.toUpperCase()}. ${dto.remarks || ''}`,
        rejection_reason: dto.rejection_reason || dto.remarks,
      },
      user,
      {
        isApprovalAction: true,
        rejection_reason: dto.rejection_reason || dto.remarks,
        approval_remarks: dto.remarks || null,
      },
    );
    // The open tender_approvals request is closed (APPROVED / REJECTED) inside transitionTender's transaction.
    return updated;
  }

  /**
   * Deadline Change with Corrigendum Reason Logging
   */
  async updateDeadline(
    id: string,
    dto: ChangeDeadlineDto,
    user: AuthUser,
    options?: {
      /** Extra writes that must commit (or roll back) with the deadline change, e.g. the corrigendum row. */
      inTransaction?: (trx: Kysely<Database>, change: { oldDeadline: Date; newDeadline: Date }) => Promise<void>;
    },
  ) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);

    if (dto.expected_version !== undefined && existing.version !== dto.expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    if (existing.is_deleted || this.workflowService.isTerminal(existing.status)) {
      throw new BadRequestException('Cannot change deadline on closed or deleted tenders');
    }

    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Reason is required when recording a deadline change (e.g. Corrigendum No.)');
    }

    const newDeadline = this.parseDateTimeIST(dto.new_deadline);
    if (!newDeadline) {
      throw new BadRequestException('Invalid new deadline date/time format');
    }

    const pubDay = this.istDay(existing.publication_date as any);
    if (pubDay) {
      if (istDateOf(newDeadline) < pubDay) {
        throw new BadRequestException('New submission deadline cannot be earlier than publication date');
      }
    }

    const oldDeadline = existing.submission_deadline ? new Date(existing.submission_deadline) : new Date();

    await this.db.transaction().execute(async (trx) => {
      if (options?.inTransaction) {
        await options.inTransaction(trx, { oldDeadline, newDeadline });
      }

      // Record change in history table
      await trx
        .insertInto('tender_deadline_changes')
        .values({
          tender_id: id,
          old_deadline: oldDeadline,
          new_deadline: newDeadline,
          reason: dto.reason.trim(),
          changed_by: user.id,
        })
        .execute();

      // Update tender submission deadline
      await trx
        .updateTable('tenders')
        .set({
          submission_deadline: newDeadline.toISOString(),
          bid_closing_date: newDeadline.toISOString(),
          version: (existing.version || 1) + 1,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      // Log activity
      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: 'DEADLINE_CHANGED',
          description: `Deadline extended to ${this.istLabel(newDeadline)} IST. Reason: ${dto.reason}`,
          performed_by: user.id,
          metadata: { old_deadline: oldDeadline, new_deadline: newDeadline, reason: dto.reason },
        })
        .execute();

      // Notify assignee
      if (existing.assigned_to) {
        await trx
          .insertInto('notifications')
          .values({
            user_id: existing.assigned_to,
            type: 'tender_deadline',
            title: `Deadline Extended: Tender ${existing.tender_number}`,
            body: `Deadline updated to ${this.istLabel(newDeadline)} IST. Corrigendum: ${dto.reason}`,
            entity_type: 'tender',
            entity_id: id,
          })
          .execute();
      }
    });

    this.audit(
      user.id,
      id,
      'tender_deadline_changed',
      { submission_deadline: existing.submission_deadline ? oldDeadline.toISOString() : null },
      { submission_deadline: newDeadline.toISOString(), reason: dto.reason.trim() },
    );
    return this.findOne(id);
  }

  /**
   * Section 5: Record Result Form (WON / LOST) with Snapshot
   */
  async recordResult(id: string, dto: RecordTenderResultDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (user.role === 'regional_manager') await this.assertTenderVisible(user, existing);

    if (dto.expected_version !== undefined && existing.version !== dto.expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    const outcome = dto.outcome.toLowerCase().trim() as 'won' | 'lost';
    if (outcome !== 'won' && outcome !== 'lost') {
      throw new BadRequestException('Outcome must be "won" or "lost"');
    }

    // Rule: "Allowed only if the tender has a PQ_SUBMITTED or TENDER_SUBMITTED entry in history."
    const submissionHistory = await this.db
      .selectFrom('tender_status_history')
      .select(['id', 'to_status', 'created_at'])
      .where('tender_id', '=', id)
      .where((eb) =>
        eb.or([
          eb(sql`lower(to_status)`, 'in', ['pq_submitted', 'submitted', 'tender_submitted']),
        ]),
      )
      .orderBy('created_at', 'asc')
      .execute();

    if (submissionHistory.length === 0) {
      throw new BadRequestException(
        'Cannot record result: tender has not reached a submission stage (PQ_SUBMITTED or TENDER_SUBMITTED) in history.',
      );
    }

    const firstSubmissionDate = new Date(submissionHistory[0].created_at);
    const resultDate = new Date(dto.result_date);

    // Rule: "result_date must be on or after the first submission date and cannot be in the future."
    if (isNaN(resultDate.getTime())) {
      throw new BadRequestException('Invalid result_date format');
    }

    // Compare IST calendar days: today's IST date is accepted at every hour (incl. 00:00–05:30 IST).
    const resultDayStr = this.istDay(dto.result_date as any) as string;
    if (resultDayStr > todayInKolkata()) {
      throw new BadRequestException(
        `Result date ${resultDayStr} cannot be in the future (today is ${todayInKolkata()} IST)`,
      );
    }

    // The result is declared after the bid was submitted AND after the bid closed (bids open only after closing),
    // so a won/lost record can never be dated before the submission deadline it answers.
    const firstSubDayStr = istDateOf(firstSubmissionDate);
    if (resultDayStr < firstSubDayStr) {
      throw new BadRequestException(
        `Result date cannot be earlier than the first submission date (${firstSubDayStr}).`,
      );
    }
    const closingDayStr = this.istDay((existing.submission_deadline || existing.bid_closing_date) as any);
    if (closingDayStr && resultDayStr < closingDayStr) {
      throw new BadRequestException(
        `Result date cannot be earlier than the bid closing date (${closingDayStr}); results are declared after bids close.`,
      );
    }

    // Rule: WON requires value > 0 when require_won_value is on
    const settings = await this.getSettings();
    const targetStatus = outcome === 'won' ? 'WON' : 'LOST';

    const tenderVal = dto.value !== undefined ? dto.value : ((dto as any).value_lakh ? Number((dto as any).value_lakh) * 100000 : undefined);

    if (outcome === 'won') {
      if (settings?.require_won_value) {
        if (!tenderVal || tenderVal <= 0) {
          throw new BadRequestException('Won value is required and must be greater than zero');
        }
      }
    }

    // A PBG request raised with the win must carry its amount (instruments are never zero / negative).
    if (outcome === 'won' && (dto as any).pbg_required) {
      const pbg = Number((dto as any).pbg_amount);
      if (!Number.isFinite(pbg) || pbg <= 0) {
        throw new BadRequestException('PBG amount must be greater than zero when a PBG is required.');
      }
    }

    // Rule: LOST requires at least one loss reason (multi-select). OTHER requires text.
    let lossReasonsList: string[] = [];
    if (outcome === 'lost') {
      const rawReasons = dto.loss_reasons || (dto.loss_reason ? [dto.loss_reason] : ((dto as any).reason ? [(dto as any).reason] : []));
      lossReasonsList = (rawReasons as string[]).map((r) => r.toUpperCase());
      if (lossReasonsList.length === 0) {
        throw new BadRequestException('A structured loss reason is mandatory when recording a lost tender');
      }

      // Verify reasons against master table
      const validReasons = await this.getLossReasons();
      const validCodes = new Set(validReasons.map((r) => r.code.toUpperCase()));
      for (const r of lossReasonsList) {
        if (!validCodes.has(r)) {
          throw new BadRequestException(`Unknown loss reason code: "${r}"`);
        }
      }

      if (lossReasonsList.includes('OTHER')) {
        if (!dto.other_reason_text || !dto.other_reason_text.trim()) {
          throw new BadRequestException('Text explanation is required when loss reason includes OTHER');
        }
      }
    }

    const primaryLossReason = (dto as any).loss_reason || (dto as any).reason || (lossReasonsList[0] ? lossReasonsList[0].toLowerCase() : null);

    // Perform transition and save snapshot
    await this.transitionTender(
      id,
      {
        to_status: targetStatus,
        note: `Result recorded: ${outcome.toUpperCase()}. ${dto.notes || ''}`,
        loss_reasons: lossReasonsList,
        loss_reason: primaryLossReason,
        value: tenderVal,
        result_date: dto.result_date,
      },
      user,
      { isRecordResultAction: true },
    );

    // The result sheet confirms the tender category (PQ / General-MHA / Other); a correction there updates the bid.
    // category and its master row (category_id / tender_category_id) move together, so the register, filters and
    // reports agree on the corrected category.
    const resultCategory = String((dto as any).category || '').toLowerCase().trim();
    const categoryCorrection = (['pq', 'general_mha', 'other'] as const).find(
      (c) => c === resultCategory && c !== String(existing.category || '').toLowerCase(),
    );
    const correctedCategoryId = categoryCorrection
      ? ((await this.db
          .selectFrom('tender_categories')
          .select('id')
          .where(sql`lower(code)`, '=', categoryCorrection)
          .executeTakeFirst())?.id ?? null)
      : null;

    // Save snapshot in tender_results and update tenders row
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('tenders')
        .set({
          ...(categoryCorrection
            ? { category: categoryCorrection, category_id: correctedCategoryId, tender_category_id: correctedCategoryId }
            : {}),
          status: outcome as any,
          result_date: resultDayStr,
          tender_value: tenderVal || null,
          loss_reason: primaryLossReason,
          competitor: dto.competitor || null,
          loss_notes: dto.notes || null,
          product_id: (dto as any).product_id || existing.product_id,
          region_id: (dto as any).region_id || existing.region_id,
          assigned_to: (dto as any).responsible_person_id || existing.assigned_to,
          assigned_person_id: (dto as any).responsible_person_id || existing.assigned_to,
        })
        .where('id', '=', id)
        .execute();

      await trx
        .deleteFrom('tender_results')
        .where('tender_id', '=', id)
        .execute();

      await trx
        .insertInto('tender_results')
        .values({
          tender_id: id,
          outcome,
          result: outcome.toUpperCase(),
          result_date: resultDayStr,
          value: tenderVal || null,
          awarded_value: (dto as any).awarded_value || (outcome === 'won' ? tenderVal : null),
          awarded_line_items: (dto as any).awarded_line_items ? JSON.stringify((dto as any).awarded_line_items) : ('[]' as any),
          order_number: (dto as any).order_number || (dto as any).po_number || null,
          loa_number: (dto as any).loa_number || null,
          po_number: (dto as any).po_number || null,
          loa_date: (dto as any).loa_date || null,
          pbg_required: Boolean((dto as any).pbg_required),
          pbg_amount: (dto as any).pbg_amount || null,
          pbg_due_date: (dto as any).pbg_due_date || null,
          loss_reasons: lossReasonsList as any,
          loss_reason_detail: dto.other_reason_text?.trim() || (dto as any).loss_reason_detail || null,
          winning_price: (dto as any).winning_price || null,
          our_price: (dto as any).our_price || null,
          our_rank: (dto as any).our_rank || null,
          lessons_learned: (dto as any).lessons_learned || null,
          other_reason_text: dto.other_reason_text?.trim() || null,
          competitor: dto.competitor?.trim() || null,
          notes: dto.notes?.trim() || null,
          // Immutable Snapshots
          zone_id: existing.zone_id,
          region_id: (dto as any).region_id || existing.region_id,
          assigned_to: (dto as any).responsible_person_id || existing.assigned_to,
          category_id: categoryCorrection ? correctedCategoryId : existing.category_id,
          product_id: (dto as any).product_id || existing.product_id,
          recorded_by: user.id,
          recorded_at: new Date(),
        })
        .execute();

      // Finance Integration: If lost, automatically move EMD status to Refund Due
      if (outcome === 'lost') {
        await trx
          .updateTable('tender_financial_instruments')
          .set({ status: 'Refund Due', updated_at: new Date() })
          .where('tender_id', '=', id)
          .where('instrument_type', '=', 'EMD')
          .where('status', 'in', ['Issued', 'Submitted', 'Requested', 'Approved'])
          .execute();
      }

      // Finance Integration: If won and PBG required, create PBG instrument request
      if (outcome === 'won' && (dto as any).pbg_required) {
        await trx
          .insertInto('tender_financial_instruments')
          .values({
            tender_id: id,
            instrument_type: 'PBG',
            amount: Number((dto as any).pbg_amount),
            status: 'Requested',
            remarks: `PBG due by ${(dto as any).pbg_due_date || 'LoA deadline'}`,
          })
          .execute();
      }

      // Backwards compatibility with tender_outcomes
      await trx
        .deleteFrom('tender_outcomes')
        .where('tender_id', '=', id)
        .execute();

      await trx
        .insertInto('tender_outcomes')
        .values({
          tender_id: id,
          result: outcome,
          reason: primaryLossReason,
          competitor: dto.competitor || null,
          value_lakh: tenderVal ? Number((tenderVal / 100000).toFixed(2)) : null,
          result_date: resultDayStr,
          notes: dto.notes || null,
          other_reason: dto.other_reason_text || null,
        })
        .execute();

      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: `OUTCOME_${outcome.toUpperCase()}`,
          description: `Tender outcome recorded as ${outcome.toUpperCase()}`,
          performed_by: user.id,
          metadata: { outcome, result_date: resultDayStr, value: tenderVal, loss_reasons: lossReasonsList },
        })
        .execute();
    });

    return this.findOne(id);
  }

  /**
   * Backwards compatible outcome endpoint
   */
  async recordOutcome(id: string, dto: RecordTenderOutcomeDto, user: AuthUser) {
    const outcome = (dto.result || '').toLowerCase().trim();
    if (outcome !== 'won' && outcome !== 'lost') {
      throw new BadRequestException('Result must be either "won" or "lost"');
    }

    const lossReason = dto.loss_reason || dto.reason;
    if (outcome === 'lost' && !lossReason?.trim()) {
      throw new BadRequestException('A structured loss reason is mandatory when recording a lost tender');
    }

    // The outcome form's reason picker uses friendly keys (price, competitor, customer_decision …); map them onto the
    // loss_reasons master codes so a lost result is never rejected as an "unknown loss reason code".
    const REASON_ALIASES: Record<string, string> = {
      PRICE: 'PRICING',
      PRICING: 'PRICING',
      COMPETITOR: 'OTHER',
      TECHNICAL: 'TECHNICAL',
      ELIGIBILITY: 'ELIGIBILITY',
      DOCUMENTATION: 'DOCUMENTATION',
      CUSTOMER_DECISION: 'OTHER',
      PQ_NOT_QUALIFIED: 'PQ_NOT_QUALIFIED',
      OTHER: 'OTHER',
    };
    const REASON_LABELS: Record<string, string> = {
      COMPETITOR: 'Competitor advantage / preference',
      CUSTOMER_DECISION: 'Customer cancellation / retender',
    };
    const primaryKey = (lossReason || '').trim().toUpperCase();
    const primaryCode = primaryKey ? REASON_ALIASES[primaryKey] || primaryKey : '';

    const reasons: string[] = [];
    if (primaryCode) reasons.push(primaryCode);
    if (dto.technical_issue) reasons.push('TECHNICAL');
    if (dto.pricing_issue) reasons.push('PRICING');
    if (dto.eligibility_issue) reasons.push('ELIGIBILITY');
    if (dto.documentation_issue) reasons.push('DOCUMENTATION');
    if (dto.other_reason) reasons.push('OTHER');
    const uniqueReasons = [...new Set(reasons)];
    // OTHER needs an explanation: the typed note, else the label of the friendly reason that mapped onto OTHER.
    const otherText =
      dto.other_reason?.trim() || (uniqueReasons.includes('OTHER') ? REASON_LABELS[primaryKey] || '' : '') || undefined;

    return this.recordResult(
      id,
      {
        outcome: outcome as any,
        result_date: dto.result_date || todayInKolkata(),
        value: dto.value_lakh ? dto.value_lakh * 100000 : (dto as any).value,
        loss_reasons: uniqueReasons,
        loss_reason: primaryCode ? primaryCode.toLowerCase() : undefined,
        other_reason_text: otherText,
        competitor: dto.competitor,
        notes: dto.notes || dto.remarks,
        category: dto.category || dto.tender_category,
        product_id: dto.product_id,
        region_id: dto.region_id,
        responsible_person_id: dto.responsible_person_id,
      } as any,
      user,
    );
  }

  /**
   * Section 3: Reopen (Admin only, reason required, only from terminal statuses)
   */
  async reopenTender(id: string, dto: ReopenTenderDto, user: AuthUser) {
    if (!['admin', 'management'].includes(user.role)) {
      throw new ForbiddenException('Only System Administrators or Corporate Management can reopen terminal tenders.');
    }

    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A reason is mandatory when reopening a closed tender');
    }

    const existing = await this.findOne(id, user);

    if (dto.expected_version !== undefined && existing.version !== dto.expected_version) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    const norm = this.workflowService.normalizeStatus(existing.status);
    if (!this.workflowService.isTerminal(norm)) {
      throw new BadRequestException(
        `Cannot reopen tender: tender is not in a terminal state (current status: "${this.workflowService.getStatusLabel(norm)}")`,
      );
    }

    let targetStatus: StandardTenderStatus = 'IDENTIFIED';
    if (norm === 'REJECTED_INTERNALLY') {
      targetStatus = 'IDENTIFIED';
    } else {
      // Find the stage it was in before closing from history
      const history = await this.db
        .selectFrom('tender_status_history')
        .select(['from_status', 'to_status'])
        .where('tender_id', '=', id)
        .orderBy('created_at', 'desc')
        .execute();

      const prev = history.find(
        (h) =>
          h.from_status &&
          !['won', 'lost', 'cancelled', 'rejected_internally'].includes(h.from_status.toLowerCase()),
      );

      if (prev?.from_status) {
        targetStatus = this.workflowService.normalizeStatus(prev.from_status);
      } else {
        targetStatus = 'TENDER_SUBMITTED';
      }
    }

    const legacyTarget = this.workflowService.toLegacyStatus(targetStatus);

    await this.db.transaction().execute(async (trx) => {
      // Delete result row
      await trx.deleteFrom('tender_results').where('tender_id', '=', id).execute();
      await trx.deleteFrom('tender_outcomes').where('tender_id', '=', id).execute();

      // Update tender
      await trx
        .updateTable('tenders')
        .set({
          status: legacyTarget,
          version: (existing.version || 1) + 1,
          last_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      // Log status history
      await trx
        .insertInto('tender_status_history')
        .values({
          tender_id: id,
          from_status: norm.toLowerCase(),
          to_status: legacyTarget,
          changed_by: user.id,
          remarks: `REOPEN: ${dto.reason.trim()}`,
        })
        .execute();

      // Log activity
      await trx
        .insertInto('tender_activities')
        .values({
          tender_id: id,
          event_type: 'REOPENED',
          description: `Tender reopened by admin to ${this.workflowService.getStatusLabel(targetStatus)}. Reason: ${dto.reason}`,
          performed_by: user.id,
        })
        .execute();
    });

    this.audit(user.id, id, 'tender_reopened', { status: existing.status }, { status: legacyTarget, reason: dto.reason.trim() });
    return this.findOne(id);
  }

  // =========================================================================
  // 4. Portal Issues Management (Section 2 child table & Section 9)
  // =========================================================================

  async getAllPortalIssues(user: AuthUser) {
    let q = this.db
      .selectFrom('tender_portal_issues')
      .leftJoin('tenders', 'tender_portal_issues.tender_id', 'tenders.id')
      .leftJoin('users as rep', 'tender_portal_issues.reported_by', 'rep.id')
      .leftJoin('users as resp', 'tender_portal_issues.responsible_person_id', 'resp.id')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .selectAll('tender_portal_issues')
      .select([
        'tenders.tender_no',
        'tenders.tender_number',
        'tenders.organisation',
        'tenders.portal as tender_portal',
        // The affected buyer: department first, then the mapped organisation / free-text buyer name.
        sql<string | null>`coalesce(nullif(trim(tenders.department), ''), organisations.name, nullif(trim(tenders.organisation), ''))`.as(
          'tender_department',
        ),
        'organisations.name as organisation_name',
        'rep.full_name as reported_by_name',
        'resp.full_name as responsible_name',
      ])
      .where('tenders.is_deleted', '=', false);

    if (user.role === 'regional_manager') {
      q = q.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      q = q.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
          eb('tender_portal_issues.reported_by', '=', user.id),
          eb('tender_portal_issues.responsible_person_id', '=', user.id),
        ]),
      );
    }

    return q.orderBy('tender_portal_issues.created_at', 'desc').execute();
  }

  async getPortalIssues(tenderId: string, user?: AuthUser) {
    await this.findOne(tenderId, user);
    return this.db
      .selectFrom('tender_portal_issues')
      .leftJoin('users as rep', 'tender_portal_issues.reported_by', 'rep.id')
      .leftJoin('users as resp', 'tender_portal_issues.responsible_person_id', 'resp.id')
      .selectAll('tender_portal_issues')
      .select([
        'rep.full_name as reported_by_name',
        'resp.full_name as responsible_name',
      ])
      .where('tender_id', '=', tenderId)
      .orderBy('tender_portal_issues.created_at', 'desc')
      .execute();
  }

  async createPortalIssue(tenderId: string, dto: CreateTenderPortalIssueDto, user: AuthUser) {
    // Edge Case 20: empty text, logging against deleted tender -> rejected
    const desc = (dto.issue || (dto as any).issue_description || '').trim();
    if (!desc) {
      throw new BadRequestException('Portal issue description cannot be blank or empty');
    }

    const tender = await this.findOne(tenderId, user);
    if (tender.is_deleted) {
      throw new BadRequestException('Cannot log portal issues against a deleted tender');
    }
    await this.assertTenderVisible(user, tender);

    // The incident date is an IST calendar day and cannot be in the future.
    const reportedDate = dto.reported_date ? this.istDay(dto.reported_date) : todayInKolkata();
    if (!reportedDate) throw new BadRequestException('Invalid reported date');
    if (reportedDate > todayInKolkata()) {
      throw new BadRequestException(`Reported date cannot be in the future (today is ${todayInKolkata()} IST)`);
    }

    const issue = await this.db
      .insertInto('tender_portal_issues')
      .values({
        tender_id: tenderId,
        portal: dto.portal || tender.portal || 'GeM',
        issue: desc,
        reported_date: reportedDate,
        reported_by: user.id,
        responsible_person_id: dto.responsible_person_id || tender.assigned_to || user.id,
        escalated_to: dto.escalated_to || null,
        resolution_status: (dto.resolution_status || 'OPEN').toUpperCase(),
        resolution: dto.resolution || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('tender_activities')
      .values({
        tender_id: tenderId,
        event_type: 'PORTAL_ISSUE_LOGGED',
        description: `Portal issue logged: "${desc}"`,
        performed_by: user.id,
      })
      .execute();

    return issue;
  }

  async updatePortalIssue(
    tenderId: string,
    issueId: string,
    dto: UpdateTenderPortalIssueDto,
    user: AuthUser,
  ) {
    // Edge Case 20: an id of 0 or negative id must NOT update any record
    if (issueId === '0' || Number(issueId) <= 0 || !issueId.trim()) {
      throw new NotFoundException(`Portal issue with ID "${issueId}" not found`);
    }

    const existingIssue = await this.db
      .selectFrom('tender_portal_issues')
      .selectAll()
      .where('id', '=', issueId as any)
      .where('tender_id', '=', tenderId)
      .executeTakeFirst();

    if (!existingIssue) {
      throw new NotFoundException(`Portal issue with ID "${issueId}" not found for this tender`);
    }

    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    // Statuses are stored upper-case (OPEN / IN_PROGRESS / ESCALATED / RESOLVED) whatever the client sends.
    if (dto.resolution_status) dto.resolution_status = dto.resolution_status.trim().toUpperCase();
    const currentStatus = String(existingIssue.resolution_status || '').toUpperCase();

    // Resolving twice check
    if (dto.resolution_status === 'RESOLVED' && currentStatus === 'RESOLVED') {
      throw new BadRequestException('This portal issue has already been resolved');
    }
    if (dto.resolution_status === 'RESOLVED' && !dto.resolution?.trim()) {
      throw new BadRequestException('Resolution notes are required to resolve a portal issue.');
    }

    const updateData: Record<string, any> = {
      updated_at: new Date(),
    };

    if (dto.issue) updateData.issue = dto.issue.trim();
    if (dto.responsible_person_id) {
      updateData.responsible_person_id = dto.responsible_person_id;
      updateData.responsible_user = dto.responsible_person_id;
    }
    if (dto.escalated_to) {
      updateData.escalated_to = dto.escalated_to;
      updateData.escalation_date = new Date();
      updateData.escalated_at = new Date();
      updateData.resolution_status = 'ESCALATED';
      updateData.status = 'ESCALATED';
    }
    if (dto.resolution_status) {
      updateData.resolution_status = dto.resolution_status;
      updateData.status = dto.resolution_status;
    }
    if (dto.resolution?.trim()) {
      updateData.resolution = dto.resolution.trim();
      if (dto.resolution_status === 'RESOLVED' || !dto.resolution_status) {
        updateData.resolution_status = 'RESOLVED';
        updateData.status = 'RESOLVED';
        updateData.resolved_at = new Date();
        updateData.resolved_by = user.id;
      }
    }

    const updated = await this.db
      .updateTable('tender_portal_issues')
      .set(updateData)
      .where('id', '=', issueId as any)
      .returningAll()
      .executeTakeFirst();

    if (updated && updated.resolution_status !== existingIssue.resolution_status) {
      await this.logActivity(
        tenderId,
        'PORTAL_ISSUE_UPDATED',
        `Portal issue "${existingIssue.issue}" marked ${String(updated.resolution_status).replace(/_/g, ' ')}`,
        user.id,
      );
    }
    return updated;
  }

  async getActivities(tenderId: string, user?: AuthUser) {
    await this.findOne(tenderId, user);
    return this.db
      .selectFrom('tender_activities')
      .leftJoin('users', 'tender_activities.performed_by', 'users.id')
      .selectAll('tender_activities')
      .select('users.full_name as performed_by_name')
      .where('tender_id', '=', tenderId)
      .orderBy('tender_activities.created_at', 'desc')
      .execute();
  }

  // =========================================================================
  // 5. Deadline & Alert Engine (Section 4)
  // =========================================================================

  /**
   * Run hourly compliance and alert engine job. Deduplicates using tender_notifications_log.
   */
  async runHourlyDeadlineAlerts() {
    this.logger.log('Running Tender Deadline & Compliance Alert Engine...');
    const now = new Date();
    const settings = await this.getSettings();

    const upcomingDays = settings?.upcoming_days || 7;
    const approachingDays = settings?.approaching_days || 3;
    const approvalSlaHours = settings?.approval_sla_hours || 24;
    const resultFollowupDays = settings?.result_followup_days || 15;

    // Fetch active, non-deleted, non-terminal, non-on-hold tenders
    const activeTenders = await this.db
      .selectFrom('tenders')
      .selectAll('tenders')
      .where('is_deleted', '=', false)
      .where('on_hold', '=', false)
      .where('status', 'not in', ['won', 'lost', 'cancelled', 'rejected_internally'])
      .execute();

    const alertsGenerated: any[] = [];

    for (const tender of activeTenders) {
      const deadline = tender.submission_deadline || tender.bid_closing_date;
      const normStatus = this.workflowService.normalizeStatus(tender.status);

      // Recipient determination: assignee -> owner -> escalation users
      const recipientId = tender.assigned_to || tender.tender_owner_id || tender.owner;

      // 1. Deadlines check for pre-submission statuses: (IDENTIFIED, AWAITING, UNDER_PREP)
      if (['IDENTIFIED', 'AWAITING_INTERNAL_APPROVAL', 'UNDER_PREPARATION'].includes(normStatus) && deadline) {
        const deadlineDate = new Date(deadline);
        const diffMs = deadlineDate.getTime() - now.getTime();
        const daysLeft = this.istDaysLeft(deadlineDate, now);

        if (diffMs < 0) {
          // MISSED_DEADLINE
          await this.triggerDeduplicatedAlert(
            tender.id,
            'MISSED_DEADLINE',
            `Missed Deadline: Tender ${tender.tender_number || tender.tender_no}`,
            `The submission deadline for tender "${tender.tender_number || tender.tender_no}" passed without submission.`,
            recipientId,
          );
        } else if (daysLeft <= approachingDays) {
          // APPROACHING_DEADLINE (0 <= time left <= approaching_days inclusive)
          await this.triggerDeduplicatedAlert(
            tender.id,
            'APPROACHING_DEADLINE',
            `Approaching Deadline (<= ${approachingDays}d): Tender ${tender.tender_number || tender.tender_no}`,
            `Tender deadline is in ${daysLeft} days (${this.istLabel(deadlineDate)} IST).`,
            recipientId,
          );
        } else if (daysLeft <= upcomingDays) {
          // UPCOMING_SUBMISSION
          await this.triggerDeduplicatedAlert(
            tender.id,
            'UPCOMING_SUBMISSION',
            `Upcoming Submission: Tender ${tender.tender_number || tender.tender_no}`,
            `Tender deadline is within ${upcomingDays} days.`,
            recipientId,
          );
        }

        // INCOMPLETE_PREPARATION
        if (normStatus === 'UNDER_PREPARATION' && !tender.prep_checklist_done && daysLeft <= approachingDays && daysLeft >= 0) {
          await this.triggerDeduplicatedAlert(
            tender.id,
            'INCOMPLETE_PREPARATION',
            `Incomplete Preparation Alert: Tender ${tender.tender_number || tender.tender_no}`,
            `Tender is due in ${daysLeft} days but preparation checklist is not marked complete.`,
            recipientId,
          );
        }
      }

      // 2. Approval SLA Check
      if (normStatus === 'AWAITING_INTERNAL_APPROVAL') {
        const lastActivity = tender.last_activity_at ? new Date(tender.last_activity_at) : new Date(tender.created_at);
        const waitedHours = (now.getTime() - lastActivity.getTime()) / (3600 * 1000);

        if (waitedHours > approvalSlaHours) {
          // APPROVAL_ESCALATION
          const escalationIds = settings?.escalation_user_ids ? JSON.parse(JSON.stringify(settings.escalation_user_ids)) : [];
          await this.triggerDeduplicatedAlert(
            tender.id,
            'APPROVAL_ESCALATION',
            `Approval SLA Breached (> ${approvalSlaHours}h): Tender ${tender.tender_number || tender.tender_no}`,
            `Internal participation approval request has been pending for over ${Math.round(waitedHours)} hours.`,
            recipientId,
            escalationIds,
          );
        } else {
          // PENDING_APPROVAL
          await this.triggerDeduplicatedAlert(
            tender.id,
            'PENDING_APPROVAL',
            `Pending Internal Approval: Tender ${tender.tender_number || tender.tender_no}`,
            `Tender requires internal participation decision.`,
            recipientId,
          );
        }
      }

      // 3. Result Follow-up Check
      if (['TENDER_SUBMITTED', 'TECHNICAL_EVALUATION', 'COMMERCIAL_EVALUATION'].includes(normStatus)) {
        const lastAct = tender.last_activity_at ? new Date(tender.last_activity_at) : new Date(tender.updated_at);
        const inactiveDays = (now.getTime() - lastAct.getTime()) / (24 * 3600 * 1000);
        if (inactiveDays >= resultFollowupDays) {
          await this.triggerDeduplicatedAlert(
            tender.id,
            'RESULT_FOLLOWUP',
            `Result Follow-up Due: Tender ${tender.tender_number || tender.tender_no}`,
            `Tender has been in evaluation stages with no activity for over ${resultFollowupDays} days.`,
            recipientId,
          );
        }
      }

      // 4. Unassigned Check
      if (!tender.assigned_to) {
        await this.triggerDeduplicatedAlert(
          tender.id,
          'UNASSIGNED',
          `Unassigned Tender: ${tender.tender_number || tender.tender_no}`,
          `Tender is not assigned to any salesperson or tender team member.`,
          tender.owner || recipientId,
        );
      }
    }
  }

  private async triggerDeduplicatedAlert(
    tenderId: string,
    alertType: string,
    title: string,
    body: string,
    targetUserId?: string | null,
    escalationUserIds: string[] = [],
  ) {
    const existingLog = await this.db
      .selectFrom('tender_notifications_log')
      .select('id')
      .where('tender_id', '=', tenderId)
      .where('alert_type', '=', alertType)
      .executeTakeFirst();

    if (existingLog) return; // Already sent, deduplicate

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('tender_notifications_log')
        .values({
          tender_id: tenderId,
          alert_type: alertType,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Primary recipient
      if (targetUserId) {
        await trx
          .insertInto('notifications')
          .values({
            user_id: targetUserId,
            type: alertType.toLowerCase(),
            title,
            body,
            entity_type: 'tender',
            entity_id: tenderId,
          })
          .execute();
      }

      // Escalation recipients
      for (const escId of escalationUserIds) {
        if (escId && escId !== targetUserId) {
          await trx
            .insertInto('notifications')
            .values({
              user_id: escId,
              type: alertType.toLowerCase(),
              title: `[ESCALATION] ${title}`,
              body,
              entity_type: 'tender',
              entity_id: tenderId,
            })
            .execute();
        }
      }
    });
  }

  /** Blueprint §47 / PRD: important tender changes go to the immutable audit trail (user, action, previous → new, time). */
  private audit(actorId: string, tenderId: string, action: string, previousValue: Record<string, any> | null, newValue: Record<string, any> | null) {
    this.eventEmitter.emit('audit.log', { actorId, entityType: 'tender', entityId: tenderId, action, previousValue, newValue });
  }

  /** The fields of `after` whose value differs from `before`, split into { previous, next } halves for the audit row. */
  private changedFields(before: Record<string, any>, after: Record<string, any>) {
    const norm = (v: any) => (v === undefined || v === null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
    const previous: Record<string, any> = {};
    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(after)) {
      if (norm(before[key]) !== norm(value)) {
        previous[key] = before[key] ?? null;
        next[key] = value ?? null;
      }
    }
    return Object.keys(next).length ? { previous, next } : null;
  }

  private async logActivity(
    tenderId: string,
    eventType: string,
    description: string,
    performedBy: string,
    metadata?: any,
  ) {
    try {
      await this.db
        .insertInto('tender_activities')
        .values({
          tender_id: tenderId,
          event_type: eventType,
          description,
          performed_by: performedBy,
          // metadata is NOT NULL jsonb: a null here made the insert fail and the activity was silently lost.
          metadata: metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : {},
        })
        .execute();
    } catch (err: any) {
      this.logger.warn(`Failed to log tender activity for ${tenderId}: ${err?.message}`);
    }
  }

  // =========================================================================
  // 6. Reports & Dashboards (Section 6)
  // =========================================================================

  /**
   * Register KPIs and filter-menu counts. Takes the list's filter query and applies the same filter builder, so every
   * count follows the active filters — except its own dimension: stage counts (and Total) ignore the stage pick,
   * deadline counts the deadline pick, category counts the category pick, so choosing one option never zeroes the rest.
   */
  async getDashboard(user: AuthUser, query: TenderQueryDto = {}) {
    // Run alert engine check on page load only — filtered refetches fire on every filter change.
    const isFiltered = Object.values(query).some((v) => v !== undefined && v !== null && v !== '');
    if (!isFiltered) {
      await this.runHourlyDeadlineAlerts().catch((e) => this.logger.warn(`Alert check warning: ${e.message}`));
    }

    const now = new Date();
    const countWhere = (cond: RawBuilder<boolean>) => sql<number>`count(case when ${cond} then 1 end)::int`;
    const stage = (key: string) => countWhere(this.tenderStageMatch(key));
    const deadline = (key: string) => countWhere(this.tenderDeadlineMatch(key, now)!);
    const category = (key: string) => countWhere(this.tenderCategoryMatch(key));

    const [stageMetrics, deadlineMetrics, categoryMetrics] = await Promise.all([
      this.filteredTenders(query, user, 'status', now)
        .select([
          sql<number>`count(tenders.id)::int`.as('total_tenders'),
          stage('identified').as('identified'),
          stage('awaiting_approval').as('awaiting_approval'),
          // Same predicate as the Approvals Inbox (pendingApprovalsQuery), so unfiltered they always agree.
          countWhere(TENDER_PENDING_APPROVAL_SQL).as('pending_approvals'),
          stage('rejected_internally').as('rejected_internally'),
          stage('under_preparation').as('under_preparation'),
          stage('submitted').as('submitted'),
          stage('results').as('result_tracking'),
          stage('won').as('tenders_won'),
          stage('lost').as('tenders_lost'),
          stage('on_hold').as('on_hold_tenders'),
          sql<number>`count(case when tenders.status in ${WORKED_UPON_SQL} then 1 end)::int`.as('worked_upon'),
          sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('tenders_submitted'),
          sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending_tenders'),
          sql<number>`count(case when tenders.status in ('under_preparation') then 1 end)::int`.as('incomplete_preparation'),
          sql<number>`count(case when tenders.status in ('submitted', 'technical_eval', 'commercial_eval') then 1 end)::int`.as('result_followups'),
        ])
        .executeTakeFirst(),
      this.filteredTenders(query, user, 'deadline', now)
        .select([
          deadline('urgent_48h').as('urgent_deadlines'),
          deadline('upcoming_7d').as('upcoming_deadlines'),
          deadline('overdue').as('overdue_tenders'),
          deadline('due_today').as('due_today'),
        ])
        .executeTakeFirst(),
      this.filteredTenders(query, user, 'category', now)
        .select([
          category('pq').as('pq_tenders'),
          category('general_mha').as('general_mha_tenders'),
          category('other').as('other_tenders'),
        ])
        .executeTakeFirst(),
    ]);
    const metrics = { ...stageMetrics, ...deadlineMetrics, ...categoryMetrics };

    let portalIssuesQuery = this.db
      .selectFrom('tender_portal_issues')
      .leftJoin('tenders', 'tender_portal_issues.tender_id', 'tenders.id')
      .select(sql<number>`count(tender_portal_issues.id)::int`.as('count'))
      // "Open" = every issue not yet resolved/closed (OPEN, IN_PROGRESS, ESCALATED) — the same rule as the hub badge.
      .where(sql<boolean>`upper(coalesce(tender_portal_issues.resolution_status, 'OPEN')) not in ('RESOLVED', 'CLOSED')`)
      .where('tenders.is_deleted', '=', false);

    if (user.role === 'regional_manager') {
      portalIssuesQuery = portalIssuesQuery.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      portalIssuesQuery = portalIssuesQuery.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
          eb('tender_portal_issues.reported_by', '=', user.id),
          eb('tender_portal_issues.responsible_person_id', '=', user.id),
        ]),
      );
    }

    const portalIssuesCount = await portalIssuesQuery.executeTakeFirst();

    const won = metrics?.tenders_won || 0;
    const lost = metrics?.tenders_lost || 0;
    const totalDecided = won + lost;
    const winRate = totalDecided > 0 ? Number(((won / totalDecided) * 100).toFixed(1)) : 0;

    return {
      total: metrics?.total_tenders || 0,
      total_tenders: metrics?.total_tenders || 0,
      pq_count: metrics?.pq_tenders || 0,
      pq_tenders: metrics?.pq_tenders || 0,
      general_mha_count: metrics?.general_mha_tenders || 0,
      general_mha_tenders: metrics?.general_mha_tenders || 0,
      other_count: metrics?.other_tenders || 0,
      other_tenders: metrics?.other_tenders || 0,
      worked_upon: metrics?.worked_upon || 0,
      // 6-stage lifecycle counts
      identified: metrics?.identified || 0,
      stage_1_identified: metrics?.identified || 0,
      pending_approvals: metrics?.pending_approvals || 0,
      awaiting_approval: metrics?.awaiting_approval || 0,
      stage_2_review: metrics?.awaiting_approval || 0,
      rejected_internally: metrics?.rejected_internally || 0,
      stage_3_decision: metrics?.rejected_internally || 0,
      under_preparation: metrics?.under_preparation || 0,
      stage_4_prep: metrics?.under_preparation || 0,
      submitted: metrics?.submitted || 0,
      // §27: submitted = every bid that went in (PQ submitted … result), not just the 'submitted' stage
      tenders_submitted: metrics?.tenders_submitted || 0,
      stage_5_submitted: metrics?.submitted || 0,
      result_tracking: metrics?.result_tracking || 0,
      stage_6_results: metrics?.result_tracking || 0,
      tenders_won: won,
      won: won,
      tenders_lost: lost,
      lost: lost,
      pending: metrics?.pending_tenders || 0,
      pending_tenders: metrics?.pending_tenders || 0,
      on_hold_tenders: metrics?.on_hold_tenders || 0,
      incomplete_preparation: metrics?.incomplete_preparation || 0,
      upcoming_deadlines: metrics?.upcoming_deadlines || 0,
      urgent_deadlines: metrics?.urgent_deadlines || 0,
      overdue_tenders: metrics?.overdue_tenders || 0,
      due_today: metrics?.due_today || 0,
      result_followups: metrics?.result_followups || 0,
      open_portal_issues: portalIssuesCount?.count || 0,
      win_rate: winRate,
      win_rate_formatted: totalDecided > 0 ? `${winRate}%` : '—',
      win_rate_percentage: totalDecided > 0 ? `${winRate}%` : '—',
      win_rate_numeric: winRate,
    };
  }

  async getStats(user: AuthUser) {
    const dash = await this.getDashboard(user);
    return {
      total: dash.total_tenders,
      active: dash.worked_upon,
      closingSoon: dash.upcoming_deadlines,
      awaitingApproval: dash.pending_approvals,
      pqCount: dash.pq_tenders,
      generalMhaCount: dash.general_mha_tenders,
      generalCount: dash.general_mha_tenders,
    };
  }

  /**
   * Section 6 Multi-Dimensional Group Reporting
   * Closed tenders group by tender_results snapshot; open tenders group by live values.
   * NULL shows as "Unmapped".
   */
  async getSummaryReport(
    groupBy: 'organisation' | 'zone' | 'region' | 'salesperson',
    user: AuthUser,
    filters?: {
      start_date?: string;
      end_date?: string;
      date_field?: 'publication_date' | 'submission_deadline';
      category?: string;
      zone_id?: string;
      region_id?: string;
      salesperson_id?: string;
      product_id?: string;
      organisation?: string;
    },
  ) {
    // Fetch all non-deleted tenders with the LATEST results snapshot per tender (B5: a re-recorded result must not
    // duplicate the tender row and double-count it).
    const latestResults = this.db
      .selectFrom('tender_results')
      .selectAll()
      .distinctOn('tender_results.tender_id')
      .orderBy('tender_results.tender_id')
      .orderBy(sql`coalesce(tender_results.recorded_at, tender_results.created_at)`, 'desc')
      .as('tender_results');
    let query = this.db
      .selectFrom('tenders')
      .leftJoin(latestResults, 'tenders.id', 'tender_results.tender_id')
      .leftJoin('tender_categories', 'tenders.category_id', 'tender_categories.id')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .leftJoin('zones as live_zone', 'tenders.zone_id', 'live_zone.id')
      .leftJoin('regions as live_region', 'tenders.region_id', 'live_region.id')
      .leftJoin('users as live_user', 'tenders.assigned_to', 'live_user.id')
      .leftJoin('zones as snap_zone', 'tender_results.zone_id', 'snap_zone.id')
      .leftJoin('regions as snap_region', 'tender_results.region_id', 'snap_region.id')
      .leftJoin('users as snap_user', 'tender_results.assigned_to', 'snap_user.id')
      .select([
        'tenders.id',
        'tenders.status',
        'tenders.on_hold',
        'tenders.category',
        'tenders.organisation',
        'tenders.tender_value',
        'tender_categories.name as category_name',
        'tender_results.outcome as result_outcome',
        'tender_results.value as result_value',
        // Group fields
        sql<string>`case when tenders.status in ('won', 'lost') then coalesce(snap_zone.name, 'Unmapped') else coalesce(live_zone.name, 'Unmapped') end`.as('group_zone'),
        sql<string>`case when tenders.status in ('won', 'lost') then coalesce(snap_region.name, 'Unmapped') else coalesce(live_region.name, 'Unmapped') end`.as('group_region'),
        sql<string>`case when tenders.status in ('won', 'lost') then coalesce(snap_user.full_name, 'Unmapped') else coalesce(live_user.full_name, 'Unmapped') end`.as('group_salesperson'),
        sql<string>`coalesce(tenders.organisation, organisations.name, 'Unmapped')`.as('group_organisation'),
      ])
      .where('tenders.is_deleted', '=', false)
      .where(tenderReportScope(user));

    const dateCol = filters?.date_field === 'submission_deadline' ? 'tenders.submission_deadline' : 'tenders.publication_date';
    if (filters?.start_date) {
      query = query.where(sql<any>`${sql.ref(dateCol)} >= ${filters.start_date}`);
    }
    if (filters?.end_date) {
      query = query.where(sql<any>`${sql.ref(dateCol)} <= ${filters.end_date}`);
    }
    if (filters?.zone_id) {
      query = query.where('tenders.zone_id', '=', filters.zone_id);
    }
    if (filters?.region_id) {
      query = query.where('tenders.region_id', '=', filters.region_id);
    }
    if (filters?.product_id) {
      query = query.where('tenders.product_id', '=', filters.product_id);
    }
    if (filters?.salesperson_id) {
      query = query.where('tenders.assigned_to', '=', filters.salesperson_id);
    }

    const tenders = await query.execute();

    // Grouping dictionary
    const groups: Record<string, any> = {};

    for (const t of tenders) {
      let key = 'Unmapped';
      if (groupBy === 'zone') key = t.group_zone || 'Unmapped';
      else if (groupBy === 'region') key = t.group_region || 'Unmapped';
      else if (groupBy === 'salesperson') key = t.group_salesperson || 'Unmapped';
      else key = t.group_organisation || 'Unmapped';

      if (!groups[key]) {
        groups[key] = {
          name: key,
          group: key,
          group_name: key,
          total_identified: 0,
          pq_count: 0,
          general_mha_count: 0,
          worked_upon: 0,
          submitted: 0,
          won: 0,
          lost: 0,
          cancelled: 0,
          rejected_internally: 0,
          pending: 0,
          on_hold: 0,
          won_value: 0,
          categories: {} as Record<string, number>,
        };
      }

      const g = groups[key];
      g.total_identified += 1;

      // §20: PQ and General/MHA are their own categories (not "everything non-PQ"); configured categories are
      // broken down by name as well.
      const category = (t.category || '').toLowerCase();
      if (category.startsWith('pq')) g.pq_count += 1;
      else if (category === 'general_mha') g.general_mha_count += 1;
      const categoryName = t.category_name || t.category || 'Uncategorised';
      g.categories[categoryName] = (g.categories[categoryName] || 0) + 1;

      // §27 definitions
      const status = (t.status || '').toLowerCase();
      if (TENDER_WORKED_UPON_STATUSES.includes(status)) g.worked_upon += 1;
      if (TENDER_SUBMITTED_STATUSES.includes(status)) g.submitted += 1;
      if (!TENDER_TERMINAL_STATUSES.includes(status)) g.pending += 1;

      if (status === 'won') {
        g.won += 1;
        g.won_value += Number(t.result_value || t.tender_value || 0);
      } else if (status === 'lost') {
        g.lost += 1;
      } else if (status === 'cancelled') {
        g.cancelled += 1;
      } else if (status === 'rejected_internally') {
        g.rejected_internally += 1;
      }

      if (t.on_hold) g.on_hold += 1;
    }

    // Calculate win rates
    const rows = Object.values(groups).map((g: any) => {
      const decided = g.won + g.lost;
      const rate = decided > 0 ? Number(((g.won / decided) * 100).toFixed(1)) : null;
      return {
        ...g,
        win_rate: rate !== null ? `${rate}%` : '—',
        win_rate_numeric: rate || 0,
      };
    });

    return rows.sort((a, b) => b.total_identified - a.total_identified);
  }

  // Backwards compatibility report methods for tests
  async getPipelineReport(user: AuthUser) {
    let baseQuery = this.db
      .selectFrom('tenders')
      .where('tenders.is_deleted', '=', false);

    if (user.role === 'regional_manager') {
      baseQuery = baseQuery.where(rmTenderScope(user));
    }

    const stages = await baseQuery
      .select([
        'tenders.status',
        sql<number>`count(tenders.id)::int`.as('count'),
        sql<number>`coalesce(sum(tenders.estimated_value), 0)::numeric`.as('total_estimated_value'),
        sql<number>`coalesce(sum(tenders.tender_value), 0)::numeric`.as('total_tender_value'),
      ])
      .groupBy('tenders.status')
      .execute();

    const categories = await baseQuery
      .select([
        sql<string>`tenders.category::text`.as('category'),
        sql<number>`count(tenders.id)::int`.as('count'),
      ])
      .groupBy(sql`tenders.category::text`)
      .execute();

    const total = stages.reduce((sum, s) => sum + Number(s.count), 0);
    return {
      total,
      stages,
      categories,
    };
  }

  async getWinLossReport(user: AuthUser) {
    let query = this.db
      .selectFrom('tender_outcomes')
      .innerJoin('tenders', 'tender_outcomes.tender_id', 'tenders.id')
      .leftJoin('products', 'tenders.product_id', 'products.id')
      .leftJoin('regions', 'tenders.region_id', 'regions.id')
      .leftJoin('zones', 'tenders.zone_id', 'zones.id')
      .leftJoin('users as assigned_user', 'tenders.assigned_to', 'assigned_user.id')
      .leftJoin('users as owner_user', 'tenders.tender_owner_id', 'owner_user.id')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .select([
        'tender_outcomes.id as outcome_id',
        'tender_outcomes.tender_id',
        'tender_outcomes.result',
        'tender_outcomes.reason',
        'tender_outcomes.competitor',
        'tender_outcomes.value_lakh',
        'tender_outcomes.result_date',
        'tender_outcomes.technical_issue',
        'tender_outcomes.pricing_issue',
        'tender_outcomes.eligibility_issue',
        'tender_outcomes.documentation_issue',
        'tender_outcomes.other_reason',
        'tender_outcomes.notes',
        'tenders.tender_no',
        'tenders.requirement_text as tender_title',
        'tenders.category as tender_category',
        'products.name as product_name',
        'regions.name as region_name',
        'zones.name as zone_name',
        'assigned_user.full_name as assigned_person_name',
        'owner_user.full_name as tender_owner_name',
        'organisations.name as organisation_name',
      ] as any)
      .where('tenders.is_deleted', '=', false);

    if (user.role === 'regional_manager') {
      query = query.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      query = query.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
        ]),
      );
    }

    const outcomes = (await query.orderBy('tender_outcomes.result_date', 'desc').execute()) as any[];

    let wonCount = 0;
    let lostCount = 0;
    let totalWonValueLakh = 0;
    const lossReasons: Record<string, number> = {};
    const competitors: Record<string, number> = {};
    const wonByProduct: Record<string, { count: number; value_lakh: number }> = {};
    const wonByRegion: Record<string, { count: number; value_lakh: number }> = {};
    const wonByCategory: Record<string, { count: number; value_lakh: number }> = {};
    const wonByPerson: Record<string, { count: number; value_lakh: number }> = {};

    let technicalIssuesCount = 0;
    let pricingIssuesCount = 0;
    let eligibilityIssuesCount = 0;
    let documentationIssuesCount = 0;
    let otherReasonsCount = 0;

    for (const o of outcomes) {
      const val = Number(o.value_lakh) || 0;
      if (o.result === 'won') {
        wonCount++;
        totalWonValueLakh += val;

        const prod = o.product_name || 'Standard Equipment';
        wonByProduct[prod] = {
          count: (wonByProduct[prod]?.count || 0) + 1,
          value_lakh: Math.round(((wonByProduct[prod]?.value_lakh || 0) + val) * 100) / 100,
        };

        const reg = o.region_name || 'Unassigned Region';
        wonByRegion[reg] = {
          count: (wonByRegion[reg]?.count || 0) + 1,
          value_lakh: Math.round(((wonByRegion[reg]?.value_lakh || 0) + val) * 100) / 100,
        };

        const cat = o.tender_category || 'General / MHA';
        wonByCategory[cat] = {
          count: (wonByCategory[cat]?.count || 0) + 1,
          value_lakh: Math.round(((wonByCategory[cat]?.value_lakh || 0) + val) * 100) / 100,
        };

        const person = o.tender_owner_name || o.assigned_person_name || 'Unassigned Team';
        wonByPerson[person] = {
          count: (wonByPerson[person]?.count || 0) + 1,
          value_lakh: Math.round(((wonByPerson[person]?.value_lakh || 0) + val) * 100) / 100,
        };
      } else if (o.result === 'lost') {
        lostCount++;
        const r = o.reason || 'UNSPECIFIED';
        lossReasons[r] = (lossReasons[r] || 0) + 1;
        if (o.competitor) {
          competitors[o.competitor] = (competitors[o.competitor] || 0) + 1;
        }

        if (o.technical_issue || r.toLowerCase().includes('tech')) technicalIssuesCount++;
        if (o.pricing_issue || r.toLowerCase().includes('price') || r.toLowerCase().includes('l1')) pricingIssuesCount++;
        if (o.eligibility_issue || r.toLowerCase().includes('eligib')) eligibilityIssuesCount++;
        if (o.documentation_issue || r.toLowerCase().includes('doc')) documentationIssuesCount++;
        if (o.other_reason || r.toLowerCase().includes('other')) otherReasonsCount++;
      }
    }

    const totalDecided = wonCount + lostCount;
    const winRate = totalDecided > 0 ? Math.round((wonCount / totalDecided) * 100) : 0;

    return {
      won: wonCount,
      won_count: wonCount,
      lost: lostCount,
      lost_count: lostCount,
      total_decided: totalDecided,
      win_rate: winRate,
      total_won_value_lakh: Math.round(totalWonValueLakh * 100) / 100,
      reasons: lossReasons,
      loss_reasons: lossReasons,
      won_by_product: wonByProduct,
      won_by_region: wonByRegion,
      won_by_category: wonByCategory,
      won_by_person: wonByPerson,
      won_breakdown: {
        by_product: wonByProduct,
        by_region: wonByRegion,
        by_category: wonByCategory,
        by_salesperson: wonByPerson,
      },
      loss_factors: {
        technical_issues: technicalIssuesCount,
        pricing_issues: pricingIssuesCount,
        eligibility_issues: eligibilityIssuesCount,
        documentation_issues: documentationIssuesCount,
        other_reasons: otherReasonsCount,
      },
      lost_breakdown: {
        reasons: lossReasons,
        competitors,
        factors: {
          technical: technicalIssuesCount,
          pricing: pricingIssuesCount,
          eligibility: eligibilityIssuesCount,
          documentation: documentationIssuesCount,
          other: otherReasonsCount,
        },
      },
      recent_completed: outcomes.slice(0, 50),
    };
  }

  async getZoneReport(user: AuthUser) {
    const scoped = !['management', 'admin', 'tender_team'].includes(user.role);
    let query = this.db
      .selectFrom('zones')
      .leftJoin('tenders', (join) =>
        join
          .onRef('zones.id', '=', 'tenders.zone_id')
          .on('tenders.is_deleted', '=', false)
          .on(tenderReportScope(user)),
      )
      .select([
        'zones.id as zone_id',
        'zones.name as zone_name',
        sql<number>`count(tenders.id)::int`.as('total'),
        sql<number>`count(tenders.id)::int`.as('total_tenders'),
        sql<number>`count(case when tenders.category::text ilike 'pq%' then 1 end)::int`.as('pq_count'),
        sql<number>`count(case when tenders.category::text = 'general_mha' then 1 end)::int`.as('general_mha_count'),
        sql<number>`count(case when tenders.status in ${WORKED_UPON_SQL} then 1 end)::int`.as('worked_upon'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending_tenders'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted_tenders'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won_tenders'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost_tenders'),
      ])
      .groupBy(['zones.id', 'zones.name'])
      .orderBy('zones.name', 'asc');
    // B4: a scoped user only sees the zones their own bids sit in
    if (scoped) query = query.having(sql`count(tenders.id)`, '>', 0);
    return query.execute();
  }

  async getRegionReport(user: AuthUser) {
    const scoped = !['management', 'admin', 'tender_team'].includes(user.role);
    let query = this.db
      .selectFrom('regions')
      .leftJoin('zones', 'regions.zone_id', 'zones.id')
      .leftJoin('tenders', (join) =>
        join
          .onRef('regions.id', '=', 'tenders.region_id')
          .on('tenders.is_deleted', '=', false)
          .on(tenderReportScope(user)),
      )
      .select([
        'regions.id as region_id',
        'regions.name as region_name',
        'zones.name as zone_name',
        sql<number>`count(tenders.id)::int`.as('total'),
        sql<number>`count(tenders.id)::int`.as('total_tenders'),
        sql<number>`count(case when tenders.category::text ilike 'pq%' then 1 end)::int`.as('pq_count'),
        sql<number>`count(case when tenders.category::text = 'general_mha' then 1 end)::int`.as('general_mha_count'),
        sql<number>`count(case when tenders.status in ${WORKED_UPON_SQL} then 1 end)::int`.as('worked_upon'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending_tenders'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted_tenders'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won_tenders'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost_tenders'),
      ])
      .groupBy(['regions.id', 'regions.name', 'zones.name'])
      .orderBy('regions.name', 'asc');
    if (scoped) query = query.having(sql`count(tenders.id)`, '>', 0);
    return query.execute();
  }

  async getSalespersonReport(user: AuthUser) {
    return this.db
      .selectFrom('users')
      .innerJoin('tenders', (join) =>
        join
          .on((eb) =>
            eb.or([
              eb('users.id', '=', eb.ref('tenders.assigned_to')),
              eb('users.id', '=', eb.ref('tenders.tender_owner_id')),
            ]),
          )
          .on('tenders.is_deleted', '=', false)
          .on(tenderReportScope(user)),
      )
      .select([
        'users.id as user_id',
        'users.full_name as salesperson_name',
        'users.role',
        sql<number>`count(distinct tenders.id)::int`.as('total'),
        sql<number>`count(distinct tenders.id)::int`.as('total_tenders'),
        sql<number>`count(distinct case when tenders.category::text ilike 'pq%' then tenders.id end)::int`.as('pq_count'),
        sql<number>`count(distinct case when tenders.category::text = 'general_mha' then tenders.id end)::int`.as('general_mha_count'),
        sql<number>`count(distinct case when tenders.status in ${WORKED_UPON_SQL} then tenders.id end)::int`.as('worked_upon'),
        sql<number>`count(distinct case when tenders.status not in ${TERMINAL_SQL} then tenders.id end)::int`.as('pending'),
        sql<number>`count(distinct case when tenders.status not in ${TERMINAL_SQL} then tenders.id end)::int`.as('pending_tenders'),
        sql<number>`count(distinct case when tenders.status in ${SUBMITTED_SQL} then tenders.id end)::int`.as('submitted'),
        sql<number>`count(distinct case when tenders.status in ${SUBMITTED_SQL} then tenders.id end)::int`.as('submitted_tenders'),
        sql<number>`count(distinct case when tenders.status = 'won' then tenders.id end)::int`.as('won'),
        sql<number>`count(distinct case when tenders.status = 'won' then tenders.id end)::int`.as('won_tenders'),
        sql<number>`count(distinct case when tenders.status = 'lost' then tenders.id end)::int`.as('lost'),
        sql<number>`count(distinct case when tenders.status = 'lost' then tenders.id end)::int`.as('lost_tenders'),
      ])
      .groupBy(['users.id', 'users.full_name', 'users.role'])
      .orderBy('total', 'desc')
      .execute();
  }

  async getOrganisationReport(user: AuthUser) {
    let query = this.db
      .selectFrom('organisations')
      .leftJoin('tenders', (join) =>
        join.onRef('organisations.id', '=', 'tenders.organisation_id').on('tenders.is_deleted', '=', false),
      )
      .select([
        'organisations.id as organisation_id',
        'organisations.name as organisation_name',
        'organisations.sector',
        'organisations.city',
        'organisations.state',
        sql<number>`count(tenders.id)::int`.as('total'),
        sql<number>`count(tenders.id)::int`.as('total_tenders'),
        sql<number>`count(case when tenders.category::text ilike 'pq%' then 1 end)::int`.as('pq_count'),
        sql<number>`count(case when tenders.category::text = 'general_mha' then 1 end)::int`.as('general_mha_count'),
        sql<number>`count(case when tenders.status in ${WORKED_UPON_SQL} then 1 end)::int`.as('worked_upon'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending'),
        sql<number>`count(case when tenders.status not in ${TERMINAL_SQL} then 1 end)::int`.as('pending_tenders'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted'),
        sql<number>`count(case when tenders.status in ${SUBMITTED_SQL} then 1 end)::int`.as('submitted_tenders'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won'),
        sql<number>`count(case when tenders.status = 'won' then 1 end)::int`.as('won_tenders'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost'),
        sql<number>`count(case when tenders.status = 'lost' then 1 end)::int`.as('lost_tenders'),
      ])
      .groupBy([
        'organisations.id',
        'organisations.name',
        'organisations.sector',
        'organisations.city',
        'organisations.state',
      ])
      .having(sql`count(tenders.id)`, '>', 0)
      .orderBy('total', 'desc');

    query = query.where(tenderReportScope(user));
    return query.execute();
  }

  // =========================================================================
  // 7. Approvals Inbox & My Tenders
  // =========================================================================

  /**
   * The ONE definition of "pending internal approval": tenders whose CURRENT stage is Awaiting Internal Approval,
   * not deleted, not on hold (a held tender cannot be decided), inside the caller's territorial scope.
   * The Approvals Inbox list, its heading, the "Pending Approvals" KPI and the View-menu count all come from here,
   * so they can never disagree. Historical `tender_approvals` rows are NOT the source: a request row left PENDING
   * after its tender moved on (won/lost/returned) must never resurface in the inbox.
   */
  private pendingApprovalsQuery(user: AuthUser) {
    let q = this.db
      .selectFrom('tenders')
      .where('tenders.is_deleted', '=', false)
      .where(TENDER_PENDING_APPROVAL_SQL);

    if (user.role === 'regional_manager') {
      q = q.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      q = q.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
        ]),
      );
    }
    return q;
  }

  async countPendingApprovals(user: AuthUser): Promise<number> {
    const row = await this.pendingApprovalsQuery(user)
      .select(sql<number>`count(tenders.id)::int`.as('n'))
      .executeTakeFirst();
    return Number(row?.n || 0);
  }

  /**
   * Approvals Inbox: exactly the tenders currently awaiting approval in the caller's scope, most urgent first
   * (open deadlines soonest first, then no deadline, then deadlines already passed), newest request first on ties.
   * Each row carries its open request (who / when / note), the approval SLA clock (from the request, not from tender
   * creation) and `can_decide`, which mirrors the server's approve/reject rules (Management/Admin + dual control).
   */
  async getApprovalsInbox(user: AuthUser, now: Date = new Date()) {
    const settings = await this.getSettings();
    const slaHours = Number((settings as any)?.approval_sla_hours) || 24;
    const allowSelfApproval = Boolean(settings?.allow_self_approval);

    const rows = await this.pendingApprovalsQuery(user)
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .leftJoin('zones', 'tenders.zone_id', 'zones.id')
      .leftJoin('regions', 'tenders.region_id', 'regions.id')
      .leftJoin('tender_categories', 'tenders.category_id', 'tender_categories.id')
      .leftJoin('users as assignee', 'tenders.assigned_to', 'assignee.id')
      .select([
        'tenders.id',
        'tenders.tender_no',
        'tenders.tender_number',
        'tenders.tender_title',
        'tenders.internal_ref',
        'tenders.organisation',
        'tenders.department',
        'tenders.requirement_text',
        'tenders.state',
        'tenders.category',
        'tenders.status',
        'tenders.version',
        'tenders.submission_deadline',
        'tenders.bid_closing_date',
        'tenders.estimated_value',
        'tenders.assigned_to',
        'tenders.created_by',
        'tenders.owner',
        'tenders.tender_owner_id',
        'tenders.last_activity_at',
        'tenders.updated_at',
        'tenders.created_at',
        'organisations.name as organisation_name',
        'zones.name as zone_name',
        'regions.name as region_name',
        'tender_categories.name as category_name',
        'tender_categories.code as category_code',
        'assignee.full_name as assigned_to_name',
      ])
      .execute();

    const ids = rows.map((r) => r.id);
    const [requests, history] = ids.length
      ? await Promise.all([
          this.db
            .selectFrom('tender_approvals')
            .leftJoin('users as req', 'tender_approvals.requested_by', 'req.id')
            .select([
              'tender_approvals.tender_id',
              'tender_approvals.requested_by',
              'tender_approvals.requested_at',
              'tender_approvals.remarks',
              'tender_approvals.approval_round',
              'req.full_name as requested_by_name',
              'req.role as requested_by_role',
            ])
            .where('tender_approvals.tender_id', 'in', ids)
            .where('tender_approvals.status', '=', 'PENDING')
            .orderBy('tender_approvals.requested_at', 'desc')
            .execute(),
          this.db
            .selectFrom('tender_status_history')
            .leftJoin('users as req', 'tender_status_history.changed_by', 'req.id')
            .select([
              'tender_status_history.tender_id',
              'tender_status_history.changed_by',
              'tender_status_history.created_at',
              'tender_status_history.remarks',
              'req.full_name as requested_by_name',
              'req.role as requested_by_role',
            ])
            .where('tender_status_history.tender_id', 'in', ids)
            .where(sql<boolean>`lower(tender_status_history.to_status) in ('awaiting_internal_approval', 'awaiting_approval')`)
            .orderBy('tender_status_history.created_at', 'desc')
            .execute(),
        ])
      : [[], []];

    const isDecider = user.role === 'management' || user.role === 'admin';

    const items = rows.map((t) => {
      // Latest open request row; fall back to the latest status-history entry into the stage.
      const req = requests.find((r) => r.tender_id === t.id);
      const hist = history.find((h) => h.tender_id === t.id);
      const requestedAt = new Date(
        (req?.requested_at as any) || (hist?.created_at as any) || t.last_activity_at || t.updated_at || t.created_at,
      );
      const requestedBy = req?.requested_by || hist?.changed_by || null;
      const hoursPending = Math.max(0, Math.floor((now.getTime() - requestedAt.getTime()) / 3600000));

      const deadlineRaw = t.submission_deadline || t.bid_closing_date;
      const deadline = deadlineRaw ? new Date(deadlineRaw as any) : null;
      const msLeft = deadline ? deadline.getTime() - now.getTime() : null;

      // Mirror of TendersWorkflowService dual-control rule for management (admin is always permitted).
      let decisionBlockedReason: string | null = null;
      if (!isDecider) {
        decisionBlockedReason = 'Only Management and Admin can approve or reject tender participation.';
      } else if (
        user.role === 'management' &&
        !allowSelfApproval &&
        requestedBy === user.id &&
        t.created_by === user.id &&
        t.assigned_to === user.id
      ) {
        decisionBlockedReason = 'Self-approval is disallowed: you requested, created and are assigned to this tender.';
      }

      return {
        ...t,
        tender_number: t.tender_number || t.tender_no,
        organisation_name: t.organisation_name || t.organisation,
        category: t.category_code || t.category,
        requested_at: requestedAt.toISOString(),
        requested_by: requestedBy,
        requested_by_name: req?.requested_by_name || hist?.requested_by_name || null,
        requested_by_role: req?.requested_by_role || hist?.requested_by_role || null,
        request_note: req?.remarks || hist?.remarks || null,
        approval_round: req?.approval_round || null,
        hours_pending: hoursPending,
        sla_hours: slaHours,
        sla_breached: hoursPending > slaHours,
        deadline_passed: msLeft !== null && msLeft < 0,
        days_left: msLeft === null ? null : Math.ceil(msLeft / 86400000),
        hours_left: msLeft === null ? null : Math.round(msLeft / 3600000),
        can_decide: decisionBlockedReason === null,
        decision_blocked_reason: decisionBlockedReason,
      };
    });

    const bucket = (i: (typeof items)[number]) => (i.hours_left === null ? 1 : i.deadline_passed ? 2 : 0);
    items.sort((a, b) => {
      const ba = bucket(a);
      const bb = bucket(b);
      if (ba !== bb) return ba - bb;
      if (ba === 0) {
        const d = (a.hours_left as number) - (b.hours_left as number);
        if (d !== 0) return d;
      }
      return Date.parse(b.requested_at) - Date.parse(a.requested_at);
    });

    return {
      data: items,
      total: items.length,
      can_decide: isDecider,
      sla_hours: slaHours,
      generated_at: now.toISOString(),
    };
  }

  async getMyTenders(user: AuthUser) {
    return this.findAll({ assigned_to: user.id }, user);
  }

  // =========================================================================
  // 8. Import from Arihant's Tender Sheet (Section 8)
  // =========================================================================

  async importTenders(dto: ImportTenderSheetDto, user: AuthUser) {
    const rows = dto.rows || [];
    const duplicateMode = dto.duplicate_mode || 'skip';
    const commit = dto.commit === true;

    const rowReports: any[] = [];
    const validTendersToInsert: any[] = [];
    const seenInBatch = new Set<string>();

    const zones = await this.db.selectFrom('zones').selectAll().execute();
    const regions = await this.db.selectFrom('regions').selectAll().execute();
    const categories = await this.db.selectFrom('tender_categories').selectAll().execute();

    let rowIndex = 0;
    for (const raw of rows) {
      rowIndex++;
      const errors: string[] = [];

      // Map columns
      const tenderNum = String(raw['Tender Number'] || raw.tender_number || raw.tender_no || '').trim();
      const org = String(raw['Organisation'] || raw.organisation || raw.customer || '').trim();
      const state = String(raw['State'] || raw.state || '').trim();
      const zoneName = String(raw['Zone'] || raw.zone || '').trim();
      const regionName = String(raw['Region'] || raw.region || '').trim();
      const rawDeadline = raw['Submission Deadline'] || raw.submission_deadline || raw.closing_date;
      const rawPubDate = raw['Publication Date'] || raw.publication_date || raw.publish_date;
      const title = String(raw['Tender Title'] || raw.tender_title || raw.title || '').trim();
      const city = String(raw['City'] || raw.city || raw.location || '').trim();
      const rawCategory = String(raw['Category'] || raw.category || raw.tender_category || '').trim();
      const rawValue = raw['Estimated Value'] ?? raw.estimated_value ?? raw.value;
      const rawPreBid = raw['Pre-Bid Date'] || raw.pre_bid_meeting_date || raw.pre_bid_date;

      if (!tenderNum) errors.push('Tender Number is required');
      if (!org) errors.push('Organisation is required');
      if (!rawDeadline) errors.push('Submission Deadline is required');

      // Category: tenders.category is the PQ / General-MHA / Other enum. The sheet may give the code, its label or a
      // master category that stands for one ("General Tender" / "MHA Tender" → General / MHA); anything else is
      // rejected here rather than failing the insert. The master row stored alongside is the one whose code is that
      // enum value, so category and category_id always agree.
      let categoryCode: string | null = null;
      let categoryId: string | null = null;
      if (rawCategory) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const key = norm(rawCategory);
        const alias: Record<string, string> = {
          pq: 'pq', prequalification: 'pq',
          generalmha: 'general_mha', general: 'general_mha', mha: 'general_mha', generaltender: 'general_mha', mhatender: 'general_mha',
          other: 'other', others: 'other',
        };
        const master = categories.find((c) => norm(c.code) === key || norm(c.name) === key);
        categoryCode = (master ? alias[norm(master.code)] : undefined) || alias[key] || null;
        categoryId = categoryCode ? categories.find((c) => c.code.toLowerCase() === categoryCode)?.id ?? null : null;
        if (!categoryCode) errors.push(`Unknown Category: "${rawCategory}" (use PQ, General / MHA or Other)`);
      }

      // Estimated value in rupees; "93 Lakh" / "1.2 Cr" are converted.
      let estimatedValue: number | null = null;
      if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
        const text = String(rawValue).toLowerCase();
        const amount = typeof rawValue === 'number' ? rawValue : Number(text.replace(/[^0-9.]/g, ''));
        const unit = /\b(cr|crore)/.test(text) ? 1e7 : /\b(l|lac|lakh|lakhs)\b/.test(text) ? 1e5 : 1;
        if (!Number.isFinite(amount) || amount <= 0) errors.push(`Invalid Estimated Value: "${rawValue}"`);
        else estimatedValue = Math.round(amount * unit);
      }

      let preBidDate: Date | null = null;
      if (rawPreBid) {
        preBidDate = this.parseDateTimeIST(rawPreBid);
        if (!preBidDate) errors.push('Invalid Pre-Bid Date');
      }

      // Duplicate check inside file
      const batchKey = `${tenderNum.toLowerCase()}_${org.toLowerCase()}`;
      if (seenInBatch.has(batchKey)) {
        errors.push(`Duplicate row inside sheet for "${tenderNum}"`);
      } else {
        seenInBatch.add(batchKey);
      }

      // Parse date format
      let deadlineDate: Date | null = null;
      if (rawDeadline) {
        if (typeof rawDeadline === 'number') {
          // Excel serial format
          deadlineDate = new Date(Math.round((rawDeadline - 25569) * 86400 * 1000));
        } else {
          deadlineDate = this.parseDateTimeIST(rawDeadline);
        }
        if (!deadlineDate) errors.push('Invalid Submission Deadline date');
      }

      // Check zone matching
      let matchedZone = null;
      if (zoneName) {
        matchedZone = zones.find(
          (z) => z.name.toLowerCase() === zoneName.toLowerCase() || z.code.toLowerCase() === zoneName.toLowerCase(),
        );
        if (!matchedZone) errors.push(`Unknown Zone: "${zoneName}"`);
      }

      // Check region matching
      let matchedRegion = null;
      if (regionName) {
        matchedRegion = regions.find((r) => r.name.toLowerCase() === regionName.toLowerCase());
        if (!matchedRegion) errors.push(`Unknown Region: "${regionName}"`);
        else if (matchedZone && matchedRegion.zone_id !== matchedZone.id) {
          errors.push(`Region "${regionName}" does not belong to Zone "${zoneName}"`);
        }
      }

      // Database duplicate check
      const existingInDb = await this.db
        .selectFrom('tenders')
        .select(['id', 'tender_no', 'version'])
        .where(sql`lower(trim(coalesce(tender_number, tender_no)))`, '=', tenderNum.toLowerCase())
        .where(sql`lower(trim(coalesce(organisation, '')))`, '=', org.toLowerCase())
        .where('is_deleted', '=', false)
        .executeTakeFirst();

      if (existingInDb && duplicateMode === 'skip') {
        errors.push(`Tender already exists in database (Skipped)`);
      }

      // A GeM bid number already held by another buyer is the same bid, not a new one (QA BUG-005).
      if (!existingInDb && GEM_BID_NO_RE.test(tenderNum)) {
        const sameBid = await this.db
          .selectFrom('tenders')
          .select(['internal_ref', 'organisation'])
          .where(sql`lower(trim(coalesce(tender_number, tender_no)))`, '=', tenderNum.toLowerCase())
          .where('is_deleted', '=', false)
          .executeTakeFirst();
        if (sameBid) {
          errors.push(`GeM bid number already registered${sameBid.internal_ref ? ` as ${sameBid.internal_ref}` : ''} for "${sameBid.organisation ?? 'another buyer'}"`);
        }
      }

      rowReports.push({
        row: rowIndex,
        tender_number: tenderNum,
        organisation: org,
        valid: errors.length === 0,
        errors,
        action: existingInDb ? (duplicateMode === 'update' ? 'UPDATE' : 'SKIP') : 'INSERT',
      });

      if (errors.length === 0) {
        validTendersToInsert.push({
          tender_no: tenderNum,
          tender_number: tenderNum,
          organisation: org,
          state: state || null,
          zone_id: matchedZone?.id || null,
          region_id: matchedRegion?.id || null,
          submission_deadline: deadlineDate?.toISOString(),
          publication_date: rawPubDate ? this.istDay(rawPubDate) : null,
          tender_title: title || null,
          city: city || null,
          category_code: categoryCode,
          category_id: categoryId,
          estimated_value: estimatedValue,
          pre_bid_meeting_date: preBidDate?.toISOString() || null,
          is_existing: Boolean(existingInDb),
          existing_id: existingInDb?.id,
          extra_fields: { is_historical: true }, // Allow past deadlines in import mode
        });
      }
    }

    if (!commit) {
      return {
        preview: true,
        total_rows: rows.length,
        valid_rows: rowReports.filter((r) => r.valid).length,
        error_rows: rowReports.filter((r) => !r.valid).length,
        reports: rowReports,
      };
    }

    // Commit valid rows in one transaction: a database error part-way never leaves half a sheet imported.
    let insertedCount = 0;
    let updatedCount = 0;

    await this.db.transaction().execute(async (trx) => {
      for (const item of validTendersToInsert) {
        if (item.is_existing && duplicateMode === 'update') {
          await trx
            .updateTable('tenders')
            .set({
              submission_deadline: item.submission_deadline,
              bid_closing_date: item.submission_deadline,
              zone_id: item.zone_id,
              region_id: item.region_id,
              state: item.state,
              // Optional sheet columns only overwrite when the sheet carries them.
              ...(item.tender_title ? { tender_title: item.tender_title } : {}),
              ...(item.city ? { city: item.city } : {}),
              ...(item.category_code ? { category: item.category_code, category_id: item.category_id, tender_category_id: item.category_id } : {}),
              ...(item.estimated_value !== null ? { estimated_value: item.estimated_value } : {}),
              ...(item.pre_bid_meeting_date ? { pre_bid_meeting_date: item.pre_bid_meeting_date } : {}),
              last_activity_at: new Date(),
            })
            .where('id', '=', item.existing_id)
            .execute();
          updatedCount++;
        } else if (!item.is_existing) {
          await trx
            .insertInto('tenders')
            .values({
              // Allocated from the highest reference in use, so imports never collide with existing refs.
              internal_ref: await this.nextInternalRef(trx),
              tender_no: item.tender_no,
              tender_number: item.tender_number,
              organisation: item.organisation,
              state: item.state,
              zone_id: item.zone_id,
              region_id: item.region_id,
              submission_deadline: item.submission_deadline,
              bid_closing_date: item.submission_deadline,
              publication_date: item.publication_date,
              tender_title: item.tender_title || item.tender_number,
              city: item.city,
              ...(item.category_code ? { category: item.category_code, category_id: item.category_id, tender_category_id: item.category_id } : {}),
              estimated_value: item.estimated_value,
              pre_bid_meeting_date: item.pre_bid_meeting_date,
              status: 'identified',
              owner: user.id,
              created_by: user.id,
              extra_fields: JSON.stringify(item.extra_fields) as any,
            })
            .execute();
          insertedCount++;
        }
      }
    });

    return {
      committed: true,
      total_rows: rows.length,
      inserted: insertedCount,
      updated: updatedCount,
      skipped: rows.length - (insertedCount + updatedCount),
      reports: rowReports,
    };
  }

  // =========================================================================
  // Tender Line Items (Products, Quantity, Compliance & Quoted Pricing)
  // =========================================================================

  async getLineItems(tenderId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const items = await this.db
      .selectFrom('tender_line_items')
      .leftJoin('products', 'tender_line_items.product_id', 'products.id')
      .selectAll('tender_line_items')
      .select([
        'products.name as product_name',
        'products.gem_listed as product_gem_listed',
        'products.gem_catalogue_id as product_gem_catalogue_id',
      ])
      .where('tender_line_items.tender_id', '=', tenderId)
      .orderBy('tender_line_items.created_at', 'asc')
      .execute();

    // Field-level security: strip quoted prices if user is salesperson/technical and not assigned
    const canSeePrices =
      ['admin', 'management', 'tender_team', 'regional_manager', 'accounts'].includes(user.role) ||
      tender.assigned_to === user.id ||
      tender.owner === user.id;

    return items.map((item) => {
      const isGemListed = item.product_gem_listed ?? false;
      const gemWarning = !isGemListed;
      return {
        ...item,
        gem_warning: gemWarning,
        quoted_unit_price: canSeePrices ? item.quoted_unit_price : null,
        quoted_total: canSeePrices ? item.quoted_total : null,
      };
    });
  }

  async addLineItem(tenderId: string, dto: CreateTenderLineItemDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    this.assertBoqEditable(tender);
    this.assertLineItemNumbers(dto);
    if (dto.quantity === undefined || dto.quantity === null) {
      throw new BadRequestException('Quantity is required (at least 1).');
    }

    // Quoted total is always quantity × unit price when a price is given (never trusted from the client).
    const quotedTotal =
      dto.quoted_unit_price !== undefined && dto.quoted_unit_price !== null
        ? Number(dto.quoted_unit_price) * Number(dto.quantity)
        : dto.quoted_total;

    const newItem = await this.db
      .insertInto('tender_line_items')
      .values({
        tender_id: tenderId,
        product_id: dto.product_id || null,
        product_description: dto.product_description || null,
        quantity: dto.quantity,
        unit: dto.unit || 'Nos',
        specification_summary: dto.specification_summary || null,
        is_compliant: dto.is_compliant || 'Not Checked',
        compliance_remarks: dto.compliance_remarks || null,
        quoted_unit_price: dto.quoted_unit_price ?? null,
        quoted_total: quotedTotal ?? null,
        awarded: dto.awarded || false,
        awarded_quantity: dto.awarded_quantity || null,
        awarded_unit_price: dto.awarded_unit_price || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.logActivity(
      tenderId,
      'LINE_ITEM_ADDED',
      `Added product/line item: ${dto.product_description || dto.product_id}`,
      user.id,
    );
    return newItem;
  }

  async updateLineItem(tenderId: string, itemId: string, dto: UpdateTenderLineItemDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    // After a win only the award columns may still be filled in; everything else on the BOQ is frozen.
    const awardOnly = ['product_id', 'product_description', 'quantity', 'unit', 'specification_summary', 'is_compliant',
      'compliance_remarks', 'quoted_unit_price', 'quoted_total'].every((k) => (dto as any)[k] === undefined);
    this.assertBoqEditable(tender, { allowAwardFields: awardOnly });
    this.assertLineItemNumbers(dto);

    const current = await this.db
      .selectFrom('tender_line_items')
      .select(['quantity', 'quoted_unit_price'])
      .where('id', '=', itemId)
      .where('tender_id', '=', tenderId)
      .executeTakeFirst();
    if (!current) throw new NotFoundException(`Line item ${itemId} not found on tender ${tenderId}`);

    const updateData: any = { updated_at: new Date() };
    if (dto.product_id !== undefined) updateData.product_id = dto.product_id;
    if (dto.product_description !== undefined) updateData.product_description = dto.product_description;
    if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
    if (dto.unit !== undefined) updateData.unit = dto.unit;
    if (dto.specification_summary !== undefined) updateData.specification_summary = dto.specification_summary;
    if (dto.is_compliant !== undefined) updateData.is_compliant = dto.is_compliant;
    if (dto.compliance_remarks !== undefined) updateData.compliance_remarks = dto.compliance_remarks;
    if (dto.quoted_unit_price !== undefined) updateData.quoted_unit_price = dto.quoted_unit_price;
    if (dto.quoted_total !== undefined) updateData.quoted_total = dto.quoted_total;
    if (dto.awarded !== undefined) updateData.awarded = dto.awarded;
    if (dto.awarded_quantity !== undefined) updateData.awarded_quantity = dto.awarded_quantity;
    if (dto.awarded_unit_price !== undefined) updateData.awarded_unit_price = dto.awarded_unit_price;
    // Keep the quoted total consistent with quantity × unit price whenever either changes.
    if (dto.quantity !== undefined || dto.quoted_unit_price !== undefined) {
      const qty = Number(dto.quantity ?? current.quantity ?? 1);
      const price = dto.quoted_unit_price !== undefined ? dto.quoted_unit_price : current.quoted_unit_price;
      if (price !== null && price !== undefined) updateData.quoted_total = Number(price) * qty;
    }

    const updated = await this.db
      .updateTable('tender_line_items')
      .set(updateData)
      .where('id', '=', itemId)
      .where('tender_id', '=', tenderId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) throw new NotFoundException(`Line item ${itemId} not found on tender ${tenderId}`);
    await this.logActivity(tenderId, 'LINE_ITEM_UPDATED', `Updated product line item compliance / quantity`, user.id);
    return updated;
  }

  async deleteLineItem(tenderId: string, itemId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);
    this.assertBoqEditable(tender);

    const deleted = await this.db
      .deleteFrom('tender_line_items')
      .where('id', '=', itemId)
      .where('tender_id', '=', tenderId)
      .returning(['id', 'product_description'])
      .executeTakeFirst();
    if (!deleted) throw new NotFoundException(`Line item ${itemId} not found on tender ${tenderId}`);

    await this.logActivity(
      tenderId,
      'LINE_ITEM_DELETED',
      `Deleted line item: ${deleted.product_description || itemId}`,
      user.id,
    );
    return { success: true };
  }

  // =========================================================================
  // Document Checklist & Attachments
  // =========================================================================

  /** Which seeded checklist template applies to a tender category (templates exist for pq / mha / general). */
  private checklistTemplateCode(categoryCode?: string | null, categoryName?: string | null): string {
    const name = (categoryName || '').toLowerCase();
    const code = (categoryCode || '').toLowerCase();
    if (name.includes('pq') || code === 'pq' || code.startsWith('pq')) return 'pq';
    if (name.includes('mha') || code.includes('mha')) return 'mha';
    return 'general';
  }

  /**
   * The mandatory-document template for a category, de-duplicated by document type (the seed table holds repeated
   * rows). Falls back to the general template when the category has none.
   */
  private async getChecklistTemplate(
    categoryCode?: string | null,
    categoryName?: string | null,
    executor: Kysely<Database> = this.db,
  ): Promise<{ catCode: string; items: { document_type: string; is_mandatory: boolean }[] }> {
    const load = async (code: string) =>
      executor
        .selectFrom('document_checklist_templates')
        .select([
          'document_type',
          sql<boolean>`bool_or(is_mandatory)`.as('is_mandatory'),
          sql<number>`min(sort_order)`.as('sort_order'),
        ])
        .where('category_code', '=', code)
        .groupBy('document_type')
        .orderBy(sql`min(sort_order)`, 'asc')
        .execute();

    let catCode = this.checklistTemplateCode(categoryCode, categoryName);
    let rows = await load(catCode);
    if (rows.length === 0 && catCode !== 'general') {
      catCode = 'general';
      rows = await load(catCode);
    }
    return {
      catCode,
      items: rows.map((r) => ({ document_type: r.document_type, is_mandatory: Boolean(r.is_mandatory) })),
    };
  }

  /**
   * Submission readiness = mandatory documents Ready / mandatory documents required.
   * - Required set = the tender's mandatory checklist rows plus every mandatory item of its category template that
   *   has no checklist row yet — so "no documents" is 0% ready, never 100%, and one custom document added before the
   *   checklist is initialised can never stand in for the whole template. A template item the checklist already
   *   carries follows the checklist row (it may have been marked optional there).
   * - Only status "Ready" counts. Repeated rows of the same document type count once (ready when one is Ready).
   * - Zero required documents (no checklist and no template) is NOT ready.
   */
  async computeDocumentReadiness(
    tender: { id: string; category?: string | null; category_code?: string | null; category_name?: string | null },
    docs?: { document_type: string; is_mandatory: boolean; status: string }[],
  ) {
    const documents =
      docs ??
      (await this.db
        .selectFrom('tender_documents')
        .select(['document_type', 'is_mandatory', 'status'])
        .where('tender_id', '=', tender.id)
        .execute());

    const isReady = (status: string) => (status || '').trim().toLowerCase() === 'ready';
    const mandatoryDocs = documents.filter((d) => d.is_mandatory);
    const checklistCreated = mandatoryDocs.length > 0;

    const required = new Map<string, boolean>();
    const source: 'checklist' | 'template' = checklistCreated ? 'checklist' : 'template';
    for (const d of mandatoryDocs) {
      const key = d.document_type.trim();
      required.set(key, Boolean(required.get(key)) || isReady(d.status));
    }
    const onChecklist = new Set(documents.map((d) => d.document_type.trim()));
    const template = await this.getChecklistTemplate(
      tender.category_code || tender.category,
      tender.category_name,
    );
    for (const t of template.items.filter((i) => i.is_mandatory)) {
      const key = t.document_type.trim();
      if (onChecklist.has(key)) continue;
      required.set(key, false);
    }

    const total = required.size;
    const ready = [...required.values()].filter(Boolean).length;
    const missing = [...required.entries()].filter(([, ok]) => !ok).map(([type]) => type);
    return {
      mandatory_total: total,
      mandatory_ready: ready,
      percentage: total > 0 ? Math.round((ready / total) * 100) : 0,
      all_mandatory_ready: total > 0 && ready === total,
      checklist_created: checklistCreated,
      source,
      missing,
    };
  }

  /** Server-side document gate for TENDER_SUBMITTED / PQ_SUBMITTED. Throws a 400 listing what is missing. */
  private async assertSubmissionReadiness(
    tender: { id: string; category?: string | null; category_code?: string | null; category_name?: string | null },
    to: 'TENDER_SUBMITTED' | 'PQ_SUBMITTED',
    options?: { bypassDocumentGate?: boolean; userRole?: string },
  ) {
    if (options?.bypassDocumentGate) return;
    const r = await this.computeDocumentReadiness(tender);
    if (r.checklist_created && r.all_mandatory_ready) return;
    const stage = to === 'PQ_SUBMITTED' ? 'PQ Submitted' : 'Tender Submitted';
    // No checklist yet = nothing has been verified: the bid can never be submitted on an empty document list.
    if (!r.checklist_created) {
      throw new BadRequestException(
        `Cannot move to "${stage}": the mandatory document checklist has not been initialised. Open the Documents tab, initialise the checklist and mark every mandatory document Ready.`,
      );
    }
    const prefix = `Cannot move to "${stage}": ${r.mandatory_ready} of ${r.mandatory_total} mandatory documents are Ready (${r.percentage}%).`;
    throw new BadRequestException(`${prefix} Not Ready: ${r.missing.join(', ')}.`);
  }

  async getDocuments(tenderId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const docs = await this.db
      .selectFrom('tender_documents')
      .leftJoin('users', 'tender_documents.owner_id', 'users.id')
      .selectAll('tender_documents')
      .select('users.full_name as owner_name')
      .where('tender_documents.tender_id', '=', tenderId)
      .orderBy('tender_documents.created_at', 'asc')
      .execute();

    const readiness = await this.computeDocumentReadiness(tender, docs);

    return {
      documents: docs,
      completion_percentage: readiness.percentage,
      mandatory_ready: readiness.mandatory_ready,
      mandatory_total: readiness.mandatory_total,
      all_mandatory_ready: readiness.all_mandatory_ready,
      readiness,
    };
  }

  async addDocument(tenderId: string, dto: CreateTenderDocumentDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const doc = await this.db
      .insertInto('tender_documents')
      .values({
        tender_id: tenderId,
        document_type: dto.document_type,
        is_mandatory: dto.is_mandatory ?? false,
        status: dto.status || 'Not Started',
        file_url: dto.file_url || null,
        file_name: dto.file_name || null,
        file_size: dto.file_size || null,
        mime_type: dto.mime_type || null,
        owner_id: dto.owner_id || user.id,
        due_date: dto.due_date || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.logActivity(tenderId, 'DOCUMENT_ADDED', `Added document: ${dto.document_type}`, user.id);
    return doc;
  }

  async updateDocument(tenderId: string, docId: string, dto: UpdateTenderDocumentDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const updateData: any = { updated_at: new Date() };
    if (dto.document_type !== undefined) updateData.document_type = dto.document_type;
    if (dto.is_mandatory !== undefined) updateData.is_mandatory = dto.is_mandatory;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.file_url !== undefined) updateData.file_url = dto.file_url || null;
    if (dto.file_name !== undefined) updateData.file_name = dto.file_name || null;
    if (dto.file_size !== undefined) updateData.file_size = dto.file_size;
    if (dto.mime_type !== undefined) updateData.mime_type = dto.mime_type;
    if (dto.owner_id !== undefined) updateData.owner_id = dto.owner_id;
    if (dto.due_date !== undefined) updateData.due_date = dto.due_date;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const updated = await this.db
      .updateTable('tender_documents')
      .set(updateData)
      .where('id', '=', docId)
      .where('tender_id', '=', tenderId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) throw new NotFoundException(`Document ${docId} not found on tender ${tenderId}`);
    
    // Automatically synchronize document readiness with tender prep_checklist_done
    const allMandatoryReady = (await this.computeDocumentReadiness(tender)).all_mandatory_ready;

    await this.db
      .updateTable('tenders')
      .set({ prep_checklist_done: allMandatoryReady, updated_at: new Date() })
      .where('id', '=', tenderId)
      .execute();

    await this.logActivity(
      tenderId,
      'DOCUMENT_UPDATED',
      `Updated document ${updated.document_type} status to ${updated.status} (Readiness: ${allMandatoryReady ? 'Complete' : 'In Progress'})`,
      user.id,
    );
    return updated;
  }

  async deleteDocument(tenderId: string, docId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    await this.db
      .deleteFrom('tender_documents')
      .where('id', '=', docId)
      .where('tender_id', '=', tenderId)
      .execute();

    await this.logActivity(tenderId, 'DOCUMENT_DELETED', `Deleted document ${docId}`, user.id);
    return { success: true };
  }

  async initChecklist(tenderId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    // Same template resolution the readiness gate uses, de-duplicated by document type.
    const { catCode, items: templates } = await this.getChecklistTemplate(
      tender.category_code || tender.category,
      tender.category_name,
    );

    let createdCount = 0;
    for (const t of templates) {
      const exists = await this.db
        .selectFrom('tender_documents')
        .select('id')
        .where('tender_id', '=', tenderId)
        .where('document_type', '=', t.document_type)
        .executeTakeFirst();

      if (!exists) {
        await this.db
          .insertInto('tender_documents')
          .values({
            tender_id: tenderId,
            document_type: t.document_type,
            is_mandatory: t.is_mandatory,
            status: 'Not Started',
            owner_id: tender.assigned_to || user.id,
          })
          .execute();
        createdCount++;
      }
    }

    await this.logActivity(
      tenderId,
      'CHECKLIST_INITIALIZED',
      `Initialized ${createdCount} mandatory document checklist items for ${catCode.toUpperCase()}`,
      user.id,
    );
    return this.getDocuments(tenderId, user);
  }

  // =========================================================================
  // Tender Corrigenda & Deadline Extension
  // =========================================================================

  async getCorrigenda(tenderId: string, user?: AuthUser) {
    await this.findOne(tenderId, user);
    return this.db
      .selectFrom('tender_corrigenda')
      .leftJoin('users', 'tender_corrigenda.created_by', 'users.id')
      .selectAll('tender_corrigenda')
      .select('users.full_name as created_by_name')
      .where('tender_id', '=', tenderId)
      .orderBy('tender_corrigenda.created_at', 'desc')
      .execute();
  }

  async addCorrigendum(tenderId: string, dto: CreateTenderCorrigendumDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const corrigendumNumber = (dto.corrigendum_number || '').trim();
    if (!corrigendumNumber) throw new BadRequestException('Corrigendum number is required');
    const newDeadline = this.parseDateTimeIST(dto.new_deadline);
    if (!newDeadline) throw new BadRequestException('Invalid new deadline date format');

    // Issued date: a calendar day, not in the future (IST).
    const issuedDay = dto.issued_date ? this.istDay(dto.issued_date) : todayInKolkata();
    if (!issuedDay) throw new BadRequestException('Invalid corrigendum issued date');
    if (issuedDay > todayInKolkata()) {
      throw new BadRequestException(`Corrigendum issued date cannot be in the future (today is ${todayInKolkata()} IST)`);
    }

    // A corrigendum number is recorded once per tender (case- and space-insensitive).
    const duplicate = await this.db
      .selectFrom('tender_corrigenda')
      .select('id')
      .where('tender_id', '=', tenderId)
      .where(sql<boolean>`lower(trim(corrigendum_number)) = ${corrigendumNumber.toLowerCase()}`)
      .executeTakeFirst();
    if (duplicate) {
      throw new ConflictException(`Corrigendum "${corrigendumNumber}" is already recorded on this tender.`);
    }

    // The corrigendum row is written inside the deadline-change transaction, after every deadline rule has passed:
    // a rejected deadline (e.g. before the publication date) leaves no corrigendum behind.
    let corrigendum: any = null;
    try {
      await this.updateDeadline(
        tenderId,
        {
          new_deadline: newDeadline.toISOString(),
          reason: `Corrigendum ${corrigendumNumber}: ${dto.summary || 'Deadline extended'}`,
        },
        user,
        {
          inTransaction: async (trx, { oldDeadline }) => {
            corrigendum = await trx
              .insertInto('tender_corrigenda')
              .values({
                tender_id: tenderId,
                corrigendum_number: corrigendumNumber,
                issued_date: issuedDay,
                summary: dto.summary || null,
                old_deadline: oldDeadline,
                new_deadline: newDeadline,
                attachment_url: dto.attachment_url || null,
                created_by: user.id,
              })
              .returningAll()
              .executeTakeFirstOrThrow();
          },
        },
      );
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(`Corrigendum "${corrigendumNumber}" is already recorded on this tender.`);
      }
      throw this.toFriendlyDbError(err, 'record the corrigendum');
    }

    await this.logActivity(
      tenderId,
      'CORRIGENDUM_ISSUED',
      `Corrigendum ${corrigendumNumber} recorded. Deadline updated.`,
      user.id,
    );
    return corrigendum;
  }

  // =========================================================================
  // Financial Instruments (EMD, PBG, Fees)
  // =========================================================================

  async getFinancialInstruments(tenderId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    return this.db
      .selectFrom('tender_financial_instruments')
      .leftJoin('users', 'tender_financial_instruments.finance_owner_id', 'users.id')
      .selectAll('tender_financial_instruments')
      .select('users.full_name as finance_owner_name')
      .where('tender_id', '=', tenderId)
      .orderBy('tender_financial_instruments.created_at', 'desc')
      .execute();
  }

  async addFinancialInstrument(tenderId: string, dto: CreateTenderFinancialInstrumentDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException(`${dto.instrument_type || 'Instrument'} amount must be greater than zero.`);
    }

    const inst = await this.db
      .insertInto('tender_financial_instruments')
      .values({
        tender_id: tenderId,
        instrument_type: dto.instrument_type,
        amount,
        mode: dto.mode || 'Online',
        reference_number: dto.reference_number || null,
        bank: dto.bank || null,
        issue_date: dto.issue_date || null,
        expiry_date: dto.expiry_date || null,
        status: dto.status || 'Requested',
        finance_owner_id: dto.finance_owner_id || null,
        remarks: dto.remarks || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.logActivity(
      tenderId,
      'FINANCIAL_INSTRUMENT_REQUESTED',
      `${dto.instrument_type} of ₹${dto.amount} logged (${dto.status || 'Requested'})`,
      user.id,
    );
    this.audit(user.id, tenderId, 'financial_instrument_added', null, {
      instrument_type: inst.instrument_type,
      amount: inst.amount,
      status: inst.status,
      reference_number: inst.reference_number,
    });
    return inst;
  }

  async updateFinancialInstrument(
    tenderId: string,
    instrumentId: string,
    dto: UpdateTenderFinancialInstrumentDto,
    user: AuthUser,
  ) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    if (dto.amount !== undefined && (!Number.isFinite(Number(dto.amount)) || Number(dto.amount) <= 0)) {
      throw new BadRequestException('Instrument amount must be greater than zero.');
    }

    const updateData: any = { updated_at: new Date() };
    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.mode !== undefined) updateData.mode = dto.mode;
    if (dto.reference_number !== undefined) updateData.reference_number = dto.reference_number;
    if (dto.bank !== undefined) updateData.bank = dto.bank;
    if (dto.issue_date !== undefined) updateData.issue_date = dto.issue_date;
    if (dto.expiry_date !== undefined) updateData.expiry_date = dto.expiry_date;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.finance_owner_id !== undefined) updateData.finance_owner_id = dto.finance_owner_id;
    if (dto.remarks !== undefined) updateData.remarks = dto.remarks;

    const before = await this.db
      .selectFrom('tender_financial_instruments')
      .selectAll()
      .where('id', '=', instrumentId)
      .where('tender_id', '=', tenderId)
      .executeTakeFirst();

    const updated = await this.db
      .updateTable('tender_financial_instruments')
      .set(updateData)
      .where('id', '=', instrumentId)
      .where('tender_id', '=', tenderId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) throw new NotFoundException(`Financial instrument ${instrumentId} not found`);
    await this.logActivity(
      tenderId,
      'FINANCIAL_INSTRUMENT_UPDATED',
      `${updated.instrument_type} updated to status "${updated.status}"`,
      user.id,
    );
    const { updated_at, ...instrumentFields } = updateData;
    const diff = before ? this.changedFields(before as Record<string, any>, instrumentFields) : null;
    if (diff) {
      this.audit(user.id, tenderId, 'financial_instrument_updated', { instrument_type: updated.instrument_type, ...diff.previous }, { instrument_type: updated.instrument_type, ...diff.next });
    }
    return updated;
  }

  async getFinanceEmdTracking(user: AuthUser) {
    const instruments = await this.db
      .selectFrom('tender_financial_instruments')
      .leftJoin('tenders', 'tender_financial_instruments.tender_id', 'tenders.id')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .select([
        'tender_financial_instruments.id',
        'tender_financial_instruments.tender_id',
        'tender_financial_instruments.instrument_type',
        'tender_financial_instruments.amount',
        'tender_financial_instruments.mode',
        'tender_financial_instruments.status',
        'tender_financial_instruments.reference_number',
        'tender_financial_instruments.bank',
        'tender_financial_instruments.issue_date',
        'tender_financial_instruments.expiry_date',
        'tender_financial_instruments.remarks',
        'tender_financial_instruments.created_at',
        'tender_financial_instruments.updated_at',
        'tenders.tender_number',
        'tenders.tender_no',
        'tenders.status as tender_status',
        'tenders.submission_deadline',
        'tenders.result_date',
        'organisations.name as organisation_name',
      ])
      .where('tender_financial_instruments.instrument_type', 'in', ['EMD', 'PBG'])
      .where((eb) => eb.or([eb('tenders.is_deleted', '=', false), eb('tenders.is_deleted', 'is', null)]))
      // A regional manager tracks the EMDs of the bids their tender list shows; finance / tender team are All-India.
      .$if(user.role === 'regional_manager', (qb) => qb.where(rmTenderScope(user)))
      .orderBy('tender_financial_instruments.created_at', 'desc')
      .execute();

    const totalEmdBlocked = instruments
      .filter((i) => i.instrument_type === 'EMD' && ['Issued', 'Submitted'].includes(i.status))
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);

    const totalRefundDue = instruments
      .filter((i) => i.instrument_type === 'EMD' && i.status === 'Refund Due')
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);

    const refundDueItems = instruments
      .filter((i) => i.instrument_type === 'EMD' && i.status === 'Refund Due')
      .map((i) => {
        // An EMD falls due for refund when the result is declared (a lost bid moves it to Refund Due); one with no
        // recorded result counts from when it was logged. Editing the instrument later never restarts the clock.
        const dueSince = calendarDay(i.result_date as any) || istDateOf(i.created_at);
        const daysPending = Math.max(0, isoDaysBetween(dueSince, todayInKolkata()));
        return {
          ...i,
          days_pending: daysPending,
          aging_bucket: daysPending > 30 ? '> 30 days' : '< 30 days',
        };
      });

    return {
      total_emd_blocked: totalEmdBlocked,
      total_refund_due: totalRefundDue,
      refund_due_count: refundDueItems.length,
      refund_due_items: refundDueItems,
      all_instruments: instruments,
      instruments: instruments,
    };
  }

  // =========================================================================
  // Tender Discussions & Mentions (Replaces WhatsApp)
  // =========================================================================

  async getComments(tenderId: string, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    return this.db
      .selectFrom('tender_comments')
      .leftJoin('users', 'tender_comments.author_id', 'users.id')
      .selectAll('tender_comments')
      .select(['users.full_name as author_name', 'users.role as author_role', 'users.email as author_email'])
      .where('tender_id', '=', tenderId)
      .orderBy('tender_comments.created_at', 'asc')
      .execute();
  }

  async addComment(tenderId: string, dto: CreateTenderCommentDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    await this.assertTenderVisible(user, tender);

    const mentions = Array.isArray(dto.mentions) ? dto.mentions : [];

    const comment = await this.db
      .insertInto('tender_comments')
      .values({
        tender_id: tenderId,
        author_id: user.id,
        body: dto.body.trim(),
        mentions: JSON.stringify(mentions) as any,
        is_internal: dto.is_internal ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.logActivity(tenderId, 'COMMENT_POSTED', `Discussion note posted by ${user.full_name}`, user.id);

    // If users were mentioned, create in-app notifications
    for (const mentionedId of mentions) {
      await this.db
        .insertInto('notifications')
        .values({
          user_id: mentionedId,
          type: 'mention',
          title: `Mentioned on tender ${tender.tender_number || tender.tender_no}`,
          body: `${user.full_name}: "${dto.body.slice(0, 100)}..."`,
          entity_type: 'tender',
          entity_id: tenderId,
        })
        .execute()
        .catch(() => {});
    }

    return comment;
  }

  // =========================================================================
  // Approver Delegations (Out-of-office delegation)
  // =========================================================================

  async getDelegations(user: AuthUser) {
    return this.db
      .selectFrom('tender_user_delegations')
      .leftJoin('users as delegator', 'tender_user_delegations.delegator_id', 'delegator.id')
      .leftJoin('users as delegatee', 'tender_user_delegations.delegatee_id', 'delegatee.id')
      .selectAll('tender_user_delegations')
      .select([
        'delegator.full_name as delegator_name',
        'delegatee.full_name as delegatee_name',
      ])
      .where((eb) =>
        eb.or([
          eb('delegator_id', '=', user.id),
          eb('delegatee_id', '=', user.id),
        ]),
      )
      .orderBy('tender_user_delegations.created_at', 'desc')
      .execute();
  }

  async createDelegation(dto: CreateTenderDelegationDto, user: AuthUser) {
    return this.db
      .insertInto('tender_user_delegations')
      .values({
        delegator_id: user.id,
        delegatee_id: dto.delegatee_id,
        start_date: dto.start_date,
        end_date: dto.end_date,
        reason: dto.reason || 'Out of office delegation',
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // =========================================================================
  // Masters: Competitors, Portals, Region Mapping, Approval Rules
  // =========================================================================

  async getCompetitors() {
    return this.db
      .selectFrom('competitors')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('name', 'asc')
      .execute();
  }

  async createCompetitor(dto: CreateCompetitorDto) {
    return this.db
      .insertInto('competitors')
      .values({
        name: dto.name.trim(),
        code: dto.code ? dto.code.trim().toUpperCase() : null,
        description: dto.description || null,
        is_active: true,
      })
      .onConflict((oc) => oc.column('name').doUpdateSet({ is_active: true }))
      .returningAll()
      .executeTakeFirst();
  }

  async getPortals() {
    return this.db
      .selectFrom('tender_portals')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('name', 'asc')
      .execute();
  }

  async createPortal(dto: CreateTenderPortalDto) {
    return this.db
      .insertInto('tender_portals')
      .values({
        name: dto.name.trim(),
        code: dto.code.trim().toLowerCase(),
        base_url: dto.base_url || null,
        is_active: true,
      })
      .onConflict((oc) => oc.column('code').doUpdateSet({ name: dto.name, base_url: dto.base_url }))
      .returningAll()
      .executeTakeFirst();
  }

  async getRegionMappings() {
    return this.db
      .selectFrom('region_mapping')
      .leftJoin('regions', 'region_mapping.region_id', 'regions.id')
      .leftJoin('zones', 'region_mapping.zone_id', 'zones.id')
      .selectAll('region_mapping')
      .select([
        'regions.name as region_name',
        'zones.name as zone_name',
      ])
      .orderBy('region_mapping.state', 'asc')
      .execute();
  }

  async createRegionMapping(dto: CreateRegionMappingDto) {
    return this.db
      .insertInto('region_mapping')
      .values({
        state: dto.state.trim(),
        city: dto.city ? dto.city.trim() : null,
        region_id: dto.region_id,
        zone_id: dto.zone_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getApprovalRules() {
    return this.db
      .selectFrom('approval_rules')
      .leftJoin('tender_categories', 'approval_rules.category_id', 'tender_categories.id')
      .leftJoin('zones', 'approval_rules.zone_id', 'zones.id')
      .leftJoin('users', 'approval_rules.approver_id', 'users.id')
      .selectAll('approval_rules')
      .select([
        'tender_categories.name as category_name',
        'zones.name as zone_name',
        'users.full_name as approver_name',
      ])
      .orderBy('approval_rules.level', 'asc')
      .execute();
  }

  async createApprovalRule(dto: CreateApprovalRuleDto) {
    return this.db
      .insertInto('approval_rules')
      .values({
        category_id: dto.category_id || null,
        zone_id: dto.zone_id || null,
        min_value: dto.min_value || 0,
        max_value: dto.max_value || null,
        approver_role: dto.approver_role || 'management',
        approver_id: dto.approver_id || null,
        level: dto.level || 1,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // =========================================================================
  // Cross-Module Integrations: Linked Tender & Sales Order
  // =========================================================================

  async createLinkedTender(tenderId: string, dto: CreateLinkedTenderDto, user: AuthUser) {
    const parent = await this.findOne(tenderId, user);
    const parentNorm = this.workflowService.normalizeStatus(parent.status);

    if (parentNorm !== 'PQ_QUALIFIED' && parentNorm !== 'WON') {
      throw new BadRequestException('A linked tender can only be created from a PQ_QUALIFIED or WON PQ tender');
    }

    let catId = dto.category_id;
    if (!catId) {
      const genCat = await this.db
        .selectFrom('tender_categories')
        .select('id')
        .where('code', 'in', ['general', 'general_mha'])
        .executeTakeFirst();
      if (genCat) catId = genCat.id;
    }

    const newTender = await this.create(
      {
        tender_number: dto.tender_number.trim(),
        tender_title: dto.tender_title.trim(),
        organisation_id: parent.organisation_id || undefined,
        organisation: parent.organisation || undefined,
        department: parent.department || undefined,
        city: parent.city || undefined,
        state: parent.state || undefined,
        zone_id: parent.zone_id || undefined,
        region_id: parent.region_id || undefined,
        category_id: catId || undefined,
        tender_type: dto.tender_type || 'Open',
        submission_deadline: dto.submission_deadline,
        estimated_value: dto.estimated_value,
        assigned_to: parent.assigned_to || undefined,
        tender_owner_id: parent.tender_owner_id || undefined,
        remarks: dto.remarks || `Linked from PQ tender ${parent.tender_number || parent.tender_no}`,
        linked_pq_tender_id: parent.id,
      },
      user,
    );

    // Copy line items from parent
    const parentLineItems = await this.db
      .selectFrom('tender_line_items')
      .selectAll()
      .where('tender_id', '=', parent.id)
      .execute();

    for (const li of parentLineItems) {
      await this.db
        .insertInto('tender_line_items')
        .values({
          tender_id: newTender.id,
          product_id: li.product_id,
          product_description: li.product_description,
          quantity: li.quantity,
          unit: li.unit,
          specification_summary: li.specification_summary,
          is_compliant: li.is_compliant,
          compliance_remarks: li.compliance_remarks,
          quoted_unit_price: li.quoted_unit_price,
          quoted_total: li.quoted_total,
        })
        .execute();
    }

    // Initialize document checklist for new tender
    await this.initChecklist(newTender.id, user).catch(() => {});

    await this.logActivity(
      parent.id,
      'LINKED_TENDER_CREATED',
      `Created General tender ${dto.tender_number} linked to this PQ`,
      user.id,
    );
    return newTender;
  }

  async createSalesOrder(tenderId: string, dto: CreateSalesOrderFromTenderDto, user: AuthUser) {
    const tender = await this.findOne(tenderId, user);
    const norm = this.workflowService.normalizeStatus(tender.status);

    if (norm !== 'WON') {
      throw new BadRequestException('Sales Orders can only be generated from WON tenders');
    }

    // The delivery belongs to the buying customer; a tender captured by name only must be linked first.
    if (!tender.organisation_id) {
      throw new BadRequestException('Link this tender to a customer organisation before generating a Sales Order');
    }

    const cleanRef = (dto.order_number || `ORD-${Date.now()}`).trim();
    const deliveryNo = cleanRef.startsWith('SO-') ? cleanRef : `SO-${cleanRef}`;
    const duplicate = await this.db.selectFrom('deliveries').select('id').where('delivery_no', '=', deliveryNo).executeTakeFirst();
    if (duplicate) {
      throw new ConflictException(`Sales Order ${deliveryNo} already exists — use a different PO/LoA reference`);
    }

    const delivery = await this.db
      .insertInto('deliveries')
      .values({
        delivery_no: deliveryNo,
        organisation_id: tender.organisation_id,
        tender_id: tenderId,
        // The awarded product travels with the order (QA BUG-027: it showed the generic placeholder instead).
        product_id: tender.product_id || null,
        order_reference: dto.order_number,
        delivery_date: dto.order_date || todayInKolkata(),
        delivery_location: dto.delivery_location || tender.city || 'Client Site',
        assigned_to: tender.assigned_to || user.id,
        // Order confirmed = delivery scheduled; it then moves through the normal delivery lifecycle.
        status: 'scheduled',
        remarks: `Auto-generated from won tender ${tender.tender_number || tender.tender_no}. Terms: ${dto.delivery_terms || 'Standard'}`,
        created_by: user.id,
      })
      .returningAll()
      .executeTakeFirst();

    await this.logActivity(
      tenderId,
      'SALES_ORDER_CREATED',
      `Sales Order created with PO/LoA ref: ${dto.order_number}`,
      user.id,
    );
    return {
      id: delivery?.id,
      success: true,
      sales_order: delivery,
      tender_id: tenderId,
      order_number: dto.order_number,
    };
  }

  // =========================================================================
  // Deadline Centre & Calendar
  // =========================================================================

  async getDeadlineCentre(user: AuthUser) {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const in48Hours = new Date(now.getTime() + 48 * 3600 * 1000);
    const in24Hours = new Date(now.getTime() + 24 * 3600 * 1000);

    const nonTerminalStatuses = [
      'identified',
      'awaiting_approval',
      'under_preparation',
      'pq_submitted',
      'pq_qualified',
      'submitted',
      'technical_eval',
      'commercial_eval',
    ];

    let baseQuery = this.db
      .selectFrom('tenders')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .leftJoin('users as assignee', 'tenders.assigned_to', 'assignee.id')
      // Full tender rows so the Deadline Centre cards can open the dossier / outcome form directly.
      .selectAll('tenders')
      .select([
        'organisations.name as organisation_name',
        'assignee.full_name as assigned_to_name',
        'assignee.full_name as assigned_person_name',
      ])
      .where('tenders.is_deleted', '=', false)
      .where('tenders.status', 'in', nonTerminalStatuses as any);

    if (user.role === 'regional_manager') {
      baseQuery = baseQuery.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
        ]),
      );
    }

    const allActive = await baseQuery.execute();
    // B2/B3: only pre-submission bids can approach or miss their submission deadline; a submitted / evaluated bid
    // is never "overdue" (it shows under result follow-ups instead).
    const preSubmission = allActive.filter((t) => TENDER_PRE_SUBMISSION_STATUSES.includes(String(t.status).toLowerCase()));

    const upcoming7d = preSubmission.filter((t) => {
      if (!t.submission_deadline) return false;
      const d = new Date(t.submission_deadline);
      return d >= now && d <= in7Days;
    });

    const in72Hours = new Date(now.getTime() + 72 * 3600 * 1000);
    const approaching72h = preSubmission.filter((t) => {
      if (!t.submission_deadline) return false;
      const d = new Date(t.submission_deadline);
      return d >= now && d <= in72Hours;
    });

    const approaching48h = preSubmission.filter((t) => {
      if (!t.submission_deadline) return false;
      const d = new Date(t.submission_deadline);
      return d >= now && d <= in48Hours;
    });

    const urgent24h = preSubmission.filter((t) => {
      if (!t.submission_deadline) return false;
      const d = new Date(t.submission_deadline);
      return d >= now && d <= in24Hours;
    });

    const overdue = preSubmission.filter((t) => {
      if (!t.submission_deadline) return false;
      const d = new Date(t.submission_deadline);
      return d < now;
    });

    // Same source as the Approvals Inbox / "Pending Approvals" KPI.
    const pendingApprovals = (await this.getApprovalsInbox(user, now)).data;

    const incompletePrep = allActive.filter((t) =>
      ['under_preparation', 'UNDER_PREPARATION'].includes(t.status),
    );

    const resultFollowUps = allActive.filter((t) =>
      ['submitted', 'TENDER_SUBMITTED', 'technical_eval', 'commercial_eval'].includes(t.status),
    );

    return {
      upcoming_submissions_7d: upcoming7d,
      upcoming_7d: upcoming7d,
      approaching_deadlines_72h: approaching72h,
      approaching_48h: approaching48h,
      urgent_deadlines_24h: urgent24h,
      urgent_24h: urgent24h,
      overdue: overdue,
      incomplete_preparation: incompletePrep,
      result_follow_ups: resultFollowUps,
      pending_internal_approvals: pendingApprovals,
      pending_approvals: pendingApprovals,
      counts: {
        upcoming_submissions_7d: upcoming7d.length,
        upcoming_7d: upcoming7d.length,
        approaching_deadlines_72h: approaching72h.length,
        approaching_48h: approaching48h.length,
        urgent_deadlines_24h: urgent24h.length,
        urgent_24h: urgent24h.length,
        incomplete_preparation: incompletePrep.length,
        result_follow_ups: resultFollowUps.length,
        overdue: overdue.length,
        pending_internal_approvals: pendingApprovals.length,
        pending_approvals: pendingApprovals.length,
      },
    };
  }

  async getCalendarEvents(user: AuthUser, query: any) {
    let q = this.db
      .selectFrom('tenders')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .select([
        'tenders.id',
        'tenders.tender_number',
        'tenders.tender_no',
        'tenders.tender_title',
        'tenders.organisation',
        'organisations.name as organisation_name',
        'tenders.status',
        'tenders.submission_deadline',
        'tenders.publication_date',
        'tenders.pre_bid_meeting_date',
        'tenders.query_submission_deadline',
        'tenders.technical_opening_date',
        'tenders.commercial_opening_date',
        'tenders.region_id',
        'tenders.zone_id',
      ])
      .where('tenders.is_deleted', '=', false);

    if (user.role === 'regional_manager') {
      q = q.where(rmTenderScope(user));
    } else if (user.role === 'sales') {
      q = q.where((eb) =>
        eb.or([
          eb('tenders.assigned_to', '=', user.id),
          eb('tenders.owner', '=', user.id),
          eb('tenders.tender_owner_id', '=', user.id),
          eb('tenders.created_by', '=', user.id),
        ]),
      );
    }

    const tenders = await q.execute();
    const events: any[] = [];

    for (const t of tenders) {
      const org = t.organisation || t.organisation_name || 'Customer';
      const no = t.tender_number || t.tender_no || 'Tender';

      if (t.submission_deadline) {
        events.push({
          id: `${t.id}-sub`,
          tender_id: t.id,
          title: `Submission: ${no} (${org})`,
          date: t.submission_deadline,
          event_date: t.submission_deadline,
          event_type: 'submission_deadline',
          status: t.status,
        });
      }
      if (t.pre_bid_meeting_date) {
        events.push({
          id: `${t.id}-prebid`,
          tender_id: t.id,
          title: `Pre-Bid: ${no} (${org})`,
          date: t.pre_bid_meeting_date,
          event_date: t.pre_bid_meeting_date,
          event_type: 'pre_bid_meeting',
          status: t.status,
        });
      }
      if (t.query_submission_deadline) {
        events.push({
          id: `${t.id}-query`,
          tender_id: t.id,
          title: `Queries Due: ${no} (${org})`,
          date: t.query_submission_deadline,
          event_date: t.query_submission_deadline,
          event_type: 'query_deadline',
          status: t.status,
        });
      }
      if (t.technical_opening_date) {
        events.push({
          id: `${t.id}-techopen`,
          tender_id: t.id,
          title: `Tech Opening: ${no} (${org})`,
          date: t.technical_opening_date,
          event_date: t.technical_opening_date,
          event_type: 'technical_opening',
          status: t.status,
        });
      }
      if (t.commercial_opening_date) {
        events.push({
          id: `${t.id}-commopen`,
          tender_id: t.id,
          title: `Comm. Opening: ${no} (${org})`,
          date: t.commercial_opening_date,
          event_date: t.commercial_opening_date,
          event_type: 'commercial_opening',
          status: t.status,
        });
      }
    }

    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return events;
  }
}
