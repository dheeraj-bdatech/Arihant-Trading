import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import {
  PORTAL_LIMITS,
  PORTAL_PROBLEM_CATEGORIES,
  PORTAL_STATES,
  PORTAL_URGENCY_OPTIONS,
  PUBLIC_STATUS_LABELS,
  SERVICE_DONE_STATUSES,
  SERVICE_SLA_PAUSE_STATUSES,
  normalizeServiceStatus,
  type Database,
  type ServiceStatus,
} from '@arihant/shared';
import { ServiceService } from './service.service.js';
import { cleanText, computeSla, generateTicketNo, getServiceSetting } from './service.core.js';
import type { PortalServiceRequestDto, PortalFeedbackDto } from './service-portal.dto.js';

export const UNVERIFIED_ORG_ID = '00000000-0000-4000-8000-0000000000a1';

const STOP_WORDS = new Set([
  'the', 'of', 'and', 'office', 'hq', 'headquarters', 'head', 'quarters', 'quarter', 'dept', 'department', 'govt',
  'government', 'ltd', 'limited', 'pvt', 'private', 'india', 'indian', 'unit', 'sector', 'zone', 'region', 'police',
]);

const NAME_RE = /^[\p{L}][\p{L}\p{M}\s.'’\-]{1,99}$/u;
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[A-Za-z]{2,}$/;
const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/. ]{0,79}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function orgTokens(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Jaccard overlap of the meaningful words in two organisation names (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(orgTokens(a));
  const B = new Set(orgTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / (A.size + B.size - inter);
}

export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[^\d]/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^\d{8,12}$/.test(d)) return d; // landline with STD code
  return null;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class ServicePortalService {
  /** Brute-force guard for the tracking endpoints (per instance; the DB guards submissions). */
  private readonly trackHits = new Map<string, number[]>();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly outbox: OutboxService,
    private readonly service: ServiceService,
  ) {}

  // ---------------------------------------------------------------- helpers --
  private ipHash(ip: string): string {
    return sha256(`arihant-portal:${ip || 'unknown'}`).slice(0, 32);
  }

  private tooMany(message: string, retryAfterSeconds: number): never {
    throw new HttpException({ statusCode: 429, message, retry_after_seconds: retryAfterSeconds, error: 'Too Many Requests' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private guardTracking(ip: string) {
    const now = Date.now();
    const key = this.ipHash(ip);
    const hits = (this.trackHits.get(key) || []).filter((t) => now - t < 10 * 60000);
    if (hits.length >= 40) this.tooMany('Too many lookups. Please wait a few minutes and try again.', 600);
    hits.push(now);
    this.trackHits.set(key, hits);
    if (this.trackHits.size > 5000) this.trackHits.clear();
  }

  private async requireEnabled() {
    const enabled = await getServiceSetting<boolean>(this.db, 'portal_enabled', true);
    if (!enabled) throw new ServiceUnavailableException('The online service-request form is temporarily unavailable. Please call the Arihant service desk.');
  }

  // -------------------------------------------------------------------- meta --
  async meta() {
    await this.requireEnabled();
    const products = await this.db.selectFrom('products').select(['id', 'name', 'category']).orderBy('name', 'asc').limit(300).execute();
    const rules = await this.db.selectFrom('sla_rules').select(['priority', 'response_hours', 'resolution_hours']).where('warranty_type', '=', 'in_warranty').execute();
    return {
      enabled: true,
      products,
      problem_categories: PORTAL_PROBLEM_CATEGORIES,
      urgencies: PORTAL_URGENCY_OPTIONS.map((u) => ({ value: u.value, label: u.label })),
      states: PORTAL_STATES.map((s) => s.name),
      limits: PORTAL_LIMITS,
      response_targets: PORTAL_URGENCY_OPTIONS.map((u) => {
        const r = rules.find((x) => x.priority === u.priority);
        return { urgency: u.value, response_hours: r?.response_hours ?? null };
      }),
    };
  }

  // ------------------------------------------------------------- validation --
  private validate(dto: PortalServiceRequestDto) {
    const errors: string[] = [];
    const out: Record<string, any> = {};
    const L = PORTAL_LIMITS;

    out.organisation = cleanText(dto.organisation_name, 200);
    if (out.organisation.length < L.organisation.min) errors.push('Organisation / unit name is required (at least 3 characters)');
    if (out.organisation.length > L.organisation.max) errors.push(`Organisation name is too long (max ${L.organisation.max})`);

    out.department = dto.department ? cleanText(dto.department, 160) : null;
    out.city = cleanText(dto.city, 80);
    if (out.city.length < 2) errors.push('City / station is required');

    out.state = cleanText(dto.state, 80);
    if (!PORTAL_STATES.some((s) => s.name === out.state)) errors.push('Please choose your state / UT from the list');

    out.location = dto.location ? cleanText(dto.location, L.location.max) : null;

    out.contactName = cleanText(dto.contact_name, 100);
    if (!NAME_RE.test(out.contactName)) errors.push('Enter the contact person’s name (letters only, 2–100 characters)');
    out.designation = dto.contact_designation ? cleanText(dto.contact_designation, 100) : null;

    out.phone = normalizePhone(dto.contact_phone);
    if (!out.phone) errors.push('Enter a valid 10-digit mobile number (or landline with STD code)');

    out.email = null;
    if (dto.contact_email && String(dto.contact_email).trim()) {
      const e = String(dto.contact_email).trim().toLowerCase();
      if (!EMAIL_RE.test(e) || e.length > 120) errors.push('Enter a valid e-mail address or leave it blank');
      else out.email = e;
    }

    out.productId = null;
    if (dto.product_id && String(dto.product_id).trim()) {
      if (!UUID_RE.test(String(dto.product_id).trim())) errors.push('Selected equipment is not valid');
      else out.productId = String(dto.product_id).trim();
    }
    out.productText = dto.product_text ? cleanText(dto.product_text, 120) : null;

    out.serial = null;
    if (dto.equipment_serial && String(dto.equipment_serial).trim()) {
      const s = String(dto.equipment_serial).trim();
      if (!SERIAL_RE.test(s)) errors.push('Serial number may contain letters, digits and - _ / . only (max 80)');
      else out.serial = s;
    }

    out.category = dto.problem_category || 'Breakdown';
    if (!(PORTAL_PROBLEM_CATEGORIES as readonly string[]).includes(out.category)) errors.push('Choose a valid problem type');

    out.complaint = cleanText(dto.complaint, L.complaint.max);
    if (out.complaint.length < L.complaint.min) errors.push(`Describe the problem in at least ${L.complaint.min} characters so the engineer knows what to expect`);
    else if (out.complaint.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < 3) errors.push('Please describe the problem in a few words, not a single word');
    if ((dto.complaint || '').length > 8000) errors.push('Description is too long');

    const urgency = PORTAL_URGENCY_OPTIONS.find((u) => u.value === dto.urgency);
    if (!urgency) errors.push('Choose how urgent the problem is');
    out.urgency = urgency;

    out.preferredVisit = null;
    if (dto.preferred_visit_date && String(dto.preferred_visit_date).trim()) {
      const raw = String(dto.preferred_visit_date).trim().slice(0, 10);
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(raw) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw;
      const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const max = new Date(Date.now() + 330 * 60000 + 90 * 86400000).toISOString().slice(0, 10);
      if (!valid) errors.push('Preferred visit date is not a valid date');
      else if (raw < today) errors.push('Preferred visit date cannot be in the past');
      else if (raw > max) errors.push('Preferred visit date must be within the next 90 days');
      else out.preferredVisit = raw;
    }
    out.siteNotes = dto.site_access_notes ? cleanText(dto.site_access_notes, 500) : null;

    if (dto.consent !== true) errors.push('You must confirm that the details are correct and agree to be contacted');

    return { errors, v: out };
  }

  // ------------------------------------------------------ customer matching --
  private async matchOrganisation(v: any): Promise<{ orgId: string | null; method: string; confidence: number; zoneId: string | null; regionId: string | null; priorWarranty: string | null }> {
    const none = { orgId: null, method: 'none', confidence: 0, zoneId: null, regionId: null, priorWarranty: null };

    // 1. The serial number is the strongest signal: it ties the machine to a customer we already serve.
    if (v.serial) {
      const byTicket = await this.db
        .selectFrom('service_tickets')
        .select(['organisation_id', 'warranty_status_snapshot'])
        .where((eb) => eb.or([eb('equipment_serial', '=', v.serial), eb('serial_number', '=', v.serial)]))
        .where('organisation_id', '<>', UNVERIFIED_ORG_ID)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      const byDelivery = byTicket
        ? null
        : await this.db.selectFrom('deliveries').select('organisation_id').where('equipment_serial', '=', v.serial).orderBy('created_at', 'desc').executeTakeFirst();
      const orgId = byTicket?.organisation_id || byDelivery?.organisation_id;
      if (orgId) {
        const org = await this.db.selectFrom('organisations').select(['id', 'name', 'city', 'zone_id', 'region_id']).where('id', '=', orgId).executeTakeFirst();
        // a serial that clashes completely with the claimed name is treated as suspicious, not trusted
        if (org && nameSimilarity(org.name, v.organisation) >= 0.2) {
          return { orgId: org.id, method: 'serial', confidence: 0.95, zoneId: org.zone_id, regionId: org.region_id, priorWarranty: byTicket?.warranty_status_snapshot ?? null };
        }
      }
    }

    // 2. Fuzzy name (+ city) against the customer master.
    const toks = orgTokens(v.organisation).sort((a, b) => b.length - a.length).slice(0, 3);
    if (toks.length === 0) return none;
    const like = toks.map((t) => `%${t.replace(/[%_\\]/g, '')}%`);
    const candidates = await this.db
      .selectFrom('organisations')
      .select(['id', 'name', 'city', 'zone_id', 'region_id'])
      .where('id', '<>', UNVERIFIED_ORG_ID)
      .where((eb) => eb.or(like.map((p) => eb(sql`lower(name)`, 'like', p))))
      .limit(60)
      .execute();

    // "Unit 12" and "Unit 21" are different customers: when both names carry numbers they must agree.
    const numbersOf = (n: string) => orgTokens(n).filter((t) => /\d/.test(t)).sort().join(',');
    const claimedNumbers = numbersOf(v.organisation);

    let best: { c: (typeof candidates)[number]; score: number; base: number; cityHit: boolean } | null = null;
    for (const c of candidates) {
      const candNumbers = numbersOf(c.name);
      if (claimedNumbers && candNumbers && claimedNumbers !== candNumbers) continue;
      const base = nameSimilarity(c.name, v.organisation);
      const cityHit = !!c.city && c.city.toLowerCase() === String(v.city).toLowerCase();
      const score = base + (cityHit ? 0.15 : 0);
      if (!best || score > best.score) best = { c, score, base, cityHit };
    }
    if (best && ((best.cityHit && best.base >= 0.6) || best.base >= 0.85)) {
      return {
        orgId: best.c.id,
        method: best.cityHit ? 'name_city' : 'name',
        confidence: Math.min(0.9, best.score),
        zoneId: best.c.zone_id,
        regionId: best.c.region_id,
        priorWarranty: null,
      };
    }
    return none;
  }

  /** Zone/region from the state the customer picked (used when the customer isn't matched yet). */
  private async regionFromState(state: string): Promise<{ zoneId: string | null; regionId: string | null }> {
    const zoneCode = PORTAL_STATES.find((s) => s.name === state)?.zone;
    if (!zoneCode) return { zoneId: null, regionId: null };
    const zone = await this.db.selectFrom('zones').select('id').where('code', '=', zoneCode).executeTakeFirst();
    if (!zone) return { zoneId: null, regionId: null };
    const region = await this.db.selectFrom('regions').select('id').where('zone_id', '=', zone.id).orderBy('created_at', 'asc').executeTakeFirst();
    return { zoneId: zone.id, regionId: region?.id ?? null };
  }

  private async leastLoadedEngineer(zoneId: string | null): Promise<string | null> {
    let q = this.db
      .selectFrom('users')
      .leftJoin('service_tickets', (j) =>
        j.onRef('service_tickets.assigned_to', '=', 'users.id').on('service_tickets.status', 'not in', SERVICE_DONE_STATUSES as any),
      )
      .select(['users.id', sql<number>`count(service_tickets.id)::int`.as('load')])
      .where('users.role', '=', 'service_team')
      .where('users.is_active', '=', true)
      .groupBy('users.id')
      .orderBy('load', 'asc')
      .orderBy('users.id', 'asc')
      .limit(1);
    if (zoneId) q = q.where((eb) => eb.or([eb('users.zone_id', '=', zoneId), eb('users.zone_id', 'is', null)]));
    const row = await q.executeTakeFirst();
    return row?.id ?? null;
  }

  // ------------------------------------------------------------------ submit --
  async submit(dto: PortalServiceRequestDto, ctx: { ip: string; userAgent?: string }) {
    await this.requireEnabled();

    // --- bot traps: answer like a success so scripts learn nothing, but create nothing
    const tooFast = typeof dto.form_started_at === 'number' && Date.now() - dto.form_started_at < 2500 && dto.form_started_at > 0;
    if ((dto.website && String(dto.website).trim() !== '') || tooFast) {
      return { accepted: true, reference: `REQ-${randomBytes(4).toString('hex').toUpperCase()}`, duplicate: false, customer_message: 'Thank you. Your request has been received.' };
    }

    const { errors, v } = this.validate(dto);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors, error: 'Bad Request' });

    // --- throttles (DB-backed so they hold across restarts and instances)
    const ipHash = this.ipHash(ctx.ip);
    const perHour = await getServiceSetting<number>(this.db, 'portal_rate_limit_per_hour', 8);
    const perPhone = await getServiceSetting<number>(this.db, 'portal_rate_limit_per_phone_per_day', 10);
    const hourAgo = new Date(Date.now() - 3600000);
    const dayAgo = new Date(Date.now() - 86400000);
    const [ipCount, phoneCount, globalCount] = await Promise.all([
      this.db.selectFrom('service_intake_requests').select(sql<number>`count(id)::int`.as('n')).where('ip_hash', '=', ipHash).where('created_at', '>', hourAgo).where('status', '<>', 'rejected').executeTakeFirst(),
      this.db.selectFrom('service_intake_requests').select(sql<number>`count(id)::int`.as('n')).where('contact_phone', '=', v.phone).where('created_at', '>', dayAgo).where('status', '<>', 'rejected').executeTakeFirst(),
      this.db.selectFrom('service_intake_requests').select(sql<number>`count(id)::int`.as('n')).where('created_at', '>', hourAgo).executeTakeFirst(),
    ]);
    if ((ipCount?.n || 0) >= perHour) this.tooMany('You have sent several requests in a short time. Please wait a while, or call the Arihant service desk for urgent faults.', 3600);
    if ((phoneCount?.n || 0) >= perPhone) this.tooMany('This phone number has reached today’s request limit. Please call the Arihant service desk.', 86400);
    if ((globalCount?.n || 0) >= 400) this.tooMany('The form is very busy right now. Please try again in a few minutes.', 300);

    // --- duplicate guard: the same person re-sending the same text (double click, refresh, retry)
    const dupWindow = await getServiceSetting<number>(this.db, 'portal_duplicate_window_minutes', 30);
    const complaintKey = v.complaint.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    const recent = await this.db
      .selectFrom('service_intake_requests')
      .select(['reference', 'complaint', 'status', 'ticket_id', 'created_at'])
      .where('contact_phone', '=', v.phone)
      .where('created_at', '>', new Date(Date.now() - dupWindow * 60000))
      .where('status', '=', 'converted')
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute();
    const dup = recent.find((r) => String(r.complaint).toLowerCase().replace(/\s+/g, ' ').slice(0, 120) === complaintKey);
    if (dup) {
      return {
        accepted: true,
        duplicate: true,
        reference: dup.reference,
        customer_message: 'We already have this request. Use the tracking link you received earlier to follow its progress.',
      };
    }

    // --- resolve customer, product, region, warranty hint
    const match = await this.matchOrganisation(v);
    const fromState = match.regionId ? { zoneId: match.zoneId, regionId: match.regionId } : await this.regionFromState(v.state);
    const verified = !!match.orgId;
    const orgId = match.orgId || UNVERIFIED_ORG_ID;

    let productId: string | null = v.productId;
    if (productId) {
      const p = await this.db.selectFrom('products').select('id').where('id', '=', productId).executeTakeFirst();
      if (!p) throw new BadRequestException({ statusCode: 400, message: ['Selected equipment was not found'], error: 'Bad Request' });
    } else if (v.productText) {
      const p = await this.db.selectFrom('products').select('id').where(sql`lower(name)`, 'like', `%${v.productText.toLowerCase().replace(/[%_\\]/g, '')}%`).limit(2).execute();
      if (p.length === 1) productId = p[0].id; // only when unambiguous
    }

    const priority = v.urgency.priority as string;
    const autoAssign = await getServiceSetting<boolean>(this.db, 'auto_assign_portal_tickets', false);
    const assignedTo = autoAssign ? await this.leastLoadedEngineer(fromState.zoneId) : null;

    const lines = [v.complaint];
    if (!productId && v.productText) lines.unshift(`[Equipment stated by customer: ${v.productText}]`);
    if (v.siteNotes) lines.push(`Site access notes: ${v.siteNotes}`);
    if (v.preferredVisit) lines.push(`Customer's preferred visit date: ${v.preferredVisit}`);
    if (!verified) lines.unshift(`[UNVERIFIED CUSTOMER — claims to be: ${v.organisation}${v.department ? `, ${v.department}` : ''}, ${v.city}, ${v.state}]`);
    const complaintText = lines.join('\n').slice(0, 4000);

    const token = randomBytes(18).toString('base64url');
    const reference = await generateTicketNo(this.db as any);

    const { ticket, intakeId } = await this.db.transaction().execute(async (trx) => {
      const intake = await trx
        .insertInto('service_intake_requests')
        .values({
          reference,
          organisation_id: match.orgId,
          match_method: match.method,
          match_confidence: match.confidence,
          claimed_organisation: v.organisation,
          claimed_department: v.department,
          claimed_city: v.city,
          claimed_state: v.state,
          location: v.location,
          contact_name: v.contactName,
          contact_designation: v.designation,
          contact_phone: v.phone,
          contact_email: v.email,
          product_id: productId,
          product_text: v.productText,
          equipment_serial: v.serial,
          problem_category: v.category,
          complaint: v.complaint,
          urgency: v.urgency.value,
          preferred_visit_date: v.preferredVisit,
          site_access_notes: v.siteNotes,
          consent: true,
          status: 'received',
          tracking_token_hash: sha256(token),
          ip_hash: ipHash,
          user_agent: (ctx.userAgent || '').slice(0, 300) || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      // a verified customer gains the contact in the CRM ("enter once, use everywhere")
      let contactId: string | null = null;
      if (verified) {
        const existing = await trx
          .selectFrom('contacts')
          .select('id')
          .where('organisation_id', '=', orgId)
          .where((eb) => eb.or([eb('mobile', '=', v.phone), ...(v.email ? [eb(sql`lower(email)`, '=', v.email)] : [])]))
          .executeTakeFirst();
        contactId =
          existing?.id ||
          (
            await trx
              .insertInto('contacts')
              .values({ organisation_id: orgId, full_name: v.contactName, designation: v.designation, mobile: v.phone, email: v.email, is_primary: false })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
      }

      const created = await this.service.createTicketCore(trx, {
        organisationId: orgId,
        contactId,
        productId,
        serial: v.serial,
        equipmentUnverified: !verified || (!!v.serial && match.method !== 'serial'),
        location: v.location || `${v.city}, ${v.state}`,
        complaint: complaintText,
        source: 'Customer Portal',
        problemCategory: v.category,
        priority,
        warranty: match.priorWarranty || 'in_warranty',
        isChargeable: false,
        assignedTo,
        regionId: fromState.regionId,
        customTicketNo: reference,
        claimedOrganisationName: verified ? null : v.organisation,
        intakeRequestId: intake.id,
        actorId: null,
        initialReason: `Complaint received via customer portal from ${v.contactName} (${v.phone}). Warranty/coverage to be verified by the service desk.`,
      });

      await trx.updateTable('service_intake_requests').set({ ticket_id: created.ticket.id, status: 'converted', updated_at: new Date() }).where('id', '=', intake.id).execute();
      return { ticket: created.ticket, intakeId: intake.id };
    });

    // --- everything that should happen next
    await this.service.afterCreate(ticket, null, { portal: true });
    await this.service.emitTicketEvent(AppEvents.SERVICE_PORTAL_REQUEST, ticket.id, {
      contactName: v.contactName,
      contactPhone: v.phone,
      claimedOrganisation: v.organisation,
      verified,
      matchMethod: match.method,
      urgency: v.urgency.value,
      preferredVisit: v.preferredVisit,
      autoAssigned: !!assignedTo,
    });
    try {
      // hook for an e-mail / SMS gateway: the customer acknowledgement is queued, not sent inline
      await this.outbox.queueEvent(this.db, {
        eventType: 'service.portal_acknowledgement',
        aggregateType: 'ServiceTicket',
        aggregateId: ticket.id,
        suppressNotifications: true,
        payload: { reference, email: v.email, phone: v.phone, contactName: v.contactName },
      });
    } catch {
      /* acknowledgement queueing must never fail the submission */
    }
    void intakeId;

    const sla = await computeSla(this.db as any, priority, 'in_warranty', new Date());
    return {
      accepted: true,
      duplicate: false,
      reference,
      tracking_token: token,
      track_path: `/service-request/track?ref=${encodeURIComponent(reference)}&token=${encodeURIComponent(token)}`,
      status: 'received',
      status_label: PUBLIC_STATUS_LABELS.received,
      urgency: v.urgency.value,
      response_target_hours: sla.responseHours,
      /** true → the target counts working hours only (Mon–Sat, 9:00–18:00 IST), so the due time can be the next day */
      response_in_business_hours: sla.businessHours,
      response_due_at: sla.responseDueAt,
      customer_message:
        priority === 'critical'
          ? 'Marked CRITICAL. Our service desk has been alerted and will contact you shortly. For an active security emergency please also call the service desk. Keep your tracking link: it is the only way to follow this request online.'
          : 'Your request has been registered. A service coordinator will contact you on the number provided. Keep your tracking link: it is the only way to follow this request online.',
    };
  }

  // ---------------------------------------------------------------- tracking --
  private async authorise(ref: string, token: string, ip: string) {
    this.guardTracking(ip);
    const reference = String(ref || '').trim();
    const t = String(token || '').trim();
    if (!reference || !t || reference.length > 60 || t.length > 100) throw new NotFoundException('Request not found, or the tracking code is incorrect');

    const intake = await this.db
      .selectFrom('service_intake_requests')
      .select(['id', 'ticket_id', 'tracking_token_hash', 'contact_name', 'reference', 'complaint', 'product_text'])
      .where(sql`upper(reference)`, '=', reference.toUpperCase())
      .executeTakeFirst();

    const given = Buffer.from(sha256(t), 'hex');
    const real = Buffer.from(intake?.tracking_token_hash || sha256('x'), 'hex');
    const ok = given.length === real.length && timingSafeEqual(given, real) && !!intake && !!intake.ticket_id;
    if (!ok || !intake) throw new NotFoundException('Request not found, or the tracking code is incorrect');
    return intake;
  }

  async track(ref: string, token: string, ip: string) {
    const intake = await this.authorise(ref, token, ip);
    const ticket = await this.db
      .selectFrom('service_tickets')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('users as eng', 'service_tickets.assigned_to', 'eng.id')
      .select([
        'service_tickets.id',
        sql<string>`coalesce(service_tickets.ticket_no, service_tickets.ticket_number)`.as('ticket_no'),
        'service_tickets.status',
        'service_tickets.priority',
        'service_tickets.complaint_description',
        'service_tickets.location',
        'service_tickets.equipment_serial',
        'service_tickets.planned_visit_date',
        'service_tickets.sla_response_due_at',
        'service_tickets.sla_resolution_due_at',
        'service_tickets.first_response_at',
        'service_tickets.created_at',
        'service_tickets.closed_at',
        'products.name as product_name',
        'eng.full_name as engineer_name',
      ])
      .where('service_tickets.id', '=', intake.ticket_id!)
      .executeTakeFirst();
    if (!ticket) throw new NotFoundException('Request not found, or the tracking code is incorrect');

    const status = normalizeServiceStatus(ticket.status);
    const history = await this.db
      .selectFrom('ticket_status_history')
      .select(['from_status', 'to_status', 'changed_at'])
      .where('ticket_id', '=', ticket.id)
      .orderBy('changed_at', 'asc')
      .execute();

    // customer timeline: only genuine status changes, with customer-safe wording, no internal reasons
    const timeline: { status: ServiceStatus; label: string; at: Date | string }[] = [];
    for (const h of history) {
      if (h.from_status === h.to_status) continue;
      const s = normalizeServiceStatus(h.to_status);
      if (timeline.length && timeline[timeline.length - 1].status === s) continue;
      timeline.push({ status: s, label: PUBLIC_STATUS_LABELS[s] || s, at: h.changed_at });
    }

    const comments = await this.db
      .selectFrom('ticket_comments')
      .select(['body', 'author_id', 'mentions', 'created_at'])
      .where('ticket_id', '=', ticket.id)
      .where('is_internal', '=', false)
      .orderBy('created_at', 'asc')
      .execute();

    const report = await this.db
      .selectFrom('service_reports')
      .select(['problem_identified', 'action_taken', 'customer_feedback_rating', 'customer_confirmation', 'report_status', 'submitted_at'])
      .where('ticket_id', '=', ticket.id)
      .where('report_status', 'in', ['Submitted', 'Approved'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    const paused = SERVICE_SLA_PAUSE_STATUSES.includes(status);
    const done = SERVICE_DONE_STATUSES.includes(status);
    const closedAgo = ticket.closed_at ? Date.now() - new Date(ticket.closed_at as any).getTime() : 0;

    return {
      reference: ticket.ticket_no,
      status,
      status_label: PUBLIC_STATUS_LABELS[status],
      is_closed: status === 'closed' || status === 'cancelled',
      created_at: ticket.created_at,
      complaint: intake.complaint, // exactly what the customer typed (the ticket text carries internal triage notes)
      product: ticket.product_name || intake.product_text || null,
      serial: ticket.equipment_serial,
      location: ticket.location,
      engineer_first_name: ticket.engineer_name ? String(ticket.engineer_name).split(/\s+/)[0] : null,
      planned_visit_date: ticket.planned_visit_date,
      sla: {
        business_hours: await this.slaIsBusinessHours(ticket.priority, 'in_warranty'),
        response_due_at: ticket.first_response_at ? null : ticket.sla_response_due_at,
        first_response_at: ticket.first_response_at,
        resolution_due_at: done ? null : ticket.sla_resolution_due_at,
        paused,
      },
      timeline,
      messages: comments.map((c) => ({
        from: c.author_id ? 'Arihant service desk' : 'You',
        body: c.body,
        at: c.created_at,
      })),
      work_summary: report && ['resolved', 'report_submitted', 'closed'].includes(status) ? { problem: report.problem_identified, action: report.action_taken, submitted_at: report.submitted_at } : null,
      can_comment: status !== 'cancelled' && !(status === 'closed' && closedAgo > 14 * 86400000),
      can_give_feedback: ['resolved', 'report_submitted'].includes(status) || (status === 'closed' && closedAgo <= 14 * 86400000 && !report?.customer_feedback_rating),
    };
  }

  private async slaIsBusinessHours(priority: string, warranty: string): Promise<boolean> {
    const rule = await this.db.selectFrom('sla_rules').select('business_hours_only').where('priority', '=', priority).where('warranty_type', '=', warranty).executeTakeFirst();
    return rule ? !!rule.business_hours_only : priority !== 'critical';
  }

  async addComment(ref: string, token: string, body: string | undefined, ip: string) {
    const intake = await this.authorise(ref, token, ip);
    const text = cleanText(body, PORTAL_LIMITS.comment.max);
    if (text.length < PORTAL_LIMITS.comment.min) throw new BadRequestException({ statusCode: 400, message: [`Write at least ${PORTAL_LIMITS.comment.min} characters`], error: 'Bad Request' });
    if ((body || '').length > 8000) throw new BadRequestException('Message is too long');

    const ticket = await this.db.selectFrom('service_tickets').select(['id', 'status', 'closed_at']).where('id', '=', intake.ticket_id!).executeTakeFirstOrThrow();
    const status = normalizeServiceStatus(ticket.status);
    if (status === 'cancelled') throw new BadRequestException('This request was cancelled. Please submit a new request.');
    if (status === 'closed' && ticket.closed_at && Date.now() - new Date(ticket.closed_at as any).getTime() > 14 * 86400000) {
      throw new BadRequestException('This request was closed more than 14 days ago. Please submit a new request.');
    }

    // a customer can only post 10 messages per hour on one request
    const recent = await this.db
      .selectFrom('ticket_comments')
      .select(sql<number>`count(id)::int`.as('n'))
      .where('ticket_id', '=', ticket.id)
      .where('author_id', 'is', null)
      .where('created_at', '>', new Date(Date.now() - 3600000))
      .executeTakeFirst();
    if ((recent?.n || 0) >= 10) this.tooMany('You have sent many messages on this request. Our team will reply soon.', 3600);

    await this.db
      .insertInto('ticket_comments')
      .values({ ticket_id: ticket.id, author_id: null, body: text, is_internal: false, mentions: JSON.stringify([{ customer: true, name: intake.contact_name }]) })
      .execute();
    await this.service.emitTicketEvent(AppEvents.SERVICE_CUSTOMER_COMMENT, ticket.id, { contactName: intake.contact_name, excerpt: text.slice(0, 160) });
    return { ok: true, message: 'Your message has been sent to the service team.' };
  }

  async feedback(dto: PortalFeedbackDto, ip: string) {
    const intake = await this.authorise(dto.ref, dto.token, ip);
    const remarks = cleanText(dto.remarks, 1500);
    if (dto.action === 'not_resolved' && remarks.length < 5) {
      throw new BadRequestException({ statusCode: 400, message: ['Please tell us what is still wrong (at least 5 characters)'], error: 'Bad Request' });
    }

    const ticket: any = await this.db.selectFrom('service_tickets').selectAll().where('id', '=', intake.ticket_id!).executeTakeFirstOrThrow();
    const status = normalizeServiceStatus(ticket.status);
    if (status === 'cancelled') throw new BadRequestException('This request was cancelled.');
    if (!['resolved', 'report_submitted', 'closed'].includes(status)) {
      throw new BadRequestException('Feedback can be given once the engineer has finished the work.');
    }
    const latest = await this.db.selectFrom('service_reports').selectAll().where('ticket_id', '=', ticket.id).orderBy('created_at', 'desc').executeTakeFirst();

    if (dto.action === 'confirm_resolved') {
      if (latest && latest.customer_feedback_rating && status === 'closed') {
        throw new BadRequestException('Feedback has already been recorded for this request.');
      }
      if (latest) {
        await this.db
          .updateTable('service_reports')
          .set({
            customer_feedback_rating: dto.rating ?? latest.customer_feedback_rating ?? null,
            customer_remarks: remarks || latest.customer_remarks || null,
            // a portal confirmation counts as e-mail style confirmation only when none was obtained on site
            customer_confirmation: true,
            customer_confirmation_type: latest.customer_confirmation ? latest.customer_confirmation_type : 'Email Confirmation',
            customer_name_signed: latest.customer_name_signed || intake.contact_name,
            confirmation_not_obtained_reason: null,
            updated_at: new Date(),
          })
          .where('id', '=', latest.id)
          .execute();
      }
      await this.service.emitTicketEvent(AppEvents.SERVICE_CUSTOMER_FEEDBACK, ticket.id, { action: 'confirm_resolved', rating: dto.rating ?? null, contactName: intake.contact_name });
      return { ok: true, message: 'Thank you. Your confirmation has been passed to the service manager, who will close the request.' };
    }

    // not_resolved
    if (status === 'closed') {
      // closing was a management decision, so only management can reopen — flag it to them.
      await this.db
        .insertInto('ticket_comments')
        .values({ ticket_id: ticket.id, author_id: null, body: `Customer reports the problem persists after closure: ${remarks}`, is_internal: false, mentions: JSON.stringify([{ customer: true, name: intake.contact_name }]) })
        .execute();
      await this.service.emitTicketEvent(AppEvents.SERVICE_CUSTOMER_FEEDBACK, ticket.id, { action: 'not_resolved_closed', contactName: intake.contact_name, remarks });
      return { ok: true, escalated: true, message: 'We have asked a manager to review this immediately. You will be contacted shortly.' };
    }

    const row = await this.db.transaction().execute(async (trx) => {
      if (latest && latest.report_status === 'Submitted') {
        await trx
          .updateTable('service_reports')
          .set({ report_status: 'Returned for Correction', return_reason: `Customer reports the problem persists: ${remarks}`.slice(0, 500), updated_at: new Date() })
          .where('id', '=', latest.id)
          .execute();
      }
      await trx
        .insertInto('ticket_comments')
        .values({ ticket_id: ticket.id, author_id: null, body: `Customer reports the problem persists: ${remarks}`, is_internal: false, mentions: JSON.stringify([{ customer: true, name: intake.contact_name }]) })
        .execute();
      return this.service.applyTransition(trx, ticket, 'in_progress', { actorId: null, reason: `Customer reports the problem persists: ${remarks}`.slice(0, 500) });
    });
    await this.service.announceTransition(ticket, row, null, 'Customer reports the problem persists');
    await this.service.emitTicketEvent(AppEvents.SERVICE_CUSTOMER_FEEDBACK, ticket.id, { action: 'not_resolved', contactName: intake.contact_name, remarks });
    return { ok: true, reopened: true, message: 'Sorry about that. The engineer has been told the problem persists and will follow up.' };
  }
}
