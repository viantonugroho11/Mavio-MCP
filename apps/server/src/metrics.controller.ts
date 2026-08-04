import { Controller, Get, Header, Inject } from "@nestjs/common";
import { MavioMetrics } from "@mavio/observability";
import { METRICS } from "./observability.module.js";

@Controller("metrics")
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: MavioMetrics) {}

  @Get()
  @Header("cache-control", "no-store")
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
