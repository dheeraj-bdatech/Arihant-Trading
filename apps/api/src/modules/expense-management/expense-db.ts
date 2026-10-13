/**
 * Module 9 reads through the shared pool, wrapped in a plugin that turns Postgres DATE values back
 * into plain 'YYYY-MM-DD' strings. The shared pool parses DATE into a JS Date at server-local
 * midnight, which shifts a day when serialised (e.g. 2026-09-15 → 2026-09-14T18:30Z); expense dates
 * must never move. Only the known DATE columns are converted — timestamps are left untouched.
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

export const EXPENSE_DB = 'EXPENSE_DB';

/** Column names (including aliases used by this module) that hold a Postgres DATE. */
const DATE_KEYS = new Set(['expense_date', 'period_from', 'period_to', 'payment_date', 'trip_date', 'planned_date', 'visit_date']);

const pad = (n: number) => String(n).padStart(2, '0');
/** pg builds a DATE as local midnight, so the local calendar fields are exactly the stored date. */
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export class DateOnlyPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const rows = args.result.rows;
    if (!rows?.length) return args.result;
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        const v = row[key];
        if (v instanceof Date && DATE_KEYS.has(key)) row[key] = toDateString(v);
      }
    }
    return args.result;
  }
}

export function createExpenseDb(shared: Kysely<Database>): Kysely<Database> {
  return shared.withPlugin(new DateOnlyPlugin());
}
