import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadWorkflowService } from './leads.workflow.js';
import { LeadChatService } from './lead-chat.service.js';
import { LeadChatController } from './lead-chat.controller.js';

@Module({
  controllers: [LeadsController, LeadChatController],
  providers: [LeadsService, LeadWorkflowService, LeadChatService],
  exports: [LeadsService, LeadWorkflowService],
})
export class LeadsModule {}
