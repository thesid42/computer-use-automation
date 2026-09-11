import type { RunEvent } from '../evidence/events.js';
import type { RunResult, RunStatus } from './types.js';

export type RunRecord = {
  id: string;
  goal: string;
  status: RunStatus;
  result?: RunResult;
  events: RunEvent[];
  sessionId?: string;
  capabilityId?: string;
  interventionId?: string;
  llmCalls?: number;
  mode?: 'discovery' | 'replay' | 'clarification';
  executionMode?: 'offline' | 'live';
  providerEndpoint?: string;
  modelId?: string;
  generationSettings?: { temperature: number; timeoutMs: number; actionMode: 'json' | 'tool' };
  createdAt: string;
};

export type InterventionRecord = {
  id: string;
  runId: string;
  status: 'open' | 'claimed' | 'resumed' | 'aborted';
  reason: string;
  stepId: string;
  screenshotPath: string;
  createdAt: string;
};

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class InMemoryRunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly interventions = new Map<string, InterventionRecord>();

  createRun(goal: string): RunRecord {
    const run: RunRecord = { id: id('run'), goal, status: 'pending', events: [], createdAt: new Date().toISOString() };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(runId: string): RunRecord | undefined { return this.runs.get(runId); }

  listRuns(): RunRecord[] {
    return [...this.runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Restore a terminal run loaded from the durable evidence directory. */
  restoreRun(run: RunRecord): RunRecord {
    if (!['succeeded', 'business_outcome', 'failed', 'aborted'].includes(run.status)) throw new Error('only_terminal_runs_can_be_restored');
    this.runs.set(run.id, run);
    return run;
  }

  updateRun(runId: string, update: Partial<Omit<RunRecord, 'id' | 'createdAt'>>): RunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new Error('run_not_found');
    Object.assign(run, update);
    return run;
  }

  appendEvent(runId: string, event: RunEvent): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error('run_not_found');
    run.events.push(event);
  }

  openIntervention(runId: string, reason: string, stepId: string, screenshotPath: string): InterventionRecord {
    if (!this.runs.has(runId)) throw new Error('run_not_found');
    const intervention: InterventionRecord = { id: id('intervention'), runId, status: 'open', reason, stepId, screenshotPath, createdAt: new Date().toISOString() };
    this.interventions.set(intervention.id, intervention);
    this.updateRun(runId, { status: 'needs_human', interventionId: intervention.id });
    return intervention;
  }

  getIntervention(interventionId: string): InterventionRecord | undefined { return this.interventions.get(interventionId); }

  getInterventionForRun(runId: string): InterventionRecord | undefined {
    return [...this.interventions.values()].reverse().find((intervention) => intervention.runId === runId && intervention.status !== 'aborted');
  }

  updateIntervention(interventionId: string, status: InterventionRecord['status']): InterventionRecord {
    const intervention = this.interventions.get(interventionId);
    if (!intervention) throw new Error('intervention_not_found');
    intervention.status = status;
    return intervention;
  }

  updateInterventionScreenshot(interventionId: string, screenshotPath: string): InterventionRecord {
    const intervention = this.interventions.get(interventionId);
    if (!intervention) throw new Error('intervention_not_found');
    intervention.screenshotPath = screenshotPath;
    return intervention;
  }
}
