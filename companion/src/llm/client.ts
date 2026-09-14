import type { DiscoveryModel } from '../discovery/runner.js';
import type { ProvisionalIntent } from '../goal/interpret.js';
import { redact, type RunEvent } from '../evidence/events.js';
import type { SurfaceSnapshot } from '../surface/adapter.js';

/** A model may ask the operator for one missing value before discovery starts. */
export type LLMGoalDecision = ProvisionalIntent | {
  kind: 'needs_input';
  message: string;
  missing?: string;
};

export type ProviderErrorCategory = 'auth' | 'rate_limit' | 'invalid_request' | 'unsupported' | 'upstream_unavailable' | 'timeout' | 'provider_error';

/** Classify a provider failure without retaining or exposing its response body. */
export function classifyProviderError(status: number, body = ''): ProviderErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream_unavailable';
  const text = body.toLowerCase();
  if (/(unsupported|not support|not implemented|response_format|tool_choice|tools)/.test(text)) return 'unsupported';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'provider_error';
}

async function providerHttpError(response: Response): Promise<Error> {
  let body = '';
  try { body = await response.text(); } catch { /* retain the HTTP status category */ }
  return new Error(`llm_http_${response.status}:${classifyProviderError(response.status, body)}`);
}

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  /** Maximum time allowed for a provider response. */
  timeoutMs?: number;
  requestTimeoutMs?: number;
  responseFormat?: 'json_schema' | 'json_object' | 'none';
  actionMode?: 'json' | 'tool';
  /** Observation transport for action discovery. Accessibility mode sends grounded controls/text without an image. */
  observationMode?: 'multimodal' | 'accessibility';
  fetch?: typeof globalThis.fetch;
};

// Catalog-verified zero-price vision/tool model selected after live grounding
// benchmark. The OpenRouter model id is pinned for reproducible discovery.
export const DEFAULT_LLM_MODEL = 'nex-agi/nex-n2.5-mini:free';

function compactPriorActions(priorEvents: RunEvent[]): Array<Record<string, unknown>> {
  return priorEvents
    .filter((event) => event.kind === 'action' && event.outcome === 'succeeded')
    .slice(-12)
    .map((event) => {
      const action = event.action && typeof event.action === 'object' ? event.action as Record<string, unknown> : {};
      const control = event.resolvedControl;
      const safeControl = control ? Object.fromEntries(
        (['role', 'name', 'label', 'relativeText'] as const)
          .filter((key) => control[key] !== undefined)
          .map((key) => [key, control[key]])
      ) : undefined;
      const summary: Record<string, unknown> = {
        stepId: event.stepId,
        kind: typeof action.kind === 'string' ? action.kind : event.stepId,
        ...(safeControl && Object.keys(safeControl).length ? { control: safeControl } : {}),
        ...(typeof event.details?.output === 'string' ? { output: event.details.output } : {}),
        ...(typeof action.checkpoint === 'string' ? { checkpoint: action.checkpoint } : {})
      };
      return redact(summary) as Record<string, unknown>;
    });
}

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
export const MIN_LLM_TIMEOUT_MS = 5_000;
export const MAX_LLM_TIMEOUT_MS = 120_000;

export function normalizeLLMTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LLM_TIMEOUT_MS;
  return Math.min(MAX_LLM_TIMEOUT_MS, Math.max(MIN_LLM_TIMEOUT_MS, Math.round(value)));
}

const actionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  allOf: [
    { if: { properties: { kind: { enum: ['click', 'fill', 'selectOption', 'extract'] } } }, then: { required: ['target'] } },
    { if: { properties: { kind: { const: 'clickPoint' } } }, then: { required: ['x', 'y'] } },
    { if: { properties: { kind: { const: 'fill' } } }, then: { required: ['target', 'value'] } },
    { if: { properties: { kind: { const: 'selectOption' } } }, then: { required: ['target', 'option'] } },
    { if: { properties: { kind: { const: 'wait' } } }, then: { required: ['condition', 'timeoutMs'] } },
    { if: { properties: { kind: { const: 'extract' } } }, then: { required: ['target', 'output', 'parseAs'] } },
    { if: { properties: { kind: { const: 'finish' } } }, then: { required: ['outputs', 'checkpoint'] } },
    { if: { properties: { kind: { const: 'requestHuman' } } }, then: { required: ['reason'] } }
  ],
  properties: {
    kind: { type: 'string', enum: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman', 'clickPoint'] },
    id: { type: 'string' },
    target: { type: 'object', required: ['strategies'], properties: { strategies: { type: 'array', minItems: 1, items: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } }, additionalProperties: true } } }, additionalProperties: true },
    value: { anyOf: [{ type: 'string' }, { type: 'object', properties: { fromInput: { type: 'string' } }, required: ['fromInput'], additionalProperties: false }] },
    option: { anyOf: [{ type: 'string' }, { type: 'object', properties: { fromInput: { type: 'string' } }, required: ['fromInput'], additionalProperties: false }] },
    condition: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
    output: { type: 'string' },
    parseAs: { type: 'string', enum: ['text', 'money', 'string'] },
    outputs: { type: 'array', items: { type: 'string' } },
    checkpoint: { type: 'string' },
    reason: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    risk: { type: 'string', enum: ['READ_ONLY', 'REVERSIBLE_WRITE', 'IRREVERSIBLE_WRITE'] }
  }
};

const toolTargetSchema = {
  type: 'object', additionalProperties: false, required: ['strategies'],
  properties: {
    strategies: {
      type: 'array', minItems: 1,
      items: { type: 'object', additionalProperties: false, required: ['ref'], properties: { ref: { type: 'string' } } }
    }
  }
};

// Tool mode uses explicit per-kind variants so providers cannot omit the
// semantic fields that make an action executable.
const toolActionJsonSchema = {
  // The per-kind oneOf branches close their own objects. Keeping
  // additionalProperties off at this wrapper level would reject every
  // branch field because those properties are declared inside oneOf.
  type: 'object',
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'target'], properties: { kind: { const: 'click' }, id: { type: 'string' }, target: toolTargetSchema } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'target', 'value'], properties: { kind: { const: 'fill' }, id: { type: 'string' }, target: toolTargetSchema, value: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, required: ['fromInput'], properties: { fromInput: { type: 'string' } } }] } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'target', 'option'], properties: { kind: { const: 'selectOption' }, id: { type: 'string' }, target: toolTargetSchema, option: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, required: ['fromInput'], properties: { fromInput: { type: 'string' } } }] } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'condition', 'timeoutMs'], properties: { kind: { const: 'wait' }, id: { type: 'string' }, condition: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'target', 'output', 'parseAs'], properties: { kind: { const: 'extract' }, id: { type: 'string' }, target: toolTargetSchema, output: { type: 'string' }, parseAs: { type: 'string', enum: ['text', 'money', 'string'] } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'outputs', 'checkpoint'], properties: { kind: { const: 'finish' }, id: { type: 'string' }, outputs: { type: 'array', items: { type: 'string' } }, checkpoint: { type: 'string' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'reason'], properties: { kind: { const: 'requestHuman' }, id: { type: 'string' }, reason: { type: 'string' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'x', 'y'], properties: { kind: { const: 'clickPoint' }, id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } }
  ]
};

const actionTool = {
  type: 'function',
  function: {
    name: 'submit_computer_action',
    description: 'Submit exactly one grounded computer action for the current page.',
    strict: true,
    parameters: toolActionJsonSchema
  }
} as const;

// Once every requested output has been observed, the model may only close the
// run from the current result or hand it to a human. Keeping this phase
// separate prevents a provider from looping over already-completed controls.
const completionActionJsonSchema = {
  type: 'object',
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'outputs', 'checkpoint'], properties: { kind: { const: 'finish' }, id: { type: 'string' }, outputs: { type: 'array', minItems: 1, items: { type: 'string' } }, checkpoint: { type: 'string', minLength: 1 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'id', 'reason'], properties: { kind: { const: 'requestHuman' }, id: { type: 'string' }, reason: { type: 'string', minLength: 1 } } }
  ]
} as const;

