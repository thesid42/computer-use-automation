export type RunEvent = {
  runId: string;
  stepId: string;
  kind: 'action' | 'observation' | 'human_action' | 'result';
  action?: unknown;
  modelRef?: string;
  resolvedControl?: { role?: string; name?: string; text?: string; label?: string; relativeText?: string; framePath?: string[]; frameUrl?: string };
  inputProvenance?: Record<string, string>;
  beforeFingerprint?: string;
  afterFingerprint?: string;
  outcome: string;
  durationMs?: number;
  evidence: string[];
  details?: Record<string, unknown>;
  timestamp?: string;
};

export type RunEventSink = (event: RunEvent) => void | Promise<void>;

function shouldRedact(key: string | undefined, value: string): boolean {
  return key !== 'fromInput' && ((key !== undefined && /^(member[_-]?id|account[_-]?id|secret|token|password|inputValue|value|identifier)$/i.test(key)) || /^\d{4,}$/.test(value));
}

export function redact(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (shouldRedact(key, value)) return '[REDACTED]';
    if (key && /^(id|createdAt|timestamp|runId|sessionId|interventionId|capabilityId|workflowId|version|schemaVersion|stepId|modelId|output|kind|code|status|mode|beforeEvidence|afterEvidence|evidenceRef)$/i.test(key)) return value;
    if (key === 'frameUrl') return value.replace(/\/\d{4,}(?=\/|$)/g, '/[REDACTED]');
    if (key === 'path' || key === 'url' || key === 'evidence') return value;
    return value.replace(/\b\d{4,}\b/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

export class RunEventRecorder {
  readonly events: RunEvent[] = [];

  constructor(private readonly onEvent?: RunEventSink) {}

  record(event: RunEvent): void {
    const sanitized = { ...redact(event) as RunEvent, timestamp: event.timestamp ?? new Date().toISOString() };
    this.events.push(sanitized);
    try {
      const notification = this.onEvent?.(sanitized);
      if (notification && typeof (notification as Promise<void>).then === 'function') {
        void notification.catch(() => undefined);
      }
    } catch {
      // Evidence sinks are observers. A sink failure must never change the run result.
    }
  }

  toJSONL(): string {
    return this.events.map((event) => JSON.stringify(event)).join('\n') + (this.events.length ? '\n' : '');
  }
}
