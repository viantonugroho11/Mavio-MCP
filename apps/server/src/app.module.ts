import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config.module.js";
import { CacheModule } from "./cache.module.js";
import { RegistryModule } from "./registry.module.js";
import { RouterController } from "./router.controller.js";
import { RouterService } from "./router.service.js";
import { ServersController } from "./servers.controller.js";
import { ImportsController } from "./imports.controller.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";

@Module({
  imports: [AppConfigModule, CacheModule, RegistryModule],
  controllers: [RouterController, ServersController, ImportsController],
  providers: [RouterService, ApiKeyGuard, RateLimitInterceptor],
})
export class AppModule {}