const completionActionTool = {
  type: 'function',
  function: {
    name: 'submit_computer_action',
    description: 'Submit exactly one completion action for the current observed result.',
    strict: true,
    parameters: completionActionJsonSchema
  }
} as const;

// This schema deliberately describes a generic read-only intent. The server
// validates the grounded fields again before matching or compiling a workflow.
// Keeping the schema broad lets a learned workflow carry an objective that was
// not known when the companion was shipped.
const intentEntitySchema = {
  type: 'object', additionalProperties: false,
  required: ['proposedName', 'value', 'sourceSpan', 'type', 'sensitivity'],
  properties: {
    proposedName: { type: 'string', minLength: 1 }, value: { type: 'string', minLength: 1 }, sourceSpan: { type: 'string', minLength: 1 },
    type: { const: 'string' }, sensitivity: { type: 'string', minLength: 1 }
  }
} as const;

const intentOutputSchema = {
  type: 'object', additionalProperties: false,
  required: ['proposedName', 'type'],
  properties: { proposedName: { type: 'string', minLength: 1 }, type: { type: 'string', enum: ['money', 'string'] }, currency: { type: 'string', minLength: 1 } }
} as const;

/**
 * Keep the provider-stage intent complete. A read-only request may have no
 * user-provided values, so `entities` may be empty, but every complete request
 * must declare at least one output. Clarification remains a server concern.
 */
export const intentJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'objective', 'entities', 'requestedOutputs', 'risk'],
  properties: {
    kind: { const: 'intent' }, objective: { type: 'string', minLength: 1 },
    entities: { type: 'array', minItems: 0, items: intentEntitySchema },
    requestedOutputs: { type: 'array', minItems: 1, items: intentOutputSchema },
    risk: { const: 'read_only' }, title: { type: 'string', minLength: 1 },
    requiredConcepts: { type: 'array', items: { type: 'string' } }, phrases: { type: 'array', items: { type: 'string' } }
  }
} as const;

const intentTool = {
  type: 'function',
  function: {
    name: 'submit_goal_intent',
    description: 'Submit exactly one grounded read-only goal interpretation.',
    strict: true,
    parameters: intentJsonSchema
  }
} as const;

const intentSystemPrompt = [
  'Interpret one plain-language computer-use request for a rendered application.',
  'Return exactly one JSON object and no prose.',
  'A complete read-only intent MUST contain these fields: kind (the literal "intent"), objective (a concise stable slug), entities (an array, possibly empty only when the request contains no user-provided values), requestedOutputs (an array with at least one declared output), and risk (the literal "read_only").',
  'Each entity MUST contain proposedName, value, sourceSpan, type (the literal "string"), and sensitivity. Ground every user-provided identifier, search term, date, or filter value in the request; sourceSpan must be copied from the request and value must be the exact value to enter.',
  'A value after words such as matching, named, called, containing, or filter is already a complete search input; never ask for a separate identifier when the request already provides that search or filter value. For example, "Find items matching Brass hinge" is complete and must include item_query=Brass hinge as an entity; it must not return needs_input.',
  'Each requested output MUST contain proposedName and type ("string" or "money", with currency when applicable). When the request asks to find or show records, declare a generic string output named "results".',
  'Before discovery, do not infer that a target form field or identifier is mandatory from a domain noun; the rendered UI has not been observed yet. The request\'s own explicit search, filter, name, or record value is sufficient, and any unseen form field is discovered later. This provider stage has an intent-only tool, so do not ask for another identifier or emit a clarification response when a meaningful value is present.',
  'The companion handles read-only validation and known missing inputs outside this tool. If the request is not read-only, the companion rejects it; never invent a write action or credentials.',
  'Never invent values, credentials, selectors, controls, actions, or outputs. A matching signature is context only; do not return needs_input merely because no existing signature matches. If all identifiers and requested values are present, always return a generic intent so the application can learn a new workflow.',
  'Contract examples:',
  '{"kind":"intent","objective":"find_inventory_items","entities":[{"proposedName":"item_query","value":"Brass hinge","sourceSpan":"Brass hinge","type":"string","sensitivity":"plain"}],"requestedOutputs":[{"proposedName":"results","type":"string"}],"risk":"read_only"}',
  '{"kind":"intent","objective":"read_support_ticket","entities":[{"proposedName":"ticket_id","value":"CASE-42","sourceSpan":"ticket CASE-42","type":"string","sensitivity":"sensitive_identifier"}],"requestedOutputs":[{"proposedName":"results","type":"string"}],"risk":"read_only"}',
  '{"kind":"intent","objective":"list_public_notices","entities":[],"requestedOutputs":[{"proposedName":"results","type":"string"}],"risk":"read_only"}'
].join(' ');

