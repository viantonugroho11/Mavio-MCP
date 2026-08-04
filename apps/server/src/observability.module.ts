import { Global, Module } from "@nestjs/common";
import { MavioMetrics } from "@mavio/observability";

export const METRICS = Symbol("METRICS");

@Global()
@Module({
  providers: [
    {
      provide: METRICS,
      useFactory: (): MavioMetrics => new MavioMetrics(),
    },
  ],
  exports: [METRICS],
})
export class ObservabilityModule {}
