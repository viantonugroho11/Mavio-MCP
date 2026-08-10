import type { EventRoute } from "@mavio/registry";
import type { EventDispatcherService } from "./event-dispatcher.service.js";

/**
 * A broker consumer that subscribes to one route's stream/topic and calls
 * `dispatcher.dispatch()` for every message. Implementations are supplied
 * per source type — Kafka, NATS, RabbitMQ, etc. — and registered against
 * `EventConsumerRegistry` at boot.
 *
 * Contract:
 * - `start()` must be idempotent (supervisor calls it on route enable/edit).
 * - `stop()` must drain and close the underlying broker connection.
 * - Errors thrown from message handlers are the adapter's responsibility to
 *   log / retry / DLQ. `dispatcher.dispatch()` itself never throws — check
 *   `result.outcome` for policy denials, network errors bubble via router.
 */
export interface EventConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface EventConsumerFactory {
  /** Source-type discriminator matched against `event_routes.source_type`. */
  readonly sourceType: string;
  /**
   * Called once per approved+enabled route matching `sourceType`.
   * Return a consumer ready to `start()`.
   */
  create(route: EventRoute, dispatcher: EventDispatcherService): EventConsumer;
}

/**
 * Registry of broker adapters. Populated at boot from
 * `EventBridgeModule` — real Kafka/NATS wiring lives in a separate optional
 * package (e.g. `@mavio/event-adapters-kafka`) so this app package does not
 * hard-depend on any broker client.
 *
 * A default no-op factory for `sourceType='webhook'` is intentionally
 * absent: webhooks are dispatched by the HTTP controller, not a consumer.
 */
export class EventConsumerRegistry {
  private readonly factories = new Map<string, EventConsumerFactory>();

  register(factory: EventConsumerFactory): void {
    if (this.factories.has(factory.sourceType)) {
      throw new Error(`event consumer factory already registered: ${factory.sourceType}`);
    }
    this.factories.set(factory.sourceType, factory);
  }

  get(sourceType: string): EventConsumerFactory | undefined {
    return this.factories.get(sourceType);
  }

  supportedSourceTypes(): string[] {
    return [...this.factories.keys()];
  }
}

export const EVENT_CONSUMER_REGISTRY = Symbol("EVENT_CONSUMER_REGISTRY");