function parseJsonCandidate(value: string): unknown {
  const trimmed = value.trim();
  const clean = trimmed.startsWith('```') && trimmed.endsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    : trimmed;
  try { return JSON.parse(clean); } catch { return value; }
}

function parseContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        const parsed = parseJsonCandidate(part);
        if (parsed && typeof parsed === 'object') return parsed;
      }
      if (part && typeof part === 'object') {
        const candidate = 'text' in part ? (part as { text?: unknown }).text : 'json' in part ? (part as { json?: unknown }).json : undefined;
        if (candidate && typeof candidate === 'object') return candidate;
        if (typeof candidate === 'string') {
          const parsed = parseJsonCandidate(candidate);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      }
    }
    return content;
  }
  if (typeof content === 'string') return parseJsonCandidate(content);
  return content;
}

function parseProviderDecision(message: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown }, actionMode: 'json' | 'tool' = 'json'): unknown {
  if (actionMode === 'tool') {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) throw new Error('llm_tool_call_invalid:expected_exactly_one_tool_call');
    const toolCall = message.tool_calls[0];
    if (!toolCall || typeof toolCall !== 'object') throw new Error('llm_tool_call_invalid:malformed_tool_call');
    const fn = (toolCall as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn || fn.name !== 'submit_computer_action') throw new Error('llm_tool_call_invalid:unexpected_tool_name');
    const parsed = parseContent(fn.arguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('llm_tool_call_invalid:arguments_must_be_json_object');
    return parsed;
  }
  const direct = parseContent(message.content);
  if (direct && typeof direct === 'object') return direct;
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (!toolCall || typeof toolCall !== 'object') continue;
      const fn = (toolCall as { function?: { arguments?: unknown } }).function;
      const parsed = parseContent(fn?.arguments);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  }
  const reasoning = parseContent(message.reasoning_content);
  return reasoning && typeof reasoning === 'object' ? reasoning : direct;
}

function parseIntentContent(message: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown }): unknown {
  const direct = parseContent(message.content);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (!toolCall || typeof toolCall !== 'object') continue;
      const fn = (toolCall as { function?: { arguments?: unknown } }).function;
      const parsed = parseContent(fn?.arguments);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  }
  const reasoning = parseContent(message.reasoning_content);
  return reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning) ? reasoning : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  return values.length ? values : [];
}

