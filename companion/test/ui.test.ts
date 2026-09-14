import { describe, expect, it } from 'vitest';
import { companionHtml, renderCompanionHtml } from '../src/app/ui.js';

describe('companion operator UI', () => {
  it('renders the automation library, scoped learning dialog, and primary navigation', () => {
    expect(companionHtml).toContain('<title>Automations · Companion</title>');
    expect(companionHtml).toContain('data-view="request"');
    expect(companionHtml).toContain('id="task-form"');
    expect(companionHtml).toContain('id="request-goal"');
    expect(companionHtml).toContain('id="request-run-button"');
    expect(companionHtml).toContain('Ask the companion');
    expect(companionHtml).toContain('data-view="workflows"');
    expect(companionHtml).toContain('data-view="history"');
    expect(companionHtml).toContain('data-view="attention"');
    expect(companionHtml).toContain('id="new-automation-dialog"');
    expect(companionHtml).toContain('id="dialog-task-form"');
    expect(companionHtml).toContain('id="run-list"');
    expect(companionHtml).toContain('id="workflow-list"');
    expect(companionHtml).toContain('Transactions · Sep 1–11, 2026');
    expect(companionHtml).toContain('Loan payoff quote · Sep 30, 2026');
  });

  it('keeps the browser UI connected to workflow, run, and handoff APIs', () => {
    expect(companionHtml).toContain("api('/api/tasks'");
    expect(companionHtml).toContain("'Prefer': 'respond-async'");
    expect(companionHtml).toContain("api('/api/tasks'");
    expect(companionHtml).toContain('const selectedContext = { workflowId: id, source: \'saved_automation\' }');
    expect(companionHtml).toContain('body: JSON.stringify({ goal, context: selectedContext })');
    expect(companionHtml).not.toContain('conversationContext: selectedContext');
    expect(companionHtml).toContain('Describe a fresh request in plain language');
    expect(companionHtml).toContain("api('/api/runs'");
    expect(companionHtml).toContain("api('/api/workflows'");
    expect(companionHtml).toContain('context?.executionMode');
    expect(companionHtml).toContain('Offline demo');
    expect(companionHtml).toContain('View technical evidence');
    expect(companionHtml).toContain('Take control');
    expect(companionHtml).toContain('Continue automation');
    expect(companionHtml).toContain('Abort run');
    expect(companionHtml).not.toContain('localStorage');
  });

  it('returns the same complete document from the integration helper', () => {
    expect(renderCompanionHtml()).toBe(companionHtml);
  });
});
