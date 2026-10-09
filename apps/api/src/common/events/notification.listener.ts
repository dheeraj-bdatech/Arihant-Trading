import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module.js';
import { EventsGateway } from '../realtime/events.gateway.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { AppEvents } from './event-names.js';
import type { Database, UserRole } from '@arihant/shared';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventsGateway: EventsGateway,
    private readonly outboxService: OutboxService,
  ) {}

  private unpackEvent<T = any>(input: any): { payload: T; eventId?: string } {
    if (input && typeof input === 'object' && 'eventId' in input && 'payload' in input) {
      return { payload: input.payload, eventId: input.eventId };
    }
    return { payload: input, eventId: input?.eventId };
  }

  private async createAndPushNotification(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string;
  }) {
    try {
      const res = await this.db
        .insertInto('notifications')
        .values({
          user_id: data.userId,
          type: data.type,
          title: data.title,
          body: data.body,
          entity_type: data.entityType || null,
          entity_id: data.entityId || null,
          is_read: false,
        })
        .returningAll()
        .executeTakeFirst();

      if (res) {
        this.eventsGateway.sendToUser(data.userId, 'notification:new', res);
        this.logger.log(`Pushed notification to user ${data.userId}: ${data.title}`);
      }
    } catch (err: any) {
      this.logger.error(`Error creating notification: ${err.message}`);
    }
  }

  @OnEvent(AppEvents.TENDER_CREATED)
  async handleTenderCreated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      orgName?: string;
      assignedPersonId?: string;
      tenderOwnerId?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderCreated'))) {
      this.logger.log(`[Idempotency] Skip already processed event ${eventId}`);
      return;
    }

    if (payload.assignedPersonId && payload.assignedPersonId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.assignedPersonId,
        type: 'tender_assigned',
        title: `New Tender Assigned: ${payload.tenderNo}`,
        body: `You have been assigned to tender ${payload.tenderNo}${payload.orgName ? ` for ${payload.orgName}` : ''}.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:created', payload);
    this.eventsGateway.sendToRole('management', 'tender:created', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderCreated');
    }
  }

  @OnEvent(AppEvents.TENDER_ASSIGNED)
  async handleTenderAssigned(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      assignedPersonId?: string;
      tenderOwnerId?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderAssigned'))) {
      return;
    }

    if (payload.assignedPersonId && payload.assignedPersonId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.assignedPersonId,
        type: 'tender_assigned',
        title: `Assigned to Tender: ${payload.tenderNo}`,
        body: `You have been designated as assigned person for tender ${payload.tenderNo}.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    if (payload.tenderOwnerId && payload.tenderOwnerId !== payload.actorId && payload.tenderOwnerId !== payload.assignedPersonId) {
      await this.createAndPushNotification({
        userId: payload.tenderOwnerId,
        type: 'tender_assigned',
        title: `Designated Owner: ${payload.tenderNo}`,
        body: `You have been designated as tender owner for tender ${payload.tenderNo}.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:assigned', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderAssigned');
    }
  }

  @OnEvent(AppEvents.TENDER_APPROVAL_REQUESTED)
  async handleTenderApprovalRequested(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      orgName?: string;
      actorId: string;
      estimatedValue?: number;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.approvalRequested'))) {
      return;
    }

    // Notify management users
    const mgmtUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const u of mgmtUsers) {
      await this.createAndPushNotification({
        userId: u.id,
        type: 'tender_approval',
        title: 'Tender Participation Approval Required',
        body: `Tender ${payload.tenderNo} ${payload.orgName ? `for ${payload.orgName} ` : ''}requires participation decision.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('management', 'tender:approval_requested', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.approvalRequested');
    }
  }

  @OnEvent(AppEvents.TENDER_APPROVED)
  async handleTenderApproved(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      approverId?: string;
      tenderOwnerId?: string;
      assignedPersonId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderApproved'))) {
      return;
    }

    const recipients = new Set<string>();
    if (payload.tenderOwnerId) recipients.add(payload.tenderOwnerId);
    if (payload.assignedPersonId) recipients.add(payload.assignedPersonId);

    for (const userId of recipients) {
      if (userId !== payload.approverId) {
        await this.createAndPushNotification({
          userId,
          type: 'tender_approval',
          title: `Tender Participation Approved: ${payload.tenderNo}`,
          body: `Tender ${payload.tenderNo} has been approved by management. Preparation phase can begin.`,
          entityType: 'tender',
          entityId: payload.tenderId,
        });
      }
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:approved', payload);
    this.eventsGateway.sendToRole('management', 'tender:approved', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderApproved');
    }
  }

  @OnEvent(AppEvents.TENDER_REJECTED)
  async handleTenderRejected(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      approverId?: string;
      tenderOwnerId?: string;
      assignedPersonId?: string;
      reason?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderRejected'))) {
      return;
    }

    const recipients = new Set<string>();
    if (payload.tenderOwnerId) recipients.add(payload.tenderOwnerId);
    if (payload.assignedPersonId) recipients.add(payload.assignedPersonId);

    for (const userId of recipients) {
      if (userId !== payload.approverId) {
        await this.createAndPushNotification({
          userId,
          type: 'tender_approval',
          title: `Tender Participation Rejected: ${payload.tenderNo}`,
          body: `Tender ${payload.tenderNo} was rejected internally. Reason: ${payload.reason || 'Management decision'}`,
          entityType: 'tender',
          entityId: payload.tenderId,
        });
      }
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:rejected', payload);
    this.eventsGateway.sendToRole('management', 'tender:rejected', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderRejected');
    }
  }

  @OnEvent(AppEvents.TENDER_STATUS_CHANGED)
  async handleTenderStatusChanged(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      toStatus: string;
      actorId: string;
      tenderOwnerId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderStatusChanged'))) {
      return;
    }

    if (payload.tenderOwnerId && payload.tenderOwnerId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.tenderOwnerId,
        type: 'tender_status',
        title: `Tender ${payload.tenderNo} Status Updated`,
        body: `Status changed to: ${payload.toStatus}`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:updated', payload);
    this.eventsGateway.sendToRole('management', 'tender:updated', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderStatusChanged');
    }
  }

  @OnEvent(AppEvents.TENDER_SUBMITTED)
  async handleTenderSubmitted(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      submissionDate?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderSubmitted'))) {
      return;
    }

    const mgmtUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const u of mgmtUsers) {
      if (u.id !== payload.actorId) {
        await this.createAndPushNotification({
          userId: u.id,
          type: 'tender_submitted',
          title: `Tender Bid Submitted: ${payload.tenderNo}`,
          body: `Tender ${payload.tenderNo} bid has been successfully submitted on portal.`,
          entityType: 'tender',
          entityId: payload.tenderId,
        });
      }
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:submitted', payload);
    this.eventsGateway.sendToRole('management', 'tender:submitted', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderSubmitted');
    }
  }

  @OnEvent(AppEvents.TENDER_WON)
  async handleTenderWon(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      tenderValue?: number;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderWon'))) {
      return;
    }

    const mgmtUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const u of mgmtUsers) {
      await this.createAndPushNotification({
        userId: u.id,
        type: 'tender_won',
        title: `🏆 Tender Won: ${payload.tenderNo}`,
        body: `Congratulations! Tender ${payload.tenderNo} has been marked as WON.${payload.tenderValue ? ` Value: ₹ ${payload.tenderValue.toLocaleString('en-IN')}` : ''}`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.broadcast('tender:won', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderWon');
    }
  }

  @OnEvent(AppEvents.TENDER_LOST)
  async handleTenderLost(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      lossReason?: string;
      competitor?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.tenderLost'))) {
      return;
    }

    const mgmtUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const u of mgmtUsers) {
      await this.createAndPushNotification({
        userId: u.id,
        type: 'tender_lost',
        title: `Tender Lost: ${payload.tenderNo}`,
        body: `Tender ${payload.tenderNo} concluded as Lost. Reason: ${payload.lossReason || 'Unknown'}${payload.competitor ? ` (Competitor: ${payload.competitor})` : ''}.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.broadcast('tender:lost', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.tenderLost');
    }
  }

  @OnEvent(AppEvents.TENDER_DEADLINE_APPROACHING)
  async handleTenderDeadlineApproaching(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      deadline: string;
      hoursLeft: number;
      assignedPersonId?: string;
      tenderOwnerId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.deadlineApproaching'))) {
      return;
    }

    const targets = new Set<string>();
    if (payload.assignedPersonId) targets.add(payload.assignedPersonId);
    if (payload.tenderOwnerId) targets.add(payload.tenderOwnerId);

    for (const userId of targets) {
      await this.createAndPushNotification({
        userId,
        type: 'tender_deadline',
        title: `⏳ Urgent Tender Deadline: ${payload.tenderNo}`,
        body: `Tender ${payload.tenderNo} deadline is in ${payload.hoursLeft} hours (${new Date(payload.deadline).toLocaleString('en-IN')}).`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:deadline_alert', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.deadlineApproaching');
    }
  }

  @OnEvent(AppEvents.TENDER_DEADLINE_EXCEEDED)
  async handleTenderDeadlineExceeded(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      tenderId: string;
      tenderNo: string;
      deadline: string;
      assignedPersonId?: string;
      tenderOwnerId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.deadlineExceeded'))) {
      return;
    }

    const targets = new Set<string>();
    if (payload.assignedPersonId) targets.add(payload.assignedPersonId);
    if (payload.tenderOwnerId) targets.add(payload.tenderOwnerId);

    for (const userId of targets) {
      await this.createAndPushNotification({
        userId,
        type: 'tender_overdue',
        title: `🚨 Overdue Tender: ${payload.tenderNo}`,
        body: `Tender ${payload.tenderNo} submission deadline has passed without submission. Immediate follow-up required.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('management', 'tender:overdue', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.deadlineExceeded');
    }
  }

  @OnEvent(AppEvents.TENDER_PORTAL_ISSUE_CREATED)
  async handleTenderPortalIssueCreated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      issueId: string;
      tenderId: string;
      tenderNo?: string;
      issue: string;
      responsiblePersonId?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.portalIssueCreated'))) {
      return;
    }

    if (payload.responsiblePersonId && payload.responsiblePersonId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.responsiblePersonId,
        type: 'tender_portal_issue',
        title: `External Portal Issue Reported`,
        body: `You are designated responsible for portal issue on tender ${payload.tenderNo || payload.tenderId}: "${payload.issue}".`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:portal_issue_created', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.portalIssueCreated');
    }
  }

  @OnEvent(AppEvents.TENDER_PORTAL_ISSUE_ESCALATED)
  async handleTenderPortalIssueEscalated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      issueId: string;
      tenderId: string;
      tenderNo?: string;
      issue: string;
      escalatedTo?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.portalIssueEscalated'))) {
      return;
    }

    // Notify management
    const mgmtUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const u of mgmtUsers) {
      await this.createAndPushNotification({
        userId: u.id,
        type: 'tender_portal_issue_escalated',
        title: `🚨 Escalated Portal Issue: ${payload.tenderNo || ''}`,
        body: `External portal issue escalated: "${payload.issue}" (${payload.escalatedTo || 'Management'}).`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }

    this.eventsGateway.sendToRole('management', 'tender:portal_issue_escalated', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.portalIssueEscalated');
    }
  }

  @OnEvent(AppEvents.TENDER_PORTAL_ISSUE_RESOLVED)
  async handleTenderPortalIssueResolved(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      issueId: string;
      tenderId: string;
      tenderNo?: string;
      issue: string;
      resolution?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.portalIssueResolved'))) {
      return;
    }

    this.eventsGateway.sendToRole('tender_team', 'tender:portal_issue_resolved', payload);
    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.portalIssueResolved');
    }
  }

  @OnEvent(AppEvents.EXPENSE_SUBMITTED)
  async handleExpenseSubmitted(payload: { expenseId: string; employeeId: string; employeeName: string; amount: number; managerId: string }) {
    await this.createAndPushNotification({
      userId: payload.managerId,
      type: 'expense_approval',
      title: 'New Expense Awaiting 1st-Stage Approval',
      body: `${payload.employeeName} submitted an expense of ₹ ${payload.amount.toLocaleString('en-IN')}.`,
      entityType: 'expense',
      entityId: payload.expenseId,
    });
  }

  @OnEvent(AppEvents.EXPENSE_MANAGER_APPROVED)
  async handleExpenseManagerApproved(payload: { expenseId: string; employeeId: string; amount: number }) {
    // Notify accounts users
    const accountsUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'accounts')
      .where('is_active', '=', true)
      .execute();

    for (const u of accountsUsers) {
      await this.createAndPushNotification({
        userId: u.id,
        type: 'expense_accounts',
        title: 'Manager Approved Expense Ready for Processing',
        body: `Expense of ₹ ${payload.amount.toLocaleString('en-IN')} approved by manager, ready for accounts signoff.`,
        entityType: 'expense',
        entityId: payload.expenseId,
      });
    }

    // Also notify employee
    await this.createAndPushNotification({
      userId: payload.employeeId,
      type: 'expense_status',
      title: 'Expense Approved by Manager',
      body: `Your expense of ₹ ${payload.amount.toLocaleString('en-IN')} was approved by your manager and forwarded to Accounts.`,
      entityType: 'expense',
      entityId: payload.expenseId,
    });
  }

  @OnEvent(AppEvents.TASK_BLOCKED)
  async handleTaskBlocked(payload: { taskId: string; title: string; raisedById: string; managerId: string; blockerType: string; description: string }) {
    await this.createAndPushNotification({
      userId: payload.managerId,
      type: 'task_blocked',
      title: 'Task Execution Blocked',
      body: `Task "${payload.title}" is blocked: ${payload.description}`,
      entityType: 'task',
      entityId: payload.taskId,
    });
  }

  @OnEvent(AppEvents.VISIT_ALSO_MEET)
  async handleVisitAlsoMeet(payload: { visitId: string; employeeId: string; managerName: string; instructions: string }) {
    await this.createAndPushNotification({
      userId: payload.employeeId,
      type: 'visit_intervention',
      title: 'Manager "Also-Meet" Intervention Added',
      body: `${payload.managerName} added an instruction to your planned visit: ${payload.instructions}`,
      entityType: 'visit',
      entityId: payload.visitId,
    });
  }

  @OnEvent(AppEvents.TRIP_VISIT_ADDED)
  async handleTripVisitAdded(payload: {
    tripId: string;
    visitId: string;
    employeeId: string;
    managerName: string;
    organisationName: string;
    location?: string;
    instructions?: string;
  }) {
    await this.createAndPushNotification({
      userId: payload.employeeId,
      type: 'trip_visit_added',
      title: 'New Customer Visit Added to Your Trip Plan',
      body: `${payload.managerName} added a visit to ${payload.organisationName} (${payload.location || 'Site'}) to your trip.${payload.instructions ? ` Note: ${payload.instructions}` : ''}`,
      entityType: 'trip',
      entityId: payload.tripId,
    });
  }

  @OnEvent(AppEvents.VISIT_CANCELLED)
  async handleVisitCancelled(payload: {
    visitId: string;
    employeeId: string;
    employeeName: string;
    organisationName: string;
    plannedDate: string;
    reason: string;
    managerId?: string;
  }) {
    if (payload.managerId && payload.managerId !== payload.employeeId) {
      await this.createAndPushNotification({
        userId: payload.managerId,
        type: 'visit_cancelled',
        title: 'Field Visit Cancelled by Employee',
        body: `${payload.employeeName} cancelled visit to ${payload.organisationName} on ${payload.plannedDate}. Reason: "${payload.reason}"`,
        entityType: 'visit',
        entityId: payload.visitId,
      });
    }
  }

  @OnEvent(AppEvents.VISIT_RESCHEDULED)
  async handleVisitRescheduled(payload: {
    visitId: string;
    employeeId: string;
    employeeName: string;
    organisationName: string;
    oldDate: string;
    newDate: string;
    reason: string;
    managerId?: string;
  }) {
    if (payload.managerId && payload.managerId !== payload.employeeId) {
      await this.createAndPushNotification({
        userId: payload.managerId,
        type: 'visit_rescheduled',
        title: 'Field Visit Rescheduled by Employee',
        body: `${payload.employeeName} rescheduled visit to ${payload.organisationName} from ${payload.oldDate} to ${payload.newDate}. Reason: "${payload.reason}"`,
        entityType: 'visit',
        entityId: payload.visitId,
      });
    }
  }

  @OnEvent(AppEvents.VISIT_MODIFIED)
  async handleVisitModified(payload: {
    visitId: string;
    employeeId: string;
    employeeName: string;
    organisationName: string;
    changeDetails: string;
    reason?: string;
    managerId?: string;
  }) {
    if (payload.managerId && payload.managerId !== payload.employeeId) {
      await this.createAndPushNotification({
        userId: payload.managerId,
        type: 'visit_modified',
        title: 'Field Visit Modified by Employee',
        body: `${payload.employeeName} updated visit to ${payload.organisationName}: ${payload.changeDetails}.${payload.reason ? ` Reason: "${payload.reason}"` : ''}`,
        entityType: 'visit',
        entityId: payload.visitId,
      });
    }
  }

  @OnEvent(AppEvents.VISIT_COMPLETED)
  async handleVisitCompleted(payload: {
    visitId: string;
    employeeId: string;
    employeeName: string;
    organisationName: string;
    outcome?: string;
    personMet?: string;
    managerId?: string;
  }) {
    if (payload.managerId && payload.managerId !== payload.employeeId) {
      await this.createAndPushNotification({
        userId: payload.managerId,
        type: 'visit_completed',
        title: 'Field Visit Completed',
        body: `${payload.employeeName} completed visit to ${payload.organisationName}. Outcome: ${payload.outcome || 'Completed'}. Person met: ${payload.personMet || 'N/A'}.`,
        entityType: 'visit',
        entityId: payload.visitId,
      });
    }
  }

  @OnEvent(AppEvents.TASK_ASSIGNED)
  async handleTaskAssigned(payload: { taskId: string; title: string; assignedTo: string; deadline?: string }) {
    await this.createAndPushNotification({
      userId: payload.assignedTo,
      type: 'task_assigned',
      title: 'New Operational Task Assigned',
      body: `You have been assigned: "${payload.title}" (Due: ${payload.deadline || 'Immediate'})`,
      entityType: 'task',
      entityId: payload.taskId,
    });
  }

  @OnEvent(AppEvents.TENDER_DEADLINE_SOON)
  async handleTenderDeadlineSoon(payload: { tenderId: string; tenderNo: string; daysLeft: number; ownerId?: string }) {
    if (payload.ownerId) {
      await this.createAndPushNotification({
        userId: payload.ownerId,
        type: 'tender_deadline',
        title: `CRITICAL DEADLINE: Tender ${payload.tenderNo}`,
        body: `Submission window closes in ${payload.daysLeft} days! Immediate action required.`,
        entityType: 'tender',
        entityId: payload.tenderId,
      });
    }
  }

  @OnEvent(AppEvents.DEMO_REQUESTED)
  async handleDemoRequested(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    requestedBy: string;
    requestedByName: string;
    location?: string;
  }) {
    // Notify demo coordinators (demo_team & management)
    const coordinators = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', 'in', ['demo_team', 'management'])
      .where('is_active', '=', true)
      .execute();

    for (const u of coordinators) {
      if (u.id !== payload.requestedBy) {
        await this.createAndPushNotification({
          userId: u.id,
          type: 'demo_requested',
          title: `New Demo Request: ${payload.demoNo}`,
          body: `${payload.requestedByName} requested a client demonstration for ${payload.organisationName} (${payload.location || 'Site'}).`,
          entityType: 'demo',
          entityId: payload.demoId,
        });
      }
    }
    this.eventsGateway.sendToRole('demo_team', 'demo:requested', payload);
  }

  @OnEvent(AppEvents.DEMO_TEAM_ASSIGNED)
  async handleDemoTeamAssigned(payload: {
    demoId: string;
    demoNo: string;
    assignedToId: string;
    organisationName: string;
    demoDate?: string;
    location?: string;
  }) {
    await this.createAndPushNotification({
      userId: payload.assignedToId,
      type: 'demo_assigned',
      title: `Assigned to Client Demo: ${payload.demoNo}`,
      body: `You have been assigned to conduct demonstration for ${payload.organisationName} on ${payload.demoDate || 'TBD'} at ${payload.location || 'Site'}.`,
      entityType: 'demo',
      entityId: payload.demoId,
    });
    this.eventsGateway.sendToUser(payload.assignedToId, 'demo:assigned', payload);
  }

  @OnEvent(AppEvents.DEMO_EQUIPMENT_RESERVED)
  async handleDemoEquipmentReserved(payload: {
    demoId: string;
    demoNo: string;
    equipmentModel: string;
    serialNo?: string;
    salespersonId?: string;
    assignedToId?: string;
  }) {
    const recipients = new Set<string>();
    if (payload.salespersonId) recipients.add(payload.salespersonId);
    if (payload.assignedToId) recipients.add(payload.assignedToId);

    for (const userId of recipients) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_equipment_reserved',
        title: `Demo Unit Reserved: ${payload.demoNo}`,
        body: `Equipment unit ${payload.equipmentModel} (${payload.serialNo || 'Standard'}) reserved for demo ${payload.demoNo}.`,
        entityType: 'demo',
        entityId: payload.demoId,
      });
    }
  }

  @OnEvent(AppEvents.DEMO_CONFIRMED)
  async handleDemoConfirmed(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    confirmedDate: string;
    salespersonId?: string;
    assignedToId?: string;
  }) {
    const recipients = new Set<string>();
    if (payload.salespersonId) recipients.add(payload.salespersonId);
    if (payload.assignedToId) recipients.add(payload.assignedToId);

    for (const userId of recipients) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_confirmed',
        title: `Demo Confirmed: ${payload.demoNo}`,
        body: `Demonstration for ${payload.organisationName} confirmed for ${payload.confirmedDate}.`,
        entityType: 'demo',
        entityId: payload.demoId,
      });
    }
  }

  @OnEvent(AppEvents.DEMO_RESCHEDULED)
  async handleDemoRescheduled(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    oldDate?: string;
    newDate: string;
    reason: string;
    salespersonId?: string;
    assignedToId?: string;
  }) {
    const recipients = new Set<string>();
    if (payload.salespersonId) recipients.add(payload.salespersonId);
    if (payload.assignedToId) recipients.add(payload.assignedToId);

    for (const userId of recipients) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_rescheduled',
        title: `Demo Rescheduled: ${payload.demoNo}`,
        body: `Demonstration for ${payload.organisationName} moved to ${payload.newDate}. Reason: "${payload.reason}".`,
        entityType: 'demo',
        entityId: payload.demoId,
      });
    }
  }

  @OnEvent(AppEvents.DEMO_CANCELLED)
  async handleDemoCancelled(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    reason: string;
    salespersonId?: string;
    assignedToId?: string;
  }) {
    const recipients = new Set<string>();
    if (payload.salespersonId) recipients.add(payload.salespersonId);
    if (payload.assignedToId) recipients.add(payload.assignedToId);

    for (const userId of recipients) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_cancelled',
        title: `Demo Cancelled: ${payload.demoNo}`,
        body: `Demonstration for ${payload.organisationName} has been cancelled. Reason: "${payload.reason}". Equipment and personnel reservations released.`,
        entityType: 'demo',
        entityId: payload.demoId,
      });
    }
  }

  @OnEvent(AppEvents.DEMO_COMPLETED)
  async handleDemoCompleted(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    result: string;
    failureReason?: string;
    actorName?: string;
  }) {
    this.eventsGateway.sendToRole('demo_team', 'demo:completed', payload);
    this.eventsGateway.sendToRole('management', 'demo:completed', payload);
  }

  @OnEvent(AppEvents.DEMO_SERVICE_ESCORT_REQUESTED)
  async handleDemoServiceEscortRequested(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    location?: string;
    requestedDate: string;
    requestedById: string;
    requestedByName: string;
    serviceEngineerId?: string;
    regionId?: string;
    zoneId?: string;
  }) {
    // Notify all 5 stakeholders:
    // 1. Management
    // 2. Demo Team
    // 3. Service Team (including assigned engineer)
    // 4. Salesperson
    // 5. Regional Team (RM of that area)
    const targetUserIds = new Set<string>();

    const mgmtAndDemoUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', 'in', ['management', 'demo_team', 'admin'])
      .where('is_active', '=', true)
      .execute();
    mgmtAndDemoUsers.forEach((u) => targetUserIds.add(u.id));

    if (payload.serviceEngineerId) {
      targetUserIds.add(payload.serviceEngineerId);
    }
    const serviceEngineers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'service_team')
      .where('is_active', '=', true)
      .execute();
    serviceEngineers.forEach((u) => targetUserIds.add(u.id));

    if (payload.requestedById) {
      targetUserIds.add(payload.requestedById);
    }

    let rmQuery = this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'regional_manager')
      .where('is_active', '=', true);
    if (payload.regionId || payload.zoneId) {
      rmQuery = rmQuery.where((eb) => {
        const conds = [];
        if (payload.regionId) conds.push(eb('region_id', '=', payload.regionId));
        if (payload.zoneId) conds.push(eb('zone_id', '=', payload.zoneId));
        return eb.or(conds);
      });
    }
    const rmUsers = await rmQuery.execute();
    rmUsers.forEach((u) => targetUserIds.add(u.id));

    for (const userId of targetUserIds) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_service_escort_requested',
        title: `Service Escort Requested: Demo ${payload.demoNo}`,
        body: `${payload.requestedByName} requested Service Team escort for live demo trial at ${payload.organisationName} (${payload.location || 'Site'}) on ${payload.requestedDate}.`,
        entityType: 'demo',
        entityId: payload.demoId,
      });
    }

    this.eventsGateway.broadcast('demo:service_escort_requested', payload);
  }

  @OnEvent(AppEvents.DEMO_TECHNICAL_FAILURE)
  async handleDemoTechnicalFailure(payload: {
    demoId: string;
    demoNo: string;
    organisationName: string;
    location?: string;
    ticketId: string;
    ticketNo: string;
    failureReason: string;
    actorId: string;
    actorName: string;
    requestedById?: string;
    serviceEngineerId?: string;
    regionId?: string;
    zoneId?: string;
  }) {
    // Notify all 5 stakeholders:
    // 1. Management
    // 2. Demo Team
    // 3. Service Team (including assigned engineer)
    // 4. Salesperson
    // 5. Regional Team (RM of that area)
    const targetUserIds = new Set<string>();

    const mgmtAndDemoUsers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', 'in', ['management', 'demo_team', 'admin'])
      .where('is_active', '=', true)
      .execute();
    mgmtAndDemoUsers.forEach((u) => targetUserIds.add(u.id));

    if (payload.serviceEngineerId) {
      targetUserIds.add(payload.serviceEngineerId);
    }
    const serviceEngineers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'service_team')
      .where('is_active', '=', true)
      .execute();
    serviceEngineers.forEach((u) => targetUserIds.add(u.id));

    if (payload.requestedById) {
      targetUserIds.add(payload.requestedById);
    }

    let rmQuery = this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'regional_manager')
      .where('is_active', '=', true);
    if (payload.regionId || payload.zoneId) {
      rmQuery = rmQuery.where((eb) => {
        const conds = [];
        if (payload.regionId) conds.push(eb('region_id', '=', payload.regionId));
        if (payload.zoneId) conds.push(eb('zone_id', '=', payload.zoneId));
        return eb.or(conds);
      });
    }
    const rmUsers = await rmQuery.execute();
    rmUsers.forEach((u) => targetUserIds.add(u.id));

    for (const userId of targetUserIds) {
      await this.createAndPushNotification({
        userId,
        type: 'demo_technical_failure',
        title: `⚠️ Live Demo Breakdown: ${payload.demoNo} -> ${payload.ticketNo}`,
        body: `Hardware failure during trial at ${payload.organisationName}. Breakdown Ticket ${payload.ticketNo} generated and equipment quarantined to maintenance.`,
        entityType: 'service_ticket',
        entityId: payload.ticketId,
      });
    }

    this.eventsGateway.broadcast('demo:technical_failure', payload);
  }

  // =========================================================================
  // Proposal Management Domain Event Listeners (Event-Driven Architecture)
  // =========================================================================

  @OnEvent(AppEvents.PROPOSAL_CREATED)
  async handleProposalCreated(payload: {
    proposalId: string;
    proposalNumber: string;
    customerName?: string;
    responsibleId?: string;
    requestedBy?: string;
    actorId?: string;
  }) {
    if (payload.responsibleId && payload.responsibleId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.responsibleId,
        type: 'proposal_assigned',
        title: `New Proposal Assigned: ${payload.proposalNumber}`,
        body: `You have been assigned to prepare proposal ${payload.proposalNumber} for ${payload.customerName || 'customer'}.`,
        entityType: 'proposal',
        entityId: payload.proposalId,
      });
    }

    this.eventsGateway.broadcast('proposal:created', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_REVIEW_REQUESTED)
  async handleProposalReviewRequested(payload: {
    proposalId: string;
    proposalNumber: string;
    customerName?: string;
    actorId?: string;
  }) {
    const reviewers = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', 'in', ['management', 'regional_manager'])
      .where('is_active', '=', true)
      .execute();

    for (const r of reviewers) {
      if (r.id !== payload.actorId) {
        await this.createAndPushNotification({
          userId: r.id,
          type: 'proposal_review',
          title: `Proposal Review Required: ${payload.proposalNumber}`,
          body: `Proposal ${payload.proposalNumber} for ${payload.customerName || 'customer'} is ready for executive review & approval.`,
          entityType: 'proposal',
          entityId: payload.proposalId,
        });
      }
    }

    this.eventsGateway.sendToRole('management', 'proposal:review_requested', payload);
    this.eventsGateway.sendToRole('regional_manager', 'proposal:review_requested', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_APPROVED)
  async handleProposalApproved(payload: {
    proposalId: string;
    proposalNumber: string;
    responsibleId?: string;
    requestedBy?: string;
    actorId?: string;
  }) {
    const targets = new Set<string>();
    if (payload.responsibleId) targets.add(payload.responsibleId);
    if (payload.requestedBy) targets.add(payload.requestedBy);

    for (const uId of targets) {
      if (uId !== payload.actorId) {
        await this.createAndPushNotification({
          userId: uId,
          type: 'proposal_approved',
          title: `Proposal Approved: ${payload.proposalNumber}`,
          body: `Proposal ${payload.proposalNumber} has been approved by management and is ready to send.`,
          entityType: 'proposal',
          entityId: payload.proposalId,
        });
      }
    }

    this.eventsGateway.broadcast('proposal:approved', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_SENT)
  async handleProposalSent(payload: {
    proposalId: string;
    proposalNumber: string;
    followUpOwnerId?: string;
    actorId?: string;
  }) {
    if (payload.followUpOwnerId && payload.followUpOwnerId !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.followUpOwnerId,
        type: 'proposal_sent',
        title: `Proposal Sent: ${payload.proposalNumber}`,
        body: `Proposal ${payload.proposalNumber} was sent to customer. Follow-up tracking is now active.`,
        entityType: 'proposal',
        entityId: payload.proposalId,
      });
    }

    this.eventsGateway.broadcast('proposal:sent', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_FOLLOWUP_LOGGED)
  async handleProposalFollowupLogged(payload: {
    proposalId: string;
    proposalNumber: string;
    ownerId?: string;
    ownerName?: string;
    nextFollowupDate?: string | null;
  }) {
    this.eventsGateway.broadcast('proposal:followup_added', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_OUTCOME_RECORDED)
  async handleProposalOutcomeRecorded(payload: {
    proposalId: string;
    proposalNumber: string;
    outcome?: string;
    lostReason?: string | null;
    actorId?: string;
  }) {
    const mgmt = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const m of mgmt) {
      if (m.id !== payload.actorId) {
        await this.createAndPushNotification({
          userId: m.id,
          type: 'proposal_outcome',
          title: `Proposal Concluded: ${payload.proposalNumber} [${payload.outcome}]`,
          body: `Proposal ${payload.proposalNumber} marked as ${payload.outcome}${payload.lostReason ? ` (${payload.lostReason})` : ''}.`,
          entityType: 'proposal',
          entityId: payload.proposalId,
        });
      }
    }

    this.eventsGateway.broadcast('proposal:outcome', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_STATUS_CHANGED)
  async handleProposalStatusChanged(payload: any) {
    this.eventsGateway.broadcast('proposal:updated', payload);
  }

  @OnEvent(AppEvents.PROPOSAL_OVERDUE_FOLLOWUP)
  async handleProposalOverdueFollowup(payload: {
    proposalId: string;
    proposalNumber: string;
    followUpOwnerId?: string;
  }) {
    if (payload.followUpOwnerId) {
      await this.createAndPushNotification({
        userId: payload.followUpOwnerId,
        type: 'proposal_overdue',
        title: `Overdue Follow-up: ${payload.proposalNumber}`,
        body: `Proposal ${payload.proposalNumber} has an overdue customer follow-up. Please log client interaction.`,
        entityType: 'proposal',
        entityId: payload.proposalId,
      });
    }

    this.eventsGateway.broadcast('proposal:overdue_alert', payload);
  }

  // ==========================================
  // MODULE 1: LEADS & CUSTOMER DOMAIN EVENTS
  // ==========================================

  @OnEvent(AppEvents.LEAD_CREATED)
  async handleLeadCreated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      organisationName: string;
      leadType: string;
      leadStatus: string;
      assignedTo: string;
      regionalManagerId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadCreated'))) {
      return;
    }

    if (payload.assignedTo) {
      await this.createAndPushNotification({
        userId: payload.assignedTo,
        type: 'lead_assigned',
        title: `New Lead Registered: ${payload.organisationName}`,
        body: `A ${payload.leadType.toUpperCase()} lead has been created and assigned to you.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    if (payload.regionalManagerId && payload.regionalManagerId !== payload.assignedTo) {
      await this.createAndPushNotification({
        userId: payload.regionalManagerId,
        type: 'lead_registered',
        title: `Territory Lead Alert: ${payload.organisationName}`,
        body: `New ${payload.leadType.toUpperCase()} lead registered in your region.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    this.eventsGateway.broadcast('lead:created', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadCreated');
    }
  }

  @OnEvent(AppEvents.LEAD_RE_APPROACHED)
  async handleLeadReApproached(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      organisationName: string;
      assignedTo: string;
      regionalManagerId?: string;
      reason?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadReApproached'))) {
      return;
    }

    if (payload.assignedTo) {
      await this.createAndPushNotification({
        userId: payload.assignedTo,
        type: 'lead_re_approached',
        title: `Re-Approached Account: ${payload.organisationName}`,
        body: `An existing account with historical interactions has been re-approached for a new sales cycle.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    this.eventsGateway.broadcast('lead:re_approached', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadReApproached');
    }
  }

  @OnEvent(AppEvents.LEAD_ASSIGNED)
  async handleLeadAssigned(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      previousSalespersonId?: string;
      newSalespersonId: string;
      previousRegionalManagerId?: string;
      newRegionalManagerId?: string;
      reason?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadAssigned'))) {
      return;
    }

    // Notify new salesperson
    await this.createAndPushNotification({
      userId: payload.newSalespersonId,
      type: 'lead_assigned',
      title: 'Lead Ownership Assigned',
      body: `You are now the designated owner for lead. Reason: ${payload.reason || 'Management reassignment'}.`,
      entityType: 'lead',
      entityId: payload.leadId,
    });

    // If reassigned from someone else, notify previous salesperson
    if (payload.previousSalespersonId && payload.previousSalespersonId !== payload.newSalespersonId) {
      await this.createAndPushNotification({
        userId: payload.previousSalespersonId,
        type: 'lead_reassigned',
        title: 'Lead Ownership Transitioned',
        body: `Ownership of lead has transitioned to another team member.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    this.eventsGateway.broadcast('lead:assigned', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadAssigned');
    }
  }

  @OnEvent(AppEvents.LEAD_STATUS_CHANGED)
  async handleLeadStatusChanged(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      fromStatus: string;
      toStatus: string;
      lossReason?: string;
      assignedTo?: string;
      regionalManagerId?: string;
      actorId?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadStatusChanged'))) {
      return;
    }

    // Resolve organisation name for professional notification context
    let orgName = 'Account';
    if (payload.organisationId) {
      try {
        const org = await this.db
          .selectFrom('organisations')
          .select('name')
          .where('id', '=', payload.organisationId)
          .executeTakeFirst();
        if (org?.name) orgName = org.name;
      } catch (err: any) {
        // Continue with default
      }
    }

    const stageUpper = payload.toStatus.toUpperCase();

    // 1. Notify Demo Team if stage advanced to DEMO
    if (payload.toStatus === 'demo') {
      const demoUsers = await this.db
        .selectFrom('users')
        .select('id')
        .where('role', 'in', ['demo_team', 'management'])
        .where('is_active', '=', true)
        .execute();

      for (const u of demoUsers) {
        if (u.id !== payload.actorId) {
          await this.createAndPushNotification({
            userId: u.id,
            type: 'demo_required',
            title: `🎯 Demo Stage: Action Required`,
            body: `Opportunity for ${orgName} advanced to DEMO stage. Equipment coordination and field demo team required.`,
            entityType: 'lead',
            entityId: payload.leadId,
          });
        }
      }
      this.eventsGateway.sendToRole('demo_team', 'lead:status_changed', payload);
    }

    // 2. Notify Tender/Proposal Team if stage advanced to PROPOSAL
    if (payload.toStatus === 'proposal') {
      const tenderUsers = await this.db
        .selectFrom('users')
        .select('id')
        .where('role', 'in', ['tender_team', 'management'])
        .where('is_active', '=', true)
        .execute();

      for (const u of tenderUsers) {
        if (u.id !== payload.actorId) {
          await this.createAndPushNotification({
            userId: u.id,
            type: 'proposal_required',
            title: `📄 Proposal Stage: Action Required`,
            body: `Opportunity for ${orgName} advanced to PROPOSAL stage. Tender & commercial proposal structuring requested.`,
            entityType: 'lead',
            entityId: payload.leadId,
          });
        }
      }
      this.eventsGateway.sendToRole('tender_team', 'lead:status_changed', payload);
    }

    // 3. Notify Tender Team if stage moved to TENDER_DISCUSSION
    if (payload.toStatus === 'tender_discussion') {
      const tenderUsers = await this.db
        .selectFrom('users')
        .select('id')
        .where('role', 'in', ['tender_team', 'management'])
        .where('is_active', '=', true)
        .execute();

      for (const u of tenderUsers) {
        if (u.id !== payload.actorId) {
          await this.createAndPushNotification({
            userId: u.id,
            type: 'tender_discussion',
            title: `🤝 Tender Discussion Scheduled`,
            body: `Opportunity for ${orgName} is now in TENDER DISCUSSION stage. Review technical clauses and buyer requirements.`,
            entityType: 'lead',
            entityId: payload.leadId,
          });
        }
      }
      this.eventsGateway.sendToRole('tender_team', 'lead:status_changed', payload);
    }

    // 4. Notify Regional Manager
    if (payload.regionalManagerId && payload.regionalManagerId !== payload.actorId && payload.regionalManagerId !== payload.assignedTo) {
      await this.createAndPushNotification({
        userId: payload.regionalManagerId,
        type: 'lead_status',
        title: `Lead Pipeline Progress: ${stageUpper}`,
        body: `Opportunity for ${orgName} progressed from ${payload.fromStatus} to ${payload.toStatus}.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    // 5. Always notify assigned salesperson (if not the actor)
    if (payload.assignedTo && payload.assignedTo !== payload.actorId) {
      await this.createAndPushNotification({
        userId: payload.assignedTo,
        type: 'lead_status',
        title: `Lead Pipeline Stage: ${stageUpper}`,
        body: `Opportunity for ${orgName} progressed from ${payload.fromStatus} to ${payload.toStatus}.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    this.eventsGateway.broadcast('lead:status_changed', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadStatusChanged');
    }
  }

  @OnEvent(AppEvents.LEAD_CONVERTED)
  async handleLeadConverted(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      assignedTo?: string;
      valueLakh?: number;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadConverted'))) {
      return;
    }

    // Broadcast win to management
    const mgmt = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'management')
      .where('is_active', '=', true)
      .execute();

    for (const m of mgmt) {
      await this.createAndPushNotification({
        userId: m.id,
        type: 'lead_converted',
        title: '🎉 Lead Converted to Customer!',
        body: `Lead converted successfully! Estimated value: ${payload.valueLakh ? `₹${payload.valueLakh} Lakh` : 'N/A'}.`,
        entityType: 'lead',
        entityId: payload.leadId,
      });
    }

    this.eventsGateway.broadcast('lead:converted', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadConverted');
    }
  }

  @OnEvent(AppEvents.LEAD_LOST)
  async handleLeadLost(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      leadId: string;
      organisationId: string;
      lossReason?: string;
      assignedTo?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.leadLost'))) {
      return;
    }

    this.eventsGateway.broadcast('lead:lost', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.leadLost');
    }
  }

  @OnEvent(AppEvents.INTERACTION_CREATED)
  async handleInteractionCreated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      interactionId: string;
      organisationId: string;
      leadId?: string;
      type: string;
      employeeId: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.interactionCreated'))) {
      return;
    }

    this.eventsGateway.broadcast('interaction:created', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.interactionCreated');
    }
  }

  @OnEvent(AppEvents.FOLLOWUP_CREATED)
  async handleFollowUpCreated(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      followUpId: string;
      organisationId: string;
      leadId?: string;
      assignedTo: string;
      dueDate: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.followUpCreated'))) {
      return;
    }

    await this.createAndPushNotification({
      userId: payload.assignedTo,
      type: 'followup_assigned',
      title: 'Action Required: Client Follow-up Scheduled',
      body: `A follow-up has been scheduled for ${payload.dueDate}.`,
      entityType: 'follow_up',
      entityId: payload.followUpId,
    });

    this.eventsGateway.broadcast('followup:created', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.followUpCreated');
    }
  }

  @OnEvent(AppEvents.FOLLOWUP_COMPLETED)
  async handleFollowUpCompleted(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      followUpId: string;
      outcome?: string;
      nextFollowUpDate?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.followUpCompleted'))) {
      return;
    }

    this.eventsGateway.broadcast('followup:completed', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.followUpCompleted');
    }
  }

  @OnEvent(AppEvents.FOLLOWUP_OVERDUE)
  async handleFollowUpOverdue(eventInput: any) {
    const { payload, eventId } = this.unpackEvent<{
      followUpId: string;
      assignedTo: string;
      dueDate: string;
      organisationName?: string;
    }>(eventInput);

    if (eventId && (await this.outboxService.isEventProcessed(eventId, 'NotificationListener.followUpOverdue'))) {
      return;
    }

    await this.createAndPushNotification({
      userId: payload.assignedTo,
      type: 'followup_overdue',
      title: '⚠️ OVERDUE: Customer Follow-up Pending',
      body: `Follow-up for ${payload.organisationName || 'Client'} was due on ${payload.dueDate}. Immediate touchpoint needed.`,
      entityType: 'follow_up',
      entityId: payload.followUpId,
    });

    this.eventsGateway.broadcast('followup:overdue_alert', payload);

    if (eventId) {
      await this.outboxService.markEventProcessed(eventId, 'NotificationListener.followUpOverdue');
    }
  }

  // =======================================================================
  // Module 6 — Service & After-Sales
  // =======================================================================
  private async activeUserIds(role: UserRole, zoneId?: string | null, includeNoZone = false): Promise<string[]> {
    let q = this.db.selectFrom('users').select('id').where('role', '=', role).where('is_active', '=', true);
    if (zoneId) {
      q = includeNoZone
        ? q.where((eb) => eb.or([eb('zone_id', '=', zoneId), eb('zone_id', 'is', null)]))
        : q.where('zone_id', '=', zoneId);
    }
    return (await q.execute()).map((r) => r.id);
  }

  private async serviceAudience(p: { zoneId?: string | null; organisationId?: string; creatorId?: string | null }) {
    const management = await this.activeUserIds('management');
    let regionalManagers = p.zoneId ? await this.activeUserIds('regional_manager', p.zoneId) : [];
    if (regionalManagers.length === 0) regionalManagers = management; // nobody owns the zone → management sees it
    const serviceTeam = await this.activeUserIds('service_team', p.zoneId, true);

    const sales = new Set<string>();
    if (p.organisationId) {
      const owners = await this.db
        .selectFrom('leads')
        .select('assigned_to')
        .where('organisation_id', '=', p.organisationId)
        .where('assigned_to', 'is not', null)
        .distinct()
        .execute();
      owners.forEach((o) => o.assigned_to && sales.add(o.assigned_to));
    }
    if (p.creatorId) {
      const c = await this.db.selectFrom('users').select(['id', 'role']).where('id', '=', p.creatorId).executeTakeFirst();
      if (c?.role === 'sales') sales.add(c.id);
    }
    return { management, regionalManagers, serviceTeam, sales: [...sales] };
  }

  private async notifyUsers(
    groups: (string | null | undefined)[][],
    exceptIds: (string | null | undefined)[],
    data: { type: string; title: string; body: string; entityType?: string; entityId: string },
  ) {
    const skip = new Set(exceptIds.filter(Boolean) as string[]);
    const targets = new Set<string>();
    for (const g of groups) for (const id of g) if (id && !skip.has(id)) targets.add(id);
    for (const userId of targets) {
      await this.createAndPushNotification({ userId, entityType: 'service_ticket', ...data });
    }
  }

  @OnEvent(AppEvents.SERVICE_CREATED)
  async handleServiceCreated(p: any) {
    if (p.portal) return; // portal submissions get the richer SERVICE_PORTAL_REQUEST alert
    const a = await this.serviceAudience(p);
    const loud = p.priority === 'critical' || p.isRepeat || p.unverified;
    await this.notifyUsers(
      [a.serviceTeam, a.regionalManagers, a.sales, loud ? a.management : []],
      [p.actorId, p.assignedTo],
      {
        type: 'service_ticket_created',
        title: `${p.priority === 'critical' ? '🚨 CRITICAL ' : ''}New service ticket ${p.ticketNo}`,
        body: `${p.organisationName || 'Customer'} reported a ${p.priority} priority fault${p.isRepeat ? ' (REPEAT complaint)' : ''}.`,
        entityId: p.ticketId,
      },
    );
    this.eventsGateway.sendToRole('service_team', 'service:ticket_created', p);
  }

  @OnEvent(AppEvents.SERVICE_PORTAL_REQUEST)
  async handleServicePortalRequest(p: any) {
    const a = await this.serviceAudience(p);
    const loud = p.priority === 'critical' || p.isRepeat || !p.verified;
    await this.notifyUsers([a.serviceTeam, a.regionalManagers, a.sales, loud ? a.management : []], [p.assignedTo], {
      type: 'service_portal_request',
      title: `${p.priority === 'critical' ? '🚨 CRITICAL ' : ''}Customer portal request ${p.ticketNo}`,
      body: `${p.claimedOrganisation} (${p.contactName}, ${p.contactPhone}) raised a ${p.priority} fault${p.verified ? '' : ' — customer NOT verified, please link the account'}${p.isRepeat ? ' · repeat complaint' : ''}.`,
      entityId: p.ticketId,
    });
    this.eventsGateway.sendToRole('service_team', 'service:portal_request', p);
    this.eventsGateway.sendToRole('regional_manager', 'service:portal_request', p);
  }

  @OnEvent(AppEvents.SERVICE_ASSIGNED)
  async handleServiceAssigned(p: any) {
    if (p.engineerId && p.engineerId !== p.actorId) {
      await this.createAndPushNotification({
        userId: p.engineerId,
        type: 'service_ticket_assigned',
        title: `Service ticket assigned: ${p.ticketNo}`,
        body: `${p.organisationName || 'Customer'} — ${p.priority} priority. Open the ticket to schedule your visit.`,
        entityType: 'service_ticket',
        entityId: p.ticketId,
      });
    }
    if (p.previousEngineerId && p.previousEngineerId !== p.actorId && p.previousEngineerId !== p.engineerId) {
      await this.createAndPushNotification({
        userId: p.previousEngineerId,
        type: 'service_ticket_reassigned',
        title: `Ticket ${p.ticketNo} reassigned`,
        body: 'This ticket has been moved to another engineer.',
        entityType: 'service_ticket',
        entityId: p.ticketId,
      });
    }
  }

  @OnEvent(AppEvents.SERVICE_STATUS_CHANGED)
  async handleServiceStatusChanged(p: any) {
    const a = await this.serviceAudience(p);
    const to = String(p.to);
    if (to === 'resolved') this.eventsGateway.sendToRole('service_team', 'service:resolved', p);
    const managerFacing = ['awaiting_part', 'awaiting_customer', 'on_hold', 'revisit_required', 'resolved', 'report_submitted', 'cancelled'].includes(to);
    const salesFacing = ['resolved', 'report_submitted', 'cancelled'].includes(to);
    await this.notifyUsers(
      [[p.assignedTo], [p.creatorId], managerFacing ? a.regionalManagers : [], salesFacing ? a.sales : []],
      [p.actorId],
      {
        type: 'service_status_changed',
        title: `Ticket ${p.ticketNo}: ${to.replace(/_/g, ' ')}`,
        body: `${p.organisationName || 'Customer'} — moved from ${String(p.from).replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}${p.reason ? `. ${String(p.reason).slice(0, 140)}` : ''}`,
        entityId: p.ticketId,
      },
    );
  }

  @OnEvent(AppEvents.SERVICE_ESCALATED)
  async handleServiceEscalated(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([a.management, a.regionalManagers], [p.actorId], {
      type: 'service_escalated',
      title: `🚨 Escalated: ${p.ticketNo}`,
      body: `${p.organisationName || 'Customer'} (${p.priority}) needs senior attention.${p.reason ? ` ${String(p.reason).slice(0, 160)}` : ''}`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_REPORT_SUBMITTED)
  async handleServiceReportSubmitted(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([a.regionalManagers, a.sales], [p.actorId], {
      type: 'service_report_submitted',
      title: `Service report filed: ${p.ticketNo}`,
      body: p.furtherWork
        ? `${p.organisationName || 'Customer'} — further work required, revisit pending.`
        : `${p.organisationName || 'Customer'} — report awaiting your approval and closure.`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_CLOSED)
  async handleServiceClosed(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([a.sales, [p.creatorId], [p.assignedTo]], [p.actorId], {
      type: 'service_closed',
      title: `Ticket closed: ${p.ticketNo}`,
      body: `${p.organisationName || 'Customer'} — service ticket closed and signed off.`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_REOPENED)
  async handleServiceReopened(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([a.management, a.regionalManagers, [p.assignedTo]], [p.actorId], {
      type: 'service_reopened',
      title: `Ticket reopened: ${p.ticketNo}`,
      body: `${p.organisationName || 'Customer'} — reopened.${p.reason ? ` ${String(p.reason).slice(0, 160)}` : ''}`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_SLA_BREACHED)
  async handleServiceSlaBreached(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([[p.assignedTo], a.regionalManagers, a.management, p.priority === 'critical' ? a.serviceTeam : []], [], {
      type: 'service_sla_breached',
      title: `⏱ SLA ${p.kind === 'response' ? 'response' : 'resolution'} breached: ${p.ticketNo}`,
      body: `${p.organisationName || 'Customer'} (${p.priority}) has passed its ${p.kind} deadline${p.priority === 'critical' ? ' — Liquidated Damages risk' : ''}.`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_PART_ISSUED)
  async handleServicePartIssued(p: any) {
    if (!p.assignedTo || p.assignedTo === p.actorId) return;
    await this.createAndPushNotification({
      userId: p.assignedTo,
      type: 'service_part_issued',
      title: `Spare issued for ${p.ticketNo}`,
      body: `${p.quantity} × ${p.partName} issued from stores.`,
      entityType: 'service_ticket',
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_CUSTOMER_COMMENT)
  async handleServiceCustomerComment(p: any) {
    const a = await this.serviceAudience(p);
    await this.notifyUsers([p.assignedTo ? [p.assignedTo] : a.serviceTeam, a.regionalManagers], [], {
      type: 'service_customer_comment',
      title: `Customer message on ${p.ticketNo}`,
      body: `${p.contactName || 'Customer'}: “${p.excerpt || ''}”`,
      entityId: p.ticketId,
    });
  }

  @OnEvent(AppEvents.SERVICE_CUSTOMER_FEEDBACK)
  async handleServiceCustomerFeedback(p: any) {
    const a = await this.serviceAudience(p);
    if (p.action === 'confirm_resolved') {
      await this.notifyUsers([a.regionalManagers, [p.assignedTo]], [], {
        type: 'service_customer_confirmed',
        title: `Customer confirmed fix: ${p.ticketNo}`,
        body: `${p.contactName || 'Customer'} confirmed resolution${p.rating ? ` (${p.rating}/5)` : ''}. Approve the report and close the ticket.`,
        entityId: p.ticketId,
      });
    } else {
      await this.notifyUsers([[p.assignedTo], a.regionalManagers, a.management], [], {
        type: 'service_customer_unresolved',
        title: `🚨 Customer says NOT fixed: ${p.ticketNo}`,
        body: `${p.contactName || 'Customer'}: ${String(p.remarks || '').slice(0, 160)}`,
        entityId: p.ticketId,
      });
    }
  }
}

