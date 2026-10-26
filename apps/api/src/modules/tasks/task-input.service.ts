/**
 * Field validation shared by one-time tasks and recurring templates: core text, priority, category and
 * the link it requires (customer / tender / demo / service), "open entity" checks and assignee scope.
 * Also accepts the v1 payload other screens still send (assigned_to, related_entity_type='lead', priority='urgent').
 */
import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { TASK_PRIORITIES, TASK_TEXT_LIMITS, type AuthUser, type Database, type TaskPriority } from '@arihant/shared';
import { TASK_DB } from './task-db.js';
import { TaskAccessService } from './task-access.service.js';
import { readBool, readText, readUuid, readUuidList, type FieldErrors } from './task-common.js';

export const CLOSED_TENDER_STATUSES = ['lost', 'cancelled', 'rejected_internally'];
export const CLOSED_SERVICE_STATUSES = ['closed', 'cancelled'];

export interface TaskLinks {
  customer_id: string | null;
  tender_id: string | null;
  demo_id: string | null;
  service_ticket_id: string | null;
  project_id: string | null;
}

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  requires_link_type: string | null;
  default_evidence_required: boolean;
}

const LINK_FIELDS: (keyof TaskLinks)[] = ['customer_id', 'tender_id', 'demo_id', 'service_ticket_id', 'project_id'];

export const isLinked = (l: Partial<TaskLinks>) => Boolean(l.customer_id || l.tender_id || l.demo_id || l.service_ticket_id);

@Injectable()
export class TaskInputService {
  constructor(
    @Inject(TASK_DB) private readonly db: Kysely<Database>,
    private readonly access: TaskAccessService,
  ) {}

  /** Maps the v1 request shape onto the Module 8 one (leads page, older clients). */
  async normaliseLegacy(dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    const out = { ...dto };
    if (!out.assignee_ids && typeof out.assigned_to === 'string') out.assignee_ids = [out.assigned_to];
    if (out.priority === 'urgent') out.priority = 'critical';
    if (out.related_entity_type === 'lead' && typeof out.related_entity_id === 'string' && !out.customer_id) {
      const lead = await this.db.selectFrom('leads').select('organisation_id').where('id', '=', out.related_entity_id).executeTakeFirst();
      if (lead?.organisation_id) out.customer_id = lead.organisation_id;
      out.source = 'lead_workflow';
    }
    if (!out.category_id) {
      const code = out.tender_id ? 'TENDER' : out.demo_id ? 'DEMO' : out.service_ticket_id ? 'SERVICE' : out.customer_id ? 'CUSTOMER' : 'GENERAL';
      const cat = await this.db.selectFrom('task_categories').select('id').where('code', '=', code).executeTakeFirst();
      if (cat) out.category_id = cat.id;
    }
    return out;
  }

  readCore(errors: FieldErrors, dto: Record<string, unknown>, partial: boolean) {
    const out: { title?: string; description?: string | null; expected_outcome?: string | null; priority?: TaskPriority } = {};
    if (!partial || dto.title !== undefined) out.title = readText(errors, 'title', dto.title, TASK_TEXT_LIMITS.title, { required: true, label: 'Title' }) ?? undefined;
    if (!partial || dto.description !== undefined) out.description = readText(errors, 'description', dto.description, TASK_TEXT_LIMITS.description, { label: 'Description' });
    if (!partial || dto.expected_outcome !== undefined) out.expected_outcome = readText(errors, 'expected_outcome', dto.expected_outcome, TASK_TEXT_LIMITS.expected_outcome, { label: 'Expected outcome' });
    if (!partial || dto.priority !== undefined) {
      const p = dto.priority === undefined || dto.priority === null || dto.priority === '' ? 'medium' : dto.priority;
      if (!TASK_PRIORITIES.includes(p as TaskPriority)) errors.priority = 'Priority must be low, medium, high or critical.';
      else out.priority = p as TaskPriority;
    }
    return out;
  }

  readFlags(dto: Record<string, unknown>, category: CategoryRow | null, partial: boolean) {
    const out: { evidence_required?: boolean; approval_required?: boolean } = {};
    if (!partial || dto.evidence_required !== undefined) out.evidence_required = readBool(dto.evidence_required, category?.default_evidence_required ?? false);
    if (!partial || dto.approval_required !== undefined) out.approval_required = readBool(dto.approval_required, false);
    return out;
  }

  async loadCategory(errors: FieldErrors, id: unknown, opts: { allowInactiveId?: string } = {}): Promise<CategoryRow | null> {
    const catId = readUuid(errors, 'category_id', id, { required: true, label: 'Category' });
    if (!catId) return null;
    const cat = await this.db.selectFrom('task_categories').selectAll().where('id', '=', catId).executeTakeFirst();
    if (!cat) {
      errors.category_id = 'Category not found.';
      return null;
    }
    if (!cat.is_active && cat.id !== opts.allowInactiveId) {
      errors.category_id = `Category "${cat.name}" is no longer in use.`;
      return null;
    }
    return cat as CategoryRow;
  }

