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
import { DemosService } from './demos.service.js';
import {
  CreateDemoDto,
  UpdateDemoDto,
  AssignTeamDto,
  ConfirmDemoDto,
  RescheduleDemoDto,
  CancelDemoDto,
  ReserveEquipmentDto,
  SuggestAlternativeDto,
  ApproveReservationDto,
  RejectReservationDto,
  AllocateAnotherUnitDto,
  SubmitDemoOutcomeDto,
  CreateEquipmentDto,
  UpdateEquipmentDto,
} from './demos.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('demos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemosController {
  constructor(private readonly demosService: DemosService) {}

  // =========================================================================
  // Equipment endpoints
  // =========================================================================

  @Get('equipment')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getEquipment(
    @Query('location') location?: string,
    @Query('status') status?: string,
    @Query('product_id') product_id?: string,
  ) {
    return this.demosService.getEquipment({ location, status, product_id });
  }

  @Get('equipment/availability')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getEquipmentAvailability(
    @Query('product_id') product_id?: string,
    @Query('location') location?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.demosService.getEquipmentAvailability({ product_id, location, from_date, to_date });
  }

  @Get('equipment/:id')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async getEquipmentById(@Param('id') id: string) {
    return this.demosService.getEquipmentById(id);
  }

  @Post('equipment')
  @Roles('demo_team', 'service_team', 'admin')
  async createEquipment(@Body() dto: CreateEquipmentDto, @CurrentUser() user: AuthUser) {
    return this.demosService.createEquipment(dto, user.id);
  }

  @Patch('equipment/:id')
  @Roles('demo_team', 'service_team', 'admin')
  async updateEquipment(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.updateEquipment(id, dto, user.id);
  }

  // =========================================================================
  // Team Availability & Analytics
  // =========================================================================

  @Get('team/availability')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'admin')
  async getTeamAvailability(@Query('date') date: string) {
    return this.demosService.getTeamAvailability(date);
  }

  @Get('analytics')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async getAnalytics() {
    return this.demosService.getAnalytics();
  }

  // =========================================================================
  // Demo requests endpoints
  // =========================================================================

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'admin')
  async findAllDemos(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assigned_to') assigned_to?: string,
    @Query('requested_by') requested_by?: string,
    @Query('organisation_id') organisation_id?: string,
    @Query('product_id') product_id?: string,
    @Query('location') location?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.demosService.findAllDemos(
      {
        page,
        limit,
        search,
        status,
        assigned_to,
        requested_by,
        organisation_id,
        product_id,
        location,
        date_from,
        date_to,
      },
      user!,
    );
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'admin')
  async findOneDemo(@Param('id') id: string) {
    return this.demosService.findOneDemo(id);
  }

  @Get(':id/audit')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'admin')
  async getAuditTrail(@Param('id') id: string) {
    return this.demosService.getAuditTrail(id);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'admin')
  async createDemo(@Body() dto: CreateDemoDto, @CurrentUser() user: AuthUser) {
    return this.demosService.createDemo(dto, user);
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'admin')
  async updateDemo(
    @Param('id') id: string,
    @Body() dto: UpdateDemoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.updateDemo(id, dto, user);
  }

  @Post(':id/assign-team')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async assignTeam(
    @Param('id') id: string,
    @Body() dto: AssignTeamDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.assignTeam(id, dto, user);
  }

  @Post(':id/confirm')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async confirmDemo(
    @Param('id') id: string,
    @Body() dto: ConfirmDemoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.confirmDemo(id, dto, user);
  }

  @Post(':id/reschedule')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async rescheduleDemo(
    @Param('id') id: string,
    @Body() dto: RescheduleDemoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.rescheduleDemo(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'admin')
  async cancelDemo(
    @Param('id') id: string,
    @Body() dto: CancelDemoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.cancelDemo(id, dto, user);
  }

  @Post(':id/reserve')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async reserveEquipment(
    @Param('id') id: string,
    @Body() dto: ReserveEquipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.reserveEquipment(id, dto, user);
  }

  @Post(':id/reserve-equipment')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async reserveEquipmentAlias(
    @Param('id') id: string,
    @Body() dto: ReserveEquipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.reserveEquipment(id, dto, user);
  }

  @Post('reservations/:id/alternative')
  @Roles('management', 'regional_manager', 'demo_team', 'admin')
  async suggestAlternative(
    @Param('id') id: string,
    @Body() dto: SuggestAlternativeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.suggestAlternative(id, dto, user);
  }

  @Post('reservations/:id/approve')
  @Roles('management', 'regional_manager', 'demo_team', 'service_team', 'admin')
  async approveReservation(
    @Param('id') id: string,
    @Body() dto: ApproveReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.approveReservation(id, dto, user);
  }

  @Post('reservations/:id/reject')
  @Roles('management', 'regional_manager', 'demo_team', 'service_team', 'admin')
  async rejectReservation(
    @Param('id') id: string,
    @Body() dto: RejectReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.rejectReservation(id, dto, user);
  }

  @Post('reservations/:id/allocate')
  @Roles('management', 'regional_manager', 'demo_team', 'service_team', 'admin')
  async allocateAnotherUnit(
    @Param('id') id: string,
    @Body() dto: AllocateAnotherUnitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.allocateAnotherUnit(id, dto, user);
  }

  @Post(':id/outcome')
  @Roles('management', 'regional_manager', 'demo_team', 'sales', 'admin')
  async submitOutcome(
    @Param('id') id: string,
    @Body() dto: SubmitDemoOutcomeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.demosService.submitOutcome(id, dto, user);
  }
}
