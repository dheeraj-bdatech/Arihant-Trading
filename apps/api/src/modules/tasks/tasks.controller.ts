/**
 * Module 8 HTTP API. Bodies are plain objects validated field-by-field in the services, so every failure comes
 * back as `{ code: 'VALIDATION_FAILED', errors: { field: message } }` (400); permission 403, missing/out-of-scope
 * 404, invalid transition / stale version 409. Role scoping is enforced in the services for every read.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthUser, TaskAction } from '@arihant/shared';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { loadTaskConfig } from './task.config.js';
import { TasksService } from './tasks.service.js';
import { TaskWorkflowService } from './task-workflow.service.js';
import { TaskBlockersService } from './task-blockers.service.js';
import { TaskTemplatesService } from './task-templates.service.js';
import { TaskAttachmentsService, type UploadedFile as TaskFile } from './task-attachments.service.js';
import { TaskMastersService } from './task-masters.service.js';
import { TaskAccountabilityService } from './task-accountability.service.js';
import { PerformanceEvidenceService } from './performance-evidence.service.js';
import { PerformanceReviewsService } from './performance-reviews.service.js';

type Body_ = Record<string, unknown>;
const uploadLimits = { limits: { fileSize: loadTaskConfig().maxFileBytes, files: 1 } };

function sendFile(res: Response, buffer: Buffer, fileName: string, mime: string, extra: Record<string, string> = {}) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.send(buffer);
}

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// ============================================================================ masters & settings
@Controller('task-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskCategoriesController {
  constructor(private readonly masters: TaskMastersService) {}

  @Get()
  list(@Query('include_inactive') includeInactive: string) {
    return this.masters.listCategories(includeInactive === 'true');
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.createCategory(dto, user);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.updateCategory(id, dto, user);
  }
}

@Controller('task-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskSettingsController {
  constructor(private readonly masters: TaskMastersService) {}

  @Get()
  get() {
    return this.masters.settings(true);
  }

  @Patch()
  @Roles('admin')
  update(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.updateSettings(dto, user);
  }
}

@Controller('task-calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskCalendarController {
  constructor(
    private readonly masters: TaskMastersService,
    private readonly tasks: TasksService,
    private readonly blockers: TaskBlockersService,
  ) {}

  @Get('holidays')
  holidays(@Query('from') from: string, @Query('to') to: string) {
    return this.masters.listHolidays(from, to);
  }

  @Post('holidays')
  createHoliday(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.createHoliday(dto, user);
  }

  @Delete('holidays/:id')
  removeHoliday(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.masters.removeHoliday(id, user);
  }

  @Get('leaves')
  leaves(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.listLeaves(query, user);
  }

  @Post('leaves')
  createLeave(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.createLeave(dto, user);
  }

  @Post('leaves/:id/cancel') @HttpCode(200)
  async cancelLeave(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    const leave = await this.masters.cancelLeave(id, dto, user);
    await this.blockers.closeForCancelledLeave(id, user);
    return leave;
  }

  @Get('departments')
  departments() {
    return this.masters.listDepartments();
  }

  @Patch('departments/:id')
  @Roles('admin')
  setHead(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.setDepartmentHead(id, dto, user);
  }

  @Patch('users/:id/department')
  @Roles('admin')
  setUserDepartment(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.masters.setUserDepartment(id, dto, user);
  }

  @Get('hints')
  hints(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.calendarHints(query, user);
  }
}

// ============================================================================ tasks
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly workflow: TaskWorkflowService,
    private readonly blockers: TaskBlockersService,
    private readonly templates: TaskTemplatesService,
    private readonly attachments: TaskAttachmentsService,
  ) {}

  @Get()
  list(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.list(query, user);
  }

  /** One-time tasks (bulk = one task per assignee); a recurrence creates template(s) and their first instances. */
  @Post()
  create(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    const recurrence = typeof dto.recurrence_type === 'string' ? dto.recurrence_type : 'one_time';
    return recurrence !== 'one_time' ? this.templates.create(dto, user) : this.tasks.create(dto, user);
  }

  @Post('check') @HttpCode(200)
  check(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.check(dto, user);
  }

  @Get('my/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.tasks.summary(user);
  }

  @Get('approvals/pending')
  approvals(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.approvalsQueue(query, user);
  }

  @Get('needs-reassignment')
  needsReassignment(@CurrentUser() user: AuthUser) {
    return this.tasks.needsReassignment(user);
  }

  @Get('lookups/assignees')
  assignees(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.lookupAssignees(query, user);
  }

  @Get('lookups/links')
  links(@Query() query: Body_) {
    return this.tasks.lookupLinks(query);
  }

  @Post('bulk/reassign') @HttpCode(200)
  bulkReassign(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.workflow.bulk('reassign', dto, user);
  }

  @Post('bulk/extend-deadline') @HttpCode(200)
  bulkExtend(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.workflow.bulk('extend_deadline', dto, user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.detail(id, user);
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.tasks.edit(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.remove(id, user);
  }

  private act(id: string, action: TaskAction, dto: Body_, user: AuthUser) {
    return this.workflow.act(id, action, dto, user);
  }

  @Post(':id/start') @HttpCode(200)
  start(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'start', dto, user);
  }

  @Post(':id/progress') @HttpCode(200)
  progress(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'progress', dto, user);
  }

  @Post(':id/complete') @HttpCode(200)
  complete(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'complete', dto, user);
  }

  @Post(':id/approve') @HttpCode(200)
  approve(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'approve', dto, user);
  }

  @Post(':id/send-back') @HttpCode(200)
  sendBack(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'send_back', dto, user);
  }

  @Post(':id/reopen') @HttpCode(200)
  reopen(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'reopen', dto, user);
  }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'cancel', dto, user);
  }

  @Post(':id/extend-deadline') @HttpCode(200)
  extend(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'extend_deadline', dto, user);
  }

  @Post(':id/reassign') @HttpCode(200)
  reassign(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'reassign', dto, user);
  }

  @Get(':id/escalation-targets')
  escalationTargets(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.workflow.listEscalationTargets(id, user);
  }

  @Post(':id/escalate') @HttpCode(200)
  escalate(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'escalate', dto, user);
  }

  /** Admin data correction with a mandatory reason — never a silent DB edit (§7.33). */
  @Post(':id/correction') @HttpCode(200)
  @Roles('admin')
  correction(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.act(id, 'correction', dto, user);
  }

  @Post(':id/blockers')
  raiseBlocker(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.raise(id, dto, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  upload(@Param('id') id: string, @UploadedFile() file: TaskFile, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.attachments.upload(id, file, dto, user);
  }
}

@Controller('task-attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskAttachmentsController {
  constructor(private readonly attachments: TaskAttachmentsService) {}

  @Get(':id')
  async download(@Param('id') id: string, @Query('download') download: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const file = await this.attachments.open(id, user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `${download === 'true' ? 'attachment' : 'inline'}; filename="${file.fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.remove(id, user);
  }
}

// ============================================================================ blockers & escalations
@Controller('task-blockers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskBlockersController {
  constructor(private readonly blockers: TaskBlockersService) {}

  @Get('pending')
  pending(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.pendingQueue(query, user);
  }

  @Get('waiting-on-me')
  waiting(@CurrentUser() user: AuthUser) {
    return this.blockers.waitingOnMe(user);
  }

  @Post(':id/withdraw') @HttpCode(200)
  withdraw(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.withdraw(id, dto, user);
  }

  @Post(':id/accept') @HttpCode(200)
  accept(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.accept(id, dto, user);
  }

  @Post(':id/reject') @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.reject(id, dto, user);
  }

  @Post(':id/resolve') @HttpCode(200)
  resolve(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.blockers.resolve(id, dto, user);
  }
}

@Controller('task-escalations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskEscalationsController {
  constructor(private readonly workflow: TaskWorkflowService) {}

  @Post(':id/acknowledge') @HttpCode(200)
  acknowledge(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.workflow.escalationAction(id, 'acknowledge', dto, user);
  }

  @Post(':id/close') @HttpCode(200)
  close(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.workflow.escalationAction(id, 'close', dto, user);
  }
}

// ============================================================================ recurring templates
@Controller('task-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskTemplatesController {
  constructor(private readonly templates: TaskTemplatesService) {}

  @Get()
  list(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.list(query, user);
  }

  @Post()
  create(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.create(dto, user);
  }

  /** Next occurrences for the unsaved recurrence builder. */
  @Post('preview') @HttpCode(200)
  previewDraft(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.previewDraft(dto, user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.templates.detail(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.update(id, dto, user);
  }

  @Get(':id/preview')
  preview(@Param('id') id: string, @Query('count') count: string, @CurrentUser() user: AuthUser) {
    return this.templates.preview(id, Number(count) || 10, user);
  }

  @Post(':id/pause') @HttpCode(200)
  pause(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.setStatus(id, 'pause', dto, user);
  }

  @Post(':id/resume') @HttpCode(200)
  resume(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.setStatus(id, 'resume', dto, user);
  }

  @Post(':id/end') @HttpCode(200)
  end(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.templates.setStatus(id, 'end', dto, user);
  }
}

// ============================================================================ accountability & evidence
@Controller('accountability')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountabilityController {
  constructor(private readonly accountability: TaskAccountabilityService) {}

  @Get('dashboard')
  dashboard(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.accountability.dashboard(query, user);
  }

  @Get('flags')
  flags(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.accountability.flags(query, user);
  }
}

@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceEvidenceController {
  constructor(private readonly evidence: PerformanceEvidenceService) {}

  @Get('evidence')
  async live(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.evidence.report(await this.evidence.parse(query), user);
  }

  @Get('evidence/export')
  async export(@Query() query: Body_, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const format = query.format === 'xlsx' ? 'xlsx' : 'pdf';
    const out = await this.evidence.exportLive(query, format, user);
    sendFile(res, out.buffer, out.fileName, MIME[format]);
  }

  @Post('evidence/snapshots')
  snapshot(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.evidence.createSnapshot(dto, user);
  }

  @Get('evidence/snapshots')
  snapshots(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.evidence.listSnapshots(query, user);
  }

  @Get('evidence/snapshots/:id')
  getSnapshot(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.evidence.getSnapshot(id, user);
  }

  @Get('evidence/snapshots/:id/file')
  async snapshotFile(@Param('id') id: string, @Query('format') fmt: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const format = fmt === 'xlsx' ? 'xlsx' : 'pdf';
    const out = await this.evidence.snapshotFile(id, format, user);
    sendFile(res, out.buffer, out.fileName, MIME[format], { 'X-Evidence-Integrity': out.integrity });
  }
}

@Controller('performance-reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceReviewsController {
  constructor(private readonly reviews: PerformanceReviewsService) {}

  @Get()
  list(@Query() query: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.list(query, user);
  }

  @Post()
  create(@Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.create(dto, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reviews.get(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.update(id, dto, user);
  }

  @Post(':id/submit') @HttpCode(200)
  submit(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.submit(id, dto, user);
  }

  @Post(':id/respond') @HttpCode(200)
  respond(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.respond(id, dto, user);
  }

  @Post(':id/acknowledge') @HttpCode(200)
  acknowledge(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.acknowledge(id, dto, user);
  }

  @Post(':id/revise') @HttpCode(200)
  revise(@Param('id') id: string, @Body() dto: Body_, @CurrentUser() user: AuthUser) {
    return this.reviews.revise(id, dto, user);
  }
}