/** Detect an explicit value that a provider must ground instead of asking for again. */
function goalHasExplicitValue(goal: string): boolean {
  return /\b(?:member|customer|client|user|account|case|ticket|order|policy)\s*(?:(?:id|number|no\.?|code)\s*)?(?:is\s*|[:#-]\s*)?[A-Za-z0-9][A-Za-z0-9_-]*/i.test(goal)
    || /\b(?:matching|named|called|containing|with)\s+[A-Za-z0-9][A-Za-z0-9 .'-]{1,80}/i.test(goal)
    || /\b\d{4}-\d{2}-\d{2}\b/.test(goal)
    || /["'][^"']{1,120}["']/.test(goal);
}

function explicitGoalValueSpans(goal: string): string[] {
  const spans = new Set<string>();
  for (const match of goal.matchAll(/\b(?:matching|named|called|containing|with)\s+([^,.!?]+)/gi)) {
    const value = match[1]?.trim();
    if (value) spans.add(value);
  }
  for (const match of goal.matchAll(/\b(?:member|customer|client|user|account|case|ticket|order|policy)\s*(?:(?:id|number|no\.?|code)\s*)?(?:is\s*|[:#-]\s*)?([A-Za-z0-9][A-Za-z0-9_-]*)/gi)) {
    const value = match[1]?.trim();
    if (value) spans.add(`${match[0]}`.trim());
  }
  for (const match of goal.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) spans.add(match[0]);
  for (const match of goal.matchAll(/["']([^"']{1,120})["']/g)) {
    const value = match[1]?.trim();
    if (value) spans.add(value);
  }
  return [...spans].slice(0, 12);
}

function needsInputConflictsWithGoal(decision: LLMGoalDecision, goal: string): boolean {
  return 'kind' in decision && decision.kind === 'needs_input'
    && goalHasExplicitValue(goal)
    && /\b(?:id|identifier|number|value|search term|filter)\b/i.test(decision.message);
}

/** Normalize and reject provider intent output before it reaches matching. */
export function normalizeLLMGoalDecision(value: unknown, originalGoal: string): LLMGoalDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('llm_intent_invalid:response_object_required');
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'needs_input') {
    if (typeof raw.message !== 'string' || !raw.message.trim()) throw new Error('llm_intent_invalid:needs_input_message_required');
    return { kind: 'needs_input', message: raw.message.trim(), ...(typeof raw.missing === 'string' && raw.missing.trim() ? { missing: raw.missing.trim() } : {}) };
  }
  if (raw.kind !== 'intent') throw new Error('llm_intent_invalid:unexpected_kind');
  if (typeof raw.objective !== 'string' || !raw.objective.trim()) throw new Error('llm_intent_invalid:objective_required');
  if (raw.risk !== 'read_only') throw new Error('llm_intent_invalid:risk_must_be_read_only');

  if (!Array.isArray(raw.entities)) throw new Error('llm_intent_invalid:entities_required');
  const entities: ProvisionalIntent['entities'] = raw.entities.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`llm_intent_invalid:entity_${index}_malformed`);
    const entity = entry as Record<string, unknown>;
    if (typeof entity.proposedName !== 'string' || !entity.proposedName.trim() || typeof entity.value !== 'string' || !entity.value.trim() || typeof entity.sourceSpan !== 'string' || !entity.sourceSpan.trim() || entity.type !== 'string' || typeof entity.sensitivity !== 'string' || !entity.sensitivity.trim()) throw new Error(`llm_intent_invalid:entity_${index}_grounding_required`);
    return { proposedName: entity.proposedName.trim(), value: entity.value.trim(), sourceSpan: entity.sourceSpan.trim(), type: 'string' as const, sensitivity: entity.sensitivity.trim() };
  });
  if (!Array.isArray(raw.requestedOutputs) || raw.requestedOutputs.length === 0) throw new Error('llm_intent_invalid:requested_outputs_required');
  const requestedOutputs: ProvisionalIntent['requestedOutputs'] = raw.requestedOutputs.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`llm_intent_invalid:output_${index}_malformed`);
    const output = entry as Record<string, unknown>;
    if (typeof output.proposedName !== 'string' || !output.proposedName.trim() || (output.type !== 'money' && output.type !== 'string')) throw new Error(`llm_intent_invalid:output_${index}_declaration_required`);
    return { proposedName: output.proposedName.trim(), type: output.type, ...(typeof output.currency === 'string' && output.currency.trim() ? { currency: output.currency.trim() } : {}) };
  });
  const result: ProvisionalIntent = { objective: raw.objective.trim(), entities, requestedOutputs, risk: 'read_only', userGoal: originalGoal };
  if (typeof raw.title === 'string' && raw.title.trim()) result.title = raw.title.trim();
  const requiredConcepts = stringArray(raw.requiredConcepts);
  if (requiredConcepts !== undefined) result.requiredConcepts = requiredConcepts;
  const phrases = stringArray(raw.phrases);
  if (phrases !== undefined) result.phrases = phrases;
  return result;
}

