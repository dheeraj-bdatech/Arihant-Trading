import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { DEFAULT_COMMAND_LAYOUT, normaliseCommandLayout, type CommandLayout, type Database } from '@arihant/shared';

const COMMAND_BOARD = 'command';
const LAYOUT_FIELDS = ['sections', 'period', 'only_exceptions'];

/**
 * Each person's own layout of the Management Command dashboard (Module 10): which sections and figures they see, in
 * which order, over which results period. A preference, not business data — no audit entry, and no row until saved.
 */
@Injectable()
export class DashboardLayoutService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async get(userId: string): Promise<CommandLayout> {
    const row = await this.db
      .selectFrom('dashboard_layouts')
      .select('layout')
      .where('user_id', '=', userId)
      .where('board', '=', COMMAND_BOARD)
      .executeTakeFirst();
    return row ? normaliseCommandLayout(row.layout) : normaliseCommandLayout(DEFAULT_COMMAND_LAYOUT);
  }

  /**
   * Saves what is valid of `layout` (see normaliseCommandLayout) and returns it. A partial layout (only `period`, say)
   * changes just that part of the saved one; a body with no layout field is refused rather than resetting anything.
   */
  async save(userId: string, layout: unknown): Promise<CommandLayout> {
    const patch = layout && typeof layout === 'object' && !Array.isArray(layout) ? (layout as Record<string, unknown>) : null;
    if (!patch || !LAYOUT_FIELDS.some((k) => k in patch)) {
      throw new BadRequestException(`Send the layout to save: ${LAYOUT_FIELDS.join(', ')}.`);
    }
    const clean = normaliseCommandLayout({ ...(await this.get(userId)), ...patch });
    await this.db
      .insertInto('dashboard_layouts')
      .values({ user_id: userId, board: COMMAND_BOARD, layout: JSON.stringify(clean) })
      .onConflict((oc) => oc.columns(['user_id', 'board']).doUpdateSet({ layout: JSON.stringify(clean), updated_at: new Date() }))
      .execute();
    return clean;
  }

  /** Back to the default layout. */
  async reset(userId: string): Promise<CommandLayout> {
    await this.db.deleteFrom('dashboard_layouts').where('user_id', '=', userId).where('board', '=', COMMAND_BOARD).execute();
    return normaliseCommandLayout(DEFAULT_COMMAND_LAYOUT);
  }
}
