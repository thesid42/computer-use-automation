import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import type { ArtifactAction, TargetSpec } from '../artifact/schema.js';
import type { ActionResult, HumanActionSink, Resolution, ResolvedControl, SessionHandle, SurfaceAdapter, SurfaceControl, SurfaceSnapshot, TargetProfile } from './adapter.js';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

type RefEntry = { framePath: string[]; index: number; control: ResolvedControl };
type SessionState = { browser: Browser; context: BrowserContext; page: Page; refs: Map<string, RefEntry>; sequence: number; captureSequence: number; sink: HumanActionSink | undefined; dialogs: string[] };
type LocatedTarget = { locator: Locator; control: ResolvedControl; count: number };
const CONTROL_SELECTOR = 'button, a, input, select, textarea, dt, dd';

function stateOf(session: SessionHandle, states: Map<string, SessionState>): SessionState {
  const state = states.get(session.id);
  if (!state) throw new Error('session_not_found');
  return state;
}

async function framePathOf(frame: Frame): Promise<string[]> {
  const parent = frame.parentFrame();
  if (!parent) return [];
  const element = await frame.frameElement();
  const title = await element.getAttribute('title');
  const name = await element.getAttribute('name');
  const src = await element.getAttribute('src');
  return [...await framePathOf(parent), title ? `title:${title}` : name ? `name:${name}` : `src:${src ?? ''}`];
}

async function frameForPath(page: Page, path: string[] | undefined): Promise<Frame | undefined> {
  const wanted = path ?? [];
  for (const frame of page.frames()) {
    if (JSON.stringify(await framePathOf(frame)) === JSON.stringify(wanted)) return frame;
  }
  return undefined;
}

async function controlDescription(locator: Locator, framePath: string[], frameUrl: string, ref?: string): Promise<ResolvedControl> {
  const description = await locator.evaluate((element, payload) => {
    const html = element as HTMLElement;
    const id = html.getAttribute('id');
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : undefined;
    const text = html.textContent?.trim() || undefined;
    const name = html.getAttribute('aria-label') || label || text || undefined;
    const role = html.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', DT: 'term', DD: 'definition' } as Record<string, string>)[html.tagName] || html.tagName.toLowerCase();
    const relativeText = html.tagName === 'DD' ? html.previousElementSibling?.tagName === 'DT' ? html.previousElementSibling.textContent?.trim() || undefined : undefined : undefined;
    return { role, name, text, label: label || undefined, relativeText, framePath: payload.framePath, frameUrl: payload.frameUrl, ref: payload.ref };
  }, { framePath, frameUrl, ref });
  return description as ResolvedControl;
}

