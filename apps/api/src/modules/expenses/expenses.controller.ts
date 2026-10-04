import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ExpensesService } from './expenses.service.js';
import {
  CreateExpenseDto,
  ManagerApproveExpenseDto,
  AccountsProcessExpenseDto,
} from './expenses.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser, ExpenseFilterDto } from '@arihant/shared';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  async findAll(@Query() query: ExpenseFilterDto, @CurrentUser() user: AuthUser) {
    return this.expensesService.findAll(query, user);
  }

  @Get('summary')
  @Roles('management', 'regional_manager', 'accounts', 'admin')
  async getSummary(@Query() query: ExpenseFilterDto, @CurrentUser() user: AuthUser) {
    return this.expensesService.getExpenseSummary(query, user);
  }

  @Get('export/csv')
  @Roles('management', 'regional_manager', 'accounts', 'admin')
  async exportCsv(
    @Query() query: ExpenseFilterDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const csv = await this.expensesService.exportExpenses(query, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arihant-expenses-${new Date().toISOString().split('T')[0]}.csv"`,
    );
    return res.send(csv);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.expensesService.create(dto, user);
  }

  @Patch(':id/manager-approve')
  @Roles('management', 'regional_manager')
  async managerApprove(
    @Param('id') id: string,
    @Body() dto: ManagerApproveExpenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expensesService.managerApprove(id, dto, user);
  }

  @Patch(':id/accounts-process')
  @Roles('management', 'accounts')
  async accountsProcess(
    @Param('id') id: string,
    @Body() dto: AccountsProcessExpenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expensesService.accountsProcess(id, dto, user);
  }
}
