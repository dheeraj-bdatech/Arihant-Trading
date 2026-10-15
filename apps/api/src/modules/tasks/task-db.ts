/**
 * Module 8 reads through the shared pool with a plugin that keeps Postgres DATE columns as plain
 * 'YYYY-MM-DD' strings (the shared pool turns them into server-local midnight Dates, which shift a day
 * when serialised). Timestamps are untouched. Same approach as Module 9's expense-db.ts.
 */
import type {
  Kysely,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';
import type { Database } from '@arihant/shared';

export const TASK_DB = 'TASK_DB';

const DATE_KEYS = new Set([
  'start_date',
  'end_date',
  'occurrence_date',
  'last_generated_until',
  'holiday_date',
  'from_date',
  'to_date',
  'period_from',
  'period_to',
  'expected_resolution_date',
]);

const pad = (n: number) => String(n).padStart(2, '0');
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

class TaskDateOnlyPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    for (const row of args.result.rows || []) {
      for (const key of Object.keys(row)) {
        const v = row[key];
        if (v instanceof Date && DATE_KEYS.has(key)) row[key] = toDateString(v);
      }
    }
    return args.result;
  }
}

export function createTaskDb(shared: Kysely<Database>): Kysely<Database> {
  return shared.withPlugin(new TaskDateOnlyPlugin());
}
