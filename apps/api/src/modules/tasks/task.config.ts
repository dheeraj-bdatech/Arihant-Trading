import path from 'path';

/** Module 8 tunables. All optional env vars; business thresholds live in the task_settings table (admin UI). */
export interface TaskConfig {
  storageDir: string;
  maxFileBytes: number;
  maxFilesPerTask: number;
  /** Lower-case extensions accepted for task documents; content is also sniffed server-side. */
  allowedExtensions: string[];
  /** Scheduled jobs (generator, overdue, reminders, SLA, digest). Off by default under NODE_ENV=test. */
  jobsEnabled: boolean;
  /** Missed recurring occurrences older than this are not back-filled after downtime. */
  catchUpMaxDays: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function loadTaskConfig(env: NodeJS.ProcessEnv = process.env): TaskConfig {
  const jobsFlag = env.TASK_JOBS_ENABLED;
  return {
    storageDir: path.resolve(env.TASK_STORAGE_DIR || path.join(process.cwd(), 'storage', 'task-files')),
    maxFileBytes: num(env.TASK_MAX_FILE_MB, 10) * 1024 * 1024,
    maxFilesPerTask: num(env.TASK_MAX_FILES, 10),
    allowedExtensions: (env.TASK_ALLOWED_FILE_TYPES || 'pdf,doc,docx,xls,xlsx,jpg,jpeg,png')
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
    jobsEnabled: jobsFlag === undefined || jobsFlag === '' ? env.NODE_ENV !== 'test' : jobsFlag === 'true',
    catchUpMaxDays: num(env.TASK_CATCHUP_MAX_DAYS, 31),
  };
}

export const TASK_CONFIG = 'TASK_CONFIG';
