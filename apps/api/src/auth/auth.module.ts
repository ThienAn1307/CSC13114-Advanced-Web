import { Inject, Injectable, Module } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthGuard, PassportModule, PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { API_CONFIG } from '../config.js';
import type { ApiConfig } from '../config.js';
import { Problem } from '../common/problem.js';
import { isUuid } from '../common/request.js';
import type { Principal, SubmissionRequest } from '../common/request.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    super({
      jwtFromRequest: (request: SubmissionRequest) =>
        /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null,
      secretOrKey: config.jwtSecret,
      algorithms: ['HS256'],
      ignoreExpiration: true,
      passReqToCallback: true,
      jsonWebTokenOptions: { ignoreNotBefore: true },
    });
  }

  validate(request: SubmissionRequest, payload: unknown): Principal {
    if (typeof payload !== 'object' || payload === null)
      throw new Problem('unauthenticated', 'A valid bearer token is required.');
    const claims = payload as Record<string, unknown>;
    if (
      !isUuid(claims.sub) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= request.receivedAt.getTime() / 1000 ||
      typeof claims.role !== 'string' ||
      !['student', 'ta', 'admin'].includes(claims.role)
    ) {
      throw new Problem('unauthenticated', 'A valid bearer token is required.');
    }
    return { id: claims.sub.toLowerCase(), role: claims.role as Principal['role'] };
  }
}

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = Principal>(error: unknown, user: TUser | false | null): TUser {
    if (error || !user) throw new Problem('unauthenticated', 'A valid bearer token is required.');
    return user;
  }
}

@Injectable()
export class StudentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<SubmissionRequest>().user?.role !== 'student') {
      throw new Problem('forbidden-role', 'Only students may submit source.');
    }
    return true;
  }
}

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy, JwtGuard, StudentGuard],
  exports: [JwtGuard, StudentGuard],
})
export class AuthModule {}