async function visibleText(page: Page): Promise<string> {
  const chunks: string[] = [];
  for (const frame of page.frames()) {
    try { chunks.push(await frame.locator('body').innerText({ timeout: 2000 })); } catch { /* frame may be navigating */ }
  }
  return chunks.join('\n').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

function visibleOutcome(text: string): ActionResult | undefined {
  if (text.includes('MEMBER_NOT_FOUND')) return { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' };
  if (text.includes('PERMISSION_DENIED')) return { status: 'business_outcome', code: 'PERMISSION_DENIED' };
  if (text.includes('TEMPORARY_LOAD_FAILURE')) return { status: 'recoverable', code: 'TEMPORARY_LOAD_FAILURE', message: 'Temporary load failure is visible' };
  if (text.includes('SUPERVISOR_VERIFICATION_REQUIRED')) return { status: 'needs_human', code: 'SUPERVISOR_VERIFICATION_REQUIRED', reason: 'Supervisor verification is required' };
  return undefined;
}

export class PlaywrightSurfaceAdapter implements SurfaceAdapter {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly options: { evidenceRoot?: string } = {}) {}

  async start(target: TargetProfile): Promise<SessionHandle> {
    const browser = await chromium.launch({ headless: target.headless ?? false });
    const context = await browser.newContext();
    const sessionId = `pw-${crypto.randomUUID()}`;
    const state: SessionState = { browser, context, page: undefined as unknown as Page, refs: new Map(), sequence: 0, captureSequence: 0, sink: undefined, dialogs: [] };
    await context.exposeFunction('__companionHumanEvent', async (event: { kind?: string; details?: Record<string, unknown> }) => {
      if (state.sink) {
        const action: { kind: string; details?: Record<string, unknown> } = { kind: event.kind ?? 'unknown' };
        if (event.details) action.details = event.details;
        await state.sink(action);
      }
    });
    await context.addInitScript(() => {
      const send = (kind: string, details: Record<string, unknown> = {}) => {
        const bridge = (globalThis as unknown as { __companionHumanEvent?: (event: unknown) => void }).__companionHumanEvent;
        if (bridge) void bridge({ kind, details });
      };
      const redact = (value: string) => value.replace(/\d{4,}/g, '[REDACTED]');
      document.addEventListener('click', (event) => {
        const element = (event.target as HTMLElement | null)?.closest('button,a,input,select,textarea');
        if (element) send('click', { text: redact(element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('name') || '') });
      }, true);
      const inputEvent = (event: Event) => {
        const element = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (element) send(event.type, { field: element.getAttribute('name') || element.getAttribute('id') || element.tagName, value: '[REDACTED]' });
      };
      document.addEventListener('input', inputEvent, true);
      document.addEventListener('change', inputEvent, true);
    });
    const page = await context.newPage();
    state.page = page;
    page.on('dialog', async (dialog) => {
      state.dialogs.push(`${dialog.type()}:${dialog.message()}`);
      try { await dialog.dismiss(); } catch { /* the page may have closed while the dialog was handled */ }
    });
    page.on('framenavigated', (frame) => { if (state.sink) void state.sink({ kind: 'navigation', details: { url: frame.url() } }); });
    this.sessions.set(sessionId, state);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      await browser.close();
      this.sessions.delete(sessionId);
      throw error;
    }
    return { id: sessionId, page };
  }

  async observe(session: SessionHandle): Promise<SurfaceSnapshot> {
    const state = stateOf(session, this.sessions);
    const { page } = state;
    state.sequence += 1;
    state.refs = new Map();
    const controls: SurfaceControl[] = [];
    for (const frame of page.frames()) {
      const framePath = await framePathOf(frame);
      let locators: Locator;
      try { locators = frame.locator(CONTROL_SELECTOR); } catch { continue; }
      const count = await locators.count();
      for (let index = 0; index < count; index += 1) {
        const locator = locators.nth(index);
        const ref = `control-${state.sequence}-${page.frames().indexOf(frame)}-${index}`;
        const control = await controlDescription(locator, framePath, frame.url(), ref);
        state.refs.set(ref, { framePath, index, control });
        controls.push(control as SurfaceControl);
      }
    }
    const text = await visibleText(page);
    const screenshot = `data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`;
    const dialogs = [...state.dialogs];
    state.dialogs = [];
    return { screenshot, url: page.url(), title: await page.title(), framePath: [], controls, visibleText: text, dialogs, stateFingerprint: `${page.url()}|${text.slice(0, 500)}|dialogs:${dialogs.join('|')}` };
  }

  private async locatorFor(page: Page, target: TargetSpec): Promise<LocatedTarget | undefined> {
    for (const strategy of target.strategies) {
      if (strategy.ref) {
        const entry = [...this.sessions.values()].find((state) => state.page === page)?.refs.get(strategy.ref);
        if (!entry) continue;
        const frame = await frameForPath(page, entry.framePath);
        if (frame) {
          const locator = frame.locator(CONTROL_SELECTOR).nth(entry.index);
          const count = await locator.count();
          const control = await controlDescription(locator, entry.framePath, frame.url(), strategy.ref);
          if (count > 0) return { locator, control, count };
        }
      } else {
        const matchedFrame = strategy.framePath ? await frameForPath(page, strategy.framePath) : undefined;
        const frames = matchedFrame ? [matchedFrame] : strategy.framePath ? [] : page.frames();
        const candidateFactories: Array<(frame: Frame) => Locator> = [];
        const role = strategy.role;
        const name = strategy.name;
        const label = strategy.label;
        const text = strategy.text;
        const relativeText = strategy.relativeText;
        if (relativeText !== undefined) {
          candidateFactories.push((frame) => frame.locator('dt').filter({ hasText: relativeText }).locator('xpath=following-sibling::dd[1]'));
        } else {
          if (role !== undefined && name !== undefined) candidateFactories.push((frame) => frame.getByRole(role as never, { name, exact: true }));
          if (label !== undefined) candidateFactories.push((frame) => frame.getByLabel(label));
          if (text !== undefined) candidateFactories.push((frame) => frame.getByText(text, { exact: true }));
        }
        for (const createCandidate of candidateFactories) {
          let count = 0;
          let first: { locator: Locator; frame: Frame; framePath: string[] } | undefined;
          for (const candidateFrame of frames) {
            const candidate = createCandidate(candidateFrame);
            const candidateCount = await candidate.count();
            if (candidateCount > 0 && !first) first = { locator: candidate, frame: candidateFrame, framePath: await framePathOf(candidateFrame) };
            count += candidateCount;
          }
          if (first && count > 0) {
            const control = await controlDescription(first.locator.first(), first.framePath, first.frame.url(), undefined);
            return { locator: first.locator.first(), control, count };
          }
        }
      }
    }
    return undefined;
  }

  async resolve(session: SessionHandle, target: TargetSpec): Promise<Resolution> {
    const state = stateOf(session, this.sessions);
    const located = await this.locatorFor(state.page, target);
    if (!located) return { count: 0, description: '0 matching targets' };
    return { count: located.count, description: located.count === 1 ? 'unique target' : `${located.count} matching targets`, resolvedControl: located.control };
  }

  private async waitForCondition(page: Page, condition: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = await visibleText(page);
      if (condition.startsWith('text:') && text.includes(condition.slice(5))) return;
      if (condition.startsWith('url:') && page.url().includes(condition.slice(4))) return;
      if (!condition.includes(':') && text.includes(condition)) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`wait_condition_timeout:${condition}`);
  }

  async act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult> {
    const state = stateOf(session, this.sessions);
    const page = state.page;
    try {
      if (action.kind === 'wait') await this.waitForCondition(page, action.condition, action.timeoutMs);
      else if (action.kind === 'click') {
        const located = await this.locatorFor(page, action.target);
        if (!located) return { status: 'failed', message: 'target_missing' };
        if (located.count !== 1) return { status: 'failed', message: 'target_ambiguous' };
        await located.locator.click();
      } else if (action.kind === 'fill') {
        if (typeof action.value !== 'string') return { status: 'failed', message: 'unresolved_input_reference' };
        const located = await this.locatorFor(page, action.target);
        if (!located) return { status: 'failed', message: 'target_missing' };
        if (located.count !== 1) return { status: 'failed', message: 'target_ambiguous' };
        await located.locator.fill(action.value);
      } else if (action.kind === 'selectOption') {
        if (typeof action.option !== 'string') return { status: 'failed', message: 'unresolved_input_reference' };
        const located = await this.locatorFor(page, action.target);
        if (!located) return { status: 'failed', message: 'target_missing' };
        if (located.count !== 1) return { status: 'failed', message: 'target_ambiguous' };
        await located.locator.selectOption(action.option);
      } else if (action.kind === 'clickPoint') await page.mouse.click(action.x, action.y);
      const after = await visibleText(page);
      const outcome = visibleOutcome(after);
      return outcome ?? { status: 'succeeded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|waiting|wait_condition_timeout/i.test(message)) return { status: 'recoverable', message, code: 'TEMPORARY_LOAD_FAILURE' };
      return { status: 'failed', message };
    }
  }

  async extract(session: SessionHandle, spec: { target: TargetSpec; parseAs: 'text' | 'money' | 'string' }): Promise<unknown> {
    const state = stateOf(session, this.sessions);
    const located = await this.locatorFor(state.page, spec.target);
    if (!located) throw new Error('output_target_missing');
    if (located.count !== 1) throw new Error('output_target_ambiguous');
    const text = (await located.locator.evaluate((element) => (element.nextElementSibling?.textContent || element.textContent || '').trim())).trim();
    if (spec.parseAs !== 'money') return text;
    const match = text.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
    if (!match) throw new Error('output_parse_failure');
    const amount = match[0].replace(/,/g, '');
    const currency = /€/.test(text) ? 'EUR' : /£/.test(text) ? 'GBP' : 'USD';
    return { amount, currency };
  }

  async captureEvidence(session: SessionHandle): Promise<{ path: string; url: string }> {
    const state = stateOf(session, this.sessions);
    state.captureSequence += 1;
    const directory = join(this.options.evidenceRoot ?? join(process.cwd(), 'evidence'), session.id);
    const path = join(directory, `capture-${String(state.captureSequence).padStart(6, '0')}.png`);
    await mkdir(directory, { recursive: true });
    await state.page.screenshot({ path });
    await copyFile(path, join(directory, 'latest.png'));
    return { path, url: `/api/sessions/${encodeURIComponent(session.id)}/screenshot` };
  }

  async bringToHuman(session: SessionHandle): Promise<void> { await stateOf(session, this.sessions).page.bringToFront(); }

  async setHumanActionSink(session: SessionHandle, sink: HumanActionSink | undefined): Promise<void> { stateOf(session, this.sessions).sink = sink; }

  async close(session: SessionHandle): Promise<void> {
    const state = this.sessions.get(session.id);
    if (!state) return;
    await state.context.close();
    await state.browser.close();
    this.sessions.delete(session.id);
  }
}
