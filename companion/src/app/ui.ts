/**
 * Browser UI for the local automation companion.
 *
 * This file intentionally contains no server or domain imports. The server
 * injects this document at `/`; the browser talks to the companion only over
 * its local JSON endpoints.
 */
export const companionHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Automation Companion</title>
  <style>
    :root {
      --ink: #17252a;
      --ink-soft: #516168;
      --ink-faint: #718188;
      --navy: #14262d;
      --navy-soft: #1d353d;
      --navy-faint: #8fa6aa;
      --canvas: #f3f6f4;
      --paper: #ffffff;
      --line: #dbe5e1;
      --line-strong: #c6d5d0;
      --teal: #0f766e;
      --teal-deep: #0a5c56;
      --teal-wash: #e6f4f0;
      --amber: #a16207;
      --amber-wash: #fff6dc;
      --red: #b42318;
      --red-wash: #ffebe9;
      --shadow: 0 18px 45px rgba(20, 46, 45, .08), 0 2px 5px rgba(20, 46, 45, .05);
      --radius: 14px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: var(--ink); background: var(--canvas); }
    button, input { font: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    :focus-visible { outline: 3px solid rgba(15,118,110,.35); outline-offset: 2px; }
    .app-shell { display: flex; min-height: 100vh; }
    .sidebar { position: sticky; top: 0; display: flex; flex: 0 0 248px; flex-direction: column; min-height: 100vh; padding: 26px 16px 18px; color: #edf8f4; background: var(--navy); }
    .brand { display: flex; align-items: center; gap: 11px; padding: 0 12px 28px; }
    .brand-mark { display: grid; width: 31px; height: 31px; place-items: center; color: #123139; font-weight: 800; font-size: 13px; border-radius: 9px; background: #90d7c8; }
    .brand-name { font-size: 15px; font-weight: 700; letter-spacing: .01em; }
    .brand-caption { margin-top: 2px; color: var(--navy-faint); font-size: 11px; }
    .nav-label { padding: 0 12px 8px; color: #779197; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .nav { display: grid; gap: 4px; }
    .nav-button { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px 12px; color: #bcd0d0; text-align: left; border: 0; border-radius: 9px; background: transparent; }
    .nav-button:hover { color: #f4fffb; background: rgba(255,255,255,.07); }
    .nav-button[aria-current="page"] { color: #effff9; background: var(--navy-soft); box-shadow: inset 3px 0 0 #89d7c8; }
    .nav-icon { display: grid; width: 20px; height: 20px; place-items: center; color: currentColor; font-size: 16px; }
    .sidebar-spacer { flex: 1; }
    .connection-card { padding: 14px; border: 1px solid rgba(170,215,207,.18); border-radius: 11px; background: rgba(255,255,255,.045); }
    .connection-label { display: flex; align-items: center; gap: 7px; color: #a7c7c5; font-size: 11px; font-weight: 700; }
    .connection-dot { width: 7px; height: 7px; border-radius: 50%; background: #68cbb5; box-shadow: 0 0 0 4px rgba(104,203,181,.13); }
    .connection-name { margin-top: 9px; color: #edf8f4; font-size: 12px; line-height: 1.45; }
    .connection-note { margin-top: 3px; color: #829ba0; font-size: 11px; }
    .main { flex: 1; min-width: 0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; max-width: 1180px; margin: 0 auto; padding: 28px 42px 8px; }
    .eyebrow { color: var(--teal); font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .topbar h1 { margin: 6px 0 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.1; letter-spacing: -.035em; }
    .target-chip { display: flex; align-items: center; gap: 8px; padding: 8px 11px; color: var(--ink-soft); font-size: 12px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.65); }
    .target-chip .connection-dot { width: 6px; height: 6px; box-shadow: none; }
    .content { max-width: 1180px; margin: 0 auto; padding: 26px 42px 56px; }
    .view { display: none; }
    .view.is-active { display: block; }
    .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(260px, .7fr); gap: 20px; align-items: start; }
    .card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); box-shadow: var(--shadow); }
    .composer { padding: clamp(24px, 4vw, 40px); }
    .composer-kicker { display: inline-flex; align-items: center; gap: 7px; padding: 6px 9px; color: var(--teal-deep); font-size: 11px; font-weight: 750; border-radius: 999px; background: var(--teal-wash); }
    .composer-kicker::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--teal); }
    .composer h2 { max-width: 560px; margin: 18px 0 9px; font-size: clamp(27px, 3.3vw, 37px); line-height: 1.05; letter-spacing: -.045em; }
    .composer-intro { max-width: 575px; margin: 0 0 26px; color: var(--ink-soft); font-size: 15px; line-height: 1.55; }
    .task-form { display: flex; gap: 9px; align-items: stretch; }
    .task-input { flex: 1; min-width: 0; padding: 14px 15px; color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; background: #fbfdfc; }
    .task-input::placeholder { color: #87969a; }
    .primary-button { padding: 0 19px; color: #fff; font-weight: 750; border: 0; border-radius: 10px; background: var(--teal); box-shadow: 0 4px 10px rgba(15,118,110,.2); }
    .primary-button:hover { background: var(--teal-deep); }
    .example-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 17px; }
    .example-button { padding: 7px 10px; color: var(--ink-soft); font-size: 12px; text-align: left; border: 1px solid var(--line); border-radius: 7px; background: #f8fbfa; }
    .example-button:hover { color: var(--teal-deep); border-color: #94cfc4; background: var(--teal-wash); }
    .side-card { padding: 21px; }
    .card-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .card-title { margin: 0; font-size: 15px; letter-spacing: -.01em; }
    .card-link { color: var(--teal); font-size: 12px; font-weight: 700; text-decoration: none; }
    .card-link:hover { text-decoration: underline; }
    .empty-copy { margin: 18px 0 3px; color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
    .empty-subcopy { margin: 0; color: var(--ink-faint); font-size: 12px; line-height: 1.45; }
    .recent-list { display: grid; gap: 1px; margin: 13px -8px -8px; }
    .recent-item { display: block; width: 100%; padding: 10px 8px; color: var(--ink); text-align: left; border: 0; border-radius: 8px; background: transparent; }
    .recent-item:hover { background: #f1f7f5; }
    .recent-goal { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .recent-meta { display: flex; gap: 7px; align-items: center; margin-top: 5px; color: var(--ink-faint); font-size: 11px; }
    .mini-status { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint); }
    .mini-status.succeeded { background: #269a80; }
    .mini-status.failed { background: var(--red); }
    .mini-status.needs_human { background: #d28a16; }
    .section-header { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 17px; }
    .section-header h2 { margin: 0; font-size: 24px; letter-spacing: -.03em; }
    .section-header p { margin: 7px 0 0; color: var(--ink-soft); font-size: 13px; }
    .subtle-button { padding: 9px 12px; color: var(--ink-soft); font-size: 12px; font-weight: 700; border: 1px solid var(--line-strong); border-radius: 8px; background: #fff; }
    .subtle-button:hover { color: var(--teal-deep); border-color: #95cfc4; }
    .stack { display: grid; gap: 12px; }
    .run-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 22px; align-items: center; min-width: 0; overflow: hidden; padding: 17px 19px; border: 1px solid var(--line); border-radius: 12px; background: #fff; box-shadow: 0 3px 12px rgba(20,46,45,.035); }
    .run-row:hover { border-color: #a8d5cd; }
    .run-row.goal { overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .run-row-meta { margin-top: 5px; color: var(--ink-faint); font-size: 11px; font-weight: 500; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; width: max-content; padding: 5px 8px; font-size: 11px; font-weight: 750; border-radius: 999px; background: #eef2f1; }
    .status-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .status-badge.succeeded { color: #18745f; background: #e4f5ef; }
    .status-badge.running, .status-badge.pending { color: #246a73; background: #e4f3f5; }
    .status-badge.needs_human, .status-badge.paused { color: #9b6709; background: var(--amber-wash); }
    .status-badge.failed, .status-badge.aborted, .status-badge.business_outcome { color: var(--red); background: var(--red-wash); }
    .run-row > .recent-item { min-width: 0; }
    .run-row .status-badge { white-space: nowrap; }
    .run-row-action { min-width: 0; padding: 7px 9px; color: var(--teal); font-size: 12px; font-weight: 750; border: 0; background: transparent; }
    .run-row-action:hover { text-decoration: underline; }
    .workflow-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; }
    .workflow-card { padding: 20px; }
    .workflow-card:hover { border-color: #a8d5cd; }
    .workflow-badge { color: var(--teal); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .workflow-card h3 { margin: 9px 0 7px; font-size: 17px; letter-spacing: -.02em; }
    .workflow-card p { min-height: 42px; margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
    .workflow-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #edf2f0; }
    .workflow-output { color: var(--ink-faint); font-size: 11px; }
    .use-workflow { padding: 7px 10px; color: var(--teal-deep); font-size: 11px; font-weight: 800; border: 1px solid #a9d7cf; border-radius: 7px; background: var(--teal-wash); }
    .detail-panel { margin-top: 20px; padding: 24px; }
    .detail-panel h2 { margin: 0; font-size: 20px; letter-spacing: -.025em; }
    .detail-goal { margin: 8px 0 0; color: var(--ink-soft); font-size: 13px; }
    .result-box { margin-top: 20px; padding: 20px; border-radius: 11px; background: #f6faf8; }
    .result-label { color: var(--teal); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .result-answer { margin-top: 8px; color: var(--ink); font-size: 23px; font-weight: 750; letter-spacing: -.03em; }
    .result-detail { margin-top: 7px; color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
    .result-box.business { background: var(--amber-wash); }
    .result-box.failure { background: var(--red-wash); }
    .detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .detail-actions button { padding: 9px 12px; font-size: 12px; font-weight: 750; border-radius: 8px; }
    .intervention { margin-top: 20px; padding: 18px; border: 1px solid #edcf86; border-radius: 11px; background: #fffaf0; }
    .intervention h3 { margin: 0; color: #805b0c; font-size: 14px; }
    .intervention p { margin: 7px 0 0; color: #795f28; font-size: 13px; line-height: 1.5; }
    .intervention-image { display: block; width: 100%; max-height: 310px; margin-top: 15px; object-fit: contain; object-position: left top; border: 1px solid #ebdcae; border-radius: 8px; background: #fff; }
    .evidence-details { margin-top: 20px; border-top: 1px solid var(--line); }
    .evidence-details summary { padding: 15px 0 3px; color: var(--ink-soft); font-size: 12px; font-weight: 750; cursor: pointer; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 10px; margin-top: 12px; }
    .fact { padding: 11px; border: 1px solid var(--line); border-radius: 8px; background: #fbfdfc; }
    .fact-label { color: var(--ink-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .fact-value { margin-top: 5px; overflow: hidden; color: var(--ink); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .events { max-height: 280px; margin-top: 12px; padding: 12px; overflow: auto; color: #496067; font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; border-radius: 8px; background: #172a30; }
    .loading, .empty-state, .error-state { padding: 36px 20px; color: var(--ink-soft); text-align: center; border: 1px dashed var(--line-strong); border-radius: 12px; background: rgba(255,255,255,.6); }
    .error-state { color: var(--red); border-color: #e4aaa5; background: #fff9f8; }
    .spinner { display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px; border: 2px solid #b7dcd6; border-top-color: var(--teal); border-radius: 50%; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .toast { position: fixed; right: 22px; bottom: 22px; max-width: 360px; padding: 12px 15px; color: #fff; font-size: 13px; border-radius: 9px; background: #153239; box-shadow: var(--shadow); transform: translateY(20px); opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; }
    .toast.is-visible { transform: translateY(0); opacity: 1; }
    @media (max-width: 820px) {
      .sidebar { position: static; flex-basis: 72px; padding: 18px 9px; }
      .brand { justify-content: center; padding: 0 0 22px; }
      .brand-copy, .nav-label, .nav-button span:not(.nav-icon), .connection-card { display: none; }
      .nav-button { justify-content: center; padding: 12px 8px; }
      .topbar { padding: 22px 24px 7px; }
      .content { padding: 22px 24px 44px; }
      .workspace-grid { grid-template-columns: 1fr; }
      .target-chip { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
    @media (max-width: 580px) {
      .app-shell { display: block; }
      .sidebar { display: flex; flex-direction: row; align-items: center; min-height: auto; padding: 10px 14px; }
      .brand { padding: 0; }
      .nav { display: flex; margin-left: auto; }
      .nav-button { min-width: 42px; }
      .sidebar-spacer { display: none; }
      .topbar { align-items: flex-start; padding: 25px 18px 6px; }
      .topbar h1 { font-size: 27px; }
      .target-chip { display: none; }
      .content { padding: 20px 18px 38px; }
      .task-form { display: grid; }
      .primary-button { min-height: 44px; }
      .run-row { grid-template-columns: 1fr auto; gap: 9px; }
      .run-row .status-badge { grid-column: 1; grid-row: 2; }
      .run-row-action { grid-column: 2; grid-row: 1 / span 2; }
      .section-header { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <div class="brand"><div class="brand-mark" aria-hidden="true">AC</div><div class="brand-copy"><div class="brand-name">Automation Companion</div><div class="brand-caption">Operator workspace</div></div></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">
        <button class="nav-button" data-view="new" aria-current="page"><span class="nav-icon" aria-hidden="true">＋</span><span>New task</span></button>
        <button class="nav-button" data-view="history"><span class="nav-icon" aria-hidden="true">◷</span><span>Run history</span></button>
        <button class="nav-button" data-view="workflows"><span class="nav-icon" aria-hidden="true">◇</span><span>Learned workflows</span></button>
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="connection-card" aria-live="polite"><div class="connection-label"><span class="connection-dot" aria-hidden="true"></span><span id="side-connection-status">Target configured</span></div><div class="connection-name" id="side-target">Configured target</div><div class="connection-note" id="side-connection-note">Execution details loading</div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="eyebrow" id="view-eyebrow">Task workspace</div><h1 id="view-title">What needs doing?</h1></div><div class="target-chip"><span class="connection-dot" aria-hidden="true"></span><span id="top-target">Configured target</span></div></header>
      <div class="content">
        <section class="view is-active" data-panel="new" aria-labelledby="view-title">
          <div class="workspace-grid">
            <div>
              <div class="card composer">
                <div class="composer-kicker">Plain-language automation</div>
                <h2>Give me the outcome. I’ll handle the workflow.</h2>
                <p class="composer-intro">Describe a read-only task in one sentence. Saved workflows are reused automatically when they fit; new work is learned once and kept available for the next run.</p>
                <form class="task-form" id="task-form"><label class="sr-only" for="goal">What would you like me to do?</label><input class="task-input" id="goal" name="goal" required autocomplete="off" placeholder="Look up member 12345 and tell me their savings balance."><button class="primary-button" id="run-button" type="submit">Run task</button></form>
                <div class="example-row" aria-label="Example requests"><button class="example-button" type="button">Look up member 12345 and tell me their savings balance.</button><button class="example-button" type="button">Savings balance for member 12345</button></div>
              </div>
              <div id="new-run-detail" aria-live="polite"></div>
            </div>
            <aside class="card side-card" aria-labelledby="recent-title"><div class="card-title-row"><h2 class="card-title" id="recent-title">Recent runs</h2><a href="#history" class="card-link" data-view-link="history">View all</a></div><div id="recent-runs"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading runs</div></div></aside>
          </div>
        </section>
        <section class="view" data-panel="history" aria-labelledby="view-title"><div class="section-header"><div><h2>Run history</h2><p>Review outcomes from this companion session and reopen any run.</p></div><button class="subtle-button" id="refresh-runs" type="button">Refresh</button></div><div id="run-list" class="stack"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading runs</div></div><div id="history-detail"></div></section>
        <section class="view" data-panel="workflows" aria-labelledby="view-title"><div class="section-header"><div><h2>Learned workflows</h2><p>Capabilities verified against the configured target and ready for reuse.</p></div><button class="subtle-button" id="refresh-workflows" type="button">Refresh</button></div><div id="workflow-list" class="workflow-grid"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading workflows</div></div></section>
      </div>
    </main>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
  (() => {
    'use strict';
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const state = { activeView: 'new', selectedRunId: '', polling: null, runs: [], workflows: [], context: null };
    const labels = { pending: 'Queued', running: 'Running', succeeded: 'Completed', business_outcome: 'Business outcome', needs_human: 'Needs your help', paused: 'Paused', failed: 'Failed', aborted: 'Aborted' };

    function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
    function safeJson(value) { try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); } }
    function statusLabel(status) { return labels[status] || String(status || 'Unknown').replace(/_/g, ' '); }
    function formatDate(value) { if (!value) return 'Unknown time'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600); }
    function setLoading(element, text) { element.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>' + escapeHtml(text) + '</div>'; }
    function setError(element, message) { element.innerHTML = '<div class="error-state">' + escapeHtml(message) + '</div>'; }
    async function api(path, options) { const response = await fetch(path, options); const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { error: text || 'Unexpected server response' }; } if (!response.ok) throw new Error(body.error || 'Request failed'); return body; }
    function normalizeRuns(payload) { const rows = Array.isArray(payload) ? payload : (payload.runs || payload.items || payload.data || []); return rows.filter((row) => row && row.id).sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))); }
    function normalizeWorkflows(payload) { const rows = Array.isArray(payload) ? payload : (payload.workflows || payload.capabilities || payload.items || payload.data || []); return rows.filter(Boolean); }
    async function loadContext() { try { const context = await api('/api/context'); state.context = context; const name = context.appName || context.applicationName || context.targetName || context.name || context.target?.name || context.target?.applicationFamily; const workspace = context.workspaceName || context.workspace || ''; const executionMode = String(context.executionMode || '').toLowerCase(); const status = $('#side-connection-status'); const note = $('#side-connection-note'); if (name) { $('#side-target').textContent = name; $('#top-target').textContent = name; } if (executionMode === 'offline') { status.textContent = 'Offline demo'; note.textContent = workspace ? workspace + ' · scripted execution' : 'Scripted execution · no browser'; } else if (executionMode === 'live') { status.textContent = context.discoveryConfigured === false ? 'Target configured' : 'Target ready'; note.textContent = workspace ? workspace + ' · live browser target' : 'Live browser target'; } else if (workspace) { note.textContent = workspace; } } catch (_) { /* Older servers do not expose context yet. */ } }
    async function loadRuns() { const list = $('#run-list'); const recent = $('#recent-runs'); setLoading(list, 'Loading runs'); setLoading(recent, 'Loading runs'); try { let payload; try { payload = await api('/api/runs'); } catch (_) { payload = await api('/api/runs?limit=50'); } state.runs = normalizeRuns(payload); renderRuns(); } catch (error) { setError(list, error.message); setError(recent, 'Run history is unavailable right now.'); } }
    async function loadWorkflows() { const list = $('#workflow-list'); setLoading(list, 'Loading workflows'); try { let payload; try { payload = await api('/api/workflows'); } catch (_) { payload = await api('/api/capabilities'); } state.workflows = normalizeWorkflows(payload); renderWorkflows(); } catch (error) { setError(list, error.message); } }
    function runRow(run) { const status = run.status || run.result?.status || 'unknown'; return '<div class="run-row"><button class="recent-item" data-run-id="' + escapeHtml(run.id) + '" type="button"><div class="recent-goal">' + escapeHtml(run.goal || 'Untitled task') + '</div><div class="recent-meta"><span class="mini-status ' + escapeHtml(status) + '" aria-hidden="true"></span>' + escapeHtml(formatDate(run.createdAt || run.updatedAt)) + '</div></button><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span><button class="run-row-action" data-run-id="' + escapeHtml(run.id) + '" type="button">Open</button></div>'; }
    function renderRuns() { const list = $('#run-list'); const recent = $('#recent-runs'); if (!state.runs.length) { const empty = '<div class="empty-state">No runs yet.<br><span class="empty-subcopy">Start with a plain-language task and it will appear here.</span></div>'; list.innerHTML = empty; recent.innerHTML = '<p class="empty-copy">Your completed and active runs will show up here.</p><p class="empty-subcopy">Run a task to start building history.</p>'; return; } list.innerHTML = state.runs.map(runRow).join(''); recent.innerHTML = '<div class="recent-list">' + state.runs.slice(0, 4).map((run) => '<button class="recent-item" data-run-id="' + escapeHtml(run.id) + '" type="button"><div class="recent-goal">' + escapeHtml(run.goal || 'Untitled task') + '</div><div class="recent-meta"><span class="mini-status ' + escapeHtml(run.status || '') + '" aria-hidden="true"></span>' + escapeHtml(statusLabel(run.status)) + ' · ' + escapeHtml(formatDate(run.createdAt || run.updatedAt)) + '</div></button>').join('') + '</div>'; bindRunButtons(); }
    function workflowTitle(workflow) { return workflow.title || workflow.name || workflow.capabilityId || workflow.id || 'Saved workflow'; }
    function workflowDescription(workflow) { return workflow.description || workflow.intentSignature?.description || workflow.intentSignature?.intent || 'A verified workflow ready to run from a plain-language request.'; }
    function workflowOutput(workflow) { const outputs = workflow.outputs || workflow.outputSchema?.properties || workflow.intentSignature?.requestedOutputs; if (Array.isArray(outputs)) return outputs.map((item) => item.name || item.proposedName || item).join(', '); if (outputs && typeof outputs === 'object') return Object.keys(outputs).join(', '); return 'Typed result'; }
    function renderWorkflows() { const list = $('#workflow-list'); if (!state.workflows.length) { list.innerHTML = '<div class="empty-state">No learned workflows yet.<br><span class="empty-subcopy">The first successful discovery will be saved here for reuse.</span></div>'; return; } list.innerHTML = state.workflows.map((workflow, index) => '<article class="card workflow-card"><div class="workflow-badge">Verified capability</div><h3>' + escapeHtml(workflowTitle(workflow)) + '</h3><p>' + escapeHtml(workflowDescription(workflow)) + '</p><div class="workflow-footer"><span class="workflow-output">Returns: ' + escapeHtml(workflowOutput(workflow)) + '</span><button class="use-workflow" data-workflow-index="' + index + '" type="button">Use in a task</button></div></article>').join(''); $$('.use-workflow').forEach((button) => button.addEventListener('click', () => { const workflow = state.workflows[Number(button.dataset.workflowIndex)]; const example = workflow?.example || workflow?.exampleGoal || workflow?.intentSignature?.phrases?.[0]; if (example) $('#goal').value = String(example).replace(/[{}]/g, ''); else $('#goal').focus(); switchView('new'); showToast('Workflow ready. Add any input values, then run it.'); })); }
    async function getRun(runId) { const found = state.runs.find((run) => run.id === runId); try { return await api('/api/runs/' + encodeURIComponent(runId)); } catch (error) { if (found) return found; throw error; } }
    function moneyValue(value) { if (!value || typeof value !== 'object') return ''; const amount = value.amount ?? value.value; if (amount == null) return ''; const currency = value.currency || 'USD'; const number = Number(amount); if (!Number.isNaN(number)) try { return new Intl.NumberFormat([], { style: 'currency', currency }).format(number); } catch (_) { return currency + ' ' + amount; } return currency + ' ' + amount; }
    function resultCopy(run) { const result = run.result || run; const status = result.status || run.status; if (status === 'succeeded') { const outputs = result.outputs || {}; const entries = Object.entries(outputs); if (!entries.length) return { label: 'Completed', answer: 'Task completed', detail: result.checkpointVerified ? 'The final checkpoint was verified.' : 'The target reported completion.' }; const first = entries[0]; const value = first[1]; const answer = moneyValue(value) || (typeof value === 'string' || typeof value === 'number' ? String(value) : safeJson(value)); return { label: 'Result', answer: answer, detail: entries.length > 1 ? entries.slice(1).map((entry) => entry[0] + ': ' + (moneyValue(entry[1]) || String(entry[1]))).join(' · ') : 'Completed with a verified checkpoint.' }; } if (status === 'business_outcome') return { label: 'Outcome', answer: result.code || 'Business outcome', detail: result.details ? safeJson(result.details) : 'The target returned a business-level outcome.' }; if (status === 'needs_human') return { label: 'Action needed', answer: 'A human needs to take over', detail: result.reason || 'Automation paused and is waiting for operator input.' }; if (status === 'failed' || status === 'aborted') return { label: 'Run stopped', answer: result.error?.message || 'The task could not be completed', detail: result.error?.code ? 'Code: ' + result.error.code : 'Review the evidence below for details.' }; return { label: 'Run status', answer: statusLabel(status), detail: 'The run is still in progress.' }; }
    function detailHtml(run, events) { const result = resultCopy(run); const status = run.status || run.result?.status || 'unknown'; const interventionId = run.interventionId || run.result?.interventionId; let handoff = ''; if (status === 'needs_human' && interventionId) handoff = '<div class="intervention"><h3>Human takeover is available</h3><p id="intervention-reason">Automation paused at a point that needs an operator. Claim the same browser session, make the needed correction, then return here to continue.</p><img class="intervention-image" id="intervention-image" alt="Latest target state" src="/api/interventions/' + encodeURIComponent(interventionId) + '/screenshot"><div class="detail-actions"><button class="primary-button" data-intervention-action="claim" data-intervention-id="' + escapeHtml(interventionId) + '" type="button">Take control</button><button class="subtle-button" data-intervention-action="resume" data-intervention-id="' + escapeHtml(interventionId) + '" type="button">Continue automation</button><button class="subtle-button" data-intervention-action="abort" data-intervention-id="' + escapeHtml(interventionId) + '" type="button">Abort run</button></div></div>'; const facts = '<div class="facts"><div class="fact"><div class="fact-label">Status</div><div class="fact-value">' + escapeHtml(statusLabel(status)) + '</div></div><div class="fact"><div class="fact-label">Mode</div><div class="fact-value">' + escapeHtml(run.mode || '—') + '</div></div><div class="fact"><div class="fact-label">Model calls</div><div class="fact-value">' + escapeHtml(run.llmCalls == null ? '—' : String(run.llmCalls)) + '</div></div><div class="fact"><div class="fact-label">Capability</div><div class="fact-value" title="' + escapeHtml(run.capabilityId || '') + '">' + escapeHtml(run.capabilityId || '—') + '</div></div></div>'; const evidence = '<details class="evidence-details"><summary>View technical evidence</summary>' + facts + (events ? '<pre class="events">' + escapeHtml(safeJson(events)) + '</pre>' : '<p class="empty-subcopy">Event evidence is not available for this run.</p>') + '</details>'; return '<div class="card detail-panel"><div class="card-title-row"><div><h2>Run details</h2><p class="detail-goal">' + escapeHtml(run.goal || 'Untitled task') + '</p></div><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span></div><div class="result-box ' + (status === 'business_outcome' ? 'business' : (status === 'failed' || status === 'aborted' ? 'failure' : '')) + '"><div class="result-label">' + escapeHtml(result.label) + '</div><div class="result-answer">' + escapeHtml(result.answer) + '</div><div class="result-detail">' + escapeHtml(result.detail) + '</div></div>' + handoff + evidence + '</div>'; }
    async function openRun(runId, targetElement) { state.selectedRunId = runId; const host = targetElement || $('#history-detail'); setLoading(host, 'Loading run'); try { const run = await getRun(runId); let events = null; try { events = await api('/api/runs/' + encodeURIComponent(runId) + '/events'); } catch (_) { /* Evidence is optional for older servers. */ } host.innerHTML = detailHtml(run, events); bindInterventionButtons(host); if (run.status === 'pending' || run.status === 'running' || run.status === 'needs_human') { state.polling = runId; pollRun(runId, host); } } catch (error) { setError(host, error.message); } }
    async function pollRun(runId, host) { if (state.polling !== runId) return; try { const run = await getRun(runId); if (run.status === 'pending' || run.status === 'running' || run.status === 'needs_human') window.setTimeout(() => pollRun(runId, host), 900); else { state.polling = null; await loadRuns(); } let events = null; try { events = await api('/api/runs/' + encodeURIComponent(runId) + '/events'); } catch (_) {} host.innerHTML = detailHtml(run, events); bindInterventionButtons(host); } catch (_) { window.setTimeout(() => pollRun(runId, host), 1500); } }
    function bindRunButtons() { $$('[data-run-id]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.runId; if (!id) return; switchView('history'); openRun(id, $('#history-detail')); })); }
    function bindInterventionButtons(root) { $$('[data-intervention-action]', root).forEach((button) => button.addEventListener('click', async () => { const action = button.dataset.interventionAction; const id = button.dataset.interventionId; if (!action || !id) return; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Working'; try { await api('/api/interventions/' + encodeURIComponent(id) + '/' + action, { method: 'POST' }); showToast(action === 'claim' ? 'Human control claimed for this session.' : action === 'resume' ? 'Automation is continuing in the same session.' : 'Run aborted.'); await loadRuns(); if (state.selectedRunId) openRun(state.selectedRunId, $('#history-detail')); } catch (error) { button.disabled = false; button.textContent = action === 'claim' ? 'Take control' : action === 'resume' ? 'Continue automation' : 'Abort run'; showToast(error.message); } })); }
    function switchView(view) { state.activeView = view; $$('.view').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === view)); $$('.nav-button').forEach((button) => { button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); }); const titles = { new: ['Task workspace', 'What needs doing?'], history: ['Run history', 'What happened?'], workflows: ['Learned workflows', 'Ready to run again'] }; const title = titles[view] || titles.new; $('#view-eyebrow').textContent = title[0]; $('#view-title').textContent = title[1]; if (view === 'history') loadRuns(); if (view === 'workflows') loadWorkflows(); }
    async function submitTask(event) { event.preventDefault(); const input = $('#goal'); const button = $('#run-button'); const goal = input.value.trim(); if (!goal) return; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Starting'; const detail = $('#new-run-detail'); setLoading(detail, 'Starting task'); try { const created = await api('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'Prefer': 'respond-async' }, body: JSON.stringify({ goal: goal }) }); const runId = created.runId || created.id; if (!runId) throw new Error('The server did not return a run id.'); await loadRuns(); await openRun(runId, detail); showToast(created.mode === 'replay' ? 'Saved workflow matched. Running it now.' : 'Task started.'); } catch (error) { setError(detail, error.message); showToast(error.message); } finally { button.disabled = false; button.textContent = 'Run task'; } }
    $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view || 'new')));
    $$('[data-view-link]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); switchView(link.dataset.viewLink || 'history'); }));
    $$('.example-button').forEach((button) => button.addEventListener('click', () => { $('#goal').value = button.textContent.trim(); $('#goal').focus(); }));
    $('#task-form').addEventListener('submit', submitTask);
    $('#refresh-runs').addEventListener('click', loadRuns);
    $('#refresh-workflows').addEventListener('click', loadWorkflows);
    loadContext(); loadRuns(); loadWorkflows();
  })();
  </script>
</body>
</html>`;

/** Alias kept explicit so the server integration reads naturally. */
export function renderCompanionHtml(): string {
  return companionHtml;
}