export class OpenAICompatibleModel implements DiscoveryModel {
  readonly metadata: { baseUrl: string; model: string; temperature: number; timeoutMs: number; actionMode: 'json' | 'tool'; responseFormat: 'json_schema' | 'json_object' | 'none'; observationMode: 'multimodal' | 'accessibility' };
  private readonly send: typeof globalThis.fetch;

  constructor(private readonly config: LLMConfig) {
    this.send = config.fetch ?? globalThis.fetch;
    this.metadata = { baseUrl: config.baseUrl, model: config.model, temperature: config.temperature ?? 0, timeoutMs: normalizeLLMTimeoutMs(config.timeoutMs ?? config.requestTimeoutMs), actionMode: config.actionMode ?? 'json', responseFormat: config.responseFormat ?? 'json_schema', observationMode: config.observationMode ?? 'multimodal' };
  }

  private async requestAction(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[], repair?: { validationError: string; stepId: string; proposal: unknown; attempt: number }): Promise<unknown> {
    if (!this.config.apiKey) throw new Error('LLM_API_KEY is required for live discovery');
    const text = JSON.stringify({ intent, snapshot: { url: snapshot.url, title: snapshot.title, framePath: snapshot.framePath, controls: snapshot.controls, visibleText: snapshot.visibleText, dialogs: snapshot.dialogs, stateFingerprint: snapshot.stateFingerprint }, priorEvents: compactPriorActions(priorEvents) });
    const timeoutMs = this.metadata.timeoutMs;
    const responseFormat = this.metadata.responseFormat;
    const actionMode = this.metadata.actionMode;
    const requestedOutputs = intent.requestedOutputs.map((output) => ({ name: output.proposedName, type: output.type, ...(output.currency ? { currency: output.currency } : {}) }));
    const requestedInputNames = intent.entities.map((entity) => entity.proposedName);
    const fallbackOutput = intent.objective === 'lookup_member_savings_balance' ? { name: 'current_savings_balance', type: 'money', currency: 'USD' } : undefined;
    const outputContract = requestedOutputs.length ? requestedOutputs : (fallbackOutput ? [fallbackOutput] : []);
    const allOutputsExtracted = outputContract.length > 0 && outputContract.every((output) => priorEvents.some((event) => event.kind === 'action' && event.outcome === 'succeeded' && event.details?.output === output.name));
    const extractedRequestedOutput = priorEvents.find((event) => event.outcome === 'succeeded' && typeof event.details?.output === 'string' && outputContract.some((output) => output.name === event.details?.output));
    const finishHint = allOutputsExtracted && extractedRequestedOutput && outputContract.length > 0
      ? intent.objective === 'lookup_member_savings_balance' && outputContract.length === 1 && outputContract[0]?.name === 'current_savings_balance'
        ? 'A requested output (current_savings_balance) was already extracted. The requested output is present, so you MUST return exactly {"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Current Balance visible"} now; do not fill, click, wait, or extract again. '
        : `A requested output (${String(extractedRequestedOutput.details?.output)}) was already extracted. The requested output is present, so you MUST return exactly one finish action now with outputs ${JSON.stringify(outputContract.map((output) => output.name))} and a checkpoint copied from the current visible result; do not fill, click, wait, or extract again. `
      : '';
    const intentContract = `Use only these grounded input references when values come from the request: ${JSON.stringify(requestedInputNames)}. Requested outputs are exactly: ${JSON.stringify(outputContract)}. For an extracted output, use one of those exact names and its declared parse type.`;
    const repairInstructions = repair ? `Repair attempt ${repair.attempt} of 2. Validation failed with: ${repair.validationError}. The malformed proposal was: ${JSON.stringify(repair.proposal)}. Current controls are exactly: ${JSON.stringify(snapshot.controls.map(({ ref, role, name, text, label, framePath }) => ({ ref, role, name, text, label, framePath })))}. For click, fill, selectOption, or extract, copy exactly one current control ref into target.strategies[0].ref. Do not invent a ref or use an empty target. Fill requires target and value; selectOption requires target and option; extract requires target, output, and parseAs; wait requires condition and timeoutMs; finish requires outputs and checkpoint; requestHuman requires reason; clickPoint requires numeric x and y. Do not explain the correction, omit fields, infer a selection, or return multiple actions. ` : '';
    const completionInstructions = allOutputsExtracted
      ? 'COMPLETION PHASE: Every requested output has already been successfully extracted and is visible in the current snapshot. Before finishing, verify that the visible result is scoped to every grounded input in the intent; a broad or unfiltered result containing records outside the requested scope is not sufficient. Return exactly one finish action with the requested output names and a stable visible heading or table caption copied from the current snapshot only when the requested scope is visibly verified, or return requestHuman if the scope or checkpoint cannot be verified. Do not return click, fill, selectOption, wait, extract, or clickPoint. '
      : '';
    const selectedActionTool = allOutputsExtracted ? completionActionTool : actionTool;
    const response = await this.send(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature ?? 0,
          ...(actionMode === 'tool' ? { tools: [selectedActionTool], tool_choice: { type: 'function', function: { name: 'submit_computer_action' } } } : responseFormat === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: allOutputsExtracted ? 'nano_omni_browser_completion' : 'nano_omni_browser_action', strict: true, schema: allOutputsExtracted ? completionActionJsonSchema : actionJsonSchema } } } : responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: allOutputsExtracted
            ? `${repairInstructions}${completionInstructions}${finishHint}Return exactly one completion action matching the supplied schema. Use kind "finish" with every requested output name and a stable visible heading or table caption copied from the current snapshot, or kind "requestHuman" when that checkpoint cannot be verified. Do not return click, fill, selectOption, wait, extract, clickPoint, prose, markdown, or multiple actions. ${intentContract}`
            : `${repairInstructions}${finishHint}Continue from the current snapshot and the recent successful action history. Do not repeat a successful action, undo successful progress, or navigate to unrelated global sections. Before extracting a requested output, verify that the visible result is scoped to every grounded input in the intent; a broad or unfiltered result containing records outside the requested scope is not sufficient. If scope is missing, continue through the visible controls to apply the relevant filter or reach a scoped result, and do not extract yet. Choose the single visible control that advances the requested read-only goal; use only the temporary refs in the current snapshot. Return exactly one JSON action object matching the supplied schema. This is a one-action contract: choose exactly one click, fill, selectOption, wait, extract, finish, requestHuman, or clickPoint. Do not return prose, markdown, chain-of-thought, or multiple actions. For any control action, target MUST be {"strategies":[{"ref":"control-..."}]} using one temporary ref from the current snapshot; never invent a selector or persistent locator. Values must be explicit: fill requires both target and value; selectOption requires both target and option. If the value comes from the grounded intent, use a {"fromInput":"..."} reference named in the intent contract. ${intentContract} Use these exact shapes as examples (replace refs only with refs visible in this snapshot):
{"kind":"click","id":"click-search","target":{"strategies":[{"ref":"control-1-2"}]}}
{"kind":"fill","id":"fill-member-id","target":{"strategies":[{"ref":"control-1-1"}]},"value":{"fromInput":"member_id"}}
{"kind":"selectOption","id":"select-account","target":{"strategies":[{"ref":"control-1-3"}]},"option":"Savings"}
{"kind":"wait","id":"wait-results","condition":"text:Member Summary","timeoutMs":5000}
{"kind":"extract","id":"extract-output","target":{"strategies":[{"ref":"control-1-4"}]},"output":"<requested output name>","parseAs":"<requested output type>"}
{"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Balance Details"}
{"kind":"requestHuman","id":"request-verification","reason":"Supervisor verification is required"}
{"kind":"clickPoint","id":"click-menu","x":120,"y":80}
Never include credentials, extra keys, or a target on wait, finish, or requestHuman. Do not guess missing semantic fields.` },
          { role: 'user', content: [
            { type: 'text', text },
            ...(this.metadata.observationMode === 'multimodal' && snapshot.screenshot ? [{ type: 'image_url', image_url: { url: snapshot.screenshot } }] : [])
          ] }
        ]
      })
    });
    if (!response.ok) throw await providerHttpError(response);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> };
    return parseProviderDecision(payload.choices?.[0]?.message ?? {}, this.metadata.actionMode);
  }

  /**
   * Interpret a new plain-language goal into grounded inputs and an output
   * contract. This is a separate provider call so action discovery can remain
   * a one-action-per-observation loop. `context` is optional and should contain
   * only workflow signatures or other non-secret matching context.
   */
  async interpretGoal(userGoal: string, context?: unknown): Promise<LLMGoalDecision> {
    if (!this.config.apiKey) throw new Error('LLM_API_KEY is required for live discovery');
    const responseFormat = this.metadata.responseFormat;
    const contextText = context === undefined ? undefined : JSON.stringify(context);
    const requestIntent = async (correction?: string): Promise<unknown> => {
      const response = await this.send(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(this.metadata.timeoutMs),
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature ?? 0,
          ...(responseFormat === 'none' ? { tools: [intentTool], tool_choice: { type: 'function', function: { name: 'submit_goal_intent' } } } : responseFormat === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'read_only_goal_intent', strict: true, schema: intentJsonSchema } } } : { response_format: { type: 'json_object' } }),
          messages: [
            { role: 'system', content: `${intentSystemPrompt}${contextText ? ` Matching context (signatures only): ${contextText}` : ''}${correction ? ` Correction: ${correction}` : ''}` },
            { role: 'user', content: userGoal }
          ]
        })
      });
      if (!response.ok) throw await providerHttpError(response);
      let payload: { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> };
      try {
        payload = await response.json() as typeof payload;
      } catch {
        throw new Error('llm_intent_invalid:provider_payload_required');
      }
      return parseIntentContent(payload.choices?.[0]?.message ?? {});
    };

    const first = await requestIntent();
    try {
      const decision = normalizeLLMGoalDecision(first, userGoal);
      if (needsInputConflictsWithGoal(decision, userGoal)) throw new Error('llm_intent_invalid:needs_input_conflicts_with_grounded_goal');
      return decision;
    } catch (error) {
      const validationError = error instanceof Error ? error.message : 'llm_intent_invalid:response_object_required';
      const spans = explicitGoalValueSpans(userGoal);
      const spanHint = spans.length ? `The original goal already contains these exact value spans: ${JSON.stringify(spans)}. Ground them as entities; do not ask the user to provide them again.` : '';
      const corrected = await requestIntent(`The previous response failed local validation (${validationError}). Return a complete object matching the contract above. Include every required key, at least one requestedOutputs entry, and every user-provided value as a grounded entity. ${spanHint} If the goal contains a search or filter value, use it as the entity value even when it is not an identifier. Do not return needs_input when the goal already contains the needed value. Do not return an incomplete intent, omit arrays, or add prose.`);
      // The correction is deliberately attempted once. A second malformed
      // response is surfaced to the caller with its sanitized protocol error.
      return normalizeLLMGoalDecision(corrected, userGoal);
    }
  }

  async decide(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[]): Promise<unknown> {
    return this.requestAction(snapshot, intent, priorEvents);
  }

  async repair(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[], context: { validationError: string; stepId: string; proposal: unknown; attempt: number }): Promise<unknown> {
    return this.requestAction(snapshot, intent, priorEvents, context);
  }
}

export class ScriptedDiscoveryModel implements DiscoveryModel {
  private index = 0;
  constructor(private readonly decisions: unknown[]) {}
  async decide(): Promise<unknown> {
    const decision = this.decisions[this.index++];
    if (decision === undefined) throw new Error('script_exhausted');
    return decision;
  }
}
