import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VisitsService } from './visits.service.js';
import {
  CreateVisitDto,
  UpdateVisitDto,
  ChangeVisitStatusDto,
  RescheduleVisitDto,
  CancelVisitDto,
  ChangeDestinationDto,
  SubmitVisitUpdateDto,
  ManagerInterventionDto,
  CreateTripDto,
  AddVisitToTripDto,
} from './visits.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('visits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  // -----------------------------------------------------------
  // VISITS: List all (Filtered, Paginated)
  // -----------------------------------------------------------
  @Get()
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assigned_to') assigned_to?: string,
    @Query('organisation_id') organisation_id?: string,
    @Query('trip_id') trip_id?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('travel_required') travel_required?: boolean | string,
    @Query('demo_required') demo_required?: boolean | string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.visitsService.findAll(
      {
        page,
        limit,
        search,
        status,
        assigned_to,
        organisation_id,
        trip_id,
        dateFrom,
        dateTo,
        travel_required,
        demo_required,
      },
      user!,
    );
  }

  // -----------------------------------------------------------
  // UPCOMING FIELD ACTIVITY (Manager Dashboard / Team View)
  // -----------------------------------------------------------
  @Get('upcoming')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async getUpcomingVisits(
    @Query('assigned_to') assigned_to?: string,
    @Query('organisation_id') organisation_id?: string,
    @Query('location') location?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('travel_required') travel_required?: boolean | string,
    @Query('demo_required') demo_required?: boolean | string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.visitsService.getManagerFieldActivity(
      {
        assigned_to,
        organisation_id,
        location,
        status,
        dateFrom,
        dateTo,
        travel_required,
        demo_required,
      },
      user!,
    );
  }

  @Get('manager/field-activity')
  @Roles('management', 'regional_manager', 'admin')
  async getManagerFieldActivity(
    @Query('assigned_to') assigned_to?: string,
    @Query('organisation_id') organisation_id?: string,
    @Query('location') location?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('travel_required') travel_required?: boolean | string,
    @Query('demo_required') demo_required?: boolean | string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.visitsService.getManagerFieldActivity(
      {
        assigned_to,
        organisation_id,
        location,
        status,
        dateFrom,
        dateTo,
        travel_required,
        demo_required,
      },
      user!,
    );
  }

  // -----------------------------------------------------------
  // TRIPS: List and Create Trips
  // -----------------------------------------------------------
  @Get('trips')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async findAllTrips(
    @Query('employee_id') employee_id?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.visitsService.findAllTrips({ employee_id, dateFrom, dateTo }, user!);
  }

  @Post('trips')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async createTrip(@Body() dto: CreateTripDto, @CurrentUser() user: AuthUser) {
    return this.visitsService.createTrip(dto, user);
  }

  @Get('trips/:id')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async findTripById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.visitsService.findTripById(id, user);
  }

  @Post('trips/:id/visits')
  @Roles('management', 'regional_manager', 'admin')
  async addVisitToTrip(
    @Param('id') id: string,
    @Body() dto: AddVisitToTripDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.addVisitToTrip(id, dto, user);
  }

  // -----------------------------------------------------------
  // CUSTOMER VISIT HISTORY & EMPLOYEE ACTIVITY DOSSIER
  // -----------------------------------------------------------
  @Get('organisations/:orgId/history')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getCustomerVisitHistory(@Param('orgId') orgId: string) {
    return this.visitsService.getCustomerVisitHistory(orgId);
  }

  @Get('employees/:employeeId/activities')
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async getEmployeeActivities(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.getEmployeeActivities(employeeId, user);
  }

  // -----------------------------------------------------------
  // SINGLE VISIT OPERATIONS
  // -----------------------------------------------------------
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.visitsService.findOne(id, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin')
  async create(@Body() dto: CreateVisitDto, @CurrentUser() user: AuthUser) {
    return this.visitsService.create(dto, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.update(id, dto, user);
  }

  @Post(':id/reschedule')
  async reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.reschedule(id, dto, user);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.cancel(id, dto, user);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Query('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.cancel(id, { reason: reason || 'Cancelled by user request' }, user);
  }

  @Post(':id/destination')
  async changeDestination(
    @Param('id') id: string,
    @Body() dto: ChangeDestinationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.changeDestination(id, dto, user);
  }

  @Patch(':id/status')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeVisitStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.changeStatus(id, dto, user);
  }

  @Post(':id/intervention')
  @Roles('management', 'regional_manager', 'admin')
  async addManagerIntervention(
    @Param('id') id: string,
    @Body() dto: ManagerInterventionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.addManagerIntervention(id, dto, user);
  }

  @Post(':id/manager-intervention')
  @Roles('management', 'regional_manager', 'admin')
  async addManagerInterventionAlias(
    @Param('id') id: string,
    @Body() dto: ManagerInterventionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.addManagerIntervention(id, dto, user);
  }

  @Post(':id/update')
  async submitUpdate(
    @Param('id') id: string,
    @Body() dto: SubmitVisitUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitsService.submitUpdate(id, dto, user);
  }

  @Get(':id/audit')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async getVisitAudit(@Param('id') id: string) {
    return this.visitsService.getVisitAudit(id);
  }
}
