import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter.js';

/**
 * Global request handling shared by main.ts and the e2e suites, so tests exercise exactly what production runs:
 * the /api prefix, DTO validation (unknown fields are stripped, not rejected) and the database-aware error filter.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
