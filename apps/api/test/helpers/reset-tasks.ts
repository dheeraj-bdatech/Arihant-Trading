import { sql, type Kysely } from 'kysely';

/**
 * Module 8 tasks and recurring series can reference demos, tenders, service tickets and customers, so suites
 * that wipe those tables must clear task data first. The history tables are append-only; a purge is only
 * allowed inside a transaction that sets arihant.allow_task_purge.
 */
export async function purgeTaskModule(db: Kysely<any>) {
  await db.transaction().execute(async (trx) => {
    await sql`set local arihant.allow_task_purge = 'on'`.execute(trx);
    for (const t of ['task_attachments', 'task_updates', 'task_deadline_changes', 'task_assignment_history', 'task_escalations', 'task_notification_log']) {
      await trx.deleteFrom(t).execute();
    }
    await trx.deleteFrom('task_blockers').execute();
    await trx.deleteFrom('tasks').execute();
    await trx.deleteFrom('task_template_skips').execute();
    await trx.deleteFrom('task_templates').execute();
  });
}
