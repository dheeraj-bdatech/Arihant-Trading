import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceService } from './service.service.js';
import {
  CreateTicketDto,
  UpdateTicketStatusDto,
  SubmitServiceReportDto,
  CreateVisitDto,
  CheckInVisitDto,
  CheckOutVisitDto,
  CreatePartRequestDto,
  UpdatePartRequestStatusDto,
  CreateTicketCommentDto,
  ReviewServiceReportDto,
  CloseTicketDto,
  LinkOrganisationDto,
} from './service.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('service')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  @Get('stats')
  @Roles('management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team')
  async getDashboardStats(@CurrentUser() user: AuthUser) {
    return this.serviceService.getDashboardStats(user);
  }

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team')
  async findAll(@Query() query: Record<string, any>, @CurrentUser() user: AuthUser) {
    return this.serviceService.findAllTickets(query, user);
  }

  @Get('tickets')
  @Roles('management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team')
  async findAllTickets(@Query() query: Record<string, any>, @CurrentUser() user: AuthUser) {
    return this.serviceService.findAllTickets(query, user);
  }

  @Get('tickets/:id')
  async findOneTicket(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.serviceService.findOneTicket(id, user);
  }

  @Post('tickets')
  @Roles('management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team')
  async createTicket(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthUser) {
    return this.serviceService.createTicket(dto, user);
  }

  @Patch('tickets/:id/status')
  @Roles('management', 'regional_manager', 'service_team', 'admin')
  async updateTicketStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.updateTicketStatus(id, dto, user);
  }

  @Post('tickets/:id/report')
  @Roles('service_team', 'admin')
  async submitReport(
    @Param('id') id: string,
    @Body() dto: SubmitServiceReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.submitReport(id, dto, user);
  }

  @Post('tickets/:id/close')
  @Roles('management', 'regional_manager', 'service_team', 'admin')
  async closeTicket(@Param('id') id: string, @Body() dto: CloseTicketDto, @CurrentUser() user: AuthUser) {
    return this.serviceService.closeTicket(id, user, dto);
  }

  /** Triage: link a portal ticket from the "unverified customer" holding record to the real organisation. */
  @Patch('tickets/:id/link-organisation')
  @Roles('management', 'regional_manager', 'service_team', 'admin')
  async linkOrganisation(@Param('id') id: string, @Body() dto: LinkOrganisationDto, @CurrentUser() user: AuthUser) {
    return this.serviceService.linkOrganisation(id, dto, user);
  }

  /** Manual trigger of the SLA / auto-escalation sweep that normally runs every 10 minutes. */
  @Post('maintenance/sweep')
  @Roles('management', 'admin')
  async sweep(@CurrentUser() user: AuthUser) {
    return this.serviceService.runSlaSweep(user.id);
  }

  // --- Visits Endpoints ---
  @Get('tickets/:id/visits')
  async getVisits(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.serviceService.getVisits(id, user);
  }

  @Post('tickets/:id/visits')
  @Roles('management', 'regional_manager', 'service_team', 'admin')
  async createVisit(
    @Param('id') id: string,
    @Body() dto: CreateVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.createVisit(id, dto, user);
  }

  @Patch('tickets/:id/visits/:visitId/check-in')
  @Roles('service_team', 'admin')
  async checkInVisit(
    @Param('id') id: string,
    @Param('visitId') visitId: string,
    @Body() dto: CheckInVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.checkInVisit(id, visitId, dto, user);
  }

  @Patch('tickets/:id/visits/:visitId/check-out')
  @Roles('service_team', 'admin')
  async checkOutVisit(
    @Param('id') id: string,
    @Param('visitId') visitId: string,
    @Body() dto: CheckOutVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.checkOutVisit(id, visitId, dto, user);
  }

  // --- Report Review & Approval Endpoints ---
  @Post('tickets/:id/reports/:reportId/review')
  @Roles('management', 'regional_manager', 'admin')
  async reviewReport(
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() dto: ReviewServiceReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.reviewReport(id, reportId, dto, user);
  }

  // --- Part Requests Endpoints ---
  @Get('tickets/:id/part-requests')
  async getPartRequests(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.serviceService.getPartRequests(id, user);
  }

  @Post('tickets/:id/part-requests')
  @Roles('service_team', 'admin')
  async createPartRequest(
    @Param('id') id: string,
    @Body() dto: CreatePartRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.createPartRequest(id, dto, user);
  }

  @Patch('tickets/:id/part-requests/:requestId/status')
  @Roles('management', 'admin', 'service_team')
  async updatePartRequestStatus(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: UpdatePartRequestStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.updatePartRequestStatus(id, requestId, dto, user);
  }

  // --- Comments Endpoints ---
  @Get('tickets/:id/comments')
  async getComments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.serviceService.getComments(id, user);
  }

  @Post('tickets/:id/comments')
  async createComment(
    @Param('id') id: string,
    @Body() dto: CreateTicketCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.createComment(id, dto, user);
  }

  // --- Module 6 Cross-Module Integration Endpoints (Section 4) ---
  @Get('customer/:customerId/history')
  async getCustomerServiceHistory(
    @Param('customerId') customerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.getCustomerServiceHistory(customerId, user);
  }

  @Get('equipment/:equipmentId/history')
  async getEquipmentServiceHistory(
    @Param('equipmentId') equipmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.serviceService.getEquipmentServiceHistory(equipmentId, user);
  }

  // --- Configuration Endpoints (Section 1.8) ---
  @Get('settings/sla-rules')
  async getSlaRules() {
    return this.serviceService.getSlaRules();
  }

  @Patch('settings/sla-rules/:id')
  @Roles('management', 'admin')
  async updateSlaRule(
    @Param('id') id: string,
    @Body() dto: { response_hours?: number; resolution_hours?: number; business_hours_only?: boolean },
  ) {
    return this.serviceService.updateSlaRule(id, dto);
  }

  @Get('settings/config')
  async getServiceSettings() {
    return this.serviceService.getServiceSettings();
  }

  @Patch('settings/config/:key')
  @Roles('management', 'admin')
  async updateServiceSetting(
    @Param('key') key: string,
    @Body() body: { value: any },
  ) {
    return this.serviceService.updateServiceSetting(key, body.value);
  }
}
