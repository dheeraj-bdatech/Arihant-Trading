import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { EXPENSE_DB, createExpenseDb } from './expense-db.js';
import { EXPENSE_CONFIG, loadExpenseConfig } from './expense.config.js';
import { ExpenseClaimsService } from './expense-claims.service.js';
import { ExpenseWorkflowService } from './expense-workflow.service.js';
import { ExpenseAttachmentsService } from './expense-attachments.service.js';
import { ExpenseReportsService } from './expense-reports.service.js';
import { ExpenseImportService } from './expense-import.service.js';
import { ExpenseMastersService } from './expense-masters.service.js';
import { ExpenseNotificationsListener } from './expense-notifications.listener.js';
import {
  ExpenseAttachmentsController,
  ExpenseCategoriesController,
  ExpenseClaimsController,
  ExpenseReportsController,
  ProjectsController,
} from './expense-management.controller.js';

/** Module 9 — Standardised Expense Management (claims, two-level approval, Tally export). */
@Module({
  controllers: [
    ExpenseCategoriesController,
    ProjectsController,
    ExpenseClaimsController,
    ExpenseAttachmentsController,
    ExpenseReportsController,
  ],
  providers: [
    { provide: EXPENSE_CONFIG, useFactory: () => loadExpenseConfig() },
    { provide: EXPENSE_DB, inject: [KYSELY_DB], useFactory: (db: Kysely<Database>) => createExpenseDb(db) },
    ExpenseClaimsService,
    ExpenseWorkflowService,
    ExpenseAttachmentsService,
    ExpenseReportsService,
    ExpenseImportService,
    ExpenseMastersService,
    ExpenseNotificationsListener,
  ],
  exports: [ExpenseClaimsService, ExpenseReportsService],
})
export class ExpenseManagementModule {}
