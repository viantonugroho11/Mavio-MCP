import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { RateLimiter } from "@mavio/cache";
import type { MavioConfig } from "@mavio/config";
import { REDIS } from "./cache.module.js";
import { MAVIO_CONFIG } from "./config.module.js";
import type { Redis } from "@mavio/cache";

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly limiter: RateLimiter;
  private readonly limit: number;
  private readonly windowSeconds = 60;

  constructor(
    @Inject(REDIS) redis: Redis,
    @Inject(MAVIO_CONFIG) config: MavioConfig,
  ) {
    this.limiter = new RateLimiter(redis);
    this.limit = config.router.rateLimit?.rpm ?? 0; // 0 = disabled
  }

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (this.limit <= 0) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const scope = (req.header("authorization") ?? req.ip ?? "anon").slice(0, 128);
    const result = await this.limiter.check(scope, this.limit, this.windowSeconds);
    res.setHeader("x-ratelimit-limit", String(this.limit));
    res.setHeader("x-ratelimit-remaining", String(result.remaining));
    res.setHeader("x-ratelimit-reset", String(result.resetAt));
    if (!result.allowed) {
      throw new HttpException(
        { error: "rate_limited", resetAt: result.resetAt },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return next.handle();
  }
}
