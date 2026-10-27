import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { createHash, randomBytes } from 'crypto';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { AppEvents } from '../../common/events/event-names.js';
import { LeadsService } from './leads.service.js';
import type { AuthUser, Database, LeadChatLinkDto, LeadChatViewDto } from '@arihant/shared';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** A link token as minted below (24 random bytes, base64url); anything else is not looked up. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const NOT_FOUND = 'This chat link is no longer active. Ask your Arihant contact for a new link.';

/** Per-IP request budgets for the public page, per 10 minutes (the page polls every few seconds while open). */
const VIEW_LIMIT = 200;
const POST_LIMIT = 30;
/** A customer may send this many messages per hour on one lead. */
const CUSTOMER_MESSAGES_PER_HOUR = 20;

/**
 * Customer live chat on a lead. The team shares a private link; whoever holds it reads and writes the lead's
 * customer-facing messages without logging in, and never sees team-only ones. Only the token's hash is stored, so a
 * link is shown once when made: sharing it again means making a new one, which retires the old link.
 */
@Injectable()
export class LeadChatService {
  private readonly hits = new Map<string, number[]>();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly leads: LeadsService,
  ) {}

  // ---------------------------------------------------------------- team side --

  async getLink(leadId: string, user: AuthUser): Promise<LeadChatLinkDto> {
    await this.leads.findVisibleLeadId(leadId, user);
    const link = await this.db
      .selectFrom('lead_chat_links')
      .leftJoin('users', 'lead_chat_links.created_by', 'users.id')
      .select(['lead_chat_links.created_at', 'lead_chat_links.revoked_at', 'users.full_name as created_by_name'])
      .where('lead_chat_links.lead_id', '=', leadId)
      .executeTakeFirst();
    const active = Boolean(link && !link.revoked_at);
    return {
      active,
      created_at: active ? new Date(link!.created_at as any).toISOString() : null,
      created_by_name: active ? link!.created_by_name : null,
    };
  }

  /** Makes the lead's chat link, or replaces it (the previous link stops working). The URL is returned only here. */
  async createLink(leadId: string, user: AuthUser): Promise<LeadChatLinkDto> {
    await this.leads.findVisibleLeadId(leadId, user);
    const token = randomBytes(24).toString('base64url');
    const now = new Date();

    await this.db
      .insertInto('lead_chat_links')
      .values({ lead_id: leadId, token_hash: sha256(token), created_by: user.id, created_at: now })
      .onConflict((oc) =>
        oc.column('lead_id').doUpdateSet({
          token_hash: sha256(token),
          created_by: user.id,
          created_at: now,
          revoked_at: null,
          revoked_by: null,
        }),
      )
      .execute();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'lead',
      entityId: leadId,
      action: 'chat_link_created',
      newValue: { created_at: now.toISOString() },
    });

    return {
      active: true,
      created_at: now.toISOString(),
      created_by_name: user.full_name,
      url_path: `/lead-chat?token=${token}`,
    };
  }

  /** Turns the link off; the customer's messages stay in the lead's conversation. */
  async revokeLink(leadId: string, user: AuthUser): Promise<LeadChatLinkDto> {
    await this.leads.findVisibleLeadId(leadId, user);
    const revoked = await this.db
      .updateTable('lead_chat_links')
      .set({ revoked_at: new Date(), revoked_by: user.id })
      .where('lead_id', '=', leadId)
      .where('revoked_at', 'is', null)
      .returning('id')
      .executeTakeFirst();

    if (revoked) {
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'lead',
        entityId: leadId,
        action: 'chat_link_revoked',
      });
    }
    return { active: false, created_at: null, created_by_name: null };
  }

  // -------------------------------------------------------------- public side --

  async view(token: string, ip: string): Promise<LeadChatViewDto> {
    this.guard(`view:${ip}`, VIEW_LIMIT);
    const lead = await this.findLeadByToken(token);

    const messages = await this.db
      .selectFrom('lead_messages')
      .leftJoin('users', 'lead_messages.author_id', 'users.id')
      .select([
        'lead_messages.id',
        'lead_messages.body',
        'lead_messages.from_customer',
        'lead_messages.customer_name',
        'lead_messages.created_at',
        'users.full_name as author_name',
      ])
      .where('lead_messages.lead_id', '=', lead.id)
      .where('lead_messages.audience', '=', 'customer')
      .orderBy('lead_messages.created_at', 'asc')
      .execute();

    return {
      organisation_name: lead.organisation_name,
      product_name: lead.product_name,
      owner_name: lead.owner_name,
      customer_name: lead.contact_name,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        from_customer: m.from_customer,
        sender_name: m.from_customer ? m.customer_name || 'Customer' : `${m.author_name || 'Arihant team'} · Arihant`,
        created_at: new Date(m.created_at as any).toISOString(),
      })),
    };
  }

  async post(token: string, body: string, ip: string) {
    this.guard(`post:${ip}`, POST_LIMIT);
    const lead = await this.findLeadByToken(token);
    const text = body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

    const recent = await this.db
      .selectFrom('lead_messages')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('lead_id', '=', lead.id)
      .where('from_customer', '=', true)
      .where('created_at', '>', new Date(Date.now() - 3600_000))
      .executeTakeFirst();
    if ((recent?.n ?? 0) >= CUSTOMER_MESSAGES_PER_HOUR) {
      this.tooMany('You have sent many messages in the last hour. The Arihant team will reply soon.', 3600);
    }

    const message = await this.db
      .insertInto('lead_messages')
      .values({
        lead_id: lead.id,
        author_id: null,
        body: text,
        audience: 'customer',
        from_customer: true,
        customer_name: lead.contact_name,
      })
      .returning(['id', 'body', 'customer_name', 'created_at'])
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit(AppEvents.LEAD_MESSAGE_POSTED, {
      leadId: lead.id,
      fromCustomer: true,
      ownerId: lead.assigned_to,
      regionalManagerId: lead.regional_manager_id,
      organisationName: lead.organisation_name,
      customerName: lead.contact_name,
      excerpt: text.slice(0, 160),
    });

    return {
      id: message.id,
      body: message.body,
      from_customer: true,
      sender_name: message.customer_name || 'Customer',
      created_at: new Date(message.created_at as any).toISOString(),
    };
  }

  private async findLeadByToken(token: string) {
    const t = String(token || '').trim();
    if (!TOKEN_PATTERN.test(t)) throw new NotFoundException(NOT_FOUND);

    const lead = await this.db
      .selectFrom('lead_chat_links')
      .innerJoin('leads', 'lead_chat_links.lead_id', 'leads.id')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .leftJoin('contacts', 'leads.primary_contact_id', 'contacts.id')
      .leftJoin('users as owner', 'leads.assigned_to', 'owner.id')
      .select([
        'leads.id',
        'leads.assigned_to',
        'leads.regional_manager_id',
        'organisations.name as organisation_name',
        'products.name as product_name',
        'contacts.full_name as contact_name',
        'owner.full_name as owner_name',
      ])
      .where('lead_chat_links.token_hash', '=', sha256(t))
      .where('lead_chat_links.revoked_at', 'is', null)
      .executeTakeFirst();

    if (!lead) throw new NotFoundException(NOT_FOUND);
    return lead;
  }

  private guard(key: string, limit: number) {
    const now = Date.now();
    const hits = (this.hits.get(key) || []).filter((t) => now - t < 10 * 60_000);
    if (hits.length >= limit) this.tooMany('Too many requests. Please wait a few minutes and try again.', 600);
    hits.push(now);
    this.hits.set(key, hits);
    if (this.hits.size > 5000) this.hits.clear();
  }

  private tooMany(message: string, retryAfterSeconds: number): never {
    throw new HttpException(
      { statusCode: 429, message, retry_after_seconds: retryAfterSeconds, error: 'Too Many Requests' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
