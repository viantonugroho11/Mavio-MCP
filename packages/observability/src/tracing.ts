import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

const TRACER_NAME = "@mavio/observability";
const TRACER_VERSION = "0.1.0";

export function getMavioTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export interface SpanRunOptions {
  attributes?: Record<string, string | number | boolean | undefined>;
  kind?: SpanKind;
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  opts: SpanRunOptions = {},
): Promise<T> {
  const tracer = getMavioTracer();
  return tracer.startActiveSpan(
    name,
    { kind: opts.kind ?? SpanKind.INTERNAL, attributes: cleanAttrs(opts.attributes) },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.recordException(err instanceof Error ? err : new Error(message));
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  propagation.inject(context.active(), out);
  return out;
}

function cleanAttrs(
  input?: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  if (!input) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

export { SpanKind, SpanStatusCode };
export type { Span, Tracer };
