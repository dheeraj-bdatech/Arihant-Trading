import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import type { Database, PaginatedResult } from '@arihant/shared';
import type { CreateOrganisationDto, UpdateOrganisationDto } from './organisations.dto.js';

@Injectable()
export class OrganisationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    sector?: string;
    zone_id?: string;
    region_id?: string;
  }): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('organisations')
      .leftJoin('zones', 'organisations.zone_id', 'zones.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id')
      // the "Unverified Portal Customer" placeholder is plumbing, not a customer
      .where('organisations.id', '<>', '00000000-0000-4000-8000-0000000000a1');

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(coalesce(organisations.city, '')) like ${s}`,
          sql<boolean>`lower(coalesce(organisations.state, '')) like ${s}`,
          sql<boolean>`lower(coalesce(organisations.sector, '')) like ${s}`,
        ]),
      );
    }

    if (query.sector) {
      baseQuery = baseQuery.where('organisations.sector', '=', query.sector);
    }

    if (query.zone_id) {
      baseQuery = baseQuery.where('organisations.zone_id', '=', query.zone_id);
    }

    if (query.region_id) {
      baseQuery = baseQuery.where('organisations.region_id', '=', query.region_id);
    }

    const countRes = await baseQuery
      .select(sql<number>`count(distinct organisations.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const orgs = await baseQuery
      .select([
        'organisations.id',
        'organisations.name',
        'organisations.sector',
        'organisations.is_govt',
        'organisations.city',
        'organisations.state',
        'organisations.address',
        'organisations.zone_id',
        'organisations.region_id',
        'organisations.created_at',
        'organisations.updated_at',
        'zones.name as zone_name',
        'zones.code as zone_code',
        'regions.name as region_name',
      ])
      .orderBy('organisations.name', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Attach primary contact and current lead summary to each org
    const orgIds = orgs.map((o) => o.id);
    let primaryContacts: any[] = [];
    let leadSummaries: any[] = [];

    if (orgIds.length > 0) {
      primaryContacts = await this.db
        .selectFrom('contacts')
        .selectAll()
        .where('organisation_id', 'in', orgIds)
        .where('is_primary', '=', true)
        .execute();

      leadSummaries = await this.db
        .selectFrom('leads')
        .leftJoin('users', 'leads.assigned_to', 'users.id')
        .select([
          'leads.organisation_id',
          'leads.lead_status',
          'leads.status',
          'leads.last_interaction_at',
          'leads.next_followup_at',
          'users.full_name as assigned_salesperson_name',
        ])
        .where('leads.organisation_id', 'in', orgIds)
        .orderBy('leads.created_at', 'desc')
        .execute();
    }

    const enrichedOrgs = orgs.map((org) => {
      const primaryContact = primaryContacts.find((c) => c.organisation_id === org.id);
      const latestLead = leadSummaries.find((l) => l.organisation_id === org.id);
      return {
        ...org,
        primary_contact: primaryContact || null,
        current_salesperson: latestLead?.assigned_salesperson_name || null,
        lead_status: latestLead?.lead_status || latestLead?.status || null,
        last_interaction_at: latestLead?.last_interaction_at || null,
        next_followup_at: latestLead?.next_followup_at || null,
      };
    });

    return buildPaginatedResult(enrichedOrgs, total, page, limit);
  }

  async findOne(id: string) {
    const org = await this.db
      .selectFrom('organisations')
      .leftJoin('zones', 'organisations.zone_id', 'zones.id')
      .leftJoin('regions', 'organisations.region_id', 'regions.id')
      .leftJoin('users as creator', 'organisations.created_by', 'creator.id')
      .selectAll('organisations')
      .select([
        'zones.name as zone_name',
        'regions.name as region_name',
        'creator.full_name as created_by_name',
      ])
      .where('organisations.id', '=', id)
      .executeTakeFirst();

    if (!org) {
      throw new NotFoundException(`Organisation with id '${id}' not found`);
    }

    const contacts = await this.db
      .selectFrom('contacts')
      .selectAll()
      .where('organisation_id', '=', id)
      .orderBy('is_primary', 'desc')
      .orderBy('full_name', 'asc')
      .execute();

    const leadsCount = await this.db
      .selectFrom('leads')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('organisation_id', '=', id)
      .executeTakeFirst();

    const tendersCount = await this.db
      .selectFrom('tenders')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('organisation_id', '=', id)
      .executeTakeFirst();

    return {
      ...org,
      contacts,
      totalLeads: leadsCount?.count || 0,
      totalTenders: tendersCount?.count || 0,
    };
  }

  async getTimeline(orgId: string) {
    const org = await this.findOne(orgId);

    // 1. Fetch all interactions
    const interactions = await this.db
      .selectFrom('interactions')
      .leftJoin('contacts', 'interactions.contact_id', 'contacts.id')
      .leftJoin('users', 'interactions.employee_id', 'users.id')
      .leftJoin('leads', 'interactions.lead_id', 'leads.id')
      .selectAll('interactions')
      .select([
        'contacts.full_name as contact_name',
        'users.full_name as employee_name',
        'leads.lead_status',
        'leads.lead_type',
      ])
      .where('interactions.organisation_id', '=', orgId)
      .orderBy('interactions.occurred_on', 'desc')
      .orderBy('interactions.created_at', 'desc')
      .execute();

    const interactionIds = interactions.map((i) => i.id);
    let attachments: any[] = [];
    if (interactionIds.length > 0) {
      attachments = await this.db
        .selectFrom('interaction_attachments')
        .selectAll()
        .where('interaction_id', 'in', interactionIds)
        .execute();
    }

    const enrichedInteractions = interactions.map((item) => ({
      ...item,
      attachments: attachments.filter((a) => a.interaction_id === item.id),
    }));

    // 2. Fetch all leads under this organisation
    const leads = await this.db
      .selectFrom('leads')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .leftJoin('users as assignee', 'leads.assigned_to', 'assignee.id')
      .selectAll('leads')
      .select([
        'products.name as product_name',
        'assignee.full_name as assignee_name',
      ])
      .where('leads.organisation_id', '=', orgId)
      .orderBy('leads.created_at', 'desc')
      .execute();

    // 3. Fetch salesperson assignment history across all leads of this organisation
    const leadIds = leads.map((l) => l.id);
    let assignmentHistory: any[] = [];
    if (leadIds.length > 0) {
      assignmentHistory = await this.db
        .selectFrom('lead_assignment_history')
        .leftJoin('users as prev_sales', 'lead_assignment_history.previous_salesperson_id', 'prev_sales.id')
        .leftJoin('users as new_sales', 'lead_assignment_history.new_salesperson_id', 'new_sales.id')
        .leftJoin('users as changer', 'lead_assignment_history.changed_by', 'changer.id')
        .selectAll('lead_assignment_history')
        .select([
          'prev_sales.full_name as previous_salesperson_name',
          'new_sales.full_name as new_salesperson_name',
          'changer.full_name as changed_by_name',
        ])
        .where('lead_assignment_history.lead_id', 'in', leadIds)
        .orderBy('lead_assignment_history.changed_at', 'desc')
        .execute();
    }

    // 4. Fetch follow-ups
    const followUps = await this.db
      .selectFrom('follow_ups')
      .leftJoin('users as assignee', 'follow_ups.assigned_to', 'assignee.id')
      .selectAll('follow_ups')
      .select('assignee.full_name as assigned_to_name')
      .where('follow_ups.organisation_id', '=', orgId)
      .orderBy('follow_ups.due_date', 'asc')
      .execute();

    // 5. Fetch tenders
    const tenders = await this.db
      .selectFrom('tenders')
      .select(['id', 'tender_no', 'status', 'estimated_value', 'bid_closing_date'])
      .where('organisation_id', '=', orgId)
      .orderBy('created_at', 'desc')
      .execute();

    // 6. Fetch proposals
    const proposals = await this.db
      .selectFrom('proposals')
      .select(['id', 'proposal_number', 'reference', 'status', 'next_followup'])
      .where('organisation_id', '=', orgId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .execute();

    // 7. Product interests across all leads (from lead_product_interests + products)
    let productInterestsList: any[] = [];
    if (leadIds.length > 0) {
      productInterestsList = await this.db
        .selectFrom('lead_product_interests')
        .innerJoin('products', 'lead_product_interests.product_id', 'products.id')
        .select(['products.id', 'products.name', 'products.category'])
        .where('lead_product_interests.lead_id', 'in', leadIds)
        .distinct()
        .execute();
    }
    const leadProductNames = leads.map((l) => l.product_name).filter(Boolean);
    const allProductNames = Array.from(
      new Set([...productInterestsList.map((p) => p.name), ...leadProductNames]),
    );

    // 8. Previous Meetings (Physical visits, demonstrations, in-person discussions)
    const meetings = enrichedInteractions.filter((i) =>
      ['physical_visit', 'demo', 'meeting'].includes((i.type || '').toLowerCase()),
    );

    // 9. First and Latest interaction
    const latestInteraction = enrichedInteractions.length > 0 ? enrichedInteractions[0] : null;
    const firstInteraction =
      enrichedInteractions.length > 0
        ? enrichedInteractions[enrichedInteractions.length - 1]
        : null;

    // 10. Current vs Previous Salesperson
    const currentSalesperson = leads[0]?.assignee_name || (org as any).created_by_name || 'Unassigned';

    // 11. Follow-up history metrics
    const today = new Date().toISOString().split('T')[0];
    const followUpHistory = {
      total: followUps.length,
      pending: followUps.filter((f) => f.status === 'pending').length,
      completed: followUps.filter((f) => f.status === 'completed').length,
      overdue: followUps.filter((f) => f.status === 'pending' && f.due_date < today).length,
      due_today: followUps.filter((f) => f.status === 'pending' && f.due_date === today).length,
      items: followUps,
    };

    // 12. Current opportunity status across leads
    const activeOpportunities = leads.map((l) => ({
      id: l.id,
      product_name: l.product_name || 'Procurement Opportunity',
      status: l.lead_status || l.status || 'new',
      lead_type: l.lead_type || 'fresh',
      value_lakh: l.value_lakh,
      assigned_salesperson: l.assignee_name,
      next_followup_date: l.next_followup_date,
      last_interaction_date: l.last_contact_date,
      created_at: l.created_at,
    }));

    const managementSummary = {
      first_interaction: firstInteraction,
      latest_interaction: latestInteraction,
      previous_meetings: meetings,
      product_interests: allProductNames,
      current_salesperson: currentSalesperson,
      previous_salespersons: assignmentHistory,
      follow_up_history: followUpHistory,
      current_opportunity_status: activeOpportunities,
    };

    return {
      organisation: org,
      contacts: org.contacts,
      leads,
      timeline: enrichedInteractions,
      assignment_history: assignmentHistory,
      follow_ups: followUps,
      tenders,
      proposals,
      management_summary: managementSummary,
    };
  }

  async checkDuplicate(params: { name?: string; email?: string; phone?: string }) {
    const matches: any[] = [];
    const matchedOrgs = new Map<string, any>();

    // 1. Match by name
    if (params.name && params.name.trim()) {
      const cleanName = params.name.trim().toLowerCase();
      const s = `%${cleanName}%`;
      const nameMatches = await this.db
        .selectFrom('organisations')
        .select(['id', 'name', 'city', 'state', 'sector'])
        .where(sql<boolean>`lower(name) like ${s}`)
        .limit(5)
        .execute();

      for (const m of nameMatches) {
        matchedOrgs.set(m.id, { ...m, matchReason: `Name match (${m.name})` });
      }
    }

    // 2. Match by email in contacts
    if (params.email && params.email.trim()) {
      const cleanEmail = params.email.trim().toLowerCase();
      const emailMatches = await this.db
        .selectFrom('contacts')
        .innerJoin('organisations', 'contacts.organisation_id', 'organisations.id')
        .select([
          'organisations.id',
          'organisations.name',
          'organisations.city',
          'organisations.state',
          'organisations.sector',
          'contacts.full_name as contact_name',
          'contacts.email as contact_email',
        ])
        .where(sql<boolean>`lower(contacts.email) = ${cleanEmail}`)
        .limit(5)
        .execute();

      for (const m of emailMatches) {
        if (!matchedOrgs.has(m.id)) {
          matchedOrgs.set(m.id, {
            id: m.id,
            name: m.name,
            city: m.city,
            state: m.state,
            sector: m.sector,
            matchReason: `Contact email match (${m.contact_email} - ${m.contact_name})`,
          });
        }
      }
    }

    // 3. Match by phone/mobile in contacts
    if (params.phone && params.phone.trim()) {
      const cleanPhone = params.phone.trim();
      const phoneMatches = await this.db
        .selectFrom('contacts')
        .innerJoin('organisations', 'contacts.organisation_id', 'organisations.id')
        .select([
          'organisations.id',
          'organisations.name',
          'organisations.city',
          'organisations.state',
          'organisations.sector',
          'contacts.full_name as contact_name',
          'contacts.mobile as contact_mobile',
        ])
        .where('contacts.mobile', '=', cleanPhone)
        .limit(5)
        .execute();

      for (const m of phoneMatches) {
        if (!matchedOrgs.has(m.id)) {
          matchedOrgs.set(m.id, {
            id: m.id,
            name: m.name,
            city: m.city,
            state: m.state,
            sector: m.sector,
            matchReason: `Contact mobile match (${m.contact_mobile} - ${m.contact_name})`,
          });
        }
      }
    }

    const results = Array.from(matchedOrgs.values());
    return {
      matches: results,
      isDuplicate: results.length > 0,
      suggestion:
        results.length > 0
          ? 'Organisation already exists. Existing account detected. You can link this lead to the existing organisation to preserve historical timeline continuity.'
          : null,
    };
  }

  async create(dto: CreateOrganisationDto, actorId: string) {
    const name = dto.name.trim();

    // B2G Deduplication (§6, §7): return existing organisation if name and city match
    const existing = await this.db
      .selectFrom('organisations')
      .selectAll()
      .where(sql`lower(trim(name))`, '=', name.toLowerCase())
      .where((eb) => {
        if (dto.city) {
          return eb(sql`lower(trim(coalesce(city, '')))`, '=', dto.city.trim().toLowerCase());
        }
        return eb.val(true);
      })
      .executeTakeFirst();

    if (existing) {
      return existing;
    }

    const org = await this.db
      .insertInto('organisations')
      .values({
        name,
        sector: dto.sector || null,
        is_govt: dto.is_govt !== undefined ? dto.is_govt : true,
        city: dto.city || null,
        state: dto.state || null,
        address: dto.address || null,
        zone_id: dto.zone_id || null,
        region_id: dto.region_id || null,
        created_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId,
      entityType: 'organisation',
      entityId: org.id,
      action: 'create',
      newValue: org,
    });

    return org;
  }

  async update(id: string, dto: UpdateOrganisationDto, actorId: string) {
    const existing = await this.findOne(id);

    const updated = await this.db
      .updateTable('organisations')
      .set({
        ...dto,
        name: dto.name ? dto.name.trim() : undefined,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId,
      entityType: 'organisation',
      entityId: id,
      action: 'update',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }
}
