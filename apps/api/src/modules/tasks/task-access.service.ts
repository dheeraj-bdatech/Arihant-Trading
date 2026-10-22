/**
 * Who can see a task, who has manager authority over it, who approves it, and whom a user may assign work to.
 * Every list, dashboard and export goes through `scope()`, so query params can never widen access.
 *
 * Authority is always computed from the *current* reporting line (pending approvals and blocker reviews
 * follow a manager change automatically); `tasks.reporting_manager_id` is only the historical snapshot.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type ExpressionBuilder } from 'kysely';
import type { AuthUser, Database, TaskActorKind } from '@arihant/shared';
import { TASK_DB } from './task-db.js';
import { TaskMastersService, isAdminLike, type TaskSettings } from './task-masters.service.js';
import { teamIds as fieldTeamIds, teamScope as fieldTeamScope } from '../dashboard/dashboard-metrics.js';

/**
 * A regional manager's field team — the same set the RM dashboard and Zonal Command use (dashboard-metrics
 * `teamScope`): active sales / demo / service users reporting to the RM or based in the RM's zone. National roles
 * (tender team, accounts, management…) are never part of it, whatever region they sit in.
 */
const isRm = (user: AuthUser) => user.role === 'regional_manager';

export interface TaskAuthorityRow {
  id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  department_id: string | null;
}

export interface ApproverResolution {
  /** First active manager above the assignee, or null when the fallback role applies. */
  primary: string | null;
  /** Everyone who may act as approver/reviewer for this assignee. */
  ids: string[];
  viaFallback: boolean;
}

export type AssignScope = 'self' | 'team' | 'department' | 'peer' | 'all';

@Injectable()
export class TaskAccessService {
  constructor(
    @Inject(TASK_DB) private readonly db: Kysely<Database>,
    private readonly masters: TaskMastersService,
  ) {}

  /** Management, admin and accounts (authorised evidence viewers) see every task. */
  canViewAll(user: Pick<AuthUser, 'role'>): boolean {
    return isAdminLike(user) || user.role === 'accounts';
  }

  /** Visibility filter. Queries alias tasks as `t` and the assignee as `emp`. */
  scope(user: AuthUser, s: TaskSettings) {
    return (eb: ExpressionBuilder<any, any>) => {
      if (this.canViewAll(user)) return sql<boolean>`true`;
      const depth = s.allow_indirect_reports ? 10 : 1;
      const ors = [
        eb('t.assigned_to', '=', user.id),
        eb('t.assigned_by', '=', user.id),
        eb('t.reporting_manager_id', '=', user.id),
        eb('t.assigned_to', 'in', sql<string>`(select user_subordinate_ids(${user.id}, ${depth}))`),
        eb('t.department_id', 'in', sql<string>`(select id from departments where head_user_id = ${user.id})`),
        sql<boolean>`exists (select 1 from task_escalations e where e.task_id = t.id and e.escalated_to = ${user.id})`,
        sql<boolean>`exists (select 1 from task_blockers b where b.task_id = t.id and b.dependency_user_id = ${user.id})`,
        sql<boolean>`exists (select 1 from task_assignment_history h where h.task_id = t.id and h.from_user_id = ${user.id})`,
      ];
      if (isRm(user)) ors.push(eb('t.assigned_to', 'in', fieldTeamIds(user.id, user.zone_id ?? null) as any));
      return eb.or(ors);
    };
  }

  /**
   * Employees whose work this user manages (team scope for assignment, dashboards and evidence): the reporting
   * line, department members for a department head and — for a regional manager — their field team (dashboard
   * `teamScope`: active field staff reporting to them or based in their zone; RBAC: regional managers run their zone,
   * DEF-036). Management / admin are never anyone's "team".
   */
  async teamIds(user: AuthUser, s: TaskSettings): Promise<string[]> {
    const depth = s.allow_indirect_reports ? 10 : 1;
    const fieldTeam = isRm(user)
      ? sql`union select u.id from users u where ${fieldTeamScope(user.id, user.zone_id ?? null)} and u.id <> ${user.id}`
      : sql``;
    const rows = await sql<{ id: string }>`
      select user_subordinate_ids(${user.id}, ${depth}) as id
      union
      select u.id from users u join departments d on d.id = u.department_id where d.head_user_id = ${user.id} and u.id <> ${user.id}
      ${fieldTeam}
    `.execute(this.db);
    return rows.rows.map((r) => r.id);
  }

  /** True when `assigneeId` is on the regional manager's field team (dashboard `teamScope`; DEF-036 / DEF-075). */
  private async isRegionalReport(user: AuthUser, assigneeId: string): Promise<boolean> {
    if (!isRm(user) || assigneeId === user.id) return false;
    const res = await sql<{ id: string }>`
      select u.id from users u where u.id = ${assigneeId}::uuid and ${fieldTeamScope(user.id, user.zone_id ?? null)}
    `.execute(this.db);
    return res.rows.length > 0;
  }

