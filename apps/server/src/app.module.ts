import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config.module.js";
import { CacheModule } from "./cache.module.js";
import { RegistryModule } from "./registry.module.js";
import { RbacModule } from "./rbac.module.js";
import { AuthModule } from "./auth.module.js";
import { AuthController } from "./auth.controller.js";
import { SessionModule } from "./session.module.js";
import { LoginController } from "./login.controller.js";
import { SseController } from "./sse.controller.js";
import { HealthModule, HealthProber } from "./health.module.js";
import { RouterController } from "./router.controller.js";
import { RouterService } from "./router.service.js";
import { ServersController } from "./servers.controller.js";
import { ImportsController } from "./imports.controller.js";
import { RbacController } from "./principals.controller.js";
import { SnapshotsController } from "./snapshots.controller.js";
import { PlaygroundController } from "./playground.controller.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard } from "./rbac.guard.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { SqlDispatcher } from "./sql-dispatcher.js";
import { GraphqlDispatcher } from "./graphql-dispatcher.js";
import { PluginModule } from "./plugin.module.js";
import { PluginsController } from "./plugins.controller.js";
import { ObservabilityModule } from "./observability.module.js";
import { MetricsController } from "./metrics.controller.js";
import { AuditModule } from "./audit.module.js";
import { AuditController } from "./audit.controller.js";
import { SseSessionRegistry } from "./sse.registry.js";

@Module({
  imports: [
    AppConfigModule,
    CacheModule,
    RegistryModule,
    RbacModule,
    AuthModule,
    SessionModule,
    HealthModule,
    PluginModule,
    ObservabilityModule,
    AuditModule,
  ],
  controllers: [
    RouterController,
    ServersController,
    ImportsController,
    RbacController,
    SnapshotsController,
    PlaygroundController,
    AuthController,
    LoginController,
    SseController,
    PluginsController,
    MetricsController,
    AuditController,
  ],
  providers: [
    RouterService,
    ApiKeyGuard,
    RbacGuard,
    RateLimitInterceptor,
    SqlDispatcher,
    GraphqlDispatcher,
    HealthProber,
    SseSessionRegistry,
  ],
})
export class AppModule {}
