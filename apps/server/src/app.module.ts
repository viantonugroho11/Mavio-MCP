import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config.module.js";
import { RegistryModule } from "./registry.module.js";
import { RouterController } from "./router.controller.js";
import { RouterService } from "./router.service.js";
import { ServersController } from "./servers.controller.js";
import { ImportsController } from "./imports.controller.js";
import { ApiKeyGuard } from "./auth.guard.js";

@Module({
  imports: [AppConfigModule, RegistryModule],
  controllers: [RouterController, ServersController, ImportsController],
  providers: [RouterService, ApiKeyGuard],
})
export class AppModule {}
