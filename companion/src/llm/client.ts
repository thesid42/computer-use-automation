import type { DiscoveryModel } from '../discovery/runner.js';
import type { ProvisionalIntent } from '../goal/interpret.js';
import { redact, type RunEvent } from '../evidence/events.js';
import type { SurfaceSnapshot } from '../surface/adapter.js';

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
  fetch?: typeof globalThis.fetch;
};

export const DEFAULT_LLM_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

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
  type: 'object', additionalProperties: false,
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

export class OpenAICompatibleModel implements DiscoveryModel {
  readonly metadata: { baseUrl: string; model: string; temperature: number; timeoutMs: number; actionMode: 'json' | 'tool' };
  private readonly send: typeof globalThis.fetch;

  constructor(private readonly config: LLMConfig) {
    this.send = config.fetch ?? globalThis.fetch;
    this.metadata = { baseUrl: config.baseUrl, model: config.model, temperature: config.temperature ?? 0, timeoutMs: normalizeLLMTimeoutMs(config.timeoutMs ?? config.requestTimeoutMs), actionMode: config.actionMode ?? 'json' };
  }

  private async requestAction(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[], repair?: { validationError: string; stepId: string; proposal: unknown; attempt: number }): Promise<unknown> {
    if (!this.config.apiKey) throw new Error('LLM_API_KEY is required for live discovery');
    const text = JSON.stringify({ intent, snapshot: { url: snapshot.url, title: snapshot.title, framePath: snapshot.framePath, controls: snapshot.controls, visibleText: snapshot.visibleText, dialogs: snapshot.dialogs, stateFingerprint: snapshot.stateFingerprint }, priorEvents: compactPriorActions(priorEvents) });
    const timeoutMs = this.metadata.timeoutMs;
    const responseFormat = this.config.responseFormat ?? 'json_schema';
    const actionMode = this.metadata.actionMode;
    const requestedOutputs = intent.requestedOutputs.map((output) => ({ name: output.proposedName, type: output.type, ...(output.currency ? { currency: output.currency } : {}) }));
    const requestedInputNames = intent.entities.map((entity) => entity.proposedName);
    const fallbackOutput = intent.objective === 'lookup_member_savings_balance' ? { name: 'current_savings_balance', type: 'money', currency: 'USD' } : undefined;
    const outputContract = requestedOutputs.length ? requestedOutputs : (fallbackOutput ? [fallbackOutput] : []);
    const extractedRequestedOutput = priorEvents.find((event) => event.outcome === 'succeeded' && typeof event.details?.output === 'string' && outputContract.some((output) => output.name === event.details?.output));
    const finishHint = extractedRequestedOutput && outputContract.length > 0
      ? intent.objective === 'lookup_member_savings_balance' && outputContract.length === 1 && outputContract[0]?.name === 'current_savings_balance'
        ? 'A requested output (current_savings_balance) was already extracted. If the visible checkpoint is now satisfied, return exactly {"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Current Balance visible"}. '
        : `A requested output (${String(extractedRequestedOutput.details?.output)}) was already extracted. If the visible checkpoint is now satisfied, return exactly a finish action with outputs ${JSON.stringify(outputContract.map((output) => output.name))} and the checkpoint text visible in the current snapshot. `
      : '';
    const intentContract = `Use only these grounded input references when values come from the request: ${JSON.stringify(requestedInputNames)}. Requested outputs are exactly: ${JSON.stringify(outputContract)}. For an extracted output, use one of those exact names and its declared parse type.`;
    const repairInstructions = repair ? `Repair attempt ${repair.attempt} of 2. Validation failed with: ${repair.validationError}. The malformed proposal was: ${JSON.stringify(repair.proposal)}. Current controls are exactly: ${JSON.stringify(snapshot.controls.map(({ ref, role, name, text, label, framePath }) => ({ ref, role, name, text, label, framePath })))}. For click, fill, selectOption, or extract, copy exactly one current control ref into target.strategies[0].ref. Do not invent a ref or use an empty target. Fill requires target and value; selectOption requires target and option; extract requires target, output, and parseAs; wait requires condition and timeoutMs; finish requires outputs and checkpoint; requestHuman requires reason; clickPoint requires numeric x and y. ${finishHint}Do not explain the correction, omit fields, infer a selection, or return multiple actions. ` : '';
    const response = await this.send(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature ?? 0,
        ...(actionMode === 'tool' ? { tools: [actionTool], tool_choice: { type: 'function', function: { name: 'submit_computer_action' } } } : responseFormat === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'nano_omni_browser_action', strict: true, schema: actionJsonSchema } } } : responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: `${repairInstructions}Continue from the current snapshot and the recent successful action history. Do not repeat a successful action, undo successful progress, or navigate to unrelated global sections. Choose the single visible control that advances the requested read-only goal; use only the temporary refs in the current snapshot. Return exactly one JSON action object matching the supplied schema. This is a one-action contract: choose exactly one click, fill, selectOption, wait, extract, finish, requestHuman, or clickPoint. Do not return prose, markdown, chain-of-thought, or multiple actions. For any control action, target MUST be {"strategies":[{"ref":"control-..."}]} using one temporary ref from the current snapshot; never invent a selector or persistent locator. Values must be explicit: fill requires both target and value; selectOption requires both target and option. If the value comes from the grounded intent, use a {"fromInput":"..."} reference named in the intent contract. ${intentContract} Use these exact shapes as examples (replace refs only with refs visible in this snapshot):
{"kind":"click","id":"click-search","target":{"strategies":[{"ref":"control-1-2"}]}}
{"kind":"fill","id":"fill-member-id","target":{"strategies":[{"ref":"control-1-1"}]},"value":{"fromInput":"member_id"}}
{"kind":"selectOption","id":"select-account","target":{"strategies":[{"ref":"control-1-3"}]},"option":"Savings"}
{"kind":"wait","id":"wait-results","condition":"text:Member Summary","timeoutMs":5000}
{"kind":"extract","id":"extract-output","target":{"strategies":[{"ref":"control-1-4"}]},"output":"<requested output name>","parseAs":"<requested output type>"}
{"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Balance Details"}
{"kind":"requestHuman","id":"request-verification","reason":"Supervisor verification is required"}
{"kind":"clickPoint","id":"click-menu","x":120,"y":80}
Never include credentials, extra keys, or a target on wait, finish, or requestHuman. Do not guess missing semantic fields.` },
          { role: 'user', content: [{ type: 'text', text }, ...(snapshot.screenshot ? [{ type: 'image_url', image_url: { url: snapshot.screenshot } }] : [])] }
        ]
      })
    });
    if (!response.ok) throw new Error(`llm_http_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> };
    return parseProviderDecision(payload.choices?.[0]?.message ?? {}, this.metadata.actionMode);
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
