import { Module } from "@nestjs/common";
import { InspectorService } from "@mavio/inspector";
import { Registry } from "@mavio/registry";
import { REGISTRY } from "./registry.module.js";
import { InspectorController } from "./inspector.controller.js";

export const INSPECTOR_SERVICE = Symbol("INSPECTOR_SERVICE");

@Module({
  controllers: [InspectorController],
  providers: [
    {
      provide: INSPECTOR_SERVICE,
      inject: [REGISTRY],
      useFactory: (registry: Registry): InspectorService => new InspectorService(registry),
    },
  ],
  exports: [INSPECTOR_SERVICE],
})
export class InspectorModule {}
