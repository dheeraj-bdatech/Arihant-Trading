import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database } from '@arihant/shared';

/** Category keywords in precedence order — must match the notifications page badges. */
const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['tender', ['tender']],
  ['proposal', ['proposal']],
  ['lead', ['lead']],
  ['task', ['task', 'blocker']],
  ['expense', ['expense']],
  ['delivery', ['delivery']],
];

/** SQL CASE giving a notification's category from its type (first keyword wins, else 'system'). */
function categorySql() {
  const whens = CATEGORY_KEYWORDS.map(
    ([cat, words]) => sql`when ${sql.join(words.map((w) => sql`lower(type) like ${`%${w}%`}`), sql` or `)} then ${cat}`,
  );
  return sql`(case ${sql.join(whens, sql` `)} else 'system' end)`;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * Inbox page (DEF-106). Filters run on the server so counts and lists agree with the header bell however many
   * notifications a user has: `status` all | unread | read (read = dismissed / archived), `category` (same keyword
   * precedence as the page badges), `search` over title / body / type. Paged; `total` is the filtered count.
   */
  async findAll(
    userId: string,
    query?: { page?: number; limit?: number; unreadOnly?: boolean; status?: string; category?: string; search?: string },
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 50));
    const offset = (page - 1) * limit;
    const status = query?.unreadOnly ? 'unread' : query?.status === 'unread' || query?.status === 'read' ? query.status : 'all';
    const category = query?.category && CATEGORY_KEYWORDS.some(([c]) => c === query.category) ? query.category : null;
    const search = (query?.search || '').trim().toLowerCase().slice(0, 100);

    let baseQuery = this.db.selectFrom('notifications').where('user_id', '=', userId);
    if (status === 'unread') baseQuery = baseQuery.where('is_read', '=', false);
    if (status === 'read') baseQuery = baseQuery.where('is_read', '=', true);
    if (category) baseQuery = baseQuery.where(sql<boolean>`${categorySql()} = ${category}`);
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      baseQuery = baseQuery.where(
        sql<boolean>`(lower(title) like ${like} or lower(coalesce(body, '')) like ${like} or lower(type) like ${like})`,
      );
    }

    const [rows, countRes] = await Promise.all([
      baseQuery.selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).offset(offset).execute(),
      baseQuery.select(sql<number>`count(id)::int`.as('count')).executeTakeFirst(),
    ]);

    const total = Number(countRes?.count || 0);
    const data = rows.map((r) => ({
      ...r,
      message: (r as any).message || r.body || '',
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Counts for the inbox filters and the header bell — all, unread, read and per category (DEF-106). */
  async getSummary(userId: string) {
    const rows = await this.db
      .selectFrom('notifications')
      .select([
        sql<string>`${categorySql()}`.as('category'),
        sql<number>`count(id)::int`.as('all'),
        sql<number>`count(id) filter (where is_read = false)::int`.as('unread'),
      ])
      .where('user_id', '=', userId)
      .groupBy(sql`1`)
      .execute();
    const byType: Record<string, number> = {};
    const unreadByType: Record<string, number> = {};
    let all = 0;
    let unread = 0;
    for (const r of rows) {
      byType[r.category] = Number(r.all) || 0;
      unreadByType[r.category] = Number(r.unread) || 0;
      all += Number(r.all) || 0;
      unread += Number(r.unread) || 0;
    }
    return { all, unread, read: all - unread, count: unread, unreadCount: unread, byType, unreadByType };
  }

  async getUnreadCount(userId: string) {
    const res = await this.db
      .selectFrom('notifications')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('is_read', '=', false)
      .executeTakeFirst();

    const count = Number(res?.count || 0);
    return {
      count,
      unreadCount: count,
    };
  }

  async markAsRead(id: string, userId: string) {
    const updated = await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();

    const unread = await this.getUnreadCount(userId);
    return {
      ...updated,
      ...unread,
    };
  }

  async markAllAsRead(userId: string) {
    await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('user_id', '=', userId)
      .where('is_read', '=', false)
      .execute();

    return { success: true, count: 0, unreadCount: 0 };
  }

  async create(data: {
    userId: string;
    type?: string;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string;
  }) {
    const res = await this.db
      .insertInto('notifications')
      .values({
        user_id: data.userId,
        type: data.type || 'system',
        title: data.title,
        body: data.body,
        entity_type: data.entityType || null,
        entity_id: data.entityId || null,
        is_read: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return res;
  }
}

