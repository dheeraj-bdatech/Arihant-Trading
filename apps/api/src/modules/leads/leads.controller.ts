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
import { LeadsService } from './leads.service.js';
import {
  CreateLeadDto,
  UpdateLeadDto,
  ChangeLeadStatusDto,
  AssignLeadDto,
  AddProductInterestDto,
  CreateLeadMessageDto,
  LeadFilterQueryDto,
  LeadListQueryDto,
} from './leads.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { LEAD_CUSTOMER_CHAT_ROLES, type AuthUser } from '@arihant/shared';
import { LeadChatService } from './lead-chat.service.js';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadChat: LeadChatService,
  ) {}

  @Get('dashboard')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getDashboard(@Query() query: LeadFilterQueryDto, @CurrentUser() user: AuthUser) {
    return this.leadsService.getDashboard(query, user);
  }

  // Executive Intelligence Reports — sales get their own data (scoped in the service, QA DEF-052)
  @Get('reports/salesperson')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async getSalespersonReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getSalespersonReport(user);
  }

  @Get('reports/zones')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async getZoneReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getZoneReport(user);
  }

  @Get('reports/products')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async getProductReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getProductReport(user);
  }

  @Get('reports/interactions')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async getInteractionReport(
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('employee_id') employeeId?: string,
    @Query('organisation_id') orgId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.leadsService.getInteractionReport(
      {
        from_date: fromDate,
        to_date: toDate,
        employee_id: employeeId,
        organisation_id: orgId,
      },
      user!,
    );
  }

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async findAll(@Query() query: LeadListQueryDto, @CurrentUser() user: AuthUser) {
    return this.leadsService.findAll(query, user);
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadsService.findOne(id, user);
  }

  // Conversation thread: the roles that may open a lead, scoped to the leads they may open (in the service)
  @Get(':id/messages')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getMessages(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadsService.getMessages(id, user);
  }

  @Post(':id/messages')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async addMessage(
    @Param('id') id: string,
    @Body() dto: CreateLeadMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.addMessage(id, dto, user);
  }

  // Customer chat link: who may write to the customer (LEAD_CUSTOMER_CHAT_ROLES) manages it; anyone who may open the
  // lead sees whether one is on
  @Get(':id/chat-link')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getChatLink(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadChat.getLink(id, user);
  }

  @Post(':id/chat-link')
  @Roles(...LEAD_CUSTOMER_CHAT_ROLES)
  async createChatLink(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadChat.createLink(id, user);
  }

  @Delete(':id/chat-link')
  @Roles(...LEAD_CUSTOMER_CHAT_ROLES)
  async revokeChatLink(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadChat.revokeLink(id, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.leadsService.create(dto, user);
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeLeadStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.changeStatus(id, dto, user);
  }

  @Patch(':id/assign')
  @Roles('management', 'regional_manager', 'admin')
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.assign(id, dto, user);
  }

  @Post([':id/product-interests', ':id/products'])
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async addProductInterest(
    @Param('id') id: string,
    @Body() dto: AddProductInterestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.addProductInterest(id, dto.product_id, user);
  }

  @Delete([':id/product-interests/:productId', ':id/products/:productId'])
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async removeProductInterest(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.removeProductInterest(id, productId, user);
  }
}
