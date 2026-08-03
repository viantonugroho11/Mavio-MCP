import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config.module.js";
import { CacheModule } from "./cache.module.js";
import { RegistryModule } from "./registry.module.js";
import { RbacModule } from "./rbac.module.js";
import { RouterController } from "./router.controller.js";
import { RouterService } from "./router.service.js";
import { ServersController } from "./servers.controller.js";
import { ImportsController } from "./imports.controller.js";
import { RbacController } from "./principals.controller.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard } from "./rbac.guard.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";

@Module({
  imports: [AppConfigModule, CacheModule, RegistryModule, RbacModule],
  controllers: [RouterController, ServersController, ImportsController, RbacController],
  providers: [RouterService, ApiKeyGuard, RbacGuard, RateLimitInterceptor],
})
export class AppModule {}
