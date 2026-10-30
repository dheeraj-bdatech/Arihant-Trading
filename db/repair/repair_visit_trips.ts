/**
 * One-time repair: visits left on a trip (tour program) of another day.
 *
 * Before the reschedule / edit fix (VisitsService.tripForMovedVisit), moving a visit's date left it attached to the
 * trip of its old day, so the Trips screen listed it under the wrong date. This applies the same rule to those visits:
 *   1. the employee already has a trip on the visit's day → the visit joins it;
 *   2. else the visit is the only stop on a still-planned trip with no expense claims → the trip moves to the visit's
 *      day (a trip with claims happened on its day: moving it would re-date claimed / paid travel);
 *   3. else the visit leaves the trip (and, in a second pass, joins a trip that step 2 moved onto its day).
 * Cancelled visits are left alone. Every change is written to audit_log (action REPAIR_VISIT_TRIP).
 *
 * Dry run by default: the repair runs inside a transaction that is rolled back, and the planned changes are printed.
 *   pnpm --filter @arihant/api repair:visit-trips            # dry run
 *   pnpm --filter @arihant/api repair:visit-trips --apply    # write
 * Target: DATABASE_URL (apps/api/.env), else the local database. It never falls back to production.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env') });

const apply = process.argv.includes('--apply');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

interface Stale {
  visit_id: string;
  customer: string;
  employee: string | null;
  assigned_to: string;
  visit_status: string;
  visit_date: string;
  trip_id: string;
  trip_name: string;
  trip_date: string;
  trip_status: string;
}

type Action = 'join_trip' | 'move_trip' | 'leave_trip';

async function main() {
  const client = new pg.Client({ connectionString, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Visit ↔ trip date repair — ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);
  console.log(`Database: ${connectionString.replace(/:[^:@/]*@/, ':****@')}\n`);

  const sameDayTrip = async (employeeId: string, day: string, exceptTrip: string | null) =>
    (
      await client.query<{ id: string; base_location: string }>(
        `select id, base_location from trips
         where employee_id = $1 and trip_date = $2::date and status <> 'cancelled' and ($3::uuid is null or id <> $3::uuid)
         order by created_at limit 1`,
        [employeeId, day, exceptTrip],
      )
    ).rows[0];
  const audit = (entityType: string, entityId: string, previous: unknown, next: unknown) =>
    client.query(
      `insert into audit_log (actor_id, entity_type, entity_id, action, previous_value, new_value)
       values (null, $1, $2, 'REPAIR_VISIT_TRIP', $3::jsonb, $4::jsonb)`,
      [entityType, entityId, JSON.stringify(previous), JSON.stringify(next)],
    );
  const setVisitTrip = async (visitId: string, tripId: string | null, previousTrip: string | null) => {
    await client.query(`update visits set trip_id = $2, version = version + 1, updated_at = now() where id = $1`, [visitId, tripId]);
    await audit('visit', visitId, { trip_id: previousTrip }, { trip_id: tripId, reason: 'Visit date no longer matched its tour date' });
  };

  await client.query('BEGIN');
  try {
    const stale = (
      await client.query<Stale>(`
        select v.id as visit_id, o.name as customer, u.full_name as employee, v.assigned_to, v.status as visit_status,
               v.planned_date::text as visit_date, t.id as trip_id, t.base_location || ' tour' as trip_name,
               t.trip_date::text as trip_date, t.status as trip_status
        from visits v
        join trips t on t.id = v.trip_id
        left join organisations o on o.id = v.organisation_id
        left join users u on u.id = v.assigned_to
        where v.planned_date <> t.trip_date and v.status <> 'cancelled'
        order by v.planned_date, o.name`)
    ).rows;

    if (!stale.length) {
      console.log('No visits are attached to a tour of another day. Nothing to repair.');
      await client.query('ROLLBACK');
      return;
    }

    const plan: Record<string, string | number>[] = [];
    const left: Stale[] = [];
    for (const v of stale) {
      let action: Action;
      let result: string;
      const join = await sameDayTrip(v.assigned_to, v.visit_date, v.trip_id);
      if (join) {
        action = 'join_trip';
        result = `joins ${join.base_location} tour (${v.visit_date})`;
        await setVisitTrip(v.visit_id, join.id, v.trip_id);
      } else {
        const others = (await client.query<{ n: number }>(`select count(*)::int as n from visits where trip_id = $1 and id <> $2`, [v.trip_id, v.visit_id])).rows[0].n;
        const claims = (await client.query<{ n: number }>(`select count(*)::int as n from expense_claims where trip_id = $1 and deleted_at is null`, [v.trip_id])).rows[0].n;
        if (others === 0 && v.trip_status === 'planned' && claims === 0) {
          action = 'move_trip';
          result = `${v.trip_name} moves ${v.trip_date} → ${v.visit_date}`;
          await client.query(`update trips set trip_date = $2::date, updated_at = now() where id = $1`, [v.trip_id, v.visit_date]);
          await audit('trip', v.trip_id, { trip_date: v.trip_date }, { trip_date: v.visit_date, reason: `Follows its only visit (${v.customer})` });
        } else {
          action = 'leave_trip';
          result =
            others > 0
              ? `leaves ${v.trip_name} (${others} other stop${others === 1 ? '' : 's'} stay on ${v.trip_date})`
              : claims > 0
                ? `leaves ${v.trip_name} (${claims} expense claim${claims === 1 ? '' : 's'} keep it on ${v.trip_date})`
                : `leaves ${v.trip_name} (trip is ${v.trip_status})`;
          await setVisitTrip(v.visit_id, null, v.trip_id);
          left.push(v);
        }
      }
      plan.push({ customer: v.customer, employee: v.employee ?? '—', visit_status: v.visit_status, visit_date: v.visit_date, tour: v.trip_name, tour_date: v.trip_date, action, result });
    }

    // Second pass: a visit that left its tour may now have one on its own day (moved there in the first pass).
    for (const v of left) {
      const join = await sameDayTrip(v.assigned_to, v.visit_date, null);
      if (!join) continue;
      await setVisitTrip(v.visit_id, join.id, null);
      const row = plan.find((p) => p.customer === v.customer && p.visit_date === v.visit_date);
      if (row) row.result = `${row.result}; then joins ${join.base_location} tour (${v.visit_date})`;
    }

    console.table(plan);
    const remaining = (await client.query<{ n: number }>(`select count(*)::int as n from visits v join trips t on t.id = v.trip_id where v.planned_date <> t.trip_date and v.status <> 'cancelled'`)).rows[0].n;
    console.log(`\n${plan.length} visit(s) repaired; ${remaining} still on a tour of another day after the repair.`);

    if (apply) {
      await client.query('COMMIT');
      console.log('Committed. Each change is in audit_log as REPAIR_VISIT_TRIP.');
    } else {
      await client.query('ROLLBACK');
      console.log('Rolled back — nothing was written. Re-run with --apply to make these changes.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Repair failed — nothing was written:', err);
  process.exit(1);
});
