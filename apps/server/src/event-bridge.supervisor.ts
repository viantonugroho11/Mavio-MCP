import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { EventRoute, EventRouteRepository } from "@mavio/registry";
import { EVENT_ROUTE_REPO } from "./registry.module.js";
import { EventDispatcherService } from "./event-dispatcher.service.js";
import {
  EVENT_CONSUMER_REGISTRY,
  EventConsumerRegistry,
  type EventConsumer,
} from "./event-consumer.js";

/**
 * Boot-time supervisor for broker-backed event routes (ADR-022 M5).
 *
 * Scans `event_routes` for every source_type that has a registered
 * consumer factory (Kafka, NATS, …) and starts one consumer per
 * approved+enabled route. Webhook routes are skipped — HTTP controller
 * handles those.
 *
 * NOTE: this M5 supervisor only reconciles at startup. Live
 * add/approve/disable of broker routes needs a reconcile hook driven by
 * the InvalidationBus — deferred to M6 alongside a real Kafka/NATS
 * adapter, since without a broker to test against the reconcile loop is
 * untestable.
 */
@Injectable()
export class EventBridgeSupervisor implements OnModuleInit, OnModuleDestroy {
  private readonly running = new Map<string, EventConsumer>();

  constructor(
    @Inject(EVENT_ROUTE_REPO) private readonly routes: EventRouteRepository,
    @Inject(EVENT_CONSUMER_REGISTRY) private readonly registry: EventConsumerRegistry,
    private readonly dispatcher: EventDispatcherService,
  ) {}

  async onModuleInit(): Promise<void> {
    const supported = this.registry.supportedSourceTypes();
    if (supported.length === 0) {
      console.log("[event-bridge] no broker adapters registered — webhook-only mode");
      return;
    }
    let started = 0;
    for (const sourceType of supported) {
      const routes = await this.routes.list({
        sourceType: sourceType as EventRoute["sourceType"],
        approvalStatus: "approved",
        enabledOnly: true,
      });
      for (const route of routes) {
        try {
          await this.spawn(route);
          started += 1;
        } catch (err) {
          console.error(
            `[event-bridge] failed to start consumer for route ${route.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    console.log(
      `[event-bridge] supervisor online — adapters=[${supported.join(",")}] consumers=${started}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const [id, consumer] of this.running) {
      try {
        await consumer.stop();
      } catch (err) {
        console.error(`[event-bridge] error stopping ${id}: ${(err as Error).message}`);
      }
    }
    this.running.clear();
  }

  private async spawn(route: EventRoute): Promise<void> {
    const factory = this.registry.get(route.sourceType);
    if (!factory) return;
    const consumer = factory.create(route, this.dispatcher);
    await consumer.start();
    this.running.set(route.id, consumer);
  }
}
