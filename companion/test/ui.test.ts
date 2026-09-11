import { describe, expect, it } from 'vitest';
import { companionHtml, renderCompanionHtml } from '../src/app/ui.js';

describe('companion operator UI', () => {
  it('renders the repeatable operator workspace and its primary navigation', () => {
    expect(companionHtml).toContain('<title>Automation Companion</title>');
    expect(companionHtml).toContain('data-view="new"');
    expect(companionHtml).toContain('data-view="history"');
    expect(companionHtml).toContain('data-view="workflows"');
    expect(companionHtml).toContain('id="task-form"');
    expect(companionHtml).toContain('id="run-list"');
    expect(companionHtml).toContain('id="workflow-list"');
  });

  it('keeps the browser UI connected to companion APIs and progressive evidence', () => {
    expect(companionHtml).toContain("api('/api/tasks'");
    expect(companionHtml).toContain("'Prefer': 'respond-async'");
    expect(companionHtml).toContain("api('/api/runs'");
    expect(companionHtml).toContain("api('/api/workflows'");
    expect(companionHtml).toContain("context.executionMode");
    expect(companionHtml).toContain('Offline demo');
    expect(companionHtml).toContain('View technical evidence');
    expect(companionHtml).toContain('Take control');
    expect(companionHtml).toContain('Continue automation');
    expect(companionHtml).toContain('Abort run');
  });

  it('returns the same complete document from the integration helper', () => {
    expect(renderCompanionHtml()).toBe(companionHtml);
  });
});
