import type { ProvisionalIntent } from '../goal/interpret.js';
import type { RunEvent } from '../evidence/events.js';
import { redact } from '../evidence/events.js';
import { actionSchema, capabilitySchema, type ArtifactAction, type CapabilityArtifact } from './schema.js';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 80) || 'read-task';
}

function title(value: string): string {
  return value.split(/[_\s-]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ') || 'Read-only workflow';
}

const COMPATIBILITY_CAPABILITY_IDS = new Map([
  ['lookup_member_savings_balance', 'member.lookup-savings-balance'],
  ['lookup_member_transaction_history', 'member.lookup-transaction-history'],
  ['quote_member_loan_payoff', 'member.quote-loan-payoff']
]);

function replaceEntityTerms(text: string, intent: ProvisionalIntent, replacement: (entity: ProvisionalIntent['entities'][number]) => string): string {
  const terms = intent.entities
    .flatMap((entity) => [entity.value, entity.sourceSpan].map((term) => ({ term, entity })))
    .filter(({ term }) => term.trim().length > 0)
    .sort((left, right) => right.term.length - left.term.length);
  if (!terms.length) return text;
  const escaped = terms.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'gi');
  return text.replace(pattern, (match) => {
    const found = terms.find(({ term }) => term.toLocaleLowerCase() === match.toLocaleLowerCase());
    return found ? replacement(found.entity) : match;
  });
}

function containsEntityTerm(text: string, intent: ProvisionalIntent): boolean {
  const lower = text.toLocaleLowerCase();
  return intent.entities.some((entity) => [entity.value, entity.sourceSpan]
    .some((term) => term.trim().length > 0 && lower.includes(term.toLocaleLowerCase())));
}

