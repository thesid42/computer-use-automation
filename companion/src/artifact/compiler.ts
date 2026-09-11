import type { ProvisionalIntent } from '../goal/interpret.js';
import type { RunEvent } from '../evidence/events.js';
import { redact } from '../evidence/events.js';
import { type CapabilityArtifact, capabilitySchema } from './schema.js';

function persistentTarget(event: RunEvent): { strategies: Array<Record<string, unknown>> } | undefined {
  const action = event.action as { target?: { strategies?: Array<Record<string, unknown>> } } | undefined;
  if (!action?.target) return undefined;
  const control = event.resolvedControl;
  if (!control) {
    const strategies = action.target.strategies?.map((strategy) => Object.fromEntries(Object.entries(strategy).filter(([key]) => key !== 'ref'))).filter((strategy) => Object.keys(strategy).length > 0);
    return strategies?.length ? { strategies: strategies.map((strategy) => redact(strategy) as Record<string, unknown>) } : undefined;
  }
  const strategy: Record<string, unknown> = {};
  // Definition-list values need their label relationship to remain stable.
  // A value such as "$1,250.42" can appear in more than one control on a
  // detail page, while the preceding <dt> label identifies the intended one.
  if (control.relativeText !== undefined) {
    strategy.relativeText = control.relativeText;
    if (control.framePath !== undefined) strategy.framePath = control.framePath;
    if (control.frameUrl !== undefined) strategy.frameUrl = control.frameUrl;
    return { strategies: [redact(strategy) as Record<string, unknown>] };
  }
  for (const key of ['role', 'name', 'text', 'label', 'framePath', 'frameUrl'] as const) {
    const value = control[key];
    if (value !== undefined) strategy[key] = value;
  }
  return { strategies: [redact(strategy) as Record<string, unknown>] };
}

export function compileCapability(intent: ProvisionalIntent, events: RunEvent[], targetProfileId = 'demo-app'): CapabilityArtifact {
  const artifact: CapabilityArtifact = {
    schemaVersion: 1,
    capabilityId: 'member.lookup-savings-balance',
    version: '1.0.0',
    title: "Look up a member's savings balance",
    intentSignature: {
      intent: intent.objective,
      requiredConcepts: ['member', 'savings', 'balance'],
      phrases: ['look up member {member_id} savings balance', 'savings balance for member {member_id}']
    },
    inputs: [{ name: 'member_id', type: 'string', sensitivity: 'member_identifier', validation: { minLength: 1, maxLength: 64 } }],
    outputs: [{ name: 'current_savings_balance', type: 'money', currency: 'USD' }],
    businessOutcomes: ['MEMBER_NOT_FOUND', 'PERMISSION_DENIED', 'ACCOUNT_NOT_FOUND'],
    risk: 'READ_ONLY',
    policyProfile: {
      allowedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      allowedRoutes: ['/', '/servicing*'],
      allowedActionKinds: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman'],
      maxRisk: 'READ_ONLY', controlOwner: 'automation', blockedTargetNamePatterns: ['Post Fee']
    },
    actions: [
      { kind: 'fill', id: 'enter-member-id', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'submit-member-search', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' },
      { kind: 'wait', id: 'wait-for-results', condition: 'text:Member Search Results', timeoutMs: 10000 },
      { kind: 'click', id: 'open-member-result', target: { strategies: [{ text: 'Member Summary' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-accounts', target: { strategies: [{ role: 'link', name: 'Accounts' }, { text: 'Accounts' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-savings-account', target: { strategies: [{ text: 'Savings Account' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-balance-details', target: { strategies: [{ role: 'button', name: 'Balance Details' }, { text: 'Balance Details' }] }, risk: 'READ_ONLY' },
      { kind: 'extract', id: 'extract-savings-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
      { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }
    ],
    preconditions: ['target is on an allowed origin', 'automation owns the session'],
    postconditions: ['Current Balance visible'],
    waits: { defaultTimeoutMs: 10000, retries: 1 },
    extraction: [{ output: 'current_savings_balance', actionId: 'extract-savings-balance', parseAs: 'money' }],
    finalCheckpoint: 'Current Balance visible',
    compatibility: { applicationFamily: 'legacy-member-servicing', targetProfileId }
  };
  const successfulFinish = [...events].reverse().find((event) => {
    const action = event.action as { kind?: string; checkpoint?: unknown } | undefined;
    return event.kind === 'action' && event.outcome === 'succeeded' && action?.kind === 'finish' && typeof action.checkpoint === 'string';
  });
  const finishAction = successfulFinish?.action as { checkpoint: string } | undefined;
  if (finishAction) {
    artifact.finalCheckpoint = finishAction.checkpoint;
    artifact.postconditions = [finishAction.checkpoint];
  }
  if (events.length > 0) {
    const seenActionIds = new Set<string>();
    const successful = events.filter((event) => event.kind === 'action' && event.outcome === 'succeeded' && event.action)
      .map((event) => {
        const action = event.action as Record<string, unknown>;
        const actionId = typeof action.id === 'string' ? action.id : undefined;
        if (actionId && seenActionIds.has(actionId)) return undefined;
        if (actionId) seenActionIds.add(actionId);
        const copy = { ...action } as Record<string, unknown>;
        if (copy.kind === 'fill' && typeof copy.value === 'string') {
          const grounded = intent.entities.find((entity) => entity.value === copy.value);
          if (grounded) copy.value = { fromInput: grounded.proposedName };
        }
        if ('target' in copy) {
          const target = persistentTarget(event);
          if (!target) return undefined;
          copy.target = target;
        }
        return copy;
      }).filter((action): action is Record<string, unknown> => action !== undefined);
    artifact.actions = successful as CapabilityArtifact['actions'];
    artifact.extraction = artifact.actions
      .filter((action): action is Extract<CapabilityArtifact['actions'][number], { kind: 'extract' }> => action.kind === 'extract')
      .map((action) => ({ output: action.output, actionId: action.id, parseAs: action.parseAs }));
  }
  return capabilitySchema.parse(artifact);
}
