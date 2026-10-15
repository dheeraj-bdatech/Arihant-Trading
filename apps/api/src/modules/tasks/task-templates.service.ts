/**
 * Recurring task templates (§3.2, §7.10–18): create (one template per assignee), edit (affects only future,
 * not-yet-started instances), pause / resume / end, next-N preview and occurrence history.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import {
  TASK_HOLIDAY_POLICIES,
  TASK_MAX_BULK_ASSIGNEES,
  TASK_MIN_COMMENT_LENGTH,
  addIsoDays,
  describeRecurrence,
  expandRecurrence,
  istDateTime,
  todayInKolkata,
  validateRecurrenceRule,
  type AuthUser,
  type TaskHolidayPolicy,
  type TaskRecurrenceRule,
  type TaskRecurrenceType,
} from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { TaskInputService, isLinked, type TaskLinks } from './task-input.service.js';
import { TaskGeneratorService, horizonDays, parseRule, type TemplateRow } from './task-generator.service.js';
import { isAdminLike } from './task-masters.service.js';
import {
  TaskValidationException,
  UUID_RE,
  conflict,
  readComment,
  readDate,
  readEnum,
  readInt,
  readUuid,
  readVersion,
  staleVersion,
  throwIfErrors,
  type FieldErrors,
} from './task-common.js';

const RECURRING_TYPES = ['daily', 'weekly', 'monthly', 'custom'] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class TaskTemplatesService {
  constructor(
    private readonly store: TaskStore,
    private readonly input: TaskInputService,
    private readonly generator: TaskGeneratorService,
  ) {}

  private get db() {
    return this.store.db;
  }

  // ------------------------------------------------------------------ access
  private async visibleTemplate(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Template not found');
    const t = await this.db.selectFrom('task_templates').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t) throw new NotFoundException('Template not found');
    if (this.store.access.canViewAll(user) || t.assigned_to === user.id || t.assigned_by === user.id || t.created_by === user.id) return t;
    const s = await this.store.masters.settings();
    if ((await this.store.access.teamIds(user, s)).includes(t.assigned_to)) return t;
    throw new NotFoundException('Template not found');
  }

  /** Managing a series follows the same rule as cancelling a task: the assigner or a manager, never the assignee. */
  private async assertCanManage(t: { id: string; assigned_to: string; assigned_by: string | null; created_by: string | null; category_id: string }, user: AuthUser) {
    if (t.assigned_to === user.id) throw new ForbiddenException('Ask your manager to change or pause a recurring task assigned to you.');
    if (t.assigned_by === user.id || t.created_by === user.id || isAdminLike(user)) return;
    const ok = await this.store.access.hasManagerAuthority({ id: t.id, assigned_to: t.assigned_to, assigned_by: t.assigned_by, department_id: null }, user);
    if (!ok) throw new ForbiddenException('Only the assigner or a manager can change this recurring task.');
  }

  // ------------------------------------------------------------------ read
  async list(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    let q = this.db
      .selectFrom('task_templates as tp')
      .innerJoin('users as emp', 'emp.id', 'tp.assigned_to')
      .leftJoin('users as asg', 'asg.id', 'tp.assigned_by')
      .leftJoin('task_categories as cat', 'cat.id', 'tp.category_id')
      .selectAll('tp')
      .select([
        'emp.full_name as assignee_name',
        'emp.is_active as assignee_active',
        'asg.full_name as assigned_by_name',
        'cat.name as category_name',
        sql<number>`(select count(*)::int from tasks x where x.template_id = tp.id)`.as('instance_count'),
        sql<number>`(select count(*)::int from tasks x where x.template_id = tp.id and x.status in ('not_started', 'in_progress', 'blocked') and x.deadline < now())`.as('open_overdue_count'),
        sql<string>`(select min(x.deadline) from tasks x where x.template_id = tp.id and x.status in ('not_started', 'in_progress', 'blocked') and x.deadline >= now())`.as('next_deadline'),
      ])
      .orderBy('tp.status')
      .orderBy('tp.title');
    if (!this.store.access.canViewAll(user)) {
      const team = await this.store.access.teamIds(user, s);
      q = q.where((eb) => eb.or([eb('tp.assigned_to', '=', user.id), eb('tp.assigned_by', '=', user.id), eb('tp.created_by', '=', user.id), ...(team.length ? [eb('tp.assigned_to', 'in', team)] : [])]));
    }
    if (typeof query.status === 'string' && ['active', 'paused', 'ended'].includes(query.status)) q = q.where('tp.status', '=', query.status);
    if (typeof query.assignee_id === 'string' && UUID_RE.test(query.assignee_id)) q = q.where('tp.assigned_to', '=', query.assignee_id);
    if (typeof query.search === 'string' && query.search.trim()) q = q.where(sql<boolean>`lower(tp.title) like ${`%${query.search.trim().toLowerCase()}%`}`);
    const rows = await q.limit(500).execute();
    return rows.map((r: any) => ({ ...r, schedule: describeRecurrence(r.recurrence_type, parseRule(r.recurrence_rule)) }));
  }

  async detail(id: string, user: AuthUser) {
    const t = await this.visibleTemplate(id, user);
    const s = await this.store.masters.settings();
    const [instances, skips, meta] = await Promise.all([
      this.store.withJoins(this.store.scoped(user, s)).where('t.template_id', '=', id).orderBy('t.occurrence_date', 'desc').limit(120).execute(),
      this.db.selectFrom('task_template_skips').selectAll().where('template_id', '=', id).orderBy('occurrence_date', 'desc').limit(120).execute(),
      this.db
        .selectFrom('task_templates as tp')
        .innerJoin('users as emp', 'emp.id', 'tp.assigned_to')
        .leftJoin('users as asg', 'asg.id', 'tp.assigned_by')
        .leftJoin('task_categories as cat', 'cat.id', 'tp.category_id')
        .leftJoin('organisations as cust', 'cust.id', 'tp.customer_id')
        .select(['emp.full_name as assignee_name', 'emp.is_active as assignee_active', 'asg.full_name as assigned_by_name', 'cat.name as category_name', 'cat.code as category_code', 'cust.name as customer_name'])
        .where('tp.id', '=', id)
        .executeTakeFirst(),
    ]);
    let canManage = true;
    try {
      await this.assertCanManage(t, user);
    } catch {
      canManage = false;
    }
    return {
      ...t,
      ...meta,
      schedule: describeRecurrence(t.recurrence_type as TaskRecurrenceType, parseRule(t.recurrence_rule)),
      instances: instances.map((r: any) => this.store.serialize(r, s)),
      skips,
      upcoming: t.status === 'ended' ? [] : await this.previewFor(t as TemplateRow, 10),
      can_manage: canManage,
    };
  }

  // ------------------------------------------------------------------ preview
  private async previewFor(t: Pick<TemplateRow, 'recurrence_rule' | 'start_date' | 'end_date' | 'max_occurrences' | 'holiday_policy' | 'leave_policy' | 'assigned_to' | 'due_offset_days' | 'due_time'>, count: number) {
    const rule = parseRule(t.recurrence_rule);
    const today = todayInKolkata();
    const from = t.start_date > today ? t.start_date : today;
    const to = addIsoDays(from, rule.freq === 'monthly' ? 31 * 12 * rule.interval + 31 : rule.freq === 'weekly' ? 7 * 60 * rule.interval : 400 * rule.interval);
    const cal = await this.store.masters.calendar([t.assigned_to], from, addIsoDays(to, 40));
    const occ = expandRecurrence({
      rule,
      start_date: t.start_date,
      end_date: t.end_date,
      max_occurrences: t.max_occurrences,
      from,
      to,
      holiday_policy: t.holiday_policy as TaskHolidayPolicy,
      isNonWorkingDay: (d) => cal.isNonWorkingDay(t.assigned_to, d),
      limit: Math.min(Math.max(count, 1), 50),
    });
    return occ.map((o) => {
      const leave = o.work_date ? cal.leaveOn(t.assigned_to, o.work_date) : null;
      const skippedLeave = Boolean(leave && t.leave_policy === 'skip');
      return {
        occurrence_date: o.occurrence_date,
        work_date: skippedLeave ? null : o.work_date,
        adjustment: skippedLeave ? 'skipped_leave' : o.adjustment,
        holiday: cal.holidayName(t.assigned_to, o.occurrence_date),
        deadline: o.work_date && !skippedLeave ? istDateTime(addIsoDays(o.work_date, t.due_offset_days), t.due_time.slice(0, 5)).toISOString() : null,
      };
    });
  }

  async preview(id: string, count: number, user: AuthUser) {
    const t = await this.visibleTemplate(id, user);
    if (t.status === 'ended') return [];
    return this.previewFor(t as TemplateRow, count || 10);
  }

  /** Preview for the unsaved recurrence builder. */
  async previewDraft(dto: Record<string, unknown>, user: AuthUser) {
    const errors: FieldErrors = {};
    const fields = this.readSchedule(errors, dto, false);
    const assignee = readUuid(errors, 'assignee_id', dto.assignee_id ?? (Array.isArray(dto.assignee_ids) ? dto.assignee_ids[0] : undefined), { label: 'Assignee' }) || user.id;
    throwIfErrors(errors);
    const s = await this.store.masters.settings();
    return this.previewFor(
      {
        recurrence_rule: fields.recurrence_rule!,
        start_date: fields.start_date!,
        end_date: fields.end_date ?? null,
        max_occurrences: fields.max_occurrences ?? null,
        holiday_policy: fields.holiday_policy ?? s.default_holiday_policy,
        leave_policy: fields.leave_policy ?? s.default_leave_policy,
        assigned_to: assignee,
        due_offset_days: fields.due_offset_days ?? 0,
        due_time: fields.due_time ?? '18:00',
      },
      Number(dto.count) || 10,
    );
  }

  // ------------------------------------------------------------------ write
  private readSchedule(errors: FieldErrors, dto: Record<string, unknown>, partial: boolean, current?: TemplateRow) {
    const out: {
      recurrence_type?: TaskRecurrenceType;
      recurrence_rule?: TaskRecurrenceRule;
      start_date?: string;
      end_date?: string | null;
      max_occurrences?: number | null;
      due_offset_days?: number;
      due_time?: string;
      holiday_policy?: TaskHolidayPolicy;
      leave_policy?: 'skip' | 'keep';
    } = {};
    const typeChanged = !partial || dto.recurrence_type !== undefined || dto.recurrence_rule !== undefined;
    if (typeChanged) {
      const type = readEnum(errors, 'recurrence_type', dto.recurrence_type ?? current?.recurrence_type, RECURRING_TYPES, { label: 'Frequency', required: true }) as TaskRecurrenceType | null;
      if (type) {
        const v = validateRecurrenceRule(type, dto.recurrence_rule ?? (current ? parseRule(current.recurrence_rule) : undefined));
        Object.assign(errors, v.errors);
        if (v.rule) {
          out.recurrence_type = type;
          out.recurrence_rule = v.rule;
        }
      }
    }
    if (!partial || dto.start_date !== undefined) out.start_date = readDate(errors, 'start_date', dto.start_date ?? todayInKolkata(), { label: 'Start date', required: true }) ?? undefined;
    if (!partial || dto.end_date !== undefined) out.end_date = readDate(errors, 'end_date', dto.end_date, { label: 'End date' });
    if (!partial || dto.max_occurrences !== undefined) out.max_occurrences = readInt(errors, 'max_occurrences', dto.max_occurrences, { min: 1, max: 1000, label: 'Number of occurrences' });
    if (!partial || dto.due_offset_days !== undefined) out.due_offset_days = readInt(errors, 'due_offset_days', dto.due_offset_days ?? 0, { min: 0, max: 60, label: 'Due after (days)' }) ?? 0;
    if (!partial || dto.due_time !== undefined) {
      const tm = dto.due_time === undefined || dto.due_time === null || dto.due_time === '' ? '18:00' : String(dto.due_time).slice(0, 5);
      if (!TIME_RE.test(tm)) errors.due_time = 'Due time must be HH:mm.';
      else out.due_time = tm;
    }
    if (dto.holiday_policy !== undefined) out.holiday_policy = readEnum(errors, 'holiday_policy', dto.holiday_policy, TASK_HOLIDAY_POLICIES, { label: 'Holiday policy', required: true }) ?? undefined;
    if (dto.leave_policy !== undefined) out.leave_policy = readEnum(errors, 'leave_policy', dto.leave_policy, ['skip', 'keep'] as const, { label: 'Leave policy', required: true }) ?? undefined;
    const start = out.start_date ?? current?.start_date;
    const end = out.end_date === undefined ? current?.end_date : out.end_date;
    if (start && end && end < start) errors.end_date = 'End date must be on or after the start date.';
    if (!partial && out.start_date && out.start_date < todayInKolkata()) errors.start_date = 'A recurring series cannot start in the past.';
    return out;
  }

  async create(dtoRaw: Record<string, unknown>, user: AuthUser) {
    const dto = await this.input.normaliseLegacy(dtoRaw);
    const s = await this.store.masters.settings();
    const errors: FieldErrors = {};
    const core = this.input.readCore(errors, dto, false);
    const category = await this.input.loadCategory(errors, dto.category_id);
    const links = await this.input.readLinks(errors, dto, category);
    const flags = this.input.readFlags(dto, category, false);
    const sched = this.readSchedule(errors, dto, false);
    const assignees = await this.input.readAssignees(errors, dto, user, isLinked(links), TASK_MAX_BULK_ASSIGNEES);
    throwIfErrors(errors);
    if (flags.approval_required) for (const a of assignees) await this.store.access.requireApprovers(a.id);
    const defaultHoliday = sched.recurrence_rule?.freq === 'daily' ? 'skip' : s.default_holiday_policy;

    const templates = await this.db.transaction().execute(async (trx) => {
      const out: any[] = [];
      for (const a of assignees) {
        const row = await trx
          .insertInto('task_templates')
          .values({
            title: core.title!,
            description: core.description ?? null,
            expected_outcome: core.expected_outcome ?? null,
            priority: core.priority!,
            category_id: category!.id,
            ...links,
            assigned_to: a.id,
            assigned_by: user.id,
            evidence_required: flags.evidence_required!,
            approval_required: flags.approval_required!,
            recurrence_type: sched.recurrence_type!,
            recurrence_rule: JSON.stringify(sched.recurrence_rule),
            start_date: sched.start_date!,
            end_date: sched.end_date ?? null,
            max_occurrences: sched.max_occurrences ?? null,
            due_offset_days: sched.due_offset_days ?? 0,
            due_time: sched.due_time ?? '18:00',
            holiday_policy: sched.holiday_policy ?? defaultHoliday,
            leave_policy: sched.leave_policy ?? s.default_leave_policy,
            created_by: user.id,
            updated_by: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        out.push(row);
      }
      return out;
    });
    let generated = 0;
    for (const t of templates) {
      generated += (await this.generator.generateFor(t as TemplateRow)).created;
      this.store.audit(user, 'task_template', t.id, 'task_template_create', undefined, t);
    }
    return { data: templates, generated, kind: 'recurring' };
  }

  async update(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const t0 = await this.visibleTemplate(id, user);
    await this.assertCanManage(t0, user);
    const current = t0 as TemplateRow;
    if (current.status === 'ended') throw conflict('This series has ended. Create a new recurring task instead.');
    if (Number(t0.version) !== readVersion(dto.version)) throw staleVersion();
    const errors: FieldErrors = {};
    const core = this.input.readCore(errors, dto, true);
    const category = await this.input.loadCategory(errors, dto.category_id ?? t0.category_id, { allowInactiveId: t0.category_id });
    const existingLinks: TaskLinks = { customer_id: t0.customer_id, tender_id: t0.tender_id, demo_id: t0.demo_id, service_ticket_id: t0.service_ticket_id, project_id: t0.project_id };
    const links = await this.input.readLinks(errors, dto, category, existingLinks);
    const flags = this.input.readFlags(dto, category, true);
    const sched = this.readSchedule(errors, dto, true, current);
    let newAssignee: string | null = null;
    if (dto.assigned_to !== undefined && dto.assigned_to !== t0.assigned_to) {
      newAssignee = readUuid(errors, 'assigned_to', dto.assigned_to, { required: true, label: 'Assignee' });
      if (newAssignee) {
        const u = await this.db.selectFrom('users').select(['is_active', 'full_name']).where('id', '=', newAssignee).executeTakeFirst();
        if (!u?.is_active) errors.assigned_to = 'Choose an active employee.';
        else {
          const scope = await this.store.access.assignScope(user, newAssignee, isLinked(links));
          if (!scope.ok) errors.assigned_to = scope.reason;
        }
      }
    }
    throwIfErrors(errors);
    const patch: Record<string, unknown> = { ...core, ...links, ...flags };
    if (category && category.id !== t0.category_id) patch.category_id = category.id;
    if (sched.recurrence_rule) patch.recurrence_rule = JSON.stringify(sched.recurrence_rule);
    for (const k of ['recurrence_type', 'start_date', 'end_date', 'max_occurrences', 'due_offset_days', 'due_time', 'holiday_policy', 'leave_policy'] as const) {
      if ((sched as any)[k] !== undefined) patch[k] = (sched as any)[k];
    }
    if (newAssignee) Object.assign(patch, { assigned_to: newAssignee, needs_reassignment: false });
    const scheduleChanged = ['recurrence_type', 'recurrence_rule', 'start_date', 'end_date', 'max_occurrences', 'due_offset_days', 'due_time', 'holiday_policy', 'leave_policy', 'assigned_to'].some(
      (k) => patch[k] !== undefined && String(patch[k]) !== String((t0 as any)[k] instanceof Object ? JSON.stringify((t0 as any)[k]) : (t0 as any)[k]),
    );

    const res = await this.db
      .updateTable('task_templates')
      .set({ ...(patch as any), version: sql`version + 1`, updated_by: user.id })
      .where('id', '=', id)
      .where('version', '=', t0.version)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw staleVersion();

    // Only future, untouched instances follow the new definition; worked-on instances keep their data (§7.15).
    let purged = 0;
    let updated = 0;
    if (scheduleChanged) {
      purged = await this.generator.purgeUntouchedFuture(id);
      await this.db.updateTable('task_templates').set({ last_generated_until: todayInKolkata() }).where('id', '=', id).execute();
    } else {
      const fieldPatch: Record<string, unknown> = {};
      for (const k of ['title', 'description', 'expected_outcome', 'priority', 'category_id', 'customer_id', 'tender_id', 'demo_id', 'service_ticket_id', 'project_id', 'evidence_required', 'approval_required']) {
        if (patch[k] !== undefined) fieldPatch[k] = patch[k];
      }
      if (Object.keys(fieldPatch).length) {
        const r = await this.db
          .updateTable('tasks as t')
          .set({ ...(fieldPatch as any), version: sql`version + 1` })
          .where('t.template_id', '=', id)
          .where('t.status', '=', 'not_started')
          .where('t.start_date', '>', todayInKolkata())
          .where(sql<boolean>`not exists (select 1 from task_updates u where u.task_id = t.id and u.kind <> 'created')`)
          .executeTakeFirst();
        updated = Number(r.numUpdatedRows);
      }
    }
    const fresh = await this.db.selectFrom('task_templates').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const generated = fresh.status === 'active' ? (await this.generator.generateFor(fresh as TemplateRow)).created : 0;
    this.store.audit(user, 'task_template', id, 'task_template_update', t0, { ...patch, purged_future_instances: purged, updated_future_instances: updated, regenerated: generated });
    return { ...(await this.detail(id, user)), purged_future_instances: purged, updated_future_instances: updated, regenerated: generated };
  }

  async setStatus(id: string, action: 'pause' | 'resume' | 'end', dto: Record<string, unknown>, user: AuthUser) {
    const t = await this.visibleTemplate(id, user);
    await this.assertCanManage(t, user);
    if (Number(t.version) !== readVersion(dto.version)) throw staleVersion();
    const reason = readComment(dto.reason, { required: action !== 'resume', min: TASK_MIN_COMMENT_LENGTH, field: 'reason', label: 'Reason' });
    const today = todayInKolkata();
    let cancelled = 0;
    let generated = 0;
    if (action === 'pause') {
      if (t.status !== 'active') throw conflict('Only an active series can be paused.');
      await this.db.updateTable('task_templates').set({ status: 'paused', status_reason: reason, version: sql`version + 1`, updated_by: user.id }).where('id', '=', id).execute();
      cancelled = await this.generator.cancelFutureInstances(id, 'Template paused', user.id);
    } else if (action === 'end') {
      if (t.status === 'ended') throw conflict('This series has already ended.');
      await this.db
        .updateTable('task_templates')
        .set({ status: 'ended', status_reason: reason, end_date: !t.end_date || t.end_date > today ? today : t.end_date, version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .execute();
      cancelled = await this.generator.cancelFutureInstances(id, 'Template ended', user.id);
    } else {
      if (t.status !== 'paused') throw conflict('Only a paused series can be resumed.');
      const assignee = await this.db.selectFrom('users').select('is_active').where('id', '=', t.assigned_to).executeTakeFirst();
      if (!assignee?.is_active) throw new TaskValidationException({ assigned_to: 'The assignee is inactive — reassign the series before resuming.' });
      // Instances cancelled only because of the pause are regenerated with the current definition.
      await this.generator.purgeUntouchedFuture(id, { onlyCancelledWithReason: 'Template paused' });
      await this.db
        .updateTable('task_templates')
        .set({ status: 'active', status_reason: null, needs_reassignment: false, last_generated_until: addIsoDays(today, -1), version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .execute();
      const fresh = await this.db.selectFrom('task_templates').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      generated = (await this.generator.generateFor(fresh as TemplateRow)).created;
    }
    this.store.audit(user, 'task_template', id, `task_template_${action}`, { status: t.status }, { reason, cancelled_future_instances: cancelled, generated });
    return { ...(await this.detail(id, user)), cancelled_future_instances: cancelled, generated };
  }

  /** Horizon in days for UI hints. */
  async horizon(rule: TaskRecurrenceRule) {
    return horizonDays(rule, await this.store.masters.settings());
  }
}
