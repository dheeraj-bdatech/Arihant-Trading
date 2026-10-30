import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import type { AuthUser } from '@arihant/shared';
import { ModuleAccessService } from './module-access.service.js';

/**
 * Refuses API calls into a module an administrator has switched off for the caller's role. An interceptor rather
 * than a guard: it runs after the controller's JwtAuthGuard has put the user on the request (a global guard would
 * run before it), and before the handler and validation. Public routes carry no user and pass straight through.
 */
@Injectable()
export class ModuleAccessInterceptor implements NestInterceptor {
  constructor(private readonly access: ModuleAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user?.role) return next.handle();

    const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '');
    return from(this.access.blockedModuleForApi(user.role, req.method, path)).pipe(
      switchMap((blocked) => {
        if (blocked) throw new ForbiddenException(`${blocked.label} is switched off for your role by the administrator`);
        return next.handle();
      }),
    );
  }
}
