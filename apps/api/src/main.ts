import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { runAutoMigrations } from './common/database/auto-migrate.js';

async function bootstrap() {
  const logger = new Logger('ArihantBOS-API');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 4000;
  const corsOrigins = configService.get<string>('CORS_ORIGINS') || 'http://localhost:3000';

  // Automatically ensure database schema is up-to-date on deployment / startup
  await runAutoMigrations(configService, logger);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: corsOrigins.includes(',') ? corsOrigins.split(',').map((o) => o.trim()) : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  });

  await app.listen(port);
  logger.log(`🚀 Arihant BOS API is running on http://localhost:${port}/api`);
  logger.log(`⚡ WebSocket gateway running on port ${port}`);
}

bootstrap();
