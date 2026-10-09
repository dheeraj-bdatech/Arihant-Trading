import { Module } from '@nestjs/common';
import { DemosService } from './demos.service.js';
import { DemosController } from './demos.controller.js';
import { ServiceModule } from '../service/service.module.js';

@Module({
  imports: [ServiceModule],
  controllers: [DemosController],
  providers: [DemosService],
  exports: [DemosService],
})
export class DemosModule {}
