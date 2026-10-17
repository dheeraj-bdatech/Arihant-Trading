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
import { todayInKolkata, type AuthUser, type ExpenseClaimAction } from '@arihant/shared';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { loadExpenseConfig } from './expense.config.js';
import { ExpenseClaimsService } from './expense-claims.service.js';
import { ExpenseWorkflowService } from './expense-workflow.service.js';
import { ExpenseAttachmentsService, type UploadedFile as ReceiptFile } from './expense-attachments.service.js';
import { ExpenseReportsService } from './expense-reports.service.js';
import { ExpenseImportService } from './expense-import.service.js';
import { ExpenseMastersService } from './expense-masters.service.js';
import {
  ClaimHeaderDto,
  ExpenseCategoryDto,
  ExpenseItemDto,
  ImportClaimDto,
  ProjectDto,
  ReassignApproverDto,
  TransitionDto,
} from './expense.dto.js';

const uploadLimits = { limits: { fileSize: loadExpenseConfig().maxFileBytes, files: 1 } };

@Controller('expense-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseCategoriesController {
  constructor(private readonly masters: ExpenseMastersService) {}

  @Get()
  list(@Query('include_inactive') includeInactive: string, @CurrentUser() user: AuthUser) {
    return this.masters.listCategories(user, includeInactive === 'true');
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: ExpenseCategoryDto, @CurrentUser() user: AuthUser) {
    return this.masters.createCategory(dto, user);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: ExpenseCategoryDto, @CurrentUser() user: AuthUser) {
    return this.masters.updateCategory(id, dto, user);
  }
}

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly masters: ExpenseMastersService) {}

  @Get()
  list(@Query('include_inactive') includeInactive: string, @Query('search') search: string) {
    return this.masters.listProjects(includeInactive === 'true', search);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: ProjectDto, @CurrentUser() user: AuthUser) {
    return this.masters.createProject(dto, user);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: ProjectDto, @CurrentUser() user: AuthUser) {
    return this.masters.updateProject(id, dto, user);
  }
}

@Controller('expense-claims')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseClaimsController {
  constructor(
    private readonly claims: ExpenseClaimsService,
    private readonly workflow: ExpenseWorkflowService,
    private readonly importer: ExpenseImportService,
  ) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.claims.list(query, user, { mineOnly: query.mine === 'true' });
  }

  @Get('pending/manager')
  managerQueue(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.claims.managerQueue(query, user);
  }

  @Get('pending/accounts')
  accountsQueue(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.claims.accountsQueue(query, user);
  }

  @Get('badge-counts')
  badgeCounts(@CurrentUser() user: AuthUser) {
    return this.claims.badgeCounts(user);
  }

  @Get('linkable')
  linkable(@CurrentUser() user: AuthUser) {
    return this.claims.linkableTrips(user);
  }

  @Get('import/template')
  async template(@Res() res: Response) {
    const buf = await this.importer.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="arihant-expense-template.xlsx"');
    res.send(buf);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  import(@UploadedFile() file: ReceiptFile, @Body() dto: ImportClaimDto, @CurrentUser() user: AuthUser) {
    return this.importer.import(file, dto, user);
  }

  @Post()
  create(@Body() dto: ClaimHeaderDto, @CurrentUser() user: AuthUser) {
    return this.claims.createDraft(dto, user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.getDetail(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ClaimHeaderDto, @CurrentUser() user: AuthUser) {
    return this.claims.updateHeader(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.softDeleteDraft(id, user);
  }

  @Post(':id/copy')
  copy(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.copyToDraft(id, user);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: ExpenseItemDto, @CurrentUser() user: AuthUser) {
    return this.claims.saveItem(id, null, dto, user);
  }

  @Patch(':id/items/:itemId')
  updateItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: ExpenseItemDto, @CurrentUser() user: AuthUser) {
    return this.claims.saveItem(id, itemId, dto, user);
  }

  @Delete(':id/items/:itemId')
  deleteItem(@Param('id') id: string, @Param('itemId') itemId: string, @Query('version') version: string, @CurrentUser() user: AuthUser) {
    return this.claims.deleteItem(id, itemId, user, version);
  }

  private act(id: string, action: ExpenseClaimAction, dto: TransitionDto, user: AuthUser) {
    return this.workflow.transition(id, action, dto, user);
  }

  @Post(':id/submit') @HttpCode(200)
  submit(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'submit', dto, user);
  }

  @Post(':id/withdraw') @HttpCode(200)
  withdraw(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'withdraw', dto, user);
  }

  @Post(':id/manager-approve') @HttpCode(200)
  managerApprove(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'manager_approve', dto, user);
  }

  @Post(':id/manager-reject') @HttpCode(200)
  managerReject(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'manager_reject', dto, user);
  }

  @Post(':id/request-clarification') @HttpCode(200)
  clarify(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'request_clarification', dto, user);
  }

  @Post(':id/accounts-approve') @HttpCode(200)
  accountsApprove(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'accounts_approve', dto, user);
  }

  @Post(':id/accounts-reject') @HttpCode(200)
  accountsReject(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'accounts_reject', dto, user);
  }

  @Post(':id/process') @HttpCode(200)
  process(@Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.act(id, 'process', dto, user);
  }

  @Post(':id/reassign-approver') @HttpCode(200)
  @Roles('admin')
  reassign(@Param('id') id: string, @Body() dto: ReassignApproverDto, @CurrentUser() user: AuthUser) {
    return this.workflow.reassignApprover(id, dto, user);
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseAttachmentsController {
  constructor(private readonly attachments: ExpenseAttachmentsService) {}

  @Post('expense-items/:itemId/attachments')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  upload(@Param('itemId') itemId: string, @UploadedFile() file: ReceiptFile, @CurrentUser() user: AuthUser) {
    return this.attachments.upload(itemId, file, user);
  }

  @Get('expense-attachments/:id')
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

  @Delete('expense-attachments/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.remove(id, user);
  }
}

@Controller('expense-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseReportsController {
  constructor(private readonly reports: ExpenseReportsService) {}

  @Get()
  rows(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.reports.rows(query, user);
  }

  @Get('summary')
  summary(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.reports.summary(query, user);
  }

  @Get('customers')
  customers(@CurrentUser() user: AuthUser) {
    return this.reports.customers(user);
  }

  @Get('export')
  async export(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser, @Res() res: Response) {
    this.reports.parse(query); // validate before any bytes are sent
    const format = query.format === 'csv' ? 'csv' : 'xlsx';
    const stamp = todayInKolkata();
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="arihant-expenses-tally-${stamp}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.reports.exportTo(res, format, query, user);
    } catch (err) {
      if (!res.headersSent) throw err;
      res.destroy(err as Error);
    }
  }
}
