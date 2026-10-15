/**
 * Recurring instance generator (§7.10–18). Idempotent by construction: occurrences come from the pure
 * shared engine and are inserted with ON CONFLICT (template_id, occurrence_date) DO NOTHING, so running it
 * twice — or from two servers — never creates duplicates. Missed windows after downtime are caught up
 * (bounded by TASK_CATCHUP_MAX_DAYS); instances whose deadline had already passed when generated are
 * flagged `generated_late` and excluded from compliance metrics (the downtime was not the employee's fault).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import {
  addIsoDays,
  expandRecurrence,
  istDateTime,
  todayInKolkata,
  type TaskHolidayPolicy,
  type TaskRecurrenceRule,
} from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { TASK_CONFIG, type TaskConfig } from './task.config.js';
import type { TaskSettings } from './task-masters.service.js';

export type TemplateRow = {
  id: string;
  title: string;
  description: string | null;
  expected_outcome: string | null;
  category_id: string;
  customer_id: string | null;
  tender_id: string | null;
  demo_id: string | null;
  service_ticket_id: string | null;
  project_id: string | null;
  assigned_to: string;
  assigned_by: string | null;
  priority: string;
  evidence_required: boolean;
  approval_required: boolean;
  recurrence_type: string;
  recurrence_rule: unknown;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  due_offset_days: number;
  due_time: string;
  holiday_policy: string;
  leave_policy: string;
  status: string;
  last_generated_until: string | null;
  created_by: string | null;
};

export function horizonDays(rule: TaskRecurrenceRule, s: TaskSettings) {
  return rule.freq === 'daily' ? s.horizon_days_daily : rule.freq === 'weekly' ? s.horizon_days_weekly : s.horizon_days_monthly;
}

export const parseRule = (raw: unknown): TaskRecurrenceRule => (typeof raw === 'string' ? JSON.parse(raw) : (raw as TaskRecurrenceRule));

@Injectable()
export class TaskGeneratorService {
  private readonly logger = new Logger(TaskGeneratorService.name);

  constructor(
    private readonly store: TaskStore,
    @Inject(TASK_CONFIG) private readonly config: TaskConfig,
  ) {}

  private get db() {
    return this.store.db;
  }

  /** Templates whose assignee left: pause and flag for the manager to reassign (§7.18). */
  async pauseOrphanedTemplates() {
    const rows = await this.db
      .updateTable('task_templates as tp')
      .set({ status: 'paused', needs_reassignment: true, status_reason: 'Assignee deactivated — reassign to resume' })
      .where('tp.status', '=', 'active')
      .where((eb) => eb.exists(eb.selectFrom('users as u').select('u.id').whereRef('u.id', '=', 'tp.assigned_to').where('u.is_active', '=', false)))
      .returning(['tp.id', 'tp.title', 'tp.assigned_to'])
      .execute();
    for (const r of rows) this.store.audit(null, 'task_template', r.id, 'task_template_auto_pause', undefined, { reason: 'assignee_deactivated' });
    return rows.length;
  }

  async generateAll(now = new Date()) {
    const paused = await this.pauseOrphanedTemplates();
    const templates = await this.db.selectFrom('task_templates').selectAll().where('status', '=', 'active').execute();
    let created = 0;
    let skipped = 0;
    for (const t of templates) {
      try {
        const r = await this.generateFor(t as TemplateRow, now);
        created += r.created;
        skipped += r.skipped;
      } catch (err: any) {
        this.logger.error(`Generation failed for template ${t.id}: ${err.message}`);
      }
    }
    return { templates: templates.length, created, skipped, paused };
  }

  /**
   * Generates one template's instances up to its horizon. A brand-new template starts today (no back-fill);
   * an existing one continues from last_generated_until + 1 (catch-up bounded by catchUpMaxDays).
   */
  async generateFor(t: TemplateRow, now = new Date()): Promise<{ created: number; skipped: number; ended: boolean }> {
    if (t.status !== 'active') return { created: 0, skipped: 0, ended: false };
    const s = await this.store.masters.settings();
    const assignee = await this.db.selectFrom('users').select(['id', 'is_active', 'reporting_manager_id', 'department_id']).where('id', '=', t.assigned_to).executeTakeFirst();
    if (!assignee?.is_active) {
      await this.pauseOrphanedTemplates();
      return { created: 0, skipped: 0, ended: false };
    }
    const rule = parseRule(t.recurrence_rule);
    const today = todayInKolkata(now);
    const catchUpFloor = addIsoDays(today, -this.config.catchUpMaxDays);
    let from = t.last_generated_until ? addIsoDays(t.last_generated_until, 1) : today;
    if (from < t.start_date) from = t.start_date;
    if (from < catchUpFloor) from = catchUpFloor;
    let to = addIsoDays(today, horizonDays(rule, s));
    if (t.end_date && t.end_date < to) to = t.end_date;
    if (from > to) return { created: 0, skipped: 0, ended: await this.maybeEnd(t, today) };

    const cal = await this.store.masters.calendar([t.assigned_to], addIsoDays(from, -31), addIsoDays(to, t.due_offset_days + 31));
    // Instances already generated in this window are left alone; earlier windows' work dates guard against
    // a shifted occurrence landing on a day that already has an instance.
    const existing = await this.db
      .selectFrom('tasks')
      .select(['occurrence_date', 'start_date', 'status'])
      .where('template_id', '=', t.id)
      .where('occurrence_date', '>=', addIsoDays(from, -31))
      .where('occurrence_date', '<=', addIsoDays(to, 31))
      .execute();
    const inWindow = new Set(existing.filter((e) => e.occurrence_date! >= from && e.occurrence_date! <= to).map((e) => e.occurrence_date as string));
    const used = new Set(
      existing.filter((e) => e.status !== 'cancelled' && (e.occurrence_date! < from || e.occurrence_date! > to)).map((e) => e.start_date as string),
    );
    const occurrences = expandRecurrence({
      rule,
      start_date: t.start_date,
      end_date: t.end_date,
      max_occurrences: t.max_occurrences,
      from,
      to,
      holiday_policy: t.holiday_policy as TaskHolidayPolicy,
      isNonWorkingDay: (d) => cal.isNonWorkingDay(t.assigned_to, d),
      usedWorkDates: used,
    });

    let created = 0;
    let skipped = 0;
    let lastIndex = 0;
    for (const o of occurrences) {
      lastIndex = o.index;
      if (inWindow.has(o.occurrence_date)) continue;
      if (!o.work_date) {
        await this.skip(t.id, o.occurrence_date, o.adjustment === 'skipped_collision' ? 'skipped_collision' : 'skipped_holiday', o.adjustment === 'skipped_holiday' ? cal.holidayName(t.assigned_to, o.occurrence_date) || 'Weekly off' : 'Shifted date already has an instance');
        skipped++;
        continue;
      }
      const leave = cal.leaveOn(t.assigned_to, o.work_date);
      if (leave && t.leave_policy === 'skip') {
        await this.skip(t.id, o.occurrence_date, 'skipped_leave', `Approved leave ${leave.from_date} → ${leave.to_date}`);
        skipped++;
        continue;
      }
      const deadline = istDateTime(addIsoDays(o.work_date, t.due_offset_days), t.due_time.slice(0, 5));
      const generatedLate = deadline.getTime() < now.getTime();
      const inserted = await this.db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto('tasks')
          .values({
            title: t.title,
            description: t.description,
            expected_outcome: t.expected_outcome,
            category_id: t.category_id,
            customer_id: t.customer_id,
            tender_id: t.tender_id,
            demo_id: t.demo_id,
            service_ticket_id: t.service_ticket_id,
            project_id: t.project_id,
            assigned_to: t.assigned_to,
            assigned_by: t.assigned_by,
            reporting_manager_id: assignee.reporting_manager_id,
            department_id: assignee.department_id,
            priority: t.priority,
            evidence_required: t.evidence_required,
            approval_required: t.approval_required,
            template_id: t.id,
            occurrence_date: o.occurrence_date,
            start_date: o.work_date,
            deadline,
            original_deadline: deadline,
            generated_late: generatedLate,
            source: 'recurring',
            task_type: 'recurring',
            last_update_at: now,
          } as any)
          .onConflict((oc) => oc.columns(['template_id', 'occurrence_date']).where('template_id', 'is not', null).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (row) {
          await this.store.log(trx, row.id, {
            kind: 'created',
            author: null,
            to: 'not_started',
            comment: generatedLate ? 'Generated late (catch-up after downtime) — excluded from compliance metrics.' : null,
            metadata: { template_id: t.id, occurrence_date: o.occurrence_date, adjustment: o.adjustment, generated_late: generatedLate || undefined },
          });
        }
        return row;
      });
      if (inserted) created++;
    }

    await this.db.updateTable('task_templates').set({ last_generated_until: to }).where('id', '=', t.id).where('status', '=', 'active').execute();
    let ended = false;
    if ((t.max_occurrences && lastIndex >= t.max_occurrences) || (t.end_date && to >= t.end_date)) {
      ended = await this.markEnded(t.id, 'Series complete');
    }
    if (created || skipped) this.logger.log(`Template ${t.id}: ${created} instance(s) created, ${skipped} skipped (${from} → ${to}).`);
    return { created, skipped, ended };
  }

  private async skip(templateId: string, occurrenceDate: string, reason: 'skipped_holiday' | 'skipped_leave' | 'skipped_collision', detail: string) {
    await this.db
      .insertInto('task_template_skips')
      .values({ template_id: templateId, occurrence_date: occurrenceDate, reason, detail })
      .onConflict((oc) => oc.columns(['template_id', 'occurrence_date']).doNothing())
      .execute();
  }

  private async maybeEnd(t: TemplateRow, today: string) {
    if (t.end_date && t.end_date < today) return this.markEnded(t.id, 'End date reached');
    return false;
  }

  private async markEnded(id: string, reason: string) {
    const r = await this.db.updateTable('task_templates').set({ status: 'ended', status_reason: reason }).where('id', '=', id).where('status', '=', 'active').executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  /** Cancels future untouched NOT_STARTED instances (template paused / ended). */
  async cancelFutureInstances(templateId: string, reason: string, actorId: string | null) {
    const today = todayInKolkata();
    const rows = await this.db
      .selectFrom('tasks as t')
      .select(['t.id', 't.status'])
      .where('t.template_id', '=', templateId)
      .where('t.status', '=', 'not_started')
      .where('t.start_date', '>', today)
      .execute();
    for (const r of rows) {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('tasks')
          .set({ status: 'cancelled', cancelled_reason: reason, cancelled_at: new Date(), cancelled_by: actorId, version: sql`version + 1`, updated_by: actorId })
          .where('id', '=', r.id)
          .where('status', '=', 'not_started')
          .execute();
        await trx.insertInto('task_updates').values({ task_id: r.id, author_id: actorId, kind: 'cancel', comment: reason, status_from: 'not_started', status_to: 'cancelled' }).execute();
      });
    }
    return rows.length;
  }

  /**
   * Removes future instances nobody has touched (only the system "created" entry, no files/blockers), so a
   * template edit or resume can regenerate them with the new definition. Worked-on instances are kept.
   */
  async purgeUntouchedFuture(templateId: string, opts: { onlyCancelledWithReason?: string } = {}) {
    const today = todayInKolkata();
    let q = this.db
      .selectFrom('tasks as t')
      .select('t.id')
      .where('t.template_id', '=', templateId)
      .where('t.start_date', '>', today)
      .where(sql<boolean>`not exists (select 1 from task_updates u where u.task_id = t.id and u.kind not in ('created', 'cancel'))`)
      .where(sql<boolean>`not exists (select 1 from task_attachments a where a.task_id = t.id)`)
      .where(sql<boolean>`not exists (select 1 from task_blockers b where b.task_id = t.id)`);
    q = opts.onlyCancelledWithReason
      ? q.where('t.status', '=', 'cancelled').where('t.cancelled_reason', '=', opts.onlyCancelledWithReason)
      : q.where('t.status', '=', 'not_started').where('t.version', '=', 1);
    const ids = (await q.execute()).map((r) => r.id);
    if (!ids.length) return 0;
    await this.db.transaction().execute(async (trx) => {
      await sql`set local arihant.allow_task_purge = 'on'`.execute(trx);
      await trx.deleteFrom('task_updates').where('task_id', 'in', ids).execute();
      await trx.deleteFrom('tasks').where('id', 'in', ids).execute();
    });
    return ids.length;
  }
}
