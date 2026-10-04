import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database } from '@arihant/shared';

@Injectable()
export class NotificationsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async findAll(
    userId: string,
    query?: { page?: number; limit?: number; unreadOnly?: boolean },
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 50));
    const offset = (page - 1) * limit;

    let baseQuery = this.db
      .selectFrom('notifications')
      .where('user_id', '=', userId);

    if (query?.unreadOnly) {
      baseQuery = baseQuery.where('is_read', '=', false);
    }

    const [rows, countRes] = await Promise.all([
      baseQuery
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      baseQuery
        .select(sql<number>`count(id)::int`.as('count'))
        .executeTakeFirst(),
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
}

