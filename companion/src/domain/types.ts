export type RunFailure = {
  code: string;
  message: string;
  stepId?: string;
  expectedState?: string;
  observedState?: string;
  evidenceRef?: string;
};

export type RunResult =
  | { status: 'succeeded'; outputs: Record<string, unknown>; checkpointVerified: true }
  | { status: 'business_outcome'; code: string; details?: Record<string, unknown> }
  | { status: 'needs_human'; interventionId: string; reason: string; stepId: string }
  | { status: 'failed'; error: RunFailure };

export type RunStatus = 'pending' | 'running' | 'paused' | 'succeeded' | 'business_outcome' | 'needs_human' | 'failed' | 'aborted';

export type ActionKind = 'click' | 'fill' | 'selectOption' | 'wait' | 'extract' | 'finish' | 'requestHuman' | 'clickPoint';
export type RiskClass = 'READ_ONLY' | 'REVERSIBLE_WRITE' | 'IRREVERSIBLE_WRITE';
