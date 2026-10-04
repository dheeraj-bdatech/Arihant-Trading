import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from './common/database/database.module.js';
import { RealtimeModule } from './common/realtime/realtime.module.js';
import { CloudinaryModule } from './common/cloudinary/cloudinary.module.js';
import { AppEventsModule } from './common/events/events.module.js';
import { OutboxModule } from './common/outbox/outbox.module.js';
import { JobsModule } from './jobs/jobs.module.js';

import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { MastersModule } from './modules/masters/masters.module.js';
import { OrganisationsModule } from './modules/organisations/organisations.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { InteractionsModule } from './modules/interactions/interactions.module.js';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module.js';
import { VisitsModule } from './modules/visits/visits.module.js';
import { DemosModule } from './modules/demos/demos.module.js';
import { TendersModule } from './modules/tenders/tenders.module.js';
import { ProposalsModule } from './modules/proposals/proposals.module.js';
import { DeliveriesModule } from './modules/deliveries/deliveries.module.js';
import { ServiceModule } from './modules/service/service.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RealtimeModule,
    CloudinaryModule,
    AppEventsModule,
    OutboxModule,
    JobsModule,
    AuthModule,
    UsersModule,
    MastersModule,
    OrganisationsModule,
    ContactsModule,
    LeadsModule,
    InteractionsModule,
    FollowUpsModule,
    VisitsModule,
    DemosModule,
    TendersModule,
    ProposalsModule,
    DeliveriesModule,
    ServiceModule,
    ExpensesModule,
    TasksModule,
    NotificationsModule,
    DashboardModule,
    UploadsModule,
    AuditModule,
  ],
})
export class AppModule {}
