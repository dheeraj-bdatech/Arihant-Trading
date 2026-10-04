import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { assertNotSelfApproval } from '../../common/utils/scope.util.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { Database, AuthUser, PaginatedResult, ExpenseFilterDto } from '@arihant/shared';
import type {
  CreateExpenseDto,
  ManagerApproveExpenseDto,
  AccountsProcessExpenseDto,
} from './expenses.dto.js';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private getBaseQuery(query: ExpenseFilterDto, user: AuthUser) {
    let baseQuery = this.db
      .selectFrom('expenses')
      .innerJoin('users as employee', 'expenses.employee_id', 'employee.id')
      .leftJoin('organisations', 'expenses.organisation_id', 'organisations.id')
      .leftJoin('visits', 'expenses.visit_id', 'visits.id')
      .leftJoin('users as manager', 'expenses.manager_id', 'manager.id');

    // Scoping rules:
    // Sales, Demo, Service staff only see their own expenses
    if (['sales', 'demo_team', 'service_team'].includes(user.role)) {
      baseQuery = baseQuery.where('expenses.employee_id', '=', user.id);
    } else if (user.role === 'regional_manager') {
      // Regional manager sees own expenses and those of subordinates
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('expenses.employee_id', '=', user.id),
          eb('expenses.manager_id', '=', user.id),
          eb('employee.reporting_manager_id', '=', user.id),
        ]),
      );
    }
    // Accounts and Management see all expenses

    if (query.status) {
      baseQuery = baseQuery.where('expenses.status', '=', query.status as any);
    }

    if (query.category) {
      baseQuery = baseQuery.where('expenses.category', '=', query.category as any);
    }

    if (query.employee_id) {
      baseQuery = baseQuery.where('expenses.employee_id', '=', query.employee_id);
    }

    const orgId = query.organisation_id || (query as any).customer_id;
    if (orgId) {
      baseQuery = baseQuery.where('expenses.organisation_id', '=', orgId);
    }

    const fromDate = query.from_date || (query as any).dateFrom;
    if (fromDate) {
      baseQuery = baseQuery.where('expenses.expense_date', '>=', fromDate);
    }

    const toDate = query.to_date || (query as any).dateTo;
    if (toDate) {
      baseQuery = baseQuery.where('expenses.expense_date', '<=', toDate);
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(employee.full_name) like ${s}`,
          sql<boolean>`lower(expenses.purpose) like ${s}`,
          sql<boolean>`lower(organisations.name) like ${s}`,
        ]),
      );
    }

    return baseQuery;
  }

  async findAll(query: ExpenseFilterDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    const baseQuery = this.getBaseQuery(query, user);

    const countRes = await baseQuery
      .select(sql<number>`count(expenses.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const expenses = await baseQuery
      .select([
        'expenses.id',
        'expenses.employee_id',
        'expenses.visit_id',
        'expenses.organisation_id',
        'expenses.expense_date',
        'expenses.category',
        'expenses.amount',
        'expenses.purpose',
        'expenses.receipt_url',
        'expenses.status',
        'expenses.manager_id',
        'expenses.manager_remarks',
        'expenses.remarks',
        'expenses.created_at',
        'expenses.updated_at',
        'employee.full_name as employee_name',
        'employee.email as employee_email',
        'organisations.name as organisation_name',
        'visits.purpose as visit_purpose',
        'manager.full_name as manager_name',
      ])
      .orderBy('expenses.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(expenses, total, page, limit);
  }

  async exportExpenses(query: ExpenseFilterDto, user: AuthUser): Promise<string> {
    const records = await this.getBaseQuery(query, user)
      .select([
        'expenses.id',
        'expenses.expense_date',
        'expenses.category',
        'expenses.amount',
        'expenses.purpose',
        'expenses.status',
        'expenses.manager_remarks',
        'expenses.remarks',
        'expenses.created_at',
        'employee.full_name as employee_name',
        'employee.email as employee_email',
        'organisations.name as organisation_name',
        'visits.id as visit_id',
        'manager.full_name as manager_name',
      ])
      .orderBy('expenses.expense_date', 'desc')
      .execute();

    const headers = [
      'Expense ID',
      'Employee Name',
      'Employee Email',
      'Date',
      'Category',
      'Amount (INR)',
      'Purpose',
      'Organisation / Customer',
      'Visit Ref',
      'Approval Status',
      'Regional Manager',
      'Manager Remarks',
      'Notes / Accounts Remarks',
      'Submitted Date',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = records.map((r) => [
      escapeCsv(r.id),
      escapeCsv(r.employee_name),
      escapeCsv(r.employee_email),
      escapeCsv(r.expense_date),
      escapeCsv(r.category),
      escapeCsv(Number(r.amount).toFixed(2)),
      escapeCsv(r.purpose),
      escapeCsv(r.organisation_name || 'N/A'),
      escapeCsv(r.visit_id || 'N/A'),
      escapeCsv(r.status),
      escapeCsv(r.manager_name || 'N/A'),
      escapeCsv(r.manager_remarks || ''),
      escapeCsv(r.remarks || ''),
      escapeCsv(r.created_at),
    ]);

    return [headers.map(escapeCsv).join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  async getExpenseSummary(query: ExpenseFilterDto, user: AuthUser) {
    const base = this.getBaseQuery(query, user);

    const totals = await base
      .select([
        sql<number>`count(expenses.id)::int`.as('total_count'),
        sql<number>`coalesce(sum(expenses.amount), 0)::numeric`.as('total_amount'),
        sql<number>`coalesce(sum(case when expenses.status in ('manager_approved', 'accounts_processed') then expenses.amount else 0 end), 0)::numeric`.as('approved_amount'),
        sql<number>`coalesce(sum(case when expenses.status = 'submitted' then expenses.amount else 0 end), 0)::numeric`.as('pending_manager_amount'),
        sql<number>`coalesce(sum(case when expenses.status = 'manager_approved' then expenses.amount else 0 end), 0)::numeric`.as('pending_accounts_amount'),
      ])
      .executeTakeFirst();

    const categoryBreakdown = await this.getBaseQuery(query, user)
      .select([
        'expenses.category',
        sql<number>`count(expenses.id)::int`.as('count'),
        sql<number>`coalesce(sum(expenses.amount), 0)::numeric`.as('total_amount'),
      ])
      .groupBy('expenses.category')
      .orderBy('total_amount', 'desc')
      .execute();

    const employeeBreakdown = await this.getBaseQuery(query, user)
      .select([
        'employee.id as employee_id',
        'employee.full_name as employee_name',
        sql<number>`count(expenses.id)::int`.as('count'),
        sql<number>`coalesce(sum(expenses.amount), 0)::numeric`.as('total_amount'),
      ])
      .groupBy(['employee.id', 'employee.full_name'])
      .orderBy('total_amount', 'desc')
      .limit(10)
      .execute();

    const customerBreakdown = await this.getBaseQuery(query, user)
      .select([
        sql<string>`coalesce(organisations.name, 'General Field Expenses')`.as('organisation_name'),
        sql<number>`count(expenses.id)::int`.as('count'),
        sql<number>`coalesce(sum(expenses.amount), 0)::numeric`.as('total_amount'),
      ])
      .groupBy('organisations.name')
      .orderBy('total_amount', 'desc')
      .limit(10)
      .execute();

    return {
      metrics: {
        total_count: Number(totals?.total_count || 0),
        total_amount: Number(totals?.total_amount || 0),
        approved_amount: Number(totals?.approved_amount || 0),
        pending_manager_amount: Number(totals?.pending_manager_amount || 0),
        pending_accounts_amount: Number(totals?.pending_accounts_amount || 0),
      },
      category_breakdown: categoryBreakdown.map((c) => ({
        category: c.category,
        count: Number(c.count),
        total_amount: Number(c.total_amount),
      })),
      employee_breakdown: employeeBreakdown.map((e) => ({
        employee_id: e.employee_id,
        employee_name: e.employee_name,
        count: Number(e.count),
        total_amount: Number(e.total_amount),
      })),
      customer_breakdown: customerBreakdown.map((c) => ({
        organisation_name: c.organisation_name,
        count: Number(c.count),
        total_amount: Number(c.total_amount),
      })),
    };
  }

  async findOne(id: string) {
    const expense = await this.db
      .selectFrom('expenses')
      .innerJoin('users as employee', 'expenses.employee_id', 'employee.id')
      .leftJoin('organisations', 'expenses.organisation_id', 'organisations.id')
      .leftJoin('visits', 'expenses.visit_id', 'visits.id')
      .leftJoin('users as manager', 'expenses.manager_id', 'manager.id')
      .selectAll('expenses')
      .select([
        'employee.full_name as employee_name',
        'organisations.name as organisation_name',
        'visits.purpose as visit_purpose',
        'manager.full_name as manager_name',
      ])
      .where('expenses.id', '=', id)
      .executeTakeFirst();

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  async create(dto: CreateExpenseDto, user: AuthUser) {
    // Duplicate expense prevention
    const existing = await this.db
      .selectFrom('expenses')
      .select('id')
      .where('employee_id', '=', user.id)
      .where('expense_date', '=', dto.expense_date)
      .where('category', '=', dto.category)
      .where('amount', '=', dto.amount)
      .where('status', 'not in', ['rejected'])
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(
        'A duplicate expense claim for this date, category, and amount has already been submitted.',
      );
    }

    // Find employee's reporting manager
    const emp = await this.db
      .selectFrom('users')
      .select('reporting_manager_id')
      .where('id', '=', user.id)
      .executeTakeFirst();

    const managerId = emp?.reporting_manager_id || null;

    const expense = await this.db
      .insertInto('expenses')
      .values({
        employee_id: user.id,
        visit_id: dto.visit_id || null,
        organisation_id: dto.organisation_id || null,
        expense_date: dto.expense_date,
        category: dto.category,
        amount: dto.amount,
        purpose: dto.purpose,
        receipt_url: dto.receipt_url || null,
        status: 'submitted',
        manager_id: managerId,
        remarks: dto.remarks || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (managerId) {
      this.eventEmitter.emit(AppEvents.EXPENSE_SUBMITTED, {
        expenseId: expense.id,
        employeeId: user.id,
        employeeName: user.full_name,
        amount: Number(expense.amount),
        managerId,
      });
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense',
      entityId: expense.id,
      action: 'create',
      newValue: expense,
    });

    return expense;
  }

  async managerApprove(id: string, dto: ManagerApproveExpenseDto, user: AuthUser) {
    const expense = await this.findOne(id);

    // CRITICAL EDGE CASE: Enforce no self-approval!
    assertNotSelfApproval(user.id, expense.employee_id, 'expense approval');

    if (expense.status !== 'submitted' && expense.status !== 'clarification_required') {
      throw new BadRequestException(`Cannot approve an expense that is already in status '${expense.status}'`);
    }

    const updated = await this.db
      .updateTable('expenses')
      .set({
        status: dto.decision,
        manager_remarks: dto.manager_remarks || null,
        manager_id: user.id,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (dto.decision === 'manager_approved') {
      this.eventEmitter.emit(AppEvents.EXPENSE_MANAGER_APPROVED, {
        expenseId: id,
        employeeId: expense.employee_id,
        amount: Number(expense.amount),
      });
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense',
      entityId: id,
      action: `manager_${dto.decision}`,
      previousValue: { status: expense.status },
      newValue: { status: dto.decision, remarks: dto.manager_remarks },
    });

    return updated;
  }

  async accountsProcess(id: string, dto: AccountsProcessExpenseDto, user: AuthUser) {
    const expense = await this.findOne(id);

    if (expense.status !== 'manager_approved') {
      throw new BadRequestException('Expense must be approved by the regional manager before accounts processing.');
    }

    const updated = await this.db
      .updateTable('expenses')
      .set({
        status: dto.decision,
        remarks: dto.remarks ? `${expense.remarks || ''} | Accounts: ${dto.remarks}` : expense.remarks,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit(AppEvents.EXPENSE_PROCESSED, {
      expenseId: id,
      employeeId: expense.employee_id,
      amount: Number(expense.amount),
    });

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense',
      entityId: id,
      action: `accounts_${dto.decision}`,
      previousValue: { status: expense.status },
      newValue: { status: dto.decision },
    });

    return updated;
  }
}
