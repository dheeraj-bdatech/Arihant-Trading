import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ServiceService } from './service.service.js';

/** Every 10 minutes: flag missed SLAs and auto-escalate critical tickets nobody has picked up. */
@Injectable()
export class ServiceScheduler {
  private readonly logger = new Logger(ServiceScheduler.name);
  private running = false;

  constructor(private readonly service: ServiceService) {}

  @Cron('*/10 * * * *')
  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.service.runSlaSweep(null);
      if (r.escalated || r.responseBreaches || r.resolutionBreaches) {
        this.logger.log(`SLA sweep: ${r.escalated} escalated, ${r.responseBreaches} response / ${r.resolutionBreaches} resolution breaches flagged`);
      }
    } catch (err: any) {
      this.logger.error(`SLA sweep failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}
