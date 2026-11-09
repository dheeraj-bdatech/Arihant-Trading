import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_ONLY_KEY, ROLES_KEY } from './roles.decorator.js';
import type { UserRole, AuthUser } from '@arihant/shared';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [context.getHandler(), context.getClass()]);
    if (adminOnly) {
      const role = (context.switchToHttp().getRequest().user as AuthUser | undefined)?.role;
      if (role !== 'admin') {
        throw new ForbiddenException(`Access denied: only the system administrator can do this, current role (${role ?? 'none'})`);
      }
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: unauthenticated user');
    }

    // System admin and management have broad access unless explicitly restricted
    if (user.role === 'admin' || user.role === 'management') {
      return true;
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: required role (${requiredRoles.join(', ')}), current role (${user.role})`,
      );
    }

    return true;
  }
}