  async managerChain(userId: string): Promise<{ id: string; depth: number; is_active: boolean }[]> {
    const res = await sql<{ id: string; depth: number; is_active: boolean }>`select * from user_manager_chain(${userId})`.execute(this.db);
    return res.rows;
  }

  /** Approval / blocker-review routing: current manager chain, never the assignee, then the fallback role. */
  async resolveApprovers(assigneeId: string): Promise<ApproverResolution> {
    const chain = await this.managerChain(assigneeId);
    const first = chain.find((c) => c.is_active && c.id !== assigneeId);
    if (first) return { primary: first.id, ids: [first.id], viaFallback: false };
    const s = await this.masters.settings();
    const roles = s.fallback_approver_role === 'admin' ? ['admin'] : ['management', 'admin'];
    for (const role of roles) {
      const users = await this.db
        .selectFrom('users')
        .select('id')
        .where('role', '=', role as any)
        .where('is_active', '=', true)
        .where('id', '<>', assigneeId)
        .orderBy('created_at')
        .execute();
      if (users.length) return { primary: null, ids: users.map((u) => u.id), viaFallback: true };
    }
    return { primary: null, ids: [], viaFallback: true };
  }

  async requireApprovers(assigneeId: string): Promise<ApproverResolution> {
    const r = await this.resolveApprovers(assigneeId);
    if (!r.ids.length) {
      throw new BadRequestException({ code: 'NO_APPROVER', message: 'No approver is configured for this employee (no active manager and no fallback user). Contact admin.' });
    }
    return r;
  }

  /** Actor kinds of `user` on a task — the input to the shared transition map. */
  async actorKinds(task: TaskAuthorityRow, user: AuthUser): Promise<Set<TaskActorKind>> {
    const kinds = new Set<TaskActorKind>();
    if (user.role === 'admin') kinds.add('admin');
    if (task.assigned_to === user.id) kinds.add('assignee');
    if (task.assigned_by === user.id) kinds.add('assigner');
    if (await this.hasManagerAuthority(task, user)) kinds.add('manager');
    return kinds;
  }

  async hasManagerAuthority(task: TaskAuthorityRow, user: AuthUser): Promise<boolean> {
    if (!task.assigned_to) return isAdminLike(user);
    if (task.assigned_to === user.id) return isAdminLike(user); // kind 'assignee' still blocks self-actions
    if (isAdminLike(user)) return true;
    const s = await this.masters.settings();
    const chain = await this.managerChain(task.assigned_to);
    if (chain.some((c) => c.id === user.id && (s.allow_indirect_reports || c.depth === 1))) return true;
    // A regional manager manages the work of their field team (assign, review blockers, extend, close).
    if (await this.isRegionalReport(user, task.assigned_to)) return true;
    const head = await this.db
      .selectFrom('departments')
      .select('id')
      .where('head_user_id', '=', user.id)
      .where((eb) =>
        eb.or([
          eb('id', '=', task.department_id ?? '00000000-0000-0000-0000-000000000000'),
          eb('id', '=', eb.selectFrom('users').select('department_id').where('id', '=', task.assigned_to!)),
        ]),
      )
      .executeTakeFirst();
    if (head) return true;
    const escalation = await this.db
      .selectFrom('task_escalations')
      .select('id')
      .where('task_id', '=', task.id)
      .where('escalated_to', '=', user.id)
      .where('status', '<>', 'closed')
      .executeTakeFirst();
    if (escalation) return true;
    const approvers = await this.resolveApprovers(task.assigned_to);
    return approvers.viaFallback && approvers.ids.includes(user.id);
  }

  /** May `user` create work for `assigneeId`? Linked business work (customer/tender/demo/service) may go to peers if allowed. */
  async assignScope(user: AuthUser, assigneeId: string, linked: boolean): Promise<{ ok: true; scope: AssignScope; reason?: undefined } | { ok: false; reason: string; scope?: undefined }> {
    const s = await this.masters.settings();
    if (assigneeId === user.id) {
      return s.allow_self_tasks || isAdminLike(user) ? { ok: true, scope: 'self' } : { ok: false, reason: 'Self-created tasks are disabled — ask your manager to assign this.' };
    }
    if (isAdminLike(user)) return { ok: true, scope: 'all' };
    const team = await this.teamIds(user, s);
    if (team.includes(assigneeId)) return { ok: true, scope: 'team' };
    if (s.allow_peer_linked_assignment && linked) return { ok: true, scope: 'peer' };
    return {
      ok: false,
      reason: s.allow_peer_linked_assignment
        ? 'You can assign general tasks only to your own team. Link the task to a customer, tender, demo or service ticket to request work from a colleague.'
        : 'You can only assign tasks to your own team.',
    };
  }
}
