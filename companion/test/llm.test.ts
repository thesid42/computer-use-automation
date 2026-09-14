import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { classifyProviderError, DEFAULT_LLM_TIMEOUT_MS, MAX_LLM_TIMEOUT_MS, MIN_LLM_TIMEOUT_MS, normalizeLLMGoalDecision, OpenAICompatibleModel, ScriptedDiscoveryModel } from '../src/llm/client.js';
import type { RunEvent } from '../src/evidence/events.js';
import type { ProvisionalIntent } from '../src/goal/interpret.js';

describe('OpenAI-compatible model adapter', () => {
  it('uses a bounded conservative provider timeout and exposes it in metadata', () => {
    expect(new OpenAICompatibleModel({ baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x' }).metadata.timeoutMs).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(new OpenAICompatibleModel({ baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', timeoutMs: 1 }).metadata.timeoutMs).toBe(MIN_LLM_TIMEOUT_MS);
    expect(new OpenAICompatibleModel({ baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', timeoutMs: 999999 }).metadata.timeoutMs).toBe(MAX_LLM_TIMEOUT_MS);
  });

  it('posts a grounded snapshot request to configured endpoint without exposing the key in messages', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x',
      fetch: async (url, init) => { request = { url: String(url), init: init ?? {} }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } }] }), { status: 200 }); }
    });
    const decision = await model.decide({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' }, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, []);
    expect(decision).toMatchObject({ kind: 'finish' });
    expect(request?.url).toBe('https://provider.example/v1/chat/completions');
    expect(String(request?.init.body)).not.toContain('secret-key');
    expect(request?.init.headers).toMatchObject({ authorization: 'Bearer secret-key' });
  });

  it('sends the current screenshot as a multimodal image and an explicit action JSON contract', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } }] }), { status: 200 });
      }
    });
    await model.decide({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'x', screenshot: 'data:image/png;base64,abc' }, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, []);
    const messages = body?.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((message) => message.role === 'user');
    expect(Array.isArray(user?.content)).toBe(true);
    expect(user?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } })
    ]));
    expect(body?.response_format).toMatchObject({ type: 'json_schema' });
    expect(JSON.stringify(body?.response_format)).toContain('click');
    expect(JSON.stringify(body?.response_format)).toContain('requestHuman');
  });

  it('supports accessibility observations without sending a screenshot image', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nex-agi/nex-n2.5-mini:free',
      observationMode: 'accessibility',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } }] }), { status: 200 });
      }
    });
    await model.decide(
      { url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [{ ref: 'control-1', role: 'button', name: 'Search', framePath: [] }], visibleText: 'ready', dialogs: [], stateFingerprint: 'x', screenshot: 'data:image/png;base64,synthetic' },
      { objective: 'read_task', entities: [], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only', userGoal: 'Read results.' },
      []
    );
    const messages = body?.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((message) => message.role === 'user');
    expect(Array.isArray(user?.content)).toBe(true);
    expect(user?.content).toEqual([expect.objectContaining({ type: 'text' })]);
    expect(JSON.stringify(body)).not.toContain('data:image/png;base64,synthetic');
    expect(model.metadata.observationMode).toBe('accessibility');
  });

  it('sends compact successful action history without replaying sensitive fill values', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', responseFormat: 'json_object',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } }] }), { status: 200 });
      }
    });
    await model.decide(
      { url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' },
      { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' },
      [
        { runId: 'run', stepId: 'fill-member', kind: 'action', action: { kind: 'fill', id: 'fill-member', value: '12345' }, resolvedControl: { role: 'textbox', name: 'Member ID', label: 'Member ID' }, outcome: 'succeeded', evidence: [] },
        { runId: 'run', stepId: 'extract-balance', kind: 'action', action: { kind: 'extract', id: 'extract-balance' }, resolvedControl: { role: 'cell', name: '$1,250.42', relativeText: 'Current Balance' }, outcome: 'succeeded', details: { output: 'current_savings_balance' }, evidence: [] },
        { runId: 'run', stepId: 'failed-global-nav', kind: 'action', action: { kind: 'click', id: 'teller-totals' }, resolvedControl: { role: 'link', name: 'Teller Totals' }, outcome: 'failed:TARGET_MISSING', evidence: [] }
      ]
    );
    const request = JSON.stringify(body);
    const messages = body?.messages as Array<{ role: string; content: unknown }>;
    const userContent = messages.find((message) => message.role === 'user')?.content;
    const userText = Array.isArray(userContent) ? String((userContent[0] as { text?: unknown })?.text ?? '') : String(userContent ?? '');
    expect(userText).toContain('"kind":"fill"');
    expect(userText).toContain('"label":"Member ID"');
    expect(userText).toContain('current_savings_balance');
    expect(userText).not.toContain('12345');
    expect(userText).not.toContain('Teller Totals');
    expect(request).not.toContain('secret');
  });

  it('uses a required strict action tool and parses exactly one tool call without exposing the key', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', actionMode: 'tool',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"click","id":"click-search","target":{"strategies":[{"ref":"control-1-2"}]}}' } }] } }] }), { status: 200 });
      }
    });
    const decision = await model.decide({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [{ ref: 'control-1-2', role: 'button', name: 'Search', framePath: [] }], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' }, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, []);
    expect(decision).toMatchObject({ kind: 'click', target: { strategies: [{ ref: 'control-1-2' }] } });
    expect(body?.response_format).toBeUndefined();
    expect(body?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'submit_computer_action', strict: true }) })]));
    const actionTool = (body?.tools as Array<{ function?: { parameters?: Record<string, unknown> } }> | undefined)?.find((tool) => tool.function?.parameters)?.function?.parameters;
    expect(actionTool?.additionalProperties).toBeUndefined();
    expect(actionTool?.oneOf).toBeInstanceOf(Array);
    expect(body?.tool_choice).toEqual({ type: 'function', function: { name: 'submit_computer_action' } });
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  it('accepts valid click, fill, extract, and finish actions with Fastify validation', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', actionMode: 'tool',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"click","id":"click-search","target":{"strategies":[{"ref":"control-1-2"}]}}' } }] } }] }), { status: 200 });
      }
    });
    await model.decide({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [{ ref: 'control-1-2', role: 'button', name: 'Search', framePath: [] }], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' }, { objective: 'read_task', entities: [], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only', userGoal: 'Read results.' }, []);
    const parameters = ((body?.tools as Array<{ function?: { parameters?: unknown } }> | undefined)?.[0]?.function?.parameters) as Record<string, unknown> | undefined;
    expect(parameters).toBeDefined();
    const validator = Fastify({
      logger: false,
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } }
    });
    validator.post('/', { schema: { body: parameters } }, async () => ({ ok: true }));
    await validator.ready();
    try {
      for (const payload of [
        { kind: 'click', id: 'click', target: { strategies: [{ ref: 'control-1' }] } },
        { kind: 'fill', id: 'fill', target: { strategies: [{ ref: 'control-1' }] }, value: { fromInput: 'query' } },
        { kind: 'extract', id: 'extract', target: { strategies: [{ ref: 'control-1' }] }, output: 'results', parseAs: 'string' },
        { kind: 'finish', id: 'finish', outputs: ['results'], checkpoint: 'Results table' }
      ]) {
        const response = await validator.inject({ method: 'POST', url: '/', payload });
        expect(response.statusCode, response.body).toBe(200);
      }
    } finally {
      await validator.close();
    }
  });

  it('rejects missing or multiple tool calls instead of falling back to content', async () => {
    let response: Record<string, unknown> = { choices: [{ message: { content: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}', tool_calls: [] } }] };
    const model = new OpenAICompatibleModel({ baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', actionMode: 'tool', fetch: async () => new Response(JSON.stringify(response), { status: 200 }) });
    const snapshot = { url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' };
    const intent: ProvisionalIntent = { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' };
    await expect(model.decide(snapshot, intent, [])).rejects.toThrow('expected_exactly_one_tool_call');
    response = { choices: [{ message: { tool_calls: [
      { type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } },
      { type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"finish","id":"done","outputs":[],"checkpoint":"ready"}' } }
    ] } }] };
    await expect(model.decide(snapshot, intent, [])).rejects.toThrow('expected_exactly_one_tool_call');
  });

  it('uses the required action tool for repair requests', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', actionMode: 'tool',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Current Balance visible"}' } }] } }] }), { status: 200 });
      }
    });
    const result = await model.repair({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'Current Balance', dialogs: [], stateFingerprint: 'x' }, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, [], { validationError: 'target required', stepId: 'action-1', proposal: { kind: 'click', id: 'bad', target: {} }, attempt: 1 });
    expect(result).toMatchObject({ kind: 'finish', outputs: ['current_savings_balance'] });
    expect(body?.tool_choice).toEqual({ type: 'function', function: { name: 'submit_computer_action' } });
    expect(JSON.stringify(body?.messages)).toContain('target required');
  });

  it('uses a completion-only tool after an observed output', async () => {
    let calls = 0;
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', actionMode: 'tool',
      fetch: async (_url, init) => {
        calls += 1;
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"finish","id":"finish-results","outputs":["results"],"checkpoint":"Results table"}' } }] } }] }), { status: 200 });
      }
    });
    const decision = await model.decide(
      { url: 'http://localhost:3001/results', title: 'Demo', framePath: [], controls: [{ ref: 'control-1', role: 'table', name: 'Results table', framePath: [] }], visibleText: 'Results table', dialogs: [], stateFingerprint: 'results' },
      { objective: 'read_records', entities: [{ proposedName: 'query', value: 'Brass hinge', sourceSpan: 'Brass hinge', type: 'string', sensitivity: 'plain' }], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only', userGoal: 'Find records matching Brass hinge' },
      [{ runId: 'run', stepId: 'extract-results', kind: 'action', action: { kind: 'extract', id: 'extract-results' }, resolvedControl: { role: 'table', name: 'Results table' }, outcome: 'succeeded', details: { output: 'results' }, evidence: [] }]
    );
    expect(decision).toEqual({ kind: 'finish', id: 'finish-results', outputs: ['results'], checkpoint: 'Results table' });
    expect(calls).toBe(1);
    const tools = body?.tools as Array<{ function?: { parameters?: { oneOf?: unknown[] } } }> | undefined;
    expect(tools?.[0]?.function?.parameters?.oneOf).toHaveLength(2);
    expect(JSON.stringify(body?.messages)).toContain('COMPLETION PHASE');
  });

  it('keeps the discovery tool until every requested output is observed', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', actionMode: 'tool',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_computer_action', arguments: '{"kind":"extract","id":"extract-second","target":{"strategies":[{"ref":"control-2"}]},"output":"details","parseAs":"string"}' } }] } }] }), { status: 200 });
      }
    });
    const decision = await model.decide(
      { url: 'http://localhost:3001/results', title: 'Demo', framePath: [], controls: [{ ref: 'control-2', role: 'table', name: 'Details', framePath: [] }], visibleText: 'Details', dialogs: [], stateFingerprint: 'details' },
      { objective: 'read_two_outputs', entities: [], requestedOutputs: [{ proposedName: 'summary', type: 'string' }, { proposedName: 'details', type: 'string' }], risk: 'read_only', userGoal: 'Read the summary and details.' },
      [{ runId: 'run', stepId: 'extract-summary', kind: 'action', action: { kind: 'extract', id: 'extract-summary' }, resolvedControl: { role: 'table', name: 'Summary' }, outcome: 'succeeded', details: { output: 'summary' }, evidence: [] }]
    );
    expect(decision).toMatchObject({ kind: 'extract', output: 'details' });
    const tools = body?.tools as Array<{ function?: { parameters?: { oneOf?: unknown[] } } }> | undefined;
    expect(tools?.[0]?.function?.parameters?.oneOf).toHaveLength(8);
    expect(JSON.stringify(body?.messages)).not.toContain('COMPLETION PHASE');
  });

  it('uses the same snapshot and validation error for one repair request', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'nano-omni', responseFormat: 'json_object',
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"click","id":"click-search","target":{"strategies":[{"ref":"control-1-2"}]}}' } }] }), { status: 200 });
      }
    });
    const snapshot = { url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [{ ref: 'control-1-2', role: 'button', name: 'Balance Details', framePath: [] }], visibleText: 'Balance Details Current Balance $1,250.42', dialogs: [], stateFingerprint: 'same', screenshot: 'data:image/png;base64,abc' };
    const priorEvents = [{ kind: 'action', outcome: 'succeeded', details: { output: 'current_savings_balance' } } as unknown as RunEvent];
    await model.repair(snapshot, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, priorEvents, { validationError: 'target.strategies is required', stepId: 'action-0', proposal: { kind: 'click', id: 'click-search', target: {} }, attempt: 1 });
    expect(requests).toHaveLength(1);
    const messages = requests[0]?.messages as Array<{ role: string; content: unknown }>;
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('target.strategies is required');
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('{"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Current Balance visible"}');
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('control-1-2');
    expect(JSON.stringify(messages)).toContain('data:image/png;base64,abc');
    expect(JSON.stringify(requests[0]?.response_format)).toContain('json_object');
  });

  it('interprets generic read-only goals with grounded entities and output declarations', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'secret-key', model: 'nex-agi/nex-n2.5-mini:free', responseFormat: 'json_object',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          kind: 'intent', objective: 'lookup_case_status', entities: [{ proposedName: 'case_id', value: 'ABC-7', sourceSpan: 'case ABC-7', type: 'string', sensitivity: 'sensitive_identifier' }], requestedOutputs: [{ proposedName: 'case_status', type: 'string' }], risk: 'read_only', title: 'Case Status'
        }) } }] }), { status: 200 });
      }
    });
    const result = await model.interpretGoal('Check case ABC-7 and tell me its status.', { signatures: [{ intent: 'lookup_case_status' }] });
    expect(result).toMatchObject({ objective: 'lookup_case_status', userGoal: 'Check case ABC-7 and tell me its status.', risk: 'read_only', entities: [{ proposedName: 'case_id', value: 'ABC-7' }], requestedOutputs: [{ proposedName: 'case_status', type: 'string' }] });
    expect(body?.model).toBe('nex-agi/nex-n2.5-mini:free');
    expect(body?.response_format).toMatchObject({ type: 'json_object' });
    expect(JSON.stringify(body)).not.toContain('secret-key');
    expect(JSON.stringify(body)).toContain('lookup_case_status');
  });

  it('uses a required intent tool when the provider has no response-format mode', async () => {
    let body: Record<string, unknown> | undefined;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'secret-key', model: 'inclusionai/ling-3.0-flash-vl:free', responseFormat: 'none',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_goal_intent', arguments: JSON.stringify({ kind: 'intent', objective: 'find_branches', entities: [{ proposedName: 'branch_name', value: 'Northside', sourceSpan: 'Northside', type: 'string', sensitivity: 'plain' }], requestedOutputs: [{ proposedName: 'branches', type: 'string' }], risk: 'read_only' }) } }] } }] }), { status: 200 });
      }
    });
    await expect(model.interpretGoal('Find branches matching Northside.')).resolves.toMatchObject({ objective: 'find_branches', entities: [{ proposedName: 'branch_name', value: 'Northside' }] });
    expect(body?.response_format).toBeUndefined();
    expect(body?.tool_choice).toEqual({ type: 'function', function: { name: 'submit_goal_intent' } });
    expect(body?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'submit_goal_intent', strict: true }) })]));
  });

  it('accepts a complete intent with zero user inputs and requires a declared output', () => {
    expect(normalizeLLMGoalDecision({ kind: 'intent', objective: 'list_public_notices', entities: [], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only' }, 'List public notices.')).toMatchObject({
      objective: 'list_public_notices', entities: [], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only', userGoal: 'List public notices.'
    });
    expect(() => normalizeLLMGoalDecision({ kind: 'intent', objective: 'list_public_notices', entities: [], requestedOutputs: [], risk: 'read_only' }, 'List public notices.')).toThrow('llm_intent_invalid:requested_outputs_required');
  });

  it('makes at most one correction request when an intent response is incomplete', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'secret-key', model: 'inclusionai/ling-3.0-flash-vl:free', responseFormat: 'none',
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const call = requests.length;
        const argumentsValue = call === 1
          ? { kind: 'intent', objective: 'find_branches_matching', entities: [], requestedOutputs: [], risk: 'read_only' }
          : { kind: 'intent', objective: 'find_branches_matching', entities: [{ proposedName: 'branch_name', value: 'Northside', sourceSpan: 'Northside', type: 'string', sensitivity: 'plain' }], requestedOutputs: [{ proposedName: 'results', type: 'string' }], risk: 'read_only' };
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_goal_intent', arguments: JSON.stringify(argumentsValue) } }] } }] }), { status: 200 });
      }
    });
    await expect(model.interpretGoal('Find branches matching Northside.')).resolves.toMatchObject({ objective: 'find_branches_matching', entities: [{ proposedName: 'branch_name', value: 'Northside' }], requestedOutputs: [{ proposedName: 'results' }] });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0]?.messages)).toContain('complete read-only intent');
    expect(JSON.stringify(requests[1]?.messages)).toContain('previous response failed local validation');
    expect(JSON.stringify(requests[1]?.messages)).toContain('Northside');
  });

  it('corrects a provider that asks for a value already present in the goal', async () => {
    let calls = 0;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'secret-key', model: 'inclusionai/ling-3.0-flash-vl:free', responseFormat: 'none',
      fetch: async () => {
        calls += 1;
        const message = calls === 1
          ? { tool_calls: [{ type: 'function', function: { name: 'submit_goal_intent', arguments: '{"kind":"needs_input","message":"Which member ID should I use?"}' } }] }
          : { tool_calls: [{ type: 'function', function: { name: 'submit_goal_intent', arguments: '{"kind":"intent","objective":"read_service_requests","entities":[{"proposedName":"member_id","value":"12345","sourceSpan":"member 12345","type":"string","sensitivity":"member_identifier"}],"requestedOutputs":[{"proposedName":"results","type":"string"}],"risk":"read_only"}' } }] };
        return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
      }
    });
    await expect(model.interpretGoal('Show service requests for member 12345.')).resolves.toMatchObject({ objective: 'read_service_requests', entities: [{ proposedName: 'member_id', value: '12345' }] });
    expect(calls).toBe(2);
  });

  it('surfaces the second validation failure without a third provider call', async () => {
    let calls = 0;
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', responseFormat: 'json_object',
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"intent","objective":"broken","entities":[],"requestedOutputs":[],"risk":"read_only"}' } }] }), { status: 200 });
      }
    });
    await expect(model.interpretGoal('Show something.')).rejects.toThrow('llm_intent_invalid:requested_outputs_required');
    expect(calls).toBe(2);
  });

  it('returns an explicit needs-input intent without guessing missing values', async () => {
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', responseFormat: 'json_object',
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"needs_input","message":"Which case identifier should I use?","missing":"case_id"}' } }] }), { status: 200 })
    });
    await expect(model.interpretGoal('Show the case status.')).resolves.toMatchObject({ kind: 'needs_input', message: 'Which case identifier should I use?', missing: 'case_id' });
  });

  it('rejects non-read-only or malformed provider intents before matching', async () => {
    const unsafe = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', responseFormat: 'json_object',
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"intent","objective":"post_fee","risk":"REVERSIBLE_WRITE"}' } }] }), { status: 200 })
    });
    await expect(unsafe.interpretGoal('Post a fee.')).rejects.toThrow('llm_intent_invalid:risk_must_be_read_only');
    const malformed = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', responseFormat: 'json_object',
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"intent"}' } }] }), { status: 200 })
    });
    await expect(malformed.interpretGoal('Show something.')).rejects.toThrow('llm_intent_invalid:objective_required');
  });

  it('classifies provider HTTP failures without exposing response bodies', async () => {
    expect(classifyProviderError(401)).toBe('auth');
    expect(classifyProviderError(429)).toBe('rate_limit');
    expect(classifyProviderError(400, 'response_format is not supported')).toBe('unsupported');
    expect(classifyProviderError(502)).toBe('upstream_unavailable');
  });

  it('reports only a sanitized HTTP category when a provider response contains sensitive detail', async () => {
    const model = new OpenAICompatibleModel({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', model: 'model-x', responseFormat: 'none',
      fetch: async () => new Response('{"error":{"message":"token secret-key cannot be used","code":"bad_request"}}', { status: 400 })
    });
    await expect(model.decide({ url: 'http://localhost:3001', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'x' }, { objective: 'read_task', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'read task' }, [])).rejects.toThrow('llm_http_400:invalid_request');
  });

  it('provides deterministic scripted decisions for offline tests', async () => {
    const fake = new ScriptedDiscoveryModel([{ kind: 'wait', id: 'w', condition: 'ready', timeoutMs: 1 }]);
    expect(await fake.decide()).toMatchObject({ kind: 'wait' });
  });
});
