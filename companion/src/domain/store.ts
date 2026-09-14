import type { RunEvent } from '../evidence/events.js';
import type { CapabilityArtifact } from '../artifact/schema.js';
import type { RunResult, RunStatus } from './types.js';

export type RunRecord = {
  id: string;
  goal: string;
  status: RunStatus;
  result?: RunResult;
  events: RunEvent[];
  sessionId?: string;
  capabilityId?: string;
  /** Stable library workflow handle. capabilityId remains for legacy callers. */
  workflowId?: string;
  interventionId?: string;
  llmCalls?: number;
  /** Provider calls used to interpret the free-text goal, kept separate from action decisions. */
  intentModelCalls?: number;
  mode?: 'discovery' | 'replay' | 'clarification';
  executionMode?: 'offline' | 'live';
  providerEndpoint?: string;
  modelId?: string;
  generationSettings?: { temperature: number; timeoutMs: number; actionMode: 'json' | 'tool'; observationMode?: 'multimodal' | 'accessibility' };
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

export type WorkflowMetadata = {
  id: string;
  title: string;
  description?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRecord = WorkflowMetadata & {
  artifact: CapabilityArtifact;
};

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class InMemoryRunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly interventions = new Map<string, InterventionRecord>();
  private readonly workflows = new Map<string, WorkflowRecord>();

  createRun(goal: string): RunRecord {
    const run: RunRecord = { id: id('run'), goal, status: 'pending', events: [], createdAt: new Date().toISOString() };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(runId: string): RunRecord | undefined { return this.runs.get(runId); }

  listRuns(): RunRecord[] {
    return [...this.runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  createWorkflow(artifact: CapabilityArtifact, metadata: Partial<WorkflowMetadata> = {}): WorkflowRecord {
    const now = new Date().toISOString();
    const workflow: WorkflowRecord = {
      id: metadata.id ?? id('workflow'),
      title: metadata.title ?? artifact.title,
      ...(metadata.description !== undefined ? { description: metadata.description } : {}),
      archived: metadata.archived ?? false,
      createdAt: metadata.createdAt ?? now,
      updatedAt: metadata.updatedAt ?? now,
      artifact
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  restoreWorkflow(workflow: WorkflowRecord): WorkflowRecord {
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  getWorkflow(workflowId: string): WorkflowRecord | undefined { return this.workflows.get(workflowId); }

  listWorkflows(): WorkflowRecord[] {
    return [...this.workflows.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  updateWorkflowMetadata(workflowId: string, update: Partial<Pick<WorkflowMetadata, 'title' | 'archived'>> & { description?: string | null }): WorkflowRecord {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error('workflow_not_found');
    if (update.title !== undefined) workflow.title = update.title;
    if (update.archived !== undefined) workflow.archived = update.archived;
    if (update.description === null) delete workflow.description;
    else if (update.description !== undefined) workflow.description = update.description;
    workflow.updatedAt = new Date().toISOString();
    return workflow;
  }

  listRunsForWorkflow(workflowId: string): RunRecord[] {
    return this.listRuns().filter((run) => run.workflowId === workflowId);
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
    // Runner event buffers remain mutable across human handoff/resume. Keep
    // the store's history independent from those arrays so recorder callbacks
    // cannot duplicate or replace persisted human events through aliasing.
    Object.assign(run, update, update.events ? { events: [...update.events] } : {});
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
