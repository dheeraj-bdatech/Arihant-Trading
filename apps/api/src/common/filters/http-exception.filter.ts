import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let extraFields: any = {};
    let message: string | object = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = (res as any).message || res;
        extraFields = res;
      }
    } else if (exception instanceof Error) {
      const pgCode = (exception as any).code;
      if (pgCode === '22P02') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid identifier syntax or data format';
      } else if (pgCode === '23505') {
        status = HttpStatus.CONFLICT;
        message = (exception as any).detail || 'A record with this identifier or unique property already exists';
      } else if (pgCode === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message = (exception as any).detail || 'Referenced entity does not exist';
      } else if (pgCode === '23502') {
        status = HttpStatus.BAD_REQUEST;
        const col = (exception as any).column ? ` (${(exception as any).column})` : '';
        message = `Required field missing${col}`;
      } else if (pgCode === '23514') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = (exception as any).detail || 'Data validation constraint failed';
      } else if (pgCode === '22007' || pgCode === '22008') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid date or time format provided';
      } else if (pgCode === '22001') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Value exceeds maximum permitted length';
      } else {
        this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
        message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : exception.message;
      }
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...extraFields,
      message,
    });
  }
}
