import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export interface BootstrapOptions {
  serviceName?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  debug?: boolean;
}

let sdk: NodeSDK | null = null;

export function bootstrapTracing(opts: BootstrapOptions = {}): NodeSDK | null {
  if (sdk) return sdk;
  const endpoint = opts.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const enabled = Boolean(endpoint) || process.env.MAVIO_OTEL_DEBUG === "1";
  if (!enabled) return null;

  if (opts.debug) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: opts.serviceName ?? "mavio-mcp",
    [SEMRESATTRS_SERVICE_VERSION]: opts.serviceVersion ?? "0.1.0",
  });

  const exporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` })
    : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    resource,
    spanProcessor: new BatchSpanProcessor(exporter),
  });
  sdk.start();
  return sdk;
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
