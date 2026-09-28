import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProposalsService } from './proposals.service.js';
import {
  CreateProposalDto,
  UpdateProposalDto,
  StartPreparationDto,
  SubmitForReviewDto,
  ApproveProposalDto,
  RequestChangesDto,
  ReviseInternalDto,
  SendProposalDto,
  FastTrackSendDto,
  RequestRevisionDto,
  MarkConvertedDto,
  MarkLostDto,
  CloseProposalDto,
  ReopenProposalDto,
  CreateProposalFollowupDto,
  PostponeFollowUpDto,
  CreateProposalVersionDto,
  ReassignProposalDto,
  BulkReassignDto,
  ProposalQueryDto,
  ProposalSettingsDto,
  ChangeProposalStatusDto,
  ImportProposalSheetDto,
} from './proposals.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

// In-memory idempotency cache for Idempotency-Key header (E62)
const idempotencyCache = new Map<string, { status: number; body: any; expiresAt: number }>();

@Controller('proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  /**
   * Helper to handle Idempotency-Key header (E62)
   */
  private checkIdempotency(key: string | undefined): { status: number; body: any } | null {
    if (!key) return null;
    const cached = idempotencyCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    return null;
  }

  private setIdempotency(key: string | undefined, status: number, body: any) {
    if (!key) return;
    idempotencyCache.set(key, { status, body, expiresAt: Date.now() + 300000 }); // 5 min TTL
  }

  // =========================================================================
  // 1. Dashboard, Reports & Settings (Must come before :id parameterized routes)
  // =========================================================================
  @Get('dashboard')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getDashboardStats(@CurrentUser() user: AuthUser) {
    return this.proposalsService.getDashboardStats(user);
  }

  @Get('reports/outcome')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getOutcomeReport(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.proposalsService.getOutcomeReport(query, user);
  }

  @Get('export')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async exportData(
    @Query() query: ProposalQueryDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const csvData = await this.proposalsService.exportData(query, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="proposals-export.csv"');
    return res.send(csvData);
  }

  @Post('import')
  @Roles('management', 'regional_manager', 'admin', 'sales')
  async importProposals(@Body() dto: ImportProposalSheetDto, @CurrentUser() user: AuthUser) {
    return this.proposalsService.importProposals(dto, user);
  }

  @Get('settings')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getSettings() {
    return this.proposalsService.getSettings();
  }

  @Put('settings')
  @Roles('admin', 'management')
  async updateSettings(@Body() dto: ProposalSettingsDto, @CurrentUser() user: AuthUser) {
    return this.proposalsService.updateSettings(dto, user);
  }

  @Get('admin/dead-letter')
  @Roles('admin', 'management')
  async getDeadLetterEvents(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.proposalsService.getDeadLetterEvents(query, user);
  }

  @Post('admin/dead-letter/:id/replay')
  @Roles('admin', 'management')
  async replayDeadLetterEvent(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposalsService.replayDeadLetterEvent(id, user);
  }

  @Post('admin/rebuild-projections')
  @Roles('admin', 'management')
  async rebuildProjections(@CurrentUser() user: AuthUser) {
    return this.proposalsService.rebuildProjections(user);
  }

  @Post('bulk-reassign')
  @Roles('management', 'regional_manager', 'admin')
  async bulkReassign(@Body() dto: BulkReassignDto, @CurrentUser() user: AuthUser) {
    return this.proposalsService.bulkReassign(dto, user);
  }

  // =========================================================================
  // 2. Proposal CRUD & Search
  // =========================================================================
  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async findAll(@Query() query: ProposalQueryDto, @CurrentUser() user: AuthUser) {
    return this.proposalsService.findAll(query, user);
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposalsService.findOne(id, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'admin', 'tender_team')
  async create(
    @Body() dto: CreateProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.create(dto, user);
    this.setIdempotency(idempotencyKey, 201, result);
    return result;
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    if (ifMatch && !dto.row_version) {
      dto.row_version = parseInt(ifMatch, 10);
    }
    return this.proposalsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposalsService.delete(id, user);
  }

  // =========================================================================
  // 3. Workflow State Transition Command Endpoints (Section 5)
  // =========================================================================
  @Post(':id/start-preparation')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async startPreparation(
    @Param('id') id: string,
    @Body() dto: StartPreparationDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.startPreparation(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/submit-for-review')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async submitForReview(
    @Param('id') id: string,
    @Body() dto: SubmitForReviewDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.submitForReview(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/approve')
  @Roles('management', 'regional_manager', 'admin')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.approve(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/request-changes')
  @Roles('management', 'regional_manager', 'admin')
  async requestChanges(
    @Param('id') id: string,
    @Body() dto: RequestChangesDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.requestChanges(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/revise-internal')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async reviseInternal(
    @Param('id') id: string,
    @Body() dto: ReviseInternalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.reviseInternal(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/send')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async send(
    @Param('id') id: string,
    @Body() dto: SendProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.send(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/fast-track-send')
  @Roles('management', 'admin', 'regional_manager')
  async fastTrackSend(
    @Param('id') id: string,
    @Body() dto: FastTrackSendDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.fastTrackSend(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/request-revision')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async requestRevision(
    @Param('id') id: string,
    @Body() dto: RequestRevisionDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.requestRevision(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/mark-converted')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async markConverted(
    @Param('id') id: string,
    @Body() dto: MarkConvertedDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.markConverted(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/mark-lost')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async markLost(
    @Param('id') id: string,
    @Body() dto: MarkLostDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.markLost(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/close')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async close(
    @Param('id') id: string,
    @Body() dto: CloseProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.close(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/reopen')
  @Roles('management', 'admin')
  async reopen(
    @Param('id') id: string,
    @Body() dto: ReopenProposalDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.reopen(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  // =========================================================================
  // 4. Follow-up & Versioning Endpoints
  // =========================================================================
  @Post(':id/follow-ups')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async addFollowup(
    @Param('id') id: string,
    @Body() dto: CreateProposalFollowupDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.addFollowup(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/postpone-follow-up')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async postponeFollowup(
    @Param('id') id: string,
    @Body() dto: PostponeFollowUpDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cached = this.checkIdempotency(idempotencyKey);
    if (cached) return cached.body;

    const result = await this.proposalsService.postponeFollowup(id, dto, user);
    this.setIdempotency(idempotencyKey, 200, result);
    return result;
  }

  @Post(':id/versions')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async createVersion(
    @Param('id') id: string,
    @Body() dto: CreateProposalVersionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.proposalsService.createVersion(id, dto, user);
  }

  @Patch(':id/reassign')
  @Roles('management', 'regional_manager', 'admin')
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignProposalDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.proposalsService.reassign(id, dto, user);
  }

  // Legacy fallback routes for backward compatibility
  @Patch(':id/status')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeProposalStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.proposalsService.changeStatus(id, dto, user);
  }

  @Get(':id/follow-ups')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getFollowups(@Param('id') id: string) {
    return this.proposalsService.getFollowups(id);
  }

  @Get(':id/versions')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getVersions(@Param('id') id: string) {
    return this.proposalsService.getVersions(id);
  }

  @Patch(':id/follow-up')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async updateFollowup(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.proposalsService.updateFollowup(id, dto, user);
  }

  @Get(':id/activity')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getActivity(@Param('id') id: string) {
    return this.proposalsService.getActivity(id);
  }

  @Get(':id/history')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts')
  async getHistory(@Param('id') id: string) {
    return this.proposalsService.getHistory(id);
  }
}
