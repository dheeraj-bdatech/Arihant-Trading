/**
 * Manager performance reviews (part of the evidence pack). Draft → Submitted (locked; DB-enforced) →
 * Acknowledged by the employee, who may add a response (fairness & transparency). A locked review can only
 * be changed by creating a new version with a reason; the old one stays on record.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { TASK_MIN_COMMENT_LENGTH, type AuthUser } from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { isAdminLike } from './task-masters.service.js';
import {
  UUID_RE,
  conflict,
  readComment,
  readDate,
  readInt,
  readText,
  readUuid,
  readVersion,
  staleVersion,
  throwIfErrors,
  TaskValidationException,
  type FieldErrors,
} from './task-common.js';

export const REVIEW_EVENTS = { SUBMITTED: 'task_flow.review_submitted', RESPONDED: 'task_flow.review_responded' } as const;

@Injectable()
export class PerformanceReviewsService {
  constructor(private readonly store: TaskStore) {}

  private get db() {
    return this.store.db;
  }

  private async canReview(user: AuthUser, employeeId: string) {
    if (employeeId === user.id) return false;
    if (isAdminLike(user)) return true;
    const s = await this.store.masters.settings();
    return (await this.store.access.teamIds(user, s)).includes(employeeId);
  }

  private select() {
    return this.db
      .selectFrom('performance_reviews as pr')
      .innerJoin('users as e', 'e.id', 'pr.employee_id')
      .innerJoin('users as rv', 'rv.id', 'pr.reviewer_id')
      .selectAll('pr')
      .select(['e.full_name as employee_name', 'rv.full_name as reviewer_name']);
  }

  private async load(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Review not found');
    const r = await this.select().where('pr.id', '=', id).executeTakeFirst();
    if (!r) throw new NotFoundException('Review not found');
    const isEmployee = r.employee_id === user.id;
    if (isEmployee && r.status === 'draft') throw new NotFoundException('Review not found');
    if (!isEmployee && r.reviewer_id !== user.id && !this.store.access.canViewAll(user) && !(await this.canReview(user, r.employee_id))) {
      throw new NotFoundException('Review not found');
    }
    return r;
  }

  async list(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    let q = this.select().orderBy('pr.period_from', 'desc').orderBy('pr.version', 'desc').limit(300);
    const employeeId = typeof query.employee_id === 'string' && UUID_RE.test(query.employee_id) ? query.employee_id : null;
    if (employeeId) q = q.where('pr.employee_id', '=', employeeId);
    if (query.mine === 'true') q = q.where('pr.employee_id', '=', user.id);
    if (!this.store.access.canViewAll(user)) {
      const team = await this.store.access.teamIds(user, s);
      q = q.where((eb) =>
        eb.or([
          eb.and([eb('pr.employee_id', '=', user.id), eb('pr.status', '<>', 'draft')]),
          eb('pr.reviewer_id', '=', user.id),
          ...(team.length ? [eb.and([eb('pr.employee_id', 'in', team), eb('pr.status', '<>', 'draft')])] : []),
        ]),
      );
    } else if (!isAdminLike(user)) {
      q = q.where((eb) => eb.or([eb('pr.status', '<>', 'draft'), eb('pr.reviewer_id', '=', user.id)]));
    }
    return q.execute();
  }

  async get(id: string, user: AuthUser) {
    const r = await this.load(id, user);
    this.store.audit(user, 'performance_review', id, 'performance_review_view');
    return { ...r, can_edit: r.reviewer_id === user.id && r.status === 'draft', can_respond: r.employee_id === user.id && r.status === 'submitted' };
  }

  private async readContent(errors: FieldErrors, dto: Record<string, unknown>, partial: boolean, requireForSubmit = false) {
    const s = await this.store.masters.settings();
    const out: Record<string, unknown> = {};
    if (!partial || dto.period_from !== undefined) out.period_from = readDate(errors, 'period_from', dto.period_from, { required: true, label: 'Period from' });
    if (!partial || dto.period_to !== undefined) out.period_to = readDate(errors, 'period_to', dto.period_to, { required: true, label: 'Period to' });
    if (out.period_from && out.period_to && (out.period_from as string) > (out.period_to as string)) errors.period_to = '"To" must be on or after "From".';
    if (!partial || dto.rating !== undefined) out.rating = readInt(errors, 'rating', dto.rating, { min: 1, max: s.review_rating_scale, label: 'Rating', required: requireForSubmit });
    for (const f of ['strengths', 'improvement_areas', 'comments'] as const) {
      if (!partial || dto[f] !== undefined) out[f] = readText(errors, f, dto[f], 4000, { label: f.replace('_', ' ') });
    }
    if (!partial) out.rating_scale = s.review_rating_scale;
    return out;
  }

  async create(dto: Record<string, unknown>, user: AuthUser) {
    const errors: FieldErrors = {};
    const employeeId = readUuid(errors, 'employee_id', dto.employee_id, { required: true, label: 'Employee' });
    const content = await this.readContent(errors, dto, false);
    throwIfErrors(errors);
    if (!(await this.canReview(user, employeeId!))) {
      throw new ForbiddenException(employeeId === user.id ? 'You cannot review yourself.' : 'You can only review members of your own team.');
    }
    const row = await this.db
      .insertInto('performance_reviews')
      .values({ employee_id: employeeId!, reviewer_id: user.id, ...(content as any) })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.store.audit(user, 'performance_review', row.id, 'performance_review_create', undefined, row);
    return this.get(row.id, user);
  }

  async update(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const r = await this.load(id, user);
    if (r.reviewer_id !== user.id) throw new ForbiddenException('Only the reviewer can edit this review.');
    if (r.status !== 'draft') throw conflict('A submitted review is locked. Create a new version with a reason instead.');
    if (r.version !== readVersion(dto.version)) throw staleVersion();
    const errors: FieldErrors = {};
    const content = await this.readContent(errors, dto, true);
    throwIfErrors(errors);
    const res = await this.db.updateTable('performance_reviews').set({ ...(content as any), version: sql`version + 1` }).where('id', '=', id).where('version', '=', r.version).executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
    this.store.audit(user, 'performance_review', id, 'performance_review_update', r, content);
    return this.get(id, user);
  }

  async submit(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const r = await this.load(id, user);
    if (r.reviewer_id !== user.id) throw new ForbiddenException('Only the reviewer can submit this review.');
    if (r.status !== 'draft') throw conflict('This review has already been submitted.');
    if (r.version !== readVersion(dto.version)) throw staleVersion();
    const errors: FieldErrors = {};
    if (!r.rating) errors.rating = 'Give a rating before submitting.';
    if (!r.comments || r.comments.trim().length < 20) errors.comments = 'Add review comments (at least 20 characters) before submitting.';
    throwIfErrors(errors);
    const now = new Date();
    await this.db.updateTable('performance_reviews').set({ status: 'submitted', submitted_at: now, locked_at: now, version: sql`version + 1` }).where('id', '=', id).execute();
    this.store.audit(user, 'performance_review', id, 'performance_review_submit');
    this.store.emit(REVIEW_EVENTS.SUBMITTED, { reviewId: id, employeeId: r.employee_id, reviewerName: user.full_name, periodFrom: r.period_from, periodTo: r.period_to });
    return this.get(id, user);
  }

  async respond(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const r = await this.load(id, user);
    if (r.employee_id !== user.id) throw new ForbiddenException('Only the employee can respond to their review.');
    if (r.status !== 'submitted') throw conflict(r.status === 'acknowledged' ? 'You have already acknowledged this review.' : 'This review has not been submitted yet.');
    const response = readComment(dto.response, { required: true, min: TASK_MIN_COMMENT_LENGTH, field: 'response', label: 'Response', max: 4000 });
    await this.db.updateTable('performance_reviews').set({ employee_response: response, employee_responded_at: new Date(), version: sql`version + 1` }).where('id', '=', id).execute();
    this.store.audit(user, 'performance_review', id, 'performance_review_respond', undefined, { response });
    this.store.emit(REVIEW_EVENTS.RESPONDED, { reviewId: id, reviewerId: r.reviewer_id, employeeName: user.full_name });
    return this.get(id, user);
  }

  async acknowledge(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const r = await this.load(id, user);
    if (r.employee_id !== user.id) throw new ForbiddenException('Only the employee can acknowledge their review.');
    if (r.status !== 'submitted') throw conflict('Only a submitted review can be acknowledged.');
    const response = dto.response === undefined || dto.response === '' ? null : readText({}, 'response', dto.response, 4000, {});
    await this.db
      .updateTable('performance_reviews')
      .set({
        status: 'acknowledged',
        employee_acknowledged_at: new Date(),
        ...(response && !r.employee_response ? { employee_response: response, employee_responded_at: new Date() } : {}),
        version: sql`version + 1`,
      })
      .where('id', '=', id)
      .execute();
    this.store.audit(user, 'performance_review', id, 'performance_review_acknowledge');
    this.store.emit(REVIEW_EVENTS.RESPONDED, { reviewId: id, reviewerId: r.reviewer_id, employeeName: user.full_name, acknowledged: true });
    return this.get(id, user);
  }

  /** A locked review is changed only by a new version (with a reason); the original stays on record. */
  async revise(id: string, dto: Record<string, unknown>, user: AuthUser) {
    const r = await this.load(id, user);
    if (r.reviewer_id !== user.id && !isAdminLike(user)) throw new ForbiddenException('Only the reviewer can revise this review.');
    if (r.status === 'draft') throw conflict('Drafts can be edited directly.');
    if (r.superseded_by_id) throw conflict('A newer version of this review already exists.');
    if (r.employee_id === user.id) throw new ForbiddenException('You cannot review yourself.');
    const reason = readComment(dto.reason, { required: true, min: 10, field: 'reason', label: 'Reason for the new version' });
    const fresh = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('performance_reviews')
        .values({
          employee_id: r.employee_id,
          reviewer_id: user.id,
          period_from: r.period_from,
          period_to: r.period_to,
          rating: r.rating,
          rating_scale: r.rating_scale,
          strengths: r.strengths,
          improvement_areas: r.improvement_areas,
          comments: r.comments,
          supersedes_id: r.id,
          revision_reason: reason,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.updateTable('performance_reviews').set({ superseded_by_id: row.id }).where('id', '=', r.id).execute();
      return row;
    });
    if (!fresh) throw new TaskValidationException({ id: 'Could not create a new version.' });
    this.store.audit(user, 'performance_review', fresh.id, 'performance_review_revise', { supersedes: r.id }, { reason });
    return this.get(fresh.id, user);
  }
}
