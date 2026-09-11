import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_TIMEOUT_MS, MAX_LLM_TIMEOUT_MS, MIN_LLM_TIMEOUT_MS, OpenAICompatibleModel, ScriptedDiscoveryModel } from '../src/llm/client.js';
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
    expect(body?.tool_choice).toEqual({ type: 'function', function: { name: 'submit_computer_action' } });
    expect(JSON.stringify(body)).not.toContain('secret-key');
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
    const priorEvents = [{ outcome: 'succeeded', details: { output: 'current_savings_balance' } } as unknown as RunEvent];
    await model.repair(snapshot, { objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'do task' }, priorEvents, { validationError: 'target.strategies is required', stepId: 'action-0', proposal: { kind: 'click', id: 'click-search', target: {} }, attempt: 1 });
    expect(requests).toHaveLength(1);
    const messages = requests[0]?.messages as Array<{ role: string; content: unknown }>;
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('target.strategies is required');
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('{"kind":"finish","id":"finish-balance","outputs":["current_savings_balance"],"checkpoint":"Current Balance visible"}');
    expect(String(messages.find((message) => message.role === 'system')?.content)).toContain('control-1-2');
    expect(JSON.stringify(messages)).toContain('data:image/png;base64,abc');
    expect(JSON.stringify(requests[0]?.response_format)).toContain('json_object');
  });

  it('provides deterministic scripted decisions for offline tests', async () => {
    const fake = new ScriptedDiscoveryModel([{ kind: 'wait', id: 'w', condition: 'ready', timeoutMs: 1 }]);
    expect(await fake.decide()).toMatchObject({ kind: 'wait' });
  });
});