function stableFrameUrl(frameUrl: string): string {
  try {
    const url = new URL(frameUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return frameUrl.split(/[?#]/, 1)[0] ?? frameUrl;
  }
}

function stableSemanticStrategy(source: Record<string, unknown>, intent: ProvisionalIntent): Record<string, unknown> {
  const strategy: Record<string, unknown> = {};
  for (const key of ['role', 'label', 'name', 'relativeText'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && !containsEntityTerm(value, intent)) strategy[key] = value;
  }
  // Text is only a last resort. A control's accessible name often falls back
  // to its full rendered text, which can contain the user's query or result
  // rows and would make the learned locator input-specific.
  if (!strategy.name && !strategy.label && !strategy.relativeText) {
    const text = source.text;
    if (typeof text === 'string' && text.length > 0 && !containsEntityTerm(text, intent)) strategy.text = text;
  }
  if (Array.isArray(source.framePath)) strategy.framePath = source.framePath;
  if (typeof source.frameUrl === 'string' && source.frameUrl.length > 0) strategy.frameUrl = stableFrameUrl(source.frameUrl);
  return strategy;
}

function persistentTarget(event: RunEvent, intent: ProvisionalIntent): { strategies: Array<Record<string, unknown>> } | undefined {
  const action = event.action as { target?: { strategies?: Array<Record<string, unknown>> } } | undefined;
  if (!action?.target) return undefined;
  const control = event.resolvedControl;
  if (control) {
    // A relation such as the table header or definition-list label is more
    // stable than a rendered value. Fall back to the model's target strategy
    // if the live accessible description only contains dynamic result text.
    const sources = [control as Record<string, unknown>, ...(action.target.strategies ?? [])];
    const strategy: Record<string, unknown> = {};
    const relation = sources.find((source) => typeof source.relativeText === 'string' && source.relativeText.length > 0 && !containsEntityTerm(source.relativeText, intent));
    if (relation) {
      strategy.relativeText = relation.relativeText;
    } else {
      for (const key of ['role', 'label', 'name'] as const) {
        const candidate = sources.find((source) => typeof source[key] === 'string' && source[key]!.length > 0 && !containsEntityTerm(source[key] as string, intent));
        if (candidate) strategy[key] = candidate[key];
      }
    }
    if (!strategy.name && !strategy.label && !strategy.relativeText) {
      const candidate = sources.find((source) => typeof source.text === 'string' && source.text.length > 0 && !containsEntityTerm(source.text, intent));
      if (candidate) strategy.text = candidate.text;
    }
    // Captions and headings are non-interactive semantic anchors. Their
    // accessible name commonly falls back to the same short text that the
    // original text locator resolved, so retain that bounded text fallback.
    const role = typeof strategy.role === 'string' ? strategy.role.toLowerCase() : '';
    if (['caption', 'heading', 'term', 'definition', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(role)) {
      const candidate = sources.find((source) => typeof source.text === 'string' && source.text.length > 0 && !containsEntityTerm(source.text, intent));
      if (candidate) strategy.text = candidate.text;
    }
    if (Array.isArray(control.framePath)) strategy.framePath = control.framePath;
    else {
      const framePath = sources.find((source) => Array.isArray(source.framePath))?.framePath;
      if (framePath) strategy.framePath = framePath;
    }
    const frameUrl = sources.find((source) => typeof source.frameUrl === 'string' && source.frameUrl.length > 0)?.frameUrl;
    if (typeof frameUrl === 'string') strategy.frameUrl = stableFrameUrl(frameUrl);
    return Object.keys(strategy).length ? { strategies: [redact(strategy) as Record<string, unknown>] } : undefined;
  }
  const strategies = action.target.strategies?.map((strategy) => stableSemanticStrategy(Object.fromEntries(Object.entries(strategy).filter(([key]) => key !== 'ref')), intent)).filter((strategy) => Object.keys(strategy).length > 0);
  return strategies?.length ? { strategies: strategies.map((strategy) => redact(strategy) as Record<string, unknown>) } : undefined;
}

function goalTemplate(intent: ProvisionalIntent, includedNames: Set<string>): string {
  return replaceEntityTerms(intent.userGoal, intent, (entity) => includedNames.has(entity.proposedName) ? `{${entity.proposedName}}` : '');
}

function redactEntityValues(text: string, intent: ProvisionalIntent): string {
  return replaceEntityTerms(text, intent, () => ' ');
}

function parameterizePhrase(phrase: string, intent: ProvisionalIntent, includedNames: Set<string>): string {
  const result = replaceEntityTerms(phrase, intent, (entity) => includedNames.has(entity.proposedName) ? `{${entity.proposedName}}` : ' ');
  return result.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => includedNames.has(name) ? match : ' ');
}

function canonicalActionId(rawId: string, eventIndex: number, intent: ProvisionalIntent): string {
  const sanitized = replaceEntityTerms(rawId, intent, (entity) => entity.proposedName)
    .replace(/\s+/g, '-')
    .trim();
  return sanitized || `observed-${eventIndex}`;
}

function sourceProvenEntity(intent: ProvisionalIntent, value: string): ProvisionalIntent['entities'][number] | undefined {
  return intent.entities.find((entity) => entity.value === value);
}

function actionWithGroundedValue(action: Record<string, unknown>, intent: ProvisionalIntent): Record<string, unknown> {
  if (action.kind === 'fill' && typeof action.value === 'string') {
    const entity = sourceProvenEntity(intent, action.value);
    if (!entity) throw new Error(`CAPABILITY_COMPILE_INVALID: fill value for ${String(action.id)} was not grounded in the request text`);
    return { ...action, value: { fromInput: entity.proposedName } };
  }
  if (action.kind === 'selectOption' && typeof action.option === 'string') {
    const entity = sourceProvenEntity(intent, action.option);
    return entity ? { ...action, option: { fromInput: entity.proposedName } } : action;
  }
  if (action.kind === 'fill' && action.value && typeof action.value === 'object') {
    const name = (action.value as Record<string, unknown>).fromInput;
    if (typeof name !== 'string' || !intent.entities.some((entity) => entity.proposedName === name)) throw new Error(`CAPABILITY_COMPILE_INVALID: unknown input reference in ${String(action.id)}`);
  }
  if (action.kind === 'selectOption' && action.option && typeof action.option === 'object') {
    const name = (action.option as Record<string, unknown>).fromInput;
    if (typeof name !== 'string' || !intent.entities.some((entity) => entity.proposedName === name)) throw new Error(`CAPABILITY_COMPILE_INVALID: unknown input reference in ${String(action.id)}`);
  }
  return action;
}

function outputDeclarations(intent: ProvisionalIntent, actions: ArtifactAction[], finish: Extract<ArtifactAction, { kind: 'finish' }>): CapabilityArtifact['outputs'] {
  const extracted = actions.filter((action): action is Extract<ArtifactAction, { kind: 'extract' }> => action.kind === 'extract');
  if (extracted.length === 0) {
    throw new Error('CAPABILITY_COMPILE_INVALID: successful finish has no observed extraction');
  }
  const declared = new Map<string, { type: 'money' | 'string'; currency?: string }>();
  for (const action of extracted) {
    const requested = intent.requestedOutputs.find((output) => output.proposedName === action.output);
    declared.set(action.output, requested?.type === 'money' || action.parseAs === 'money'
      ? { type: 'money', ...(requested?.currency ? { currency: requested.currency } : {}) }
      : { type: 'string' });
  }
  const missing = finish.outputs.filter((name) => !declared.has(name));
  if (missing.length) throw new Error(`CAPABILITY_COMPILE_INVALID: finish declares outputs that were not observed: ${missing.join(', ')}`);
  const extractedNames = new Set(declared.keys());
  const requested = intent.requestedOutputs.map((output) => output.proposedName);
  const missingRequested = requested.filter((name) => !extractedNames.has(name));
  if (missingRequested.length) throw new Error(`CAPABILITY_COMPILE_INVALID: requested outputs were not observed: ${missingRequested.join(', ')}`);
  const undeclaredRequested = requested.filter((name) => !finish.outputs.includes(name));
  if (undeclaredRequested.length) throw new Error(`CAPABILITY_COMPILE_INVALID: requested outputs were not declared by finish: ${undeclaredRequested.join(', ')}`);
  return [...declared.entries()].map(([name, definition]) => ({ name, ...definition }));
}

function usedInputs(intent: ProvisionalIntent, actions: ArtifactAction[]): CapabilityArtifact['inputs'] {
  const names = new Set<string>();
  for (const action of actions) {
    const reference = action.kind === 'fill' ? action.value : action.kind === 'selectOption' ? action.option : undefined;
    if (reference && typeof reference === 'object') names.add(reference.fromInput);
  }
  return intent.entities.filter((entity) => names.has(entity.proposedName)).map((entity) => ({
    name: entity.proposedName,
    type: 'string' as const,
    sensitivity: entity.sensitivity || 'plain',
    validation: entity.sensitivity === 'date'
      ? { minLength: 10, maxLength: 10, format: 'iso_date' as const }
      : { minLength: 1, maxLength: 256 }
  }));
}

/**
 * Turn only successful, observed actions into an executable artifact. There
 * is intentionally no canned action fallback here: an incomplete trace is a
 * compile error and cannot become a saved workflow.
 */
export function compileCapability(intent: ProvisionalIntent, events: RunEvent[], targetProfileId = 'demo-app'): CapabilityArtifact {
  for (const entity of intent.entities) {
    const proposedName = entity.proposedName.toLocaleLowerCase();
    if (proposedName.includes(entity.value.toLocaleLowerCase()) || proposedName.includes(entity.sourceSpan.toLocaleLowerCase())) {
      throw new Error(`CAPABILITY_COMPILE_INVALID: entity name ${entity.proposedName} contains its grounded value`);
    }
  }
  const successfulEvents = events.filter((event) => event.kind === 'action' && event.outcome === 'succeeded' && event.action);
  const finishEvent = [...successfulEvents].reverse().find((event) => (event.action as { kind?: string } | undefined)?.kind === 'finish');
  if (!finishEvent) throw new Error('CAPABILITY_COMPILE_INVALID: no successful finish action was observed');

  const observedActions: ArtifactAction[] = [];
  const seenTraceKeys = new Set<string>();
  const usedIds = new Set<string>();
  for (const [eventIndex, event] of successfulEvents.entries()) {
    const raw = event.action as Record<string, unknown>;
    const { id: _modelActionId, ...actionWithoutId } = raw;
    // Resume can expose the exact same action twice. Deduplicate that replay
    // artifact, while retaining distinct actions that happened to receive the
    // same model-issued id (their canonical payloads differ).
    const traceKey = JSON.stringify(actionWithoutId);
    if (seenTraceKeys.has(traceKey)) continue;
    seenTraceKeys.add(traceKey);
    const originalId = typeof raw.id === 'string' ? raw.id : `observed-${eventIndex}`;
    const canonicalBase = canonicalActionId(originalId, eventIndex, intent);
    let id = canonicalBase;
    let suffix = 2;
    while (usedIds.has(id)) id = `${canonicalBase}-${suffix++}`;
    usedIds.add(id);
    const grounded = actionWithGroundedValue({ ...raw, id }, intent);
    if ('target' in grounded) {
      const target = persistentTarget(event, intent);
      if (!target) throw new Error(`CAPABILITY_COMPILE_INVALID: no persistent target was observed for ${String(grounded.id)}`);
      grounded.target = target;
    }
    observedActions.push(actionSchema.parse(grounded));
  }
  const finish = [...observedActions].reverse().find((action): action is Extract<ArtifactAction, { kind: 'finish' }> => action.kind === 'finish');
  if (!finish) throw new Error('CAPABILITY_COMPILE_INVALID: successful finish action could not be validated');
  const outputs = outputDeclarations(intent, observedActions, finish);
  if (outputs.some((output) => intent.entities.some((entity) => {
    const outputName = output.name.toLocaleLowerCase();
    return outputName.includes(entity.value.toLocaleLowerCase()) || outputName.includes(entity.sourceSpan.toLocaleLowerCase());
  }))) {
    throw new Error('CAPABILITY_COMPILE_INVALID: output name contains a grounded input value');
  }
  const inputs = usedInputs(intent, observedActions);
  const referencedNames = new Set(inputs.map((input) => input.name));
  for (const action of observedActions) {
    const reference = action.kind === 'fill' ? action.value : action.kind === 'selectOption' ? action.option : undefined;
    if (reference && typeof reference === 'object' && !referencedNames.has(reference.fromInput)) throw new Error(`CAPABILITY_COMPILE_INVALID: input ${reference.fromInput} has no source provenance`);
  }
  const objective = redactEntityValues(intent.objective || '', intent).replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || slug(intent.userGoal);
  const cleanedGoal = redactEntityValues(intent.userGoal, intent);
  const inferredConcepts = cleanedGoal.toLowerCase().match(/[a-z][a-z0-9-]*/g)?.filter((word) => word.length > 2) ?? [];
  const concepts = [...new Set([...(intent.requiredConcepts ?? []), ...inferredConcepts]
    .map((concept) => redactEntityValues(concept, intent).trim())
    .filter(Boolean))].slice(0, 8);
  const inputNames = new Set(inputs.map((input) => input.name));
  const phrases = (intent.phrases?.length ? intent.phrases : [goalTemplate(intent, inputNames)])
    .map((phrase) => parameterizePhrase(phrase, intent, inputNames))
    .filter((phrase) => phrase.trim().length > 0);
  const capability: CapabilityArtifact = {
    schemaVersion: 1,
    capabilityId: COMPATIBILITY_CAPABILITY_IDS.get(objective) ?? (objective.startsWith('member.') ? objective : `learned.${slug(objective)}`),
    version: '1.0.0',
    title: redactEntityValues(intent.title?.trim() || title(objective), intent).replace(/\s+/g, ' ').trim() || title(objective),
    intentSignature: { intent: objective, requiredConcepts: concepts, phrases },
    inputs,
    outputs,
    businessOutcomes: (intent.businessOutcomes ?? []).map((outcome) => redactEntityValues(outcome, intent).trim()).filter(Boolean),
    risk: 'READ_ONLY',
    policyProfile: {
      allowedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      allowedRoutes: ['/', '/servicing*'],
      allowedActionKinds: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman'],
      maxRisk: 'READ_ONLY',
      controlOwner: 'automation',
      blockedTargetNamePatterns: ['Post Fee']
    },
    actions: observedActions,
    preconditions: ['target is on an allowed origin', 'automation owns the session'],
    postconditions: [finish.checkpoint],
    waits: { defaultTimeoutMs: 10000, retries: 1 },
    extraction: observedActions.filter((action): action is Extract<ArtifactAction, { kind: 'extract' }> => action.kind === 'extract').map((action) => ({ output: action.output, actionId: action.id, parseAs: action.parseAs })),
    finalCheckpoint: finish.checkpoint,
    compatibility: { applicationFamily: 'legacy-member-servicing', targetProfileId }
  };
  return capabilitySchema.parse(capability);
}
