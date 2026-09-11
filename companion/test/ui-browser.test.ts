import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompanion } from '../src/app/server.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';

/**
 * These checks exercise the shipped document through a real Fastify server
 * and the scripted surface. They intentionally stay offline so a UI test
 * cannot consume a live model call.
 */
describe('companion browser workspace', () => {
  let browser: Browser;
  let baseUrl = '';

  beforeAll(async () => {
    const app = await createCompanion({ offline: true, surface: new ScriptedDemoSurfaceAdapter() });
    // Seed one real learned artifact through the application API. The browser
    // then reads the same workflow catalog that an operator would see.
    const seeded = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
    expect(seeded.statusCode).toBe(201);
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    browser = await chromium.launch({ headless: true });
    (globalThis as { __uiTestApp?: typeof app }).__uiTestApp = app;
  });

  afterAll(async () => {
    await browser?.close();
    await (globalThis as { __uiTestApp?: { close: () => Promise<void> } }).__uiTestApp?.close();
  });

  async function page(): Promise<Page> {
    const current = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await current.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    return current;
  }

  it('opens the native learning dialog, restores focus on Escape, and shows the scoped examples', async () => {
    const current = await page();
    try {
      await expect(current.getByRole('heading', { name: 'Automation library' }).isVisible()).resolves.toBe(true);
      const create = current.getByRole('button', { name: /New automation/ });
      await create.click();
      await expect(current.locator('#new-automation-dialog').isVisible()).resolves.toBe(true);
      await expect(current.locator('#goal').evaluate((element) => element === document.activeElement)).resolves.toBe(true);
      await expect(current.getByRole('button', { name: /Transactions/ }).isVisible()).resolves.toBe(true);
      await expect(current.getByRole('button', { name: /Loan payoff/ }).isVisible()).resolves.toBe(true);
      await current.keyboard.press('Escape');
      await expect(current.locator('#new-automation-dialog').isVisible()).resolves.toBe(false);
      await expect(create.evaluate((element) => element === document.activeElement)).resolves.toBe(true);
    } finally {
      await current.close();
    }
  });

  it('renders a learned workflow as a schema-driven detail page and posts fresh inputs to its run contract', async () => {
    const current = await page();
    const workflowRunRequests: Array<{ url: string; prefer: string; body: string | null }> = [];
    current.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/workflows\/[^/]+\/runs$/.test(request.url())) workflowRunRequests.push({ url: request.url(), prefer: request.headers().prefer || '', body: request.postData() });
    });
    try {
      const workflow = current.locator('.automation-link').first();
      await expect(workflow.isVisible()).resolves.toBe(true);
      await workflow.click();
      await current.waitForSelector('#workflow-detail-title');
      await expect(current.getByRole('heading', { name: 'Look up a member\'s savings balance' }).isVisible()).resolves.toBe(true);
      await expect(current.getByRole('heading', { name: 'Workflow steps' }).isVisible()).resolves.toBe(true);
      await expect(current.getByRole('heading', { name: 'Inputs' }).isVisible()).resolves.toBe(true);
      await expect(current.getByRole('heading', { name: 'What it returns' }).isVisible()).resolves.toBe(true);
      const input = current.locator('#run-workflow-form input[data-input-name="member_id"]');
      await expect(input.isVisible()).resolves.toBe(true);
      await input.fill('54321');
      await expect(current.getByText('Inputs are not saved in browser storage.').isVisible()).resolves.toBe(true);
      await current.getByRole('button', { name: 'Run automation' }).click();
      for (let attempt = 0; attempt < 20 && workflowRunRequests.length === 0; attempt += 1) await current.waitForTimeout(50);
      expect(workflowRunRequests.length).toBeGreaterThan(0);
      const request = workflowRunRequests[0];
      if (!request) throw new Error('workflow run request was not captured');
      expect(request.prefer).toContain('respond-async');
      expect(JSON.parse(request.body || '{}')).toEqual({ inputs: { member_id: '54321' } });
    } finally {
      await current.close();
    }
  });

  it('supports rename, archive, restore, reload, and meaningful history filters on a 390px viewport', async () => {
    const current = await page();
    try {
      const workflow = current.locator('.automation-link').first();
      await workflow.click();
      await current.waitForSelector('#workflow-detail-title');
      const detailTitle = current.locator('#workflow-detail-title');
      await current.getByRole('button', { name: 'Edit details' }).click();
      await expect(current.locator('#edit-automation-dialog').isVisible()).resolves.toBe(true);
      await current.locator('#edit-name').fill('Member savings check');
      await current.locator('#edit-description').fill('Read the current savings balance for a member.');
      await current.getByRole('button', { name: 'Save changes' }).click();
      await current.waitForFunction(() => document.querySelector('#workflow-detail-title')?.textContent === 'Member savings check');
      await expect(detailTitle.textContent()).resolves.toBe('Member savings check');
      await current.getByRole('button', { name: 'Archive' }).click();
      await current.waitForSelector('.status-badge', { state: 'attached' });
      await current.waitForFunction(() => Array.from(document.querySelectorAll('.status-badge')).some((element) => element.textContent?.includes('Archived')));
      await expect(current.locator('#workflow-detail-host .status-badge', { hasText: 'Archived' }).isVisible()).resolves.toBe(true);
      await current.reload({ waitUntil: 'domcontentloaded' });
      await current.waitForSelector('#workflow-detail-title');
      await expect(current.locator('#workflow-detail-title').textContent()).resolves.toBe('Member savings check');
      await expect(current.locator('#workflow-detail-host .status-badge', { hasText: 'Archived' }).isVisible()).resolves.toBe(true);
      await current.getByRole('button', { name: 'Restore' }).click();
      await current.waitForFunction(() => Array.from(document.querySelectorAll('.status-badge')).some((element) => element.textContent?.includes('Ready')));
      await expect(current.locator('#workflow-detail-host .status-badge', { hasText: 'Ready' }).isVisible()).resolves.toBe(true);

      await current.goto(baseUrl + '#history', { waitUntil: 'domcontentloaded' });
      await current.waitForSelector('#run-list .history-row');
      await current.locator('#run-search').fill('member');
      await expect(current.locator('#run-list .history-row').count()).resolves.toBeGreaterThan(0);
      await current.locator('#run-status-filter').selectOption('succeeded');
      await expect(current.locator('#run-list .history-row').count()).resolves.toBeGreaterThan(0);
      const dimensions = await current.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
    } finally {
      await current.close();
    }
  });
});
