import * as api from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { packageMetadata as pkg } from './packageMetadata.js';
import type { TelemetryConfig, TelemetryStatus } from './telemetry.types.ts';

const REDACTED_ATTRIBUTE = '[redacted]';
const MAX_ATTRIBUTE_CHARS = 1000;
let provider: NodeTracerProvider | null = null;
let initializedEndpoint = '';
let initializedSampleRatio: number | null = null;

type SafeAttributeScalar = string | number | boolean;
type SafeAttributeValue = SafeAttributeScalar | SafeAttributeScalar[];
type SafeAttributes = Record<string, SafeAttributeValue>;

interface RunSpanOptions {
  carrier?: Record<string, unknown>;
  kind?: api.SpanKind;
}

function configuredTelemetryEndpoint(config: TelemetryConfig = {}): string {
  return String(config.telemetry?.endpoint || process.env.REL_AI_OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
}

function telemetryEnabled(config: TelemetryConfig = {}): boolean {
  return config.telemetry?.enabled === true;
}

function telemetryEndpoint(config: TelemetryConfig = {}): string {
  return telemetryEnabled(config) ? configuredTelemetryEndpoint(config) : '';
}

function telemetrySampleRatio(config: TelemetryConfig = {}): number {
  const value = Number(config.telemetry?.sampleRatio ?? process.env.REL_AI_OTEL_SAMPLE_RATIO ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function initializeTelemetry(config: TelemetryConfig = {}): boolean {
  const endpoint = telemetryEndpoint(config);
  if (!endpoint) return false;
  if (provider) return true;
  const sampleRatio = telemetrySampleRatio(config);
  const exporter = new OTLPTraceExporter({ url: endpoint });
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'rel-ai-mcp',
      [ATTR_SERVICE_VERSION]: pkg.version,
      'service.instance.id': String(process.pid),
      'relai.telemetry.mode': 'optional'
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor(exporter)]
  });
  provider.register();
  initializedEndpoint = endpoint;
  initializedSampleRatio = sampleRatio;
  return true;
}

function tracer(config: TelemetryConfig = {}): api.Tracer {
  initializeTelemetry(config);
  return api.trace.getTracer('rel-ai-mcp', pkg.version);
}

function sanitizeAttributes(attributes: Record<string, unknown> = {}): SafeAttributes {
  const safe: SafeAttributes = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value == null) continue;
    if (/token|secret|password|authorization|api[_-]?key|file\.content|command\.env|approval/i.test(key)) {
      safe[key] = REDACTED_ATTRIBUTE;
      continue;
    }
    if (/(?:^|\.)(?:command|command_line)$/i.test(key)) {
      safe[key] = summarizeCommandForTelemetry(value);
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value.slice(0, 100).map(item => sanitizeScalar(item));
      continue;
    }
    safe[key] = sanitizeScalar(value);
  }
  return safe;
}

function summarizeCommandForTelemetry(value: unknown): string {
  const parts = String(value || '').replace(/[\r\n\t]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const executable = summarizeExecutable(parts[0]);
  return parts.length === 1 ? executable : `${executable} [${parts.length - 1} args]`;
}

function summarizeExecutable(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.replaceAll('\\\\', '/').replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).at(-1) || '[executable]';
}

function sanitizeScalar(value: unknown): SafeAttributeScalar {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').trim();
  return text.length > MAX_ATTRIBUTE_CHARS ? `${text.slice(0, MAX_ATTRIBUTE_CHARS - 1)}…` : text;
}

function traceContextEnvironment(): Record<string, string> {
  const carrier: Record<string, string> = {};
  const setter: api.TextMapSetter<Record<string, string>> = {
    set: (target, key, value) => { target[String(key).toLowerCase()] = String(value); }
  };
  api.propagation.inject(api.context.active(), carrier, setter);
  return {
    ...(carrier.traceparent ? { TRACEPARENT: carrier.traceparent } : {}),
    ...(carrier.tracestate ? { TRACESTATE: carrier.tracestate } : {})
  };
}

function extractTraceContext(carrier: Record<string, unknown> = {}): api.Context {
  const getter: api.TextMapGetter<Record<string, unknown>> = {
    keys: source => Object.keys(source || {}),
    get: (source, key) => (source?.[String(key).toLowerCase()] ?? source?.[key]) as string | string[] | undefined
  };
  return api.propagation.extract(api.context.active(), carrier || {}, getter);
}

async function runSpan<T>(
  config: TelemetryConfig,
  name: unknown,
  attributes: Record<string, unknown>,
  operation: () => T | Promise<T>,
  options: RunSpanOptions = {}
): Promise<T> {
  if (!telemetryEndpoint(config)) return operation();
  const parentContext = options.carrier ? extractTraceContext(options.carrier) : api.context.active();
  const span = tracer(config).startSpan(String(name || 'relai.operation'), {
    attributes: sanitizeAttributes(attributes) as api.Attributes,
    kind: options.kind || api.SpanKind.INTERNAL
  }, parentContext);
  try {
    return await api.context.with(api.trace.setSpan(parentContext, span), operation);
  } catch (error) {
    span.setAttribute('relai.error.type', safeExceptionType(error));
    span.setStatus({ code: api.SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

function safeExceptionType(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'AggregateError']).has(name)
    ? name
    : error instanceof Error ? 'Error' : 'NonErrorThrow';
}

function addSpanEvent(name: unknown, attributes: Record<string, unknown> = {}): void {
  api.trace.getSpan(api.context.active())?.addEvent(String(name || 'event'), sanitizeAttributes(attributes) as api.Attributes);
}

function setSpanAttributes(attributes: Record<string, unknown> = {}): void {
  api.trace.getSpan(api.context.active())?.setAttributes(sanitizeAttributes(attributes) as api.Attributes);
}

async function shutdownTelemetry(): Promise<void> {
  const current = provider;
  provider = null;
  initializedEndpoint = '';
  initializedSampleRatio = null;
  if (current) await current.shutdown();
}

function telemetryStatus(config: TelemetryConfig = {}): TelemetryStatus {
  const endpointConfigured = Boolean(configuredTelemetryEndpoint(config));
  const enabled = telemetryEnabled(config) && endpointConfigured;
  return {
    enabled,
    initialized: enabled && Boolean(provider),
    exporter: enabled && provider ? 'otlp-http' : '',
    endpointConfigured,
    endpoint: enabled && initializedEndpoint ? '[configured]' : '',
    sampleRatio: initializedSampleRatio ?? telemetrySampleRatio(config)
  };
}

export {
  initializeTelemetry,
  runSpan,
  addSpanEvent,
  setSpanAttributes,
  shutdownTelemetry,
  telemetryStatus,
  sanitizeAttributes,
  summarizeCommandForTelemetry,
  telemetrySampleRatio,
  traceContextEnvironment
};

