import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { CorrelationService } from './correlation.service';

const HEADER_REQUEST_ID = 'x-request-id';

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  constructor(private readonly correlation: CorrelationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const correlationId =
      (request?.headers?.[HEADER_REQUEST_ID] as string | undefined) ?? randomUUID();

    return new Observable((subscriber) => {
      this.correlation.run({ correlationId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
