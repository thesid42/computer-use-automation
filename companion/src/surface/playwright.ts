import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import type { ArtifactAction, TargetSpec } from '../artifact/schema.js';
import type { ActionResult, HumanActionSink, Resolution, ResolvedControl, SessionHandle, SurfaceAdapter, SurfaceControl, SurfaceSnapshot, TargetProfile } from './adapter.js';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

type RefEntry = { framePath: string[]; index: number; control: ResolvedControl };
type SessionState = { browser: Browser; context: BrowserContext; page: Page; refs: Map<string, RefEntry>; sequence: number; captureSequence: number; sink: HumanActionSink | undefined; pendingSinkCalls: Set<Promise<void>>; dialogs: string[] };
type LocatedTarget = { locator: Locator; control: ResolvedControl; count: number };
// Tables/captions are observable output controls. Include a bounded set of
// cells so a model can ground a filtered result without treating DOM text as
// an opaque, unresolvable blob.
const CONTROL_SELECTOR = 'button, a, input, select, textarea, dt, dd, table, caption, th, td';
const MAX_OBSERVED_CONTROLS = 256;
// Keep this browser-side script as source text. Passing a TypeScript function
// through tsx causes named helper arrows to be rewritten with a Node-only
// __name helper, which makes the page fail before it can emit human events.
const HUMAN_EVENT_INIT_SCRIPT = `
(() => {
  const send = function(kind, details) {
    const bridge = globalThis.__companionHumanEvent;
    if (bridge) void bridge({ kind, details });
  };
  const redact = function(value) { return String(value).replace(/\\d{4,}/g, '[REDACTED]'); };
  document.addEventListener('click', function(event) {
    const target = event.target;
    const element = target instanceof Element ? target.closest('button,a,input,select,textarea') : null;
    if (element) send('click', { text: redact(element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('name') || '') });
  }, true);
  const inputEvent = function(event) {
    const element = event.target;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      send(event.type, { field: element.getAttribute('name') || element.getAttribute('id') || element.tagName, value: '[REDACTED]' });
    }
  };
  document.addEventListener('input', inputEvent, true);
  document.addEventListener('change', inputEvent, true);
})();
`;

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
    const role = html.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', DT: 'term', DD: 'definition', TABLE: 'table', CAPTION: 'caption', TH: 'columnheader', TD: 'cell' } as Record<string, string>)[html.tagName] || html.tagName.toLowerCase();
    let relativeText = html.tagName === 'DD' && html.previousElementSibling?.tagName === 'DT'
      ? html.previousElementSibling.textContent?.trim() || undefined
      : undefined;
    if ((html.tagName === 'TH' || html.tagName === 'TD') && !relativeText) {
      const row = html.closest('tr');
      const table = html.closest('table');
      const cellIndex = row ? Array.from(row.children).indexOf(html) : -1;
      const rowHeaders = row ? Array.from(row.children).filter((cell) => cell.tagName === 'TH') : [];
      const headerRow = table?.querySelector('thead tr:last-child')
        ?? (table ? Array.from(table.querySelectorAll('tr')).find((candidate) => candidate.querySelector(':scope > th')) : undefined);
      const headers = headerRow ? Array.from(headerRow.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD') : [];
      // Key/value tables often put a single <th> beside the amount in a row,
      // without a thead. Associate that row header directly.
      relativeText = rowHeaders.length === 1 && html.tagName === 'TD'
        ? rowHeaders[0]?.textContent?.trim() || undefined
        : rowHeaders.length === 1 && html.tagName === 'TH'
          ? html.textContent?.trim() || undefined
        : cellIndex >= 0 ? headers[cellIndex]?.textContent?.trim() || undefined : undefined;
    }
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
  if (text.includes('NO_TRANSACTIONS')) return { status: 'business_outcome', code: 'NO_TRANSACTIONS' };
  if (text.includes('UNSUPPORTED_AS_OF_DATE')) return { status: 'business_outcome', code: 'UNSUPPORTED_AS_OF_DATE' };
  if (text.includes('NO_LOAN')) return { status: 'business_outcome', code: 'NO_LOAN' };
  if (text.includes('INVALID_START_DATE')) return { status: 'business_outcome', code: 'INVALID_START_DATE' };
  if (text.includes('INVALID_END_DATE')) return { status: 'business_outcome', code: 'INVALID_END_DATE' };
  if (text.includes('INVALID_AS_OF_DATE')) return { status: 'business_outcome', code: 'INVALID_AS_OF_DATE' };
  if (text.includes('INVALID_DATE_RANGE')) return { status: 'business_outcome', code: 'INVALID_DATE_RANGE' };
  if (text.includes('INVALID_DATE')) return { status: 'business_outcome', code: 'INVALID_DATE' };
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
    const state: SessionState = { browser, context, page: undefined as unknown as Page, refs: new Map(), sequence: 0, captureSequence: 0, sink: undefined, pendingSinkCalls: new Set(), dialogs: [] };
    await context.exposeFunction('__companionHumanEvent', async (event: { kind?: string; details?: Record<string, unknown> }) => {
      const pending = Promise.resolve().then(async () => {
        if (!state.sink) return;
        const action: { kind: string; details?: Record<string, unknown> } = { kind: event.kind ?? 'unknown' };
        if (event.details) action.details = event.details;
        await state.sink(action);
      }).catch(() => undefined);
      state.pendingSinkCalls.add(pending);
      await pending;
      state.pendingSinkCalls.delete(pending);
    });
    await context.addInitScript(HUMAN_EVENT_INIT_SCRIPT);
    const page = await context.newPage();
    state.page = page;
    page.on('dialog', async (dialog) => {
      state.dialogs.push(`${dialog.type()}:${dialog.message()}`);
      try { await dialog.dismiss(); } catch { /* the page may have closed while the dialog was handled */ }
    });
    page.on('framenavigated', (frame) => {
      if (!state.sink) return;
      try { void Promise.resolve(state.sink({ kind: 'navigation', details: { url: frame.url() } })).catch(() => undefined); } catch { /* page may be closing */ }
    });
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
      const frameIndex = page.frames().indexOf(frame);
      try {
        // Read all descriptions in one browser evaluation. A count()+nth()
        // loop can retain a stale locator while a frame commits navigation,
        // making every subsequent nth evaluation wait for its timeout.
        const descriptions = await locators.evaluateAll((elements, payload: { framePath: string[]; frameUrl: string; prefix: string }) => elements.map((element, index) => {
          const html = element as HTMLElement;
          // A result cell that wraps a link/button is a layout container, not
          // an actionable control. Omitting it prevents a ref based planner
          // from clicking the cell and leaving the real link untouched.
          if ((html.tagName === 'TD' || html.tagName === 'TH') && html.querySelector('a,button,input,select,textarea')) return null;
          const id = html.getAttribute('id');
          const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : undefined;
          const text = html.textContent?.trim() || undefined;
          const name = html.getAttribute('aria-label') || label || text || undefined;
          const role = html.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', DT: 'term', DD: 'definition', TABLE: 'table', CAPTION: 'caption', TH: 'columnheader', TD: 'cell' } as Record<string, string>)[html.tagName] || html.tagName.toLowerCase();
          let relativeText = html.tagName === 'DD' && html.previousElementSibling?.tagName === 'DT'
            ? html.previousElementSibling.textContent?.trim() || undefined
            : undefined;
          if ((html.tagName === 'TH' || html.tagName === 'TD') && !relativeText) {
            const row = html.closest('tr');
            const table = html.closest('table');
            const cellIndex = row ? Array.from(row.children).indexOf(html) : -1;
            const rowHeaders = row ? Array.from(row.children).filter((cell) => cell.tagName === 'TH') : [];
            const headerRow = table?.querySelector('thead tr:last-child')
              ?? (table ? Array.from(table.querySelectorAll('tr')).find((candidate) => candidate.querySelector(':scope > th')) : undefined);
            const headers = headerRow ? Array.from(headerRow.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD') : [];
            relativeText = rowHeaders.length === 1 && html.tagName === 'TD'
              ? rowHeaders[0]?.textContent?.trim() || undefined
              : rowHeaders.length === 1 && html.tagName === 'TH'
                ? html.textContent?.trim() || undefined
              : cellIndex >= 0 ? headers[cellIndex]?.textContent?.trim() || undefined : undefined;
          }
          return { role, name, text, label: label || undefined, relativeText, framePath: payload.framePath, frameUrl: payload.frameUrl, ref: `${payload.prefix}-${index}` };
        }), { framePath, frameUrl: frame.url(), prefix: `control-${state.sequence}-${frameIndex}` });
        for (let index = 0; index < descriptions.length && controls.length < MAX_OBSERVED_CONTROLS; index += 1) {
          const control = descriptions[index] as ResolvedControl | null;
          if (!control) continue;
          const ref = `control-${state.sequence}-${frameIndex}-${index}`;
          state.refs.set(ref, { framePath, index, control });
          controls.push(control as SurfaceControl);
        }
      } catch {
        // A frame may commit navigation during this single evaluation. Keep
        // the other frames and retry on the next observation.
      }
      if (controls.length >= MAX_OBSERVED_CONTROLS) break;
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
          candidateFactories.push((frame) => frame.locator('tr').filter({ has: frame.locator('th').filter({ hasText: relativeText }) }).locator('td').first());
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
    // Text/table targets own their result text; definition-list money targets
    // usually point at the label and keep the amount in the next <dd>. Avoid
    // reading an unrelated footer or neighboring table when extracting text.
    const text = (await located.locator.evaluate((element, parseAs) => {
      const own = (element.textContent || '').trim();
      const table = element.tagName === 'TABLE' ? element : element.closest('table');
      let renderedTable = '';
      if (table) {
        const caption = (table.querySelector('caption') as HTMLElement | null)?.innerText?.trim() || '';
        const rows = Array.from(table.querySelectorAll('tr')).map((row) => {
          const cells = Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD') as HTMLElement[];
          return cells.map((cell) => cell.innerText.trim()).filter(Boolean).join(' | ');
        }).filter(Boolean);
        renderedTable = [caption, ...rows].filter(Boolean).join('\n');
      }
      if (parseAs !== 'money') {
        // A caption or table target returns rendered rows/cells with
        // delimiters, preserving a useful filtered transaction result.
        if (table && (element.tagName === 'TABLE' || element.tagName === 'CAPTION')) return renderedTable;
        return (element as HTMLElement).innerText?.trim() || own;
      }
      const candidate = table && (element.tagName === 'TABLE' || element.tagName === 'CAPTION') ? renderedTable : own;
      if (/[-+]?\d[\d,]*(?:\.\d+)?/.test(candidate)) return candidate;
      return (element.nextElementSibling?.textContent || candidate).trim();
    }, spec.parseAs)).trim();
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

  async flushHumanActionEvents(session: SessionHandle): Promise<void> {
    const state = stateOf(session, this.sessions);
    // The page bridge is deliberately fire-and-forget so it cannot block a
    // human click/navigation. Give queued RPCs a bounded drain window before
    // the server releases the sink and resumes automation.
    for (let round = 0; round < 5; round += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const pending = [...state.pendingSinkCalls];
      if (pending.length) await Promise.allSettled(pending);
    }
  }

  async close(session: SessionHandle): Promise<void> {
    const state = this.sessions.get(session.id);
    if (!state) return;
    await state.context.close();
    await state.browser.close();
    this.sessions.delete(session.id);
  }
}
