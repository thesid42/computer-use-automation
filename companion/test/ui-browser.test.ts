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

  it('opens on the plain-language request composer and keeps the learning dialog accessible', async () => {
    const current = await page();
    try {
      await expect(current.getByRole('heading', { name: 'Ask the companion' }).isVisible()).resolves.toBe(true);
      await expect(current.locator('#request-goal').isVisible()).resolves.toBe(true);
      await expect(current.getByRole('button', { name: 'Start request' }).isVisible()).resolves.toBe(true);
      const create = current.getByRole('button', { name: /Teach a task/ });
      await create.click();
      await expect(current.locator('#new-automation-dialog').isVisible()).resolves.toBe(true);
      await expect(current.locator('#goal').evaluate((element) => element === document.activeElement)).resolves.toBe(true);
      await expect(current.locator('#new-automation-dialog').getByRole('button', { name: /Transactions/ }).isVisible()).resolves.toBe(true);
      await expect(current.locator('#new-automation-dialog').getByRole('button', { name: /Loan payoff/ }).isVisible()).resolves.toBe(true);
      await current.keyboard.press('Escape');
      await expect(current.locator('#new-automation-dialog').isVisible()).resolves.toBe(false);
      await expect(create.evaluate((element) => element === document.activeElement)).resolves.toBe(true);
    } finally {
      await current.close();
    }
  });

  it('asks for a missing member in the real task API and resumes the same conversation', async () => {
    const current = await page();
    const requests: Array<{ body: string | null }> = [];
    current.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/tasks$/.test(request.url())) requests.push({ body: request.postData() });
    });
    try {
      await current.locator('#request-goal').fill('Check the savings balance.');
      await current.getByRole('button', { name: 'Start request' }).click();
      await current.locator('.clarification').waitFor({ state: 'visible' });
      await expect(current.getByText('A little more detail is needed').isVisible()).resolves.toBe(true);
      await expect(current.getByText('Which member or customer identifier should I use?').isVisible()).resolves.toBe(true);
      await current.locator('#task-clarification-answer').fill('member 12345');
      await current.getByRole('button', { name: 'Continue request' }).click();
      await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
      const first = JSON.parse(requests[0]?.body || '{}');
      const second = JSON.parse(requests[1]?.body || '{}');
      expect(first.goal).toBe('Check the savings balance.');
      expect(second.goal).toBe('member 12345');
      expect(second.conversationId).toMatch(/^conversation-/);
      await expect.poll(() => current.url()).toMatch(/#runs\//);
      await current.locator('.nav-button[data-view="request"]').click();
      await expect.poll(() => current.url()).toMatch(/#request$/);
      await expect(current.locator('#request-goal').inputValue()).resolves.toBe('');
      await expect(current.locator('#request-feedback').textContent()).resolves.toBe('');
      await expect(current.locator('#request-feedback .spinner').count()).resolves.toBe(0);
    } finally {
      await current.close();
    }
  }, 10000);

  it('renders a learned workflow detail and sends a fresh free-text request to the task contract', async () => {
    const current = await page();
    const taskRequests: Array<{ url: string; prefer: string; body: string | null }> = [];
    current.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/tasks$/.test(request.url())) taskRequests.push({ url: request.url(), prefer: request.headers().prefer || '', body: request.postData() });
    });
    try {
      await current.goto(baseUrl + '#automations', { waitUntil: 'domcontentloaded' });
      const workflow = current.locator('.automation-link').first();
      await expect(workflow.isVisible()).resolves.toBe(true);
      await workflow.click();
      await current.waitForSelector('#workflow-detail-title');
      await expect(current.locator('#workflow-detail-title').isVisible()).resolves.toBe(true);
      await expect(current.locator('#workflow-detail-title').textContent()).resolves.toMatch(/savings balance/i);
      await expect(current.getByRole('heading', { name: 'Workflow steps' }).isVisible()).resolves.toBe(true);
      await expect(current.getByRole('heading', { name: 'Run this automation' }).isVisible()).resolves.toBe(true);
      const input = current.locator('#workflow-run-goal');
      await expect(input.isVisible()).resolves.toBe(true);
      await input.fill('Check member 54321 savings balance.');
      await expect(current.getByText('Request details are not saved in browser storage.').isVisible()).resolves.toBe(true);
      await current.getByRole('button', { name: 'Run automation' }).click();
      for (let attempt = 0; attempt < 20 && taskRequests.length === 0; attempt += 1) await current.waitForTimeout(50);
      expect(taskRequests.length).toBeGreaterThan(0);
      const request = taskRequests[0];
      if (!request) throw new Error('workflow run request was not captured');
      expect(request.prefer).toContain('respond-async');
      const body = JSON.parse(request.body || '{}');
      expect(body.goal).toBe('Check member 54321 savings balance.');
      expect(body.context.source).toBe('saved_automation');
      expect(body.conversationContext).toBeUndefined();
    } finally {
      await current.close();
    }
  });

  it('supports rename, archive, restore, reload, and meaningful history filters on a 390px viewport', async () => {
    const current = await page();
    try {
      await current.goto(baseUrl + '#automations', { waitUntil: 'domcontentloaded' });
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
