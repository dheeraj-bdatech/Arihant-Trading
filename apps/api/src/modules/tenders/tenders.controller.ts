import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { TendersService } from './tenders.service.js';
import {
  CreateTenderDto,
  UpdateTenderDto,
  ChangeTenderStatusDto,
  ApproveTenderDto,
  RecordTenderOutcomeDto,
  CreateTenderPortalIssueDto,
  UpdateTenderPortalIssueDto,
  TenderQueryDto,
  TransitionTenderDto,
  HoldTenderDto,
  ResumeTenderDto,
  ChangeDeadlineDto,
  RecordTenderResultDto,
  ReopenTenderDto,
  UpdateTenderSettingsDto,
  AddApproverDto,
  CreateLossReasonDto,
  UpdateLossReasonDto,
  UpdateTenderStatusLabelDto,
  CreateTenderCategoryDto,
  UpdateTenderCategoryDto,
  ImportTenderSheetDto,
  CreateTenderLineItemDto,
  UpdateTenderLineItemDto,
  CreateTenderDocumentDto,
  UpdateTenderDocumentDto,
  CreateTenderCorrigendumDto,
  CreateTenderFinancialInstrumentDto,
  UpdateTenderFinancialInstrumentDto,
  CreateTenderCommentDto,
  CreateTenderDelegationDto,
  CreateApprovalRuleDto,
  CreateLinkedTenderDto,
  CreateSalesOrderFromTenderDto,
  CreateCompetitorDto,
  CreateTenderPortalDto,
  CreateRegionMappingDto,
} from './tenders.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('tenders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TendersController {
  constructor(private readonly tendersService: TendersService) {}

  // =========================================================================
  // Master Configuration & Lookups
  // =========================================================================

  @Get('settings')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getSettings() {
    return this.tendersService.getSettings();
  }

  @Patch('settings')
  @Roles('management', 'admin')
  async updateSettings(@Body() dto: UpdateTenderSettingsDto) {
    return this.tendersService.updateSettings(dto);
  }

  @Get('approvers')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getApprovers() {
    return this.tendersService.getApprovers();
  }

  @Post('approvers')
  @Roles('management', 'admin')
  async addApprover(@Body() dto: AddApproverDto) {
    return this.tendersService.addApprover(dto);
  }

  @Delete('approvers/:userId')
  @Roles('management', 'admin')
  async removeApprover(@Param('userId') userId: string) {
    return this.tendersService.removeApprover(userId);
  }

  @Get('loss-reasons')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getLossReasons() {
    return this.tendersService.getLossReasons();
  }

  @Post('loss-reasons')
  @Roles('management', 'admin')
  async createLossReason(@Body() dto: CreateLossReasonDto) {
    return this.tendersService.createLossReason(dto);
  }

  @Patch('loss-reasons/:id')
  @Roles('management', 'admin')
  async updateLossReason(@Param('id') id: string, @Body() dto: UpdateLossReasonDto) {
    return this.tendersService.updateLossReason(id, dto);
  }

  @Get('statuses')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getStatuses() {
    return this.tendersService.getStatuses();
  }

  @Patch('statuses/:code')
  @Roles('management', 'admin')
  async updateStatusLabel(@Param('code') code: string, @Body() dto: UpdateTenderStatusLabelDto) {
    return this.tendersService.updateStatusLabel(code, dto);
  }

  @Get('categories')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getCategories() {
    return this.tendersService.getCategories();
  }

  @Post('categories')
  @Roles('management', 'admin')
  async createCategory(@Body() dto: CreateTenderCategoryDto) {
    return this.tendersService.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles('management', 'admin')
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateTenderCategoryDto) {
    return this.tendersService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles('management', 'admin')
  async deleteCategory(@Param('id') id: string) {
    return this.tendersService.deactivateCategory(id);
  }

  @Get('zones')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getZones() {
    return this.tendersService.getZones();
  }

  @Get('regions')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getRegions(@Query('zone_id') zoneId?: string) {
    return this.tendersService.getRegions(zoneId);
  }

  @Get('competitors')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getCompetitors() {
    return this.tendersService.getCompetitors();
  }

  @Post('competitors')
  @Roles('management', 'tender_team', 'admin')
  async createCompetitor(@Body() dto: CreateCompetitorDto) {
    return this.tendersService.createCompetitor(dto);
  }

  @Get('portals')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getPortals() {
    return this.tendersService.getPortals();
  }

  @Post('portals')
  @Roles('management', 'admin')
  async createPortal(@Body() dto: CreateTenderPortalDto) {
    return this.tendersService.createPortal(dto);
  }

  @Get('region-mapping')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getRegionMappings() {
    return this.tendersService.getRegionMappings();
  }

  @Post('region-mapping')
  @Roles('management', 'admin')
  async createRegionMapping(@Body() dto: CreateRegionMappingDto) {
    return this.tendersService.createRegionMapping(dto);
  }

  @Get('approval-rules')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getApprovalRules() {
    return this.tendersService.getApprovalRules();
  }

  @Post('approval-rules')
  @Roles('management', 'admin')
  async createApprovalRule(@Body() dto: CreateApprovalRuleDto) {
    return this.tendersService.createApprovalRule(dto);
  }

  @Get('delegations')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getDelegations(@CurrentUser() user: AuthUser) {
    return this.tendersService.getDelegations(user);
  }

  @Post('delegations')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async createDelegation(
    @Body() dto: CreateTenderDelegationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.createDelegation(dto, user);
  }

  // =========================================================================
  // Reports & Dashboards
  // =========================================================================

  @Get('deadline-centre')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getDeadlineCentre(@CurrentUser() user: AuthUser) {
    return this.tendersService.getDeadlineCentre(user);
  }

  @Get('calendar')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getCalendarEvents(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.tendersService.getCalendarEvents(user, query);
  }

  @Get('finance/emd-tracking')
  @Roles('management', 'accounts', 'tender_team', 'admin')
  async getFinanceEmdTracking(@CurrentUser() user: AuthUser) {
    return this.tendersService.getFinanceEmdTracking(user);
  }

  @Get('stats')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getStats(@CurrentUser() user: AuthUser) {
    return this.tendersService.getStats(user);
  }

  @Get('dashboard')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getDashboard(@CurrentUser() user: AuthUser) {
    return this.tendersService.getDashboard(user);
  }

  @Get('approvals-inbox')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getApprovalsInbox(@CurrentUser() user: AuthUser) {
    return this.tendersService.getApprovalsInbox(user);
  }

  @Get('my-tenders')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getMyTenders(@CurrentUser() user: AuthUser) {
    return this.tendersService.getMyTenders(user);
  }

  @Get('reports/summary')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getSummaryReport(
    @Query('groupBy') groupByCamel?: 'organisation' | 'zone' | 'region' | 'salesperson',
    @Query('group_by') groupBySnake?: 'organisation' | 'zone' | 'region' | 'salesperson',
    @Query() query?: any,
    @CurrentUser() user: AuthUser = null as any,
  ) {
    const groupBy = groupBySnake || groupByCamel || 'organisation';
    return this.tendersService.getSummaryReport(groupBy, user, query);
  }

  @Get('reports/pipeline')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getPipelineReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getPipelineReport(user);
  }

  @Get('reports/win-loss')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async getWinLossReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getWinLossReport(user);
  }

  @Get('reports/by-zone')
  @Roles('management', 'regional_manager', 'admin')
  async getZoneReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getZoneReport(user);
  }

  @Get('reports/by-region')
  @Roles('management', 'regional_manager', 'admin')
  async getRegionReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getRegionReport(user);
  }

  @Get('reports/by-salesperson')
  @Roles('management', 'regional_manager', 'admin')
  async getSalespersonReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getSalespersonReport(user);
  }

  @Get('reports/by-organisation')
  @Roles('management', 'regional_manager', 'admin')
  async getOrganisationReport(@CurrentUser() user: AuthUser) {
    return this.tendersService.getOrganisationReport(user);
  }

  // =========================================================================
  // Portal Issues (Global)
  // =========================================================================

  @Get('portal-issues')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getAllPortalIssues(@CurrentUser() user: AuthUser) {
    return this.tendersService.getAllPortalIssues(user);
  }

  @Post('portal-issues')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async createGlobalPortalIssue(
    @Body() dto: CreateTenderPortalIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!dto.tender_id) {
      throw new BadRequestException('tender_id is required to record a portal issue');
    }
    return this.tendersService.createPortalIssue(dto.tender_id, dto, user);
  }

  // =========================================================================
  // Import
  // =========================================================================

  @Post('import')
  @Roles('management', 'admin')
  async importTenders(@Body() dto: ImportTenderSheetDto, @CurrentUser() user: AuthUser) {
    return this.tendersService.importTenders(dto, user);
  }

  // =========================================================================
  // Tender CRUD & Transitions
  // =========================================================================

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async findAll(@Query() query: TenderQueryDto, @CurrentUser() user: AuthUser) {
    return this.tendersService.findAll(query, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async create(@Body() dto: CreateTenderDto, @CurrentUser() user: AuthUser) {
    return this.tendersService.create(dto, user);
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async findOne(@Param('id') id: string) {
    return this.tendersService.findOne(id);
  }

  @Put(':id')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.update(id, dto, user);
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async patchUpdate(
    @Param('id') id: string,
    @Body() dto: UpdateTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('management', 'admin')
  async softDelete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.softDelete(id, user);
  }

  // Transitions: Section 3 server-side function
  @Post(':id/transition')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async transition(
    @Param('id') id: string,
    @Body() dto: TransitionTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.transitionTender(id, dto, user);
  }

  @Post(':id/transitions')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async transitionAlias(
    @Param('id') id: string,
    @Body() dto: TransitionTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.transitionTender(id, dto, user);
  }

  @Patch(':id/status')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeTenderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.changeStatus(id, dto, user);
  }

  @Post(':id/hold')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async holdTender(
    @Param('id') id: string,
    @Body() dto: HoldTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.holdTender(id, dto, user);
  }

  @Post(':id/resume')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async resumeTender(
    @Param('id') id: string,
    @Body() dto: ResumeTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.resumeTender(id, dto, user);
  }

  @Post(':id/approval-request')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async approvalRequest(
    @Param('id') id: string,
    @Body('remarks') remarks: string | undefined,
    @Body('expected_version') expectedVersion: number | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.requestApproval(id, remarks, user, expectedVersion);
  }

  @Post(':id/request-approval')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async requestApprovalAlias(
    @Param('id') id: string,
    @Body('remarks') remarks: string | undefined,
    @Body('expected_version') expectedVersion: number | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.requestApproval(id, remarks, user, expectedVersion);
  }

  @Post(':id/approve')
  @Roles('management', 'admin')
  async approveParticipation(
    @Param('id') id: string,
    @Body() dto: ApproveTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.approveParticipation(id, dto, user);
  }

  @Post(':id/reject')
  @Roles('management', 'admin')
  async rejectParticipation(
    @Param('id') id: string,
    @Body() dto: { reason?: string; rejection_reason?: string; remarks?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.approveParticipation(
      id,
      {
        decision: 'rejected',
        rejection_reason: dto.rejection_reason || dto.reason || dto.remarks,
        remarks: dto.remarks || dto.reason,
      },
      user,
    );
  }

  @Post(':id/deadline-change')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async updateDeadline(
    @Param('id') id: string,
    @Body() dto: ChangeDeadlineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateDeadline(id, dto, user);
  }

  @Patch(':id/deadline')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async updateDeadlineAlias(
    @Param('id') id: string,
    @Body() dto: ChangeDeadlineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateDeadline(id, dto, user);
  }

  @Post(':id/result')
  @Roles('management', 'tender_team', 'sales', 'admin')
  async recordResult(
    @Param('id') id: string,
    @Body() dto: RecordTenderResultDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.recordResult(id, dto, user);
  }

  @Post(':id/outcome')
  @Roles('management', 'tender_team', 'sales', 'admin')
  async recordOutcomeAlias(
    @Param('id') id: string,
    @Body() dto: RecordTenderOutcomeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.recordOutcome(id, dto, user);
  }

  @Post(':id/reopen')
  @Roles('management', 'admin')
  async reopenTender(
    @Param('id') id: string,
    @Body() dto: ReopenTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.reopenTender(id, dto, user);
  }

  // =========================================================================
  // Tender Child Items: Portal Issues & Activities
  // =========================================================================

  @Get(':id/portal-issues')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async getPortalIssues(@Param('id') id: string) {
    return this.tendersService.getPortalIssues(id);
  }

  @Get(':id/issues')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async getPortalIssuesAlias(@Param('id') id: string) {
    return this.tendersService.getPortalIssues(id);
  }

  @Post(':id/portal-issues')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async createPortalIssue(
    @Param('id') id: string,
    @Body() dto: CreateTenderPortalIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.createPortalIssue(id, dto, user);
  }

  @Post(':id/issues')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async createPortalIssueAlias(
    @Param('id') id: string,
    @Body() dto: CreateTenderPortalIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.createPortalIssue(id, dto, user);
  }

  @Patch(':id/portal-issues/:issueId')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async updatePortalIssue(
    @Param('id') id: string,
    @Param('issueId') issueId: string,
    @Body() dto: UpdateTenderPortalIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updatePortalIssue(id, issueId, dto, user);
  }

  @Patch(':id/issues/:issueId')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async updatePortalIssueAlias(
    @Param('id') id: string,
    @Param('issueId') issueId: string,
    @Body() dto: UpdateTenderPortalIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updatePortalIssue(id, issueId, dto, user);
  }

  @Get(':id/activities')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getActivities(@Param('id') id: string) {
    return this.tendersService.getActivities(id);
  }

  // =========================================================================
  // Tender Line Items (Products & Compliance)
  // =========================================================================

  @Get(':id/line-items')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async getLineItems(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.getLineItems(id, user);
  }

  @Post(':id/line-items')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async addLineItem(
    @Param('id') id: string,
    @Body() dto: CreateTenderLineItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.addLineItem(id, dto, user);
  }

  @Put(':id/line-items/:itemId')
  @Roles('management', 'regional_manager', 'tender_team', 'demo_team', 'service_team', 'admin')
  async updateLineItemPut(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTenderLineItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateLineItem(id, itemId, dto, user);
  }

  @Patch(':id/line-items/:itemId')
  @Roles('management', 'regional_manager', 'tender_team', 'demo_team', 'service_team', 'admin')
  async updateLineItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTenderLineItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateLineItem(id, itemId, dto, user);
  }

  @Delete(':id/line-items/:itemId')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async deleteLineItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.deleteLineItem(id, itemId, user);
  }

  // =========================================================================
  // Tender Documents & Checklist
  // =========================================================================

  @Get(':id/documents')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async getDocuments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.getDocuments(id, user);
  }

  @Post(':id/documents')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async addDocument(
    @Param('id') id: string,
    @Body() dto: CreateTenderDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.addDocument(id, dto, user);
  }

  @Post(':id/documents/init-checklist')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async initChecklist(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.initChecklist(id, user);
  }

  @Patch(':id/documents/:docId')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async updateDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: UpdateTenderDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateDocument(id, docId, dto, user);
  }

  @Delete(':id/documents/:docId')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async deleteDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.deleteDocument(id, docId, user);
  }

  // =========================================================================
  // Tender Corrigenda
  // =========================================================================

  @Get(':id/corrigenda')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async getCorrigenda(@Param('id') id: string) {
    return this.tendersService.getCorrigenda(id);
  }

  @Post(':id/corrigenda')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async addCorrigendum(
    @Param('id') id: string,
    @Body() dto: CreateTenderCorrigendumDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.addCorrigendum(id, dto, user);
  }

  // =========================================================================
  // Tender Financial Instruments (EMD, PBG, Fees)
  // =========================================================================

  @Get(':id/financial-instruments')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'accounts', 'admin')
  async getFinancialInstruments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.getFinancialInstruments(id, user);
  }

  @Post(':id/financial-instruments')
  @Roles('management', 'regional_manager', 'tender_team', 'accounts', 'admin')
  async addFinancialInstrument(
    @Param('id') id: string,
    @Body() dto: CreateTenderFinancialInstrumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.addFinancialInstrument(id, dto, user);
  }

  @Patch(':id/financial-instruments/:instrumentId')
  @Roles('management', 'accounts', 'admin')
  async updateFinancialInstrument(
    @Param('id') id: string,
    @Param('instrumentId') instrumentId: string,
    @Body() dto: UpdateTenderFinancialInstrumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.updateFinancialInstrument(id, instrumentId, dto, user);
  }

  // =========================================================================
  // Tender Discussion / Comments
  // =========================================================================

  @Get(':id/comments')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async getComments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tendersService.getComments(id, user);
  }

  @Post(':id/comments')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin')
  async addComment(
    @Param('id') id: string,
    @Body() dto: CreateTenderCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.addComment(id, dto, user);
  }

  // =========================================================================
  // Inter-Module Transitions (PQ -> General, Won -> Sales Order)
  // =========================================================================

  @Post(':id/create-linked-tender')
  @Roles('management', 'regional_manager', 'tender_team', 'admin')
  async createLinkedTender(
    @Param('id') id: string,
    @Body() dto: CreateLinkedTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.createLinkedTender(id, dto, user);
  }

  @Post(':id/create-sales-order')
  @Roles('management', 'regional_manager', 'tender_team', 'sales', 'admin')
  async createSalesOrder(
    @Param('id') id: string,
    @Body() dto: CreateSalesOrderFromTenderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tendersService.createSalesOrder(id, dto, user);
  }
}
