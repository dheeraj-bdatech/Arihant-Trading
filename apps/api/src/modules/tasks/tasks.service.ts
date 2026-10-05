import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { Database, AuthUser, PaginatedResult, TaskFilterDto } from '@arihant/shared';
import type {
  CreateTaskDto,
  UpdateTaskDto,
  RaiseBlockerDto,
  ResolveBlockerDto,
} from './tasks.dto.js';

@Injectable()
export class TasksService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(query: TaskFilterDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('tasks')
      .leftJoin('users as assignee', 'tasks.assigned_to', 'assignee.id')
      .leftJoin('users as manager', 'tasks.reporting_manager_id', 'manager.id');

    if (['sales', 'demo_team', 'service_team', 'tender_team'].includes(user.role)) {
      baseQuery = baseQuery.where('tasks.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('tasks.assigned_to', '=', user.id),
          eb('tasks.reporting_manager_id', '=', user.id),
          eb('assignee.reporting_manager_id', '=', user.id),
        ]),
      );
    }

    if (query.status) {
      baseQuery = baseQuery.where('tasks.status', '=', query.status as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('tasks.assigned_to', '=', query.assigned_to);
    }

    if (query.department) {
      baseQuery = baseQuery.where('tasks.department', '=', query.department);
    }

    if (query.priority) {
      baseQuery = baseQuery.where('tasks.priority', '=', query.priority as any);
    }

    const fromDate = query.dateFrom || (query as any).from_date;
    if (fromDate) {
      baseQuery = baseQuery.where('tasks.deadline', '>=', fromDate);
    }

    const toDate = query.dateTo || (query as any).to_date;
    if (toDate) {
      baseQuery = baseQuery.where('tasks.deadline', '<=', toDate);
    }

    if (query.overdueOnly) {
      const today = new Date().toISOString().split('T')[0];
      baseQuery = baseQuery
        .where('tasks.status', '!=', 'completed')
        .where('tasks.deadline', '<', today);
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(tasks.title) like ${s}`,
          sql<boolean>`lower(tasks.description) like ${s}`,
          sql<boolean>`lower(assignee.full_name) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(tasks.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const tasks = await baseQuery
      .select([
        'tasks.id',
        'tasks.title',
        'tasks.description',
        'tasks.assigned_to',
        'tasks.reporting_manager_id',
        'tasks.department',
        'tasks.priority',
        'tasks.task_type',
        'tasks.related_entity_type',
        'tasks.related_entity_id',
        'tasks.start_date',
        'tasks.deadline',
        'tasks.expected_outcome',
        'tasks.evidence_url',
        'tasks.status',
        'tasks.created_at',
        'tasks.updated_at',
        'assignee.full_name as assignee_name',
        'manager.full_name as manager_name',
      ])
      .orderBy('tasks.deadline', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(tasks, total, page, limit);
  }

  async findOne(id: string) {
    const task = await this.db
      .selectFrom('tasks')
      .leftJoin('users as assignee', 'tasks.assigned_to', 'assignee.id')
      .leftJoin('users as manager', 'tasks.reporting_manager_id', 'manager.id')
      .selectAll('tasks')
      .select([
        'assignee.full_name as assignee_name',
        'manager.full_name as manager_name',
      ])
      .where('tasks.id', '=', id)
      .executeTakeFirst();

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const blockers = await this.db
      .selectFrom('task_blockers')
      .leftJoin('users as raiser', 'task_blockers.raised_by', 'raiser.id')
      .leftJoin('users as decider', 'task_blockers.decided_by', 'decider.id')
      .selectAll('task_blockers')
      .select([
        'raiser.full_name as raised_by_name',
        'decider.full_name as decided_by_name',
      ])
      .where('task_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();

    return {
      ...task,
      blockers,
    };
  }

  async create(dto: CreateTaskDto, user: AuthUser) {
    const assignedTo = dto.assigned_to || user.id;

    const assignee = await this.db
      .selectFrom('users')
      .select('reporting_manager_id')
      .where('id', '=', assignedTo)
      .executeTakeFirst();

    const task = await this.db
      .insertInto('tasks')
      .values({
        title: dto.title.trim(),
        description: dto.description || null,
        assigned_to: assignedTo,
        reporting_manager_id: assignee?.reporting_manager_id || user.id,
        department: dto.department || null,
        priority: dto.priority || 'medium',
        task_type: dto.task_type || 'one_time',
        related_entity_type: dto.related_entity_type || null,
        related_entity_id: dto.related_entity_id || null,
        start_date: dto.start_date || new Date().toISOString().split('T')[0],
        deadline: dto.deadline || null,
        expected_outcome: dto.expected_outcome || null,
        status: 'not_started',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'task',
      entityId: task.id,
      action: 'create',
      newValue: task,
    });

    // Auto-remind & notify the assigned team member so it pops up immediately on their side
    if (assignedTo && assignedTo !== user.id) {
      try {
        await this.db
          .insertInto('notifications')
          .values({
            user_id: assignedTo,
            type: 'task_assigned',
            title: `📌 Task Assigned: ${task.title}`,
            body: `You have been assigned a task${task.deadline ? ` (Due: ${task.deadline})` : ''} by ${user.full_name || 'Team'}.`,
            entity_type: 'task',
            entity_id: task.id,
            is_read: false,
          })
          .execute();
      } catch (err: any) {
        // Silently continue if notification table insert has any non-fatal issue
      }
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthUser) {
    const existing = await this.findOne(id);

    const updated = await this.db
      .updateTable('tasks')
      .set({
        ...dto,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'task',
      entityId: id,
      action: 'update',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async raiseBlocker(id: string, dto: RaiseBlockerDto, user: AuthUser) {
    const task = await this.findOne(id);

    const blocker = await this.db
      .insertInto('task_blockers')
      .values({
        task_id: id,
        blocker_type: dto.blocker_type,
        description: dto.description,
        raised_by: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .updateTable('tasks')
      .set({ status: 'blocked' })
      .where('id', '=', id)
      .execute();

    if (task.reporting_manager_id) {
      this.eventEmitter.emit(AppEvents.TASK_BLOCKED, {
        taskId: id,
        title: task.title,
        raisedById: user.id,
        managerId: task.reporting_manager_id,
        blockerType: dto.blocker_type,
        description: dto.description,
      });
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'task',
      entityId: id,
      action: 'raise_blocker',
      newValue: blocker,
    });

    return blocker;
  }

  async resolveBlocker(taskId: string, blockerId: string, dto: ResolveBlockerDto, user: AuthUser) {
    const blocker = await this.db
      .updateTable('task_blockers')
      .set({
        manager_decision: dto.decision,
        decided_by: user.id,
      })
      .where('id', '=', blockerId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const taskUpdatePayload: any = { status: 'in_progress' };
    if (dto.decision === 'extended' && dto.new_deadline) {
      taskUpdatePayload.deadline = dto.new_deadline;
    }
    if (dto.decision === 'reassigned' && dto.reassigned_to) {
      taskUpdatePayload.assigned_to = dto.reassigned_to;
    }

    await this.db
      .updateTable('tasks')
      .set(taskUpdatePayload)
      .where('id', '=', taskId)
      .execute();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'task',
      entityId: taskId,
      action: `resolve_blocker_${dto.decision}`,
      newValue: blocker,
    });

    return blocker;
  }

  // --- Accountability View (§42) ---
  async getAccountability(user: AuthUser) {
    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    let base = this.db
      .selectFrom('tasks')
      .leftJoin('users as assignee', 'tasks.assigned_to', 'assignee.id');

    if (user.role === 'regional_manager' && user.zone_id) {
      base = base.where('assignee.zone_id', '=', user.zone_id);
    } else if (['sales', 'demo_team', 'service_team', 'tender_team'].includes(user.role)) {
      base = base.where('tasks.assigned_to', '=', user.id);
    }

    const dueToday = await base
      .selectAll('tasks')
      .select('assignee.full_name as assignee_name')
      .where('tasks.status', '!=', 'completed')
      .where('tasks.deadline', '=', today)
      .execute();

    const overdue = await base
      .selectAll('tasks')
      .select('assignee.full_name as assignee_name')
      .where('tasks.status', '!=', 'completed')
      .where('tasks.deadline', '<', today)
      .execute();

    const noUpdate3Days = await base
      .selectAll('tasks')
      .select('assignee.full_name as assignee_name')
      .where('tasks.status', '!=', 'completed')
      .where('tasks.updated_at', '<', threeDaysAgo as any)
      .execute();

    const blocked = await base
      .selectAll('tasks')
      .select('assignee.full_name as assignee_name')
      .where('tasks.status', '=', 'blocked')
      .execute();

    return {
      dueTodayCount: dueToday.length,
      overdueCount: overdue.length,
      noUpdateCount: noUpdate3Days.length,
      blockedCount: blocked.length,
      dueToday,
      overdue,
      noUpdate3Days,
      blocked,
    };
  }

  // --- Salary & Performance Evidence Report (§4, §43) ---
  async getSalaryEvidence(user: AuthUser, employeeId?: string) {
    let targetUsersQuery = this.db
      .selectFrom('users')
      .selectAll()
      .where('is_active', '=', true);

    if (employeeId) {
      targetUsersQuery = targetUsersQuery.where('id', '=', employeeId);
    } else if (user.role === 'regional_manager' && user.zone_id) {
      targetUsersQuery = targetUsersQuery.where('zone_id', '=', user.zone_id);
    } else if (['sales', 'demo_team', 'service_team', 'tender_team'].includes(user.role)) {
      targetUsersQuery = targetUsersQuery.where('id', '=', user.id);
    }

    const targetUsers = await targetUsersQuery.execute();

    const dossiers = await Promise.all(
      targetUsers.map(async (emp) => {
        const completedTasks = await this.db
          .selectFrom('tasks')
          .select(sql<number>`count(id)::int`.as('count'))
          .where('assigned_to', '=', emp.id)
          .where('status', '=', 'completed')
          .executeTakeFirst();

        const overdueTasks = await this.db
          .selectFrom('tasks')
          .select(sql<number>`count(id)::int`.as('count'))
          .where('assigned_to', '=', emp.id)
          .where('status', '!=', 'completed')
          .where('deadline', '<', new Date().toISOString().split('T')[0])
          .executeTakeFirst();

        const verifiedVisits = await this.db
          .selectFrom('visits')
          .select(sql<number>`count(id)::int`.as('count'))
          .where('assigned_to', '=', emp.id)
          .where('status', '=', 'completed')
          .executeTakeFirst();

        const approvedBlockers = await this.db
          .selectFrom('task_blockers')
          .select(sql<number>`count(id)::int`.as('count'))
          .where('raised_by', '=', emp.id)
          .where('manager_decision', 'in', ['accepted', 'extended', 'reassigned'])
          .executeTakeFirst();

        const totalTasks = (completedTasks?.count || 0) + (overdueTasks?.count || 0);
        const onTimeRate = totalTasks > 0 ? Math.round(((completedTasks?.count || 0) / totalTasks) * 100) : 100;

        return {
          employeeId: emp.id,
          employeeName: emp.full_name,
          role: emp.role,
          email: emp.email,
          completedTasksCount: completedTasks?.count || 0,
          overdueTasksCount: overdueTasks?.count || 0,
          verifiedVisitsCount: verifiedVisits?.count || 0,
          approvedBlockersCount: approvedBlockers?.count || 0,
          onTimeDeliveryPercentage: onTimeRate,
          evidenceGrade: onTimeRate >= 80 ? 'Exemplary' : onTimeRate >= 60 ? 'Satisfactory' : 'Needs Review',
        };
      }),
    );

    return {
      disclaimer:
        'EVIDENCE ONLY: Under Blueprint §4 and corporate policy, automated salary or payroll deductions are strictly prohibited. This evidence dossier is provided to management for human appraisal and performance review discretion.',
      generatedAt: new Date().toISOString(),
      dossiers,
    };
  }
}
