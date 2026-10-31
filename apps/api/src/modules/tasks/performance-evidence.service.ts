/**
 * Performance evidence (§11 / Blueprint §43). Factual, per employee per period: work assigned, completion,
 * deadline compliance, approved/rejected blockers, repeated misses, reassignments and the manager review with
 * the employee's response. Restricted: every view and export is written to the audit log.
 * Snapshots freeze the data + PDF + Excel and are immutable (DB trigger); regenerating creates a new version.
 *
 * This service never computes salary, incentive or deduction amounts and has no field for one.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import {
  TASK_BLOCKER_TYPE_LABELS,
  TASK_DELAY_CLASS_LABELS,
  TASK_EVIDENCE_DISCLAIMER,
  TASK_PRIORITY_LABELS,
  TASK_REASSIGN_REASON_LABELS,
  TASK_STATUS_LABELS,
  addIsoDays,
  formatTaskDate,
  formatTaskDateTime,
  istDateOf,
  istEndOfDay,
  isIsoDateString,
  minutesToDays,
  todayInKolkata,
  type AuthUser,
  type TaskBlockerType,
  type TaskEvidenceBasis,
} from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { TASK_CONFIG, type TaskConfig } from './task.config.js';
import { TaskValidationException, UUID_RE, throwIfErrors, type FieldErrors } from './task-common.js';
import { PdfBuilder } from './task-pdf.js';
import { blockerSummary, classify, complianceSummary, countBy, type MetricBlocker, type MetricTask } from './task-metrics.js';

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

export interface EvidenceQuery {
  employee_id: string;
  from: string;
  to: string;
  basis: TaskEvidenceBasis;
}

@Injectable()
export class PerformanceEvidenceService {
  constructor(
    private readonly store: TaskStore,
    @Inject(TASK_CONFIG) private readonly config: TaskConfig,
  ) {}

  private get db() {
    return this.store.db;
  }

  // ------------------------------------------------------------------ access
  async parse(query: Record<string, unknown>): Promise<EvidenceQuery> {
    const s = await this.store.masters.settings();
    const errors: FieldErrors = {};
    const employee_id = typeof query.employee_id === 'string' && UUID_RE.test(query.employee_id) ? query.employee_id : '';
    if (!employee_id) errors.employee_id = 'Choose an employee.';
    const today = todayInKolkata();
    const from = isIsoDateString(query.from) ? (query.from as string) : `${today.slice(0, 7)}-01`;
    const to = isIsoDateString(query.to) ? (query.to as string) : today;
    if (from > to) errors.to = '"To" must be on or after "From".';
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 731) errors.to = 'The period can be at most two years.';
    const basis = query.basis === 'completion' || query.basis === 'deadline' ? query.basis : s.evidence_period_basis;
    throwIfErrors(errors);
    return { employee_id, from, to, basis };
  }

  /** Authorised viewers: management/admin/accounts (all), managers & department heads (their team), the employee (self). */
  async assertCanView(employeeId: string, user: AuthUser) {
    if (this.store.access.canViewAll(user) || employeeId === user.id) return;
    const s = await this.store.masters.settings();
    if ((await this.store.access.teamIds(user, s)).includes(employeeId)) return;
    throw new ForbiddenException('Performance evidence is restricted to the employee, their managers and authorised management / accounts.');
  }

  assertCanSnapshot(user: AuthUser) {
    if (!this.store.access.canViewAll(user)) throw new ForbiddenException('Only authorised management / accounts can generate or export evidence.');
  }

  // ------------------------------------------------------------------ report
  async report(q: EvidenceQuery, viewer: AuthUser, opts: { audit?: string } = { audit: 'performance_evidence_view' }) {
    await this.assertCanView(q.employee_id, viewer);
    const s = await this.store.masters.settings();
    const emp = await this.db
      .selectFrom('users as u')
      .leftJoin('departments as d', 'd.id', 'u.department_id')
      .leftJoin('users as m', 'm.id', 'u.reporting_manager_id')
      .leftJoin('regions as r', 'r.id', 'u.region_id')
      .select(['u.id', 'u.full_name', 'u.email', 'u.role', 'u.employee_code', 'u.is_active', 'u.deactivated_at', 'd.name as department_name', 'm.full_name as manager_name', 'r.name as region_name'])
      .where('u.id', '=', q.employee_id)
      .executeTakeFirst();
    if (!emp) throw new NotFoundException('Employee not found');

    // Metrics freeze at deactivation (§7.28).
    const frozenAt = !emp.is_active && emp.deactivated_at ? new Date(emp.deactivated_at) : null;
    const to = frozenAt && istDateOf(frozenAt) < q.to ? istDateOf(frozenAt) : q.to;
    const fromTs = istStart(q.from);
    const toTs = istEndOfDay(to);
    const now = frozenAt && frozenAt < new Date() ? frozenAt : new Date();

    let tq = this.db
      .selectFrom('tasks as t')
      .leftJoin('task_categories as cat', 'cat.id', 't.category_id')
      .leftJoin('task_templates as tpl', 'tpl.id', 't.template_id')
      .leftJoin('organisations as cust', 'cust.id', 't.customer_id')
      .leftJoin('tenders as tdr', 'tdr.id', 't.tender_id')
      .select([
        't.id',
        't.task_number',
        't.title',
        't.assigned_to',
        't.status',
        't.priority',
        't.template_id',
        't.deadline',
        't.original_deadline',
        't.completed_at',
        't.approved_at',
        't.unexcused_locked_minutes',
        't.extension_count',
        't.rework_count',
        't.reopen_count',
        't.reassign_count',
        't.is_backlog',
        't.generated_late',
        't.last_update_at',
        't.cancelled_reason',
        't.progress_at_completion',
        't.delay_reason',
        'cat.name as category_name',
        'tpl.recurrence_type',
        'cust.name as customer_name',
        'tdr.tender_no',
        sql<Date | null>`(select b.created_at from task_blockers b where b.task_id = t.id and b.status = 'accepted' limit 1)`.as('accepted_blocker_raised_at'),
        sql<string | null>`(select b.decision from task_blockers b where b.task_id = t.id and b.status = 'accepted' limit 1)`.as('accepted_blocker_decision'),
      ])
      .where('t.assigned_to', '=', q.employee_id);
    const due = sql`coalesce(t.original_deadline, t.deadline)`;
    tq =
      q.basis === 'deadline'
        ? tq.where(sql<boolean>`${due} between ${fromTs} and ${toTs}`)
        : tq.where(sql<boolean>`(t.completed_at between ${fromTs} and ${toTs} or (t.completed_at is null and ${due} between ${fromTs} and ${toTs}))`);
    const rawTasks = await tq.orderBy(sql`${due}`).execute();
    const tasks = rawTasks.map((t: any) => classify(t as MetricTask, s, now));
    const taskIds = tasks.map((t) => t.id);

    const [blockerRows, changeRows, reassignedAway, reviews] = await Promise.all([
      this.db
        .selectFrom('task_blockers as b')
        .innerJoin('tasks as t', 't.id', 'b.task_id')
        .select(['b.id', 'b.task_id', 'b.blocker_type', 'b.status', 'b.decision', 'b.raised_after_deadline', 'b.requested_new_deadline', 'b.excused_minutes', 'b.created_at', 'b.description', 'b.decision_comment', 't.task_number'])
        // Only blockers this employee raised: on the period's tasks, or raised in the period on work since reassigned.
        .where('b.raised_by', '=', q.employee_id)
        .where((eb) =>
          eb.or([
            ...(taskIds.length ? [eb('b.task_id', 'in', taskIds)] : []),
            eb.and([eb('b.created_at', '>=', fromTs), eb('b.created_at', '<=', toTs)]),
          ]),
        )
        .orderBy('b.created_at')
        .execute(),
      taskIds.length
        ? this.db.selectFrom('task_deadline_changes').select(['task_id', 'source', 'excused_minutes', 'created_at']).where('task_id', 'in', taskIds).execute()
        : Promise.resolve([] as any[]),
      this.db
        .selectFrom('task_assignment_history as h')
        .innerJoin('tasks as t', 't.id', 'h.task_id')
        .leftJoin('users as to', 'to.id', 'h.to_user_id')
        .select(['h.id', 'h.task_id', 'h.reason', 'h.reason_type', 'h.was_overdue', 'h.overdue_minutes', 'h.created_at', 't.task_number', 't.title', 'to.full_name as to_name'])
        .where('h.from_user_id', '=', q.employee_id)
        .where('h.created_at', '>=', fromTs)
        .where('h.created_at', '<=', toTs)
        .orderBy('h.created_at')
        .execute(),
      this.db
        .selectFrom('performance_reviews as pr')
        .innerJoin('users as rv', 'rv.id', 'pr.reviewer_id')
        .select([
          'pr.id',
          'pr.period_from',
          'pr.period_to',
          'pr.rating',
          'pr.rating_scale',
          'pr.strengths',
          'pr.improvement_areas',
          'pr.comments',
          'pr.employee_response',
          'pr.employee_responded_at',
          'pr.employee_acknowledged_at',
          'pr.status',
          'pr.submitted_at',
          'pr.version',
          'rv.full_name as reviewer_name',
        ])
        .where('pr.employee_id', '=', q.employee_id)
        .where('pr.status', 'in', ['submitted', 'acknowledged'])
        .where('pr.superseded_by_id', 'is', null)
        .where('pr.period_from', '<=', to)
        .where('pr.period_to', '>=', q.from)
        .orderBy('pr.period_from')
        .execute(),
    ]);
    const blockers = blockerRows as unknown as (MetricBlocker & { task_number: string; description: string; decision_comment: string | null })[];

    const counted = tasks.filter((t) => !t.excluded);
    const compliance = complianceSummary(tasks);
    const bsum = blockerSummary(blockers);
    const granted = changeRows.filter((c: any) => c.source === 'manager_extension' || c.source === 'blocker_accepted').length;
    const recurringMissed = counted.filter((t) => t.template_id && (t.delay_class === 'late_unexcused' || t.delay_class === 'open_overdue'));
    const multiExt = counted.filter((t) => t.extension_count >= 2);

    const report = {
      employee: {
        id: emp.id,
        name: emp.full_name,
        email: emp.email,
        employee_code: emp.employee_code,
        role: emp.role,
        department: emp.department_name,
        manager: emp.manager_name,
        region: emp.region_name,
        is_active: emp.is_active,
        deactivated_at: emp.deactivated_at,
      },
      period: {
        from: q.from,
        to,
        requested_to: q.to,
        basis: q.basis,
        basis_note:
          q.basis === 'deadline'
            ? 'A task belongs to this period when its ORIGINAL deadline falls inside it (extensions never move a task between periods).'
            : 'A task belongs to this period when it was completed inside it; open tasks are included when their original deadline falls inside it.',
        frozen_at_deactivation: frozenAt ? frozenAt.toISOString() : null,
      },
      generated_at: new Date().toISOString(),
      disclaimer: TASK_EVIDENCE_DISCLAIMER,
      work_assigned: {
        total: counted.length,
        by_category: countBy(counted, (t) => t.category_name),
        by_priority: countBy(counted, (t) => t.priority),
        recurring: counted.filter((t) => t.template_id).length,
        one_time: counted.filter((t) => !t.template_id).length,
      },
      completion: {
        completed: counted.filter((t) => t.status === 'completed').length,
        awaiting_approval: counted.filter((t) => t.status === 'awaiting_approval').length,
        open: counted.filter((t) => ['not_started', 'in_progress', 'blocked'].includes(t.status)).length,
        cancelled: tasks.filter((t) => t.excluded === 'cancelled').length,
        completion_rate_pct: counted.length ? Math.round(((counted.filter((t) => t.status === 'completed' || t.status === 'awaiting_approval').length) / counted.length) * 1000) / 10 : null,
      },
      compliance: { ...compliance, extensions_requested: bsum.extensions_requested, extensions_granted: granted },
      blockers: bsum,
      repeated_misses: {
        recurring_instances_missed: recurringMissed.length,
        tasks_with_multiple_extensions: multiExt.length,
        rework_count: counted.reduce((a, t) => a + t.rework_count, 0),
        reopen_count: counted.reduce((a, t) => a + t.reopen_count, 0),
        tasks_reworked_or_reopened: counted.filter((t) => t.rework_count > 0 || t.reopen_count > 0).length,
      },
      reassignments: {
        reassigned_away: reassignedAway.map((r) => ({ ...r, overdue_days: minutesToDays(r.overdue_minutes), counted_as_miss: r.reason_type === 'non_performance' })),
        counted_as_miss: reassignedAway.filter((r) => r.reason_type === 'non_performance').length,
      },
      excluded: {
        cancelled: tasks.filter((t) => t.excluded === 'cancelled').length,
        backlog_entries: tasks.filter((t) => t.excluded === 'backlog').length,
        generated_late: tasks.filter((t) => t.excluded === 'generated_late').length,
      },
      reviews,
      blocker_list: blockers.map((b) => ({
        id: b.id,
        task_number: b.task_number,
        type: b.blocker_type,
        status: b.status,
        decision: b.decision,
        raised_at: b.created_at,
        raised_after_deadline: b.raised_after_deadline,
        excused_days: minutesToDays(b.excused_minutes || 0),
        description: b.description,
        decision_comment: b.decision_comment,
      })),
      tasks: rawTasks.map((r: any, i) => {
        const c = tasks[i];
        return {
          id: r.id,
          task_number: r.task_number,
          title: r.title,
          category: r.category_name,
          priority: r.priority,
          recurring: Boolean(r.template_id),
          status: r.status,
          original_deadline: r.original_deadline,
          deadline: r.deadline,
          completed_at: r.completed_at,
          delay_class: c.excluded ? null : c.delay_class,
          excluded: c.excluded,
          unexcused_delay_days: minutesToDays(c.unexcused_delay_minutes),
          excused_delay_days: minutesToDays(c.excused_delay_minutes),
          extensions: r.extension_count,
          blockers: blockers.filter((b) => b.task_id === r.id).map((b) => `${TASK_BLOCKER_TYPE_LABELS[b.blocker_type as TaskBlockerType] || b.blocker_type} (${b.status})`).join('; '),
          rework: r.rework_count,
          reopened: r.reopen_count,
          reassigned: r.reassign_count,
          delay_reason: r.delay_reason,
          cancelled_reason: r.cancelled_reason,
          customer: r.customer_name,
          tender_no: r.tender_no,
        };
      }),
    };
    if (opts.audit) this.store.audit(viewer, 'performance_evidence', q.employee_id, opts.audit, undefined, { from: q.from, to, basis: q.basis });
    return report;
  }

  // ------------------------------------------------------------------ renderers
  renderPdf(r: Awaited<ReturnType<PerformanceEvidenceService['report']>>, snapshotLabel?: string) {
    const pdf = new PdfBuilder({ title: `Arihant BOS · Performance evidence · ${r.employee.name} · ${formatTaskDate(r.period.from)} to ${formatTaskDate(r.period.to)}`, disclaimer: r.disclaimer });
    pdf.title('Performance Evidence Report', `${r.employee.name} (${r.employee.role.replace(/_/g, ' ')}) · ${formatTaskDate(r.period.from)} - ${formatTaskDate(r.period.to)} · generated ${formatTaskDateTime(r.generated_at)}${snapshotLabel ? ` · ${snapshotLabel}` : ''}`);
    pdf.callout(r.disclaimer);
    pdf.kv([
      ['Employee', r.employee.name],
      ['Employee code', r.employee.employee_code || '-'],
      ['Department', r.employee.department || '-'],
      ['Reporting manager', r.employee.manager || '-'],
      ['Region', r.employee.region || '-'],
      ['Status', r.employee.is_active ? 'Active' : `Inactive since ${formatTaskDate(r.employee.deactivated_at)}`],
    ]);
    pdf.paragraph(`Period rule: ${r.period.basis_note}${r.period.frozen_at_deactivation ? ' Metrics are frozen at the deactivation date.' : ''}`, { size: 8, color: [0.29, 0.33, 0.41] });

    pdf.heading('1. Work assigned');
    pdf.kv([
      ['Tasks assessed', String(r.work_assigned.total)],
      ['Recurring / one-time', `${r.work_assigned.recurring} / ${r.work_assigned.one_time}`],
      ...Object.entries(r.work_assigned.by_priority).map(([k, v]) => [`Priority: ${TASK_PRIORITY_LABELS[k as keyof typeof TASK_PRIORITY_LABELS] || k}`, String(v)] as [string, string]),
      ...Object.entries(r.work_assigned.by_category).map(([k, v]) => [`Category: ${k}`, String(v)] as [string, string]),
    ]);
    pdf.heading('2. Completion status');
    pdf.kv([
      ['Completed', String(r.completion.completed)],
      ['Awaiting approval', String(r.completion.awaiting_approval)],
      ['Open', String(r.completion.open)],
      ['Completion rate', r.completion.completion_rate_pct === null ? '-' : `${r.completion.completion_rate_pct}%`],
      ['Cancelled (excluded)', String(r.completion.cancelled)],
      ['Backlog / generated late (excluded)', `${r.excluded.backlog_entries} / ${r.excluded.generated_late}`],
    ]);
    pdf.heading('3. Deadline compliance');
    pdf.kv([
      ['On time', String(r.compliance.on_time)],
      ['On-time rate (of completed)', r.compliance.on_time_pct === null ? '-' : `${r.compliance.on_time_pct}%`],
      ['Late - excused', String(r.compliance.late_excused)],
      ['Late - unexcused', String(r.compliance.late_unexcused)],
      ['Open and overdue', String(r.compliance.open_overdue)],
      ['Avg unexcused delay (days)', String(r.compliance.avg_unexcused_delay_days)],
      ['Total unexcused delay (days)', String(r.compliance.total_unexcused_delay_days)],
      ['Total excused delay (days)', String(r.compliance.total_excused_delay_days)],
      ['Extensions requested', String(r.compliance.extensions_requested)],
      ['Extensions granted', String(r.compliance.extensions_granted)],
    ]);
    pdf.heading('4. Blockers');
    pdf.kv([
      ['Raised', String(r.blockers.raised)],
      ['Accepted (approved dependencies)', String(r.blockers.accepted)],
      ['Rejected', String(r.blockers.rejected)],
      ['Raised after the deadline', String(r.blockers.raised_after_deadline)],
      ['Excused days from blockers', String(r.blockers.excused_days)],
      ...Object.entries(r.blockers.accepted_by_type).map(([k, v]) => [`Accepted: ${TASK_BLOCKER_TYPE_LABELS[k as TaskBlockerType] || k}`, String(v)] as [string, string]),
    ]);
    pdf.heading('5. Repeated misses & rework');
    pdf.kv([
      ['Recurring instances missed', String(r.repeated_misses.recurring_instances_missed)],
      ['Tasks with 2+ extensions', String(r.repeated_misses.tasks_with_multiple_extensions)],
      ['Sent back for rework', String(r.repeated_misses.rework_count)],
      ['Reopened after completion', String(r.repeated_misses.reopen_count)],
      ['Reassigned away (non-performance)', `${r.reassignments.reassigned_away.length} (${r.reassignments.counted_as_miss})`],
    ]);
    pdf.heading('6. Manager review');
    if (!r.reviews.length) pdf.paragraph('No submitted manager review overlaps this period.', { size: 9, color: [0.29, 0.33, 0.41] });
    for (const rv of r.reviews as any[]) {
      pdf.kv([
        ['Reviewer', rv.reviewer_name],
        ['Review period', `${formatTaskDate(rv.period_from)} - ${formatTaskDate(rv.period_to)}`],
        ['Rating', rv.rating ? `${rv.rating} / ${rv.rating_scale}` : '-'],
        ['Acknowledged by employee', rv.employee_acknowledged_at ? formatTaskDateTime(rv.employee_acknowledged_at) : 'Not yet'],
      ]);
      if (rv.strengths) pdf.paragraph(`Strengths: ${rv.strengths}`);
      if (rv.improvement_areas) pdf.paragraph(`Improvement areas: ${rv.improvement_areas}`);
      if (rv.comments) pdf.paragraph(`Comments: ${rv.comments}`);
      pdf.paragraph(`Employee response: ${rv.employee_response || '(none)'}`, { bold: true });
    }
    pdf.heading('Appendix A - Task list');
    pdf.table(
      [
        { label: 'Task', width: 15 },
        { label: 'Title', width: 22 },
        { label: 'Orig. deadline', width: 11 },
        { label: 'Completed', width: 11 },
        { label: 'Status', width: 11 },
        { label: 'Delay class', width: 13 },
        { label: 'Unexc. d', width: 7, align: 'right' },
        { label: 'Ext', width: 4, align: 'right' },
        { label: 'Blockers', width: 18 },
      ],
      r.tasks.map((t) => [
        t.task_number,
        t.title,
        formatTaskDate(t.original_deadline),
        t.completed_at ? formatTaskDate(t.completed_at) : '-',
        TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] || t.status,
        t.excluded ? `Excluded (${t.excluded.replace('_', ' ')})` : t.delay_class ? TASK_DELAY_CLASS_LABELS[t.delay_class] : '-',
        String(t.unexcused_delay_days),
        String(t.extensions),
        t.blockers || '-',
      ]),
    );
    if (r.blocker_list.length) {
      pdf.heading('Appendix B - Blocker history');
      pdf.table(
        [
          { label: 'Task', width: 15 },
          { label: 'Type', width: 15 },
          { label: 'Raised', width: 11 },
          { label: 'Status', width: 10 },
          { label: 'After deadline', width: 9 },
          { label: 'Excused d', width: 8, align: 'right' },
          { label: 'Description / decision', width: 32 },
        ],
        r.blocker_list.map((b) => [
          b.task_number,
          TASK_BLOCKER_TYPE_LABELS[b.type as TaskBlockerType] || b.type,
          formatTaskDate(b.raised_at as any),
          b.status,
          b.raised_after_deadline ? 'Yes' : 'No',
          String(b.excused_days),
          `${b.description}${b.decision_comment ? ` | ${b.decision_comment}` : ''}`,
        ]),
      );
    }
    if (r.reassignments.reassigned_away.length) {
      pdf.heading('Appendix C - Reassigned away');
      pdf.table(
        [
          { label: 'Task', width: 15 },
          { label: 'Title', width: 27 },
          { label: 'To', width: 16 },
          { label: 'Reason type', width: 16 },
          { label: 'Overdue then', width: 10 },
          { label: 'Reason', width: 30 },
        ],
        r.reassignments.reassigned_away.map((h: any) => [
          h.task_number,
          h.title,
          h.to_name || '-',
          TASK_REASSIGN_REASON_LABELS[h.reason_type as keyof typeof TASK_REASSIGN_REASON_LABELS] || h.reason_type,
          h.was_overdue ? `${h.overdue_days} d` : 'No',
          h.reason,
        ]),
      );
    }
    return pdf.build();
  }

  async renderXlsx(r: Awaited<ReturnType<PerformanceEvidenceService['report']>>, snapshotLabel?: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Arihant BOS';
    wb.created = new Date(r.generated_at);
    const summary = wb.addWorksheet('Summary');
    summary.columns = [{ width: 42 }, { width: 46 }];
    summary.addRow(['Performance Evidence Report']).font = { bold: true, size: 14 };
    const d = summary.addRow([r.disclaimer]);
    d.font = { bold: true, color: { argb: 'FF9A3412' } };
    summary.mergeCells(`A${d.number}:B${d.number}`);
    d.alignment = { wrapText: true };
    d.height = 32;
    const rows: [string, unknown][] = [
      ['Employee', r.employee.name],
      ['Employee code', r.employee.employee_code || ''],
      ['Department', r.employee.department || ''],
      ['Reporting manager', r.employee.manager || ''],
      ['Period', `${formatTaskDate(r.period.from)} to ${formatTaskDate(r.period.to)}`],
      ['Period rule', r.period.basis_note],
      ['Generated', formatTaskDateTime(r.generated_at)],
      ['Snapshot', snapshotLabel || 'Live (not a snapshot)'],
      ['', ''],
      ['Tasks assessed', r.work_assigned.total],
      ['Recurring / one-time', `${r.work_assigned.recurring} / ${r.work_assigned.one_time}`],
      ['Completed', r.completion.completed],
      ['Awaiting approval', r.completion.awaiting_approval],
      ['Open', r.completion.open],
      ['Cancelled (excluded)', r.completion.cancelled],
      ['Completion rate %', r.completion.completion_rate_pct ?? ''],
      ['On time', r.compliance.on_time],
      ['On-time rate % (of completed)', r.compliance.on_time_pct ?? ''],
      ['Late - excused', r.compliance.late_excused],
      ['Late - unexcused', r.compliance.late_unexcused],
      ['Open and overdue', r.compliance.open_overdue],
      ['Avg unexcused delay (days)', r.compliance.avg_unexcused_delay_days],
      ['Total unexcused delay (days)', r.compliance.total_unexcused_delay_days],
      ['Total excused delay (days)', r.compliance.total_excused_delay_days],
      ['Extensions requested / granted', `${r.compliance.extensions_requested} / ${r.compliance.extensions_granted}`],
      ['Blockers raised / accepted / rejected', `${r.blockers.raised} / ${r.blockers.accepted} / ${r.blockers.rejected}`],
      ['Blockers raised after deadline', r.blockers.raised_after_deadline],
      ['Excused days from blockers', r.blockers.excused_days],
      ['Recurring instances missed', r.repeated_misses.recurring_instances_missed],
      ['Tasks with 2+ extensions', r.repeated_misses.tasks_with_multiple_extensions],
      ['Rework / reopen count', `${r.repeated_misses.rework_count} / ${r.repeated_misses.reopen_count}`],
      ['Reassigned away (non-performance)', `${r.reassignments.reassigned_away.length} (${r.reassignments.counted_as_miss})`],
    ];
    for (const [k, v] of rows) summary.addRow([k, v as any]).getCell(1).font = { color: { argb: 'FF4A5568' } };

    const tasks = wb.addWorksheet('Tasks');
    tasks.columns = [
      { header: 'Task No', key: 'task_number', width: 18 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Recurring', key: 'recurring', width: 10 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Original deadline', key: 'original_deadline', width: 20 },
      { header: 'Current deadline', key: 'deadline', width: 20 },
      { header: 'Completed', key: 'completed_at', width: 20 },
      { header: 'Delay class', key: 'delay_class', width: 18 },
      { header: 'Unexcused delay (days)', key: 'unexcused_delay_days', width: 12 },
      { header: 'Excused delay (days)', key: 'excused_delay_days', width: 12 },
      { header: 'Extensions', key: 'extensions', width: 10 },
      { header: 'Blockers', key: 'blockers', width: 40 },
      { header: 'Rework', key: 'rework', width: 8 },
      { header: 'Reopened', key: 'reopened', width: 9 },
      { header: 'Reason for delay', key: 'delay_reason', width: 40 },
      { header: 'Excluded', key: 'excluded', width: 14 },
    ];
    tasks.getRow(1).font = { bold: true };
    for (const t of r.tasks) {
      tasks.addRow({
        ...t,
        recurring: t.recurring ? 'Yes' : 'No',
        status: TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] || t.status,
        original_deadline: formatTaskDateTime(t.original_deadline),
        deadline: formatTaskDateTime(t.deadline),
        completed_at: t.completed_at ? formatTaskDateTime(t.completed_at) : '',
        delay_class: t.delay_class ? TASK_DELAY_CLASS_LABELS[t.delay_class] : '',
        excluded: t.excluded || '',
      });
    }
    const bl = wb.addWorksheet('Blockers');
    bl.columns = [
      { header: 'Task No', key: 'task_number', width: 18 },
      { header: 'Type', key: 'type', width: 24 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Raised', key: 'raised_at', width: 20 },
      { header: 'After deadline', key: 'after', width: 12 },
      { header: 'Excused days', key: 'excused_days', width: 12 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Decision comment', key: 'decision_comment', width: 40 },
    ];
    bl.getRow(1).font = { bold: true };
    for (const b of r.blocker_list) bl.addRow({ ...b, type: TASK_BLOCKER_TYPE_LABELS[b.type as TaskBlockerType] || b.type, raised_at: formatTaskDateTime(b.raised_at as any), after: b.raised_after_deadline ? 'Yes' : 'No' });
    const rv = wb.addWorksheet('Manager review');
    rv.columns = [
      { header: 'Reviewer', key: 'reviewer_name', width: 22 },
      { header: 'Period', key: 'period', width: 24 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Strengths', key: 'strengths', width: 40 },
      { header: 'Improvement areas', key: 'improvement_areas', width: 40 },
      { header: 'Comments', key: 'comments', width: 40 },
      { header: 'Employee response', key: 'employee_response', width: 40 },
      { header: 'Acknowledged', key: 'ack', width: 20 },
    ];
    rv.getRow(1).font = { bold: true };
    for (const x of r.reviews as any[]) {
      rv.addRow({ ...x, period: `${formatTaskDate(x.period_from)} - ${formatTaskDate(x.period_to)}`, rating: x.rating ? `${x.rating}/${x.rating_scale}` : '', ack: x.employee_acknowledged_at ? formatTaskDateTime(x.employee_acknowledged_at) : '' });
    }
    for (const ws of [tasks, bl, rv]) {
      const last = ws.addRow([]);
      const note = ws.addRow([r.disclaimer]);
      note.font = { bold: true, color: { argb: 'FF9A3412' } };
      void last;
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ------------------------------------------------------------------ live export
  async exportLive(query: Record<string, unknown>, format: 'pdf' | 'xlsx', user: AuthUser) {
    this.assertCanSnapshot(user);
    const q = await this.parse(query);
    const r = await this.report(q, user, { audit: `performance_evidence_export_${format}` });
    const buf = format === 'pdf' ? this.renderPdf(r) : await this.renderXlsx(r);
    const slug = r.employee.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return { buffer: buf, fileName: `evidence-${slug}-${r.period.from}-to-${r.period.to}.${format}` };
  }

  // ------------------------------------------------------------------ snapshots
  private snapshotDir() {
    return path.join(this.config.storageDir, 'evidence-snapshots');
  }

  async createSnapshot(dto: Record<string, unknown>, user: AuthUser) {
    this.assertCanSnapshot(user);
    const q = await this.parse(dto);
    const r = await this.report(q, user, { audit: 'performance_evidence_snapshot' });
    const prev = await this.db
      .selectFrom('performance_evidence_snapshots')
      .select(sql<number>`coalesce(max(snapshot_no), 0)::int`.as('n'))
      .where('employee_id', '=', q.employee_id)
      .where('period_from', '=', q.from)
      .where('period_to', '=', r.period.to)
      .executeTakeFirst();
    const no = Number(prev?.n || 0) + 1;
    const label = `Snapshot v${no}`;
    const data = JSON.stringify(r);
    const pdf = this.renderPdf(r, label);
    const xlsx = await this.renderXlsx(r, label);
    const dir = path.join(this.snapshotDir(), q.employee_id);
    await fs.promises.mkdir(dir, { recursive: true });
    const base = `${q.from}_${r.period.to}_v${no}_${randomUUID().slice(0, 8)}`;
    const pdfKey = path.join('evidence-snapshots', q.employee_id, `${base}.pdf`);
    const xlsxKey = path.join('evidence-snapshots', q.employee_id, `${base}.xlsx`);
    await fs.promises.writeFile(path.join(this.config.storageDir, pdfKey), pdf, { mode: 0o440 });
    await fs.promises.writeFile(path.join(this.config.storageDir, xlsxKey), xlsx, { mode: 0o440 });
    const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
    try {
      const row = await this.db
        .insertInto('performance_evidence_snapshots')
        .values({
          employee_id: q.employee_id,
          period_from: q.from,
          period_to: r.period.to,
          period_basis: q.basis,
          snapshot_no: no,
          generated_by: user.id,
          data,
          data_sha256: sha(data),
          pdf_storage_key: pdfKey,
          pdf_sha256: sha(pdf),
          xlsx_storage_key: xlsxKey,
          xlsx_sha256: sha(xlsx),
        })
        .returning(['id', 'employee_id', 'period_from', 'period_to', 'period_basis', 'snapshot_no', 'generated_at', 'data_sha256', 'pdf_sha256', 'xlsx_sha256'])
        .executeTakeFirstOrThrow();
      this.store.audit(user, 'performance_evidence_snapshot', row.id, 'performance_evidence_snapshot_create', undefined, { employee_id: q.employee_id, period: `${q.from}..${r.period.to}`, snapshot_no: no });
      return row;
    } catch (err: any) {
      await fs.promises.unlink(path.join(this.config.storageDir, pdfKey)).catch(() => undefined);
      await fs.promises.unlink(path.join(this.config.storageDir, xlsxKey)).catch(() => undefined);
      if (err?.code === '23505') throw new TaskValidationException({ employee_id: 'Another snapshot was generated at the same moment — try again.' });
      throw err;
    }
  }

  async listSnapshots(query: Record<string, unknown>, user: AuthUser) {
    const employeeId = typeof query.employee_id === 'string' && UUID_RE.test(query.employee_id) ? query.employee_id : null;
    if (!employeeId) throw new TaskValidationException({ employee_id: 'Choose an employee.' });
    await this.assertCanView(employeeId, user);
    return this.db
      .selectFrom('performance_evidence_snapshots as s')
      .innerJoin('users as g', 'g.id', 's.generated_by')
      .select(['s.id', 's.employee_id', 's.period_from', 's.period_to', 's.period_basis', 's.snapshot_no', 's.generated_at', 's.data_sha256', 's.pdf_sha256', 's.xlsx_sha256', 'g.full_name as generated_by_name'])
      .where('s.employee_id', '=', employeeId)
      .orderBy('s.generated_at', 'desc')
      .execute();
  }

  async getSnapshot(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Snapshot not found');
    const row = await this.db.selectFrom('performance_evidence_snapshots').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Snapshot not found');
    await this.assertCanView(row.employee_id, user);
    this.store.audit(user, 'performance_evidence_snapshot', id, 'performance_evidence_snapshot_view');
    return { ...row, data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data };
  }

  async snapshotFile(id: string, format: 'pdf' | 'xlsx', user: AuthUser) {
    const row = await this.getSnapshot(id, user);
    const key = format === 'pdf' ? row.pdf_storage_key : row.xlsx_storage_key;
    if (!key) throw new NotFoundException('File not found');
    const full = path.resolve(this.config.storageDir, key);
    if (!full.startsWith(this.config.storageDir + path.sep) || !fs.existsSync(full)) throw new NotFoundException('Snapshot file is missing from storage.');
    const buffer = await fs.promises.readFile(full);
    const expected = format === 'pdf' ? row.pdf_sha256 : row.xlsx_sha256;
    const actual = createHash('sha256').update(buffer).digest('hex');
    this.store.audit(user, 'performance_evidence_snapshot', id, `performance_evidence_snapshot_download_${format}`);
    return { buffer, fileName: `evidence-snapshot-v${row.snapshot_no}-${row.period_from}-to-${row.period_to}.${format}`, integrity: expected === actual ? 'verified' : 'MISMATCH' };
  }

  /** Default period helper for the UI. */
  defaultPeriod() {
    const today = todayInKolkata();
    return { from: addIsoDays(`${today.slice(0, 7)}-01`, 0), to: today };
  }
}
