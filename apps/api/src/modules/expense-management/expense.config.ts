import path from 'path';

/** Module 9 tunables. All are optional env vars; defaults follow the business brief. */
export interface ExpenseConfig {
  /** Upper sanity limit per line item (₹). */
  maxItemAmount: number;
  /** Items older than this many days need a late-submission remark. */
  lateSubmissionDays: number;
  /** Allowed slack (days) around a trip/visit date for item dates. */
  tripDateToleranceDays: number;
  allowedMimeTypes: string[];
  maxFileBytes: number;
  maxFilesPerItem: number;
  storageDir: string;
  /** Role used to resolve an approver when the employee has no usable manager. */
  fallbackApproverRole: 'management' | 'admin';
  /** Claims pending longer than this trigger the daily reminder. */
  reminderAfterDays: number;
  /** Row count above which exports stream in batches instead of a single query. */
  exportBatchSize: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function loadExpenseConfig(env: NodeJS.ProcessEnv = process.env): ExpenseConfig {
  return {
    maxItemAmount: num(env.EXPENSE_MAX_ITEM_AMOUNT, 1_000_000),
    lateSubmissionDays: num(env.EXPENSE_LATE_SUBMISSION_DAYS, 90),
    tripDateToleranceDays: num(env.EXPENSE_TRIP_DATE_TOLERANCE_DAYS, 1),
    allowedMimeTypes: (env.EXPENSE_ALLOWED_MIME_TYPES || 'application/pdf,image/jpeg,image/png,image/heic')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    maxFileBytes: num(env.EXPENSE_MAX_FILE_MB, 10) * 1024 * 1024,
    maxFilesPerItem: num(env.EXPENSE_MAX_FILES_PER_ITEM, 5),
    storageDir: path.resolve(env.EXPENSE_STORAGE_DIR || path.join(process.cwd(), 'storage', 'expense-receipts')),
    fallbackApproverRole: env.EXPENSE_FALLBACK_APPROVER_ROLE === 'admin' ? 'admin' : 'management',
    reminderAfterDays: num(env.EXPENSE_REMINDER_AFTER_DAYS, 3),
    exportBatchSize: num(env.EXPENSE_EXPORT_BATCH_SIZE, 1000),
  };
}

export const EXPENSE_CONFIG = 'EXPENSE_CONFIG';