  /**
   * Validates link ids (only those that changed, when `existing` is given), checks the linked entity is
   * still open, derives the customer from a tender/demo/ticket, and enforces the category's required link.
   */
  async readLinks(errors: FieldErrors, dto: Record<string, unknown>, category: CategoryRow | null, existing?: TaskLinks): Promise<TaskLinks> {
    const links: TaskLinks = existing ? { ...existing } : { customer_id: null, tender_id: null, demo_id: null, service_ticket_id: null, project_id: null };
    const changed = new Set<keyof TaskLinks>();
    for (const f of LINK_FIELDS) {
      if (dto[f] === undefined) continue;
      links[f] = readUuid(errors, f, dto[f], { label: f.replace(/_id$/, '').replace('_', ' ') });
      if (!existing || links[f] !== existing[f]) changed.add(f);
    }
    const derived: { customer?: string | null } = {};
    if (links.tender_id && changed.has('tender_id')) {
      const t = await this.db.selectFrom('tenders').select(['id', 'status', 'is_deleted', 'organisation_id', 'tender_no']).where('id', '=', links.tender_id).executeTakeFirst();
      if (!t || (t as any).is_deleted) errors.tender_id = 'Tender not found.';
      else if (CLOSED_TENDER_STATUSES.includes(String(t.status))) errors.tender_id = `Tender ${t.tender_no || ''} is closed (${t.status}).`;
      else derived.customer = t.organisation_id;
    }
    if (links.demo_id && changed.has('demo_id')) {
      const d = await this.db.selectFrom('demos').select(['id', 'status', 'organisation_id', 'demo_no']).where('id', '=', links.demo_id).executeTakeFirst();
      if (!d) errors.demo_id = 'Demo not found.';
      else if (d.status === 'cancelled') errors.demo_id = `Demo ${d.demo_no} was cancelled.`;
      else derived.customer = derived.customer ?? d.organisation_id;
    }
    if (links.service_ticket_id && changed.has('service_ticket_id')) {
      const st = await this.db.selectFrom('service_tickets').select(['id', 'status', 'deleted_at', 'organisation_id', 'customer_id', 'ticket_no']).where('id', '=', links.service_ticket_id).executeTakeFirst();
      if (!st || st.deleted_at) errors.service_ticket_id = 'Service ticket not found.';
      else if (CLOSED_SERVICE_STATUSES.includes(String(st.status))) errors.service_ticket_id = `Ticket ${st.ticket_no || ''} is ${st.status}.`;
      else derived.customer = derived.customer ?? st.customer_id ?? st.organisation_id;
    }
    if (links.customer_id && changed.has('customer_id')) {
      const c = await this.db.selectFrom('organisations').select('id').where('id', '=', links.customer_id).executeTakeFirst();
      if (!c) errors.customer_id = 'Customer not found.';
    }
    if (links.project_id && changed.has('project_id')) {
      const p = await this.db.selectFrom('projects').select(['id', 'is_active']).where('id', '=', links.project_id).executeTakeFirst();
      if (!p?.is_active) errors.project_id = 'Project not found or inactive.';
    }
    if (!links.customer_id && derived.customer) links.customer_id = derived.customer;

    switch (category?.requires_link_type) {
      case 'customer':
        if (!links.customer_id && !errors.customer_id) errors.customer_id = `A ${category.name} task needs a customer.`;
        break;
      case 'tender':
        if (!links.tender_id && !errors.tender_id) errors.tender_id = `A ${category.name} task needs a tender.`;
        break;
      case 'demo':
        if (!links.demo_id && !links.customer_id && !errors.demo_id) errors.demo_id = `A ${category.name} task needs a demo (or at least the customer).`;
        break;
      case 'service':
        if (!links.service_ticket_id && !links.customer_id && !errors.service_ticket_id) errors.service_ticket_id = `A ${category.name} task needs a service ticket (or at least the customer).`;
        break;
    }
    return links;
  }

  /** Active employees in the creator's scope. Reports each failure against `assignee_ids`. */
  async readAssignees(errors: FieldErrors, dto: Record<string, unknown>, user: AuthUser, linked: boolean, max: number) {
    const ids = readUuidList(errors, 'assignee_ids', dto.assignee_ids, 'Assignees');
    if (!ids.length) {
      errors.assignee_ids = errors.assignee_ids || 'Choose at least one assignee.';
      return [];
    }
    if (ids.length > max) {
      errors.assignee_ids = `You can assign to at most ${max} people at once.`;
      return [];
    }
    const users = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'is_active', 'reporting_manager_id', 'department_id', 'role'])
      .where('id', 'in', ids)
      .execute();
    const problems: string[] = [];
    for (const id of ids) {
      const u = users.find((x) => x.id === id);
      if (!u) problems.push('An assignee was not found.');
      else if (!u.is_active) problems.push(`${u.full_name} is inactive.`);
      else {
        const scope = await this.access.assignScope(user, id, linked);
        if (!scope.ok) problems.push(`${u.full_name}: ${scope.reason}`);
      }
    }
    if (problems.length) errors.assignee_ids = problems.join(' ');
    return users;
  }
}
