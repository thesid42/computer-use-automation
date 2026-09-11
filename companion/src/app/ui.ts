/**
 * Browser UI for the local automation companion.
 *
 * The document stays deliberately dependency free. It is a small operator
 * console backed by JSON endpoints exposed by server.ts. The browser never
 * persists member identifiers or run inputs.
 */
export const companionHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Automations · Companion</title>
  <style>
    :root {
      --canvas: #f4f3f0;
      --panel: #fff;
      --panel-soft: #faf9f7;
      --ink: #24242a;
      --muted: #6b6b75;
      --faint: #9897a0;
      --line: #dedde1;
      --line-strong: #c8c7ce;
      --accent: #5f4bb6;
      --accent-dark: #49368f;
      --accent-wash: #f0edfb;
      --amber: #a46316;
      --amber-wash: #fff7e9;
      --red: #b23838;
      --red-wash: #fff0ef;
      --green: #287553;
      --green-wash: #ecf7f0;
      --shadow: 0 10px 24px rgba(38, 35, 43, .045);
      --radius: 7px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; }
    body { margin: 0; min-height: 100vh; color: var(--ink); background: var(--canvas); }
    body.dialog-open { overflow: hidden; }
    button, input, textarea, select { font: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .52; }
    a { color: inherit; }
    :focus-visible { outline: 3px solid rgba(95, 75, 182, .3); outline-offset: 2px; }
    .app-shell { display: flex; min-height: 100vh; }
    .sidebar { position: sticky; top: 0; display: flex; flex: 0 0 218px; flex-direction: column; min-height: 100vh; padding: 24px 13px 16px; border-right: 1px solid var(--line); background: #f7f6f4; }
    .brand { display: flex; align-items: center; gap: 10px; padding: 0 10px 31px; }
    .brand-mark { display: grid; width: 28px; height: 28px; place-items: center; color: #fff; font-size: 11px; font-weight: 800; border-radius: 6px; background: var(--accent); }
    .brand-name { color: var(--ink); font-size: 14px; font-weight: 760; letter-spacing: -.015em; }
    .brand-caption { margin-top: 3px; color: var(--faint); font-size: 10px; }
    .nav-label { padding: 0 10px 8px; color: var(--faint); font-size: 10px; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
    .nav { display: grid; gap: 3px; }
    .nav-button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 10px; color: var(--muted); text-align: left; border: 1px solid transparent; border-radius: 6px; background: transparent; }
    .nav-button:hover { color: var(--ink); background: #eeece9; }
    .nav-button[aria-current="page"] { color: var(--accent-dark); border-color: #ded8f4; background: var(--accent-wash); }
    .nav-icon { display: grid; width: 18px; height: 18px; place-items: center; color: currentColor; }
    .nav-icon svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .nav-badge { margin-left: auto; min-width: 18px; padding: 2px 5px; color: var(--amber); font-size: 10px; text-align: center; border-radius: 10px; background: var(--amber-wash); }
    .sidebar-spacer { flex: 1; }
    .connection-card { padding: 12px 10px; border-top: 1px solid var(--line); }
    .connection-label { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .connection-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--faint); }
    .connection-dot.live { background: var(--green); }
    .connection-dot.offline { background: var(--amber); }
    .connection-name { margin-top: 8px; overflow: hidden; color: var(--ink); font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .connection-note { margin-top: 3px; color: var(--faint); font-size: 10px; line-height: 1.4; }
    .main { flex: 1; min-width: 0; }
    .topbar { display: flex; align-items: flex-end; justify-content: space-between; max-width: 1240px; margin: 0 auto; padding: 25px 40px 0; }
    .breadcrumbs { display: flex; align-items: center; gap: 7px; min-height: 17px; color: var(--faint); font-size: 11px; }
    .breadcrumbs a { text-decoration: none; }
    .breadcrumbs a:hover { color: var(--accent); text-decoration: underline; }
    .breadcrumb-sep { color: #c1c0c6; }
    .topbar h1 { margin: 8px 0 0; color: var(--ink); font-size: clamp(25px, 3vw, 34px); line-height: 1.08; letter-spacing: -.04em; }
    .target-chip { display: flex; align-items: center; gap: 8px; max-width: 265px; padding: 7px 10px; color: var(--muted); font-size: 11px; border: 1px solid var(--line); border-radius: 5px; background: rgba(255,255,255,.6); }
    .target-chip span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .content { max-width: 1240px; margin: 0 auto; padding: 26px 40px 60px; }
    .view { display: none; }
    .view.is-active { display: block; }
    .panel { border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
    .section-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 19px; }
    .section-header h2 { margin: 0; font-size: 22px; letter-spacing: -.03em; }
    .section-header p { max-width: 650px; margin: 7px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 35px; padding: 7px 12px; color: var(--muted); font-size: 12px; font-weight: 700; border: 1px solid var(--line-strong); border-radius: 5px; background: #fff; }
    .button:hover { color: var(--ink); border-color: #aaa8b3; background: var(--panel-soft); }
    .button.primary { color: #fff; border-color: var(--accent); background: var(--accent); }
    .button.primary:hover { border-color: var(--accent-dark); background: var(--accent-dark); }
    .button.danger { color: var(--red); border-color: #e2baba; background: #fff; }
    .button.danger:hover { background: var(--red-wash); }
    .button.small { min-height: 29px; padding: 5px 9px; font-size: 11px; }
    .icon-button { display: inline-grid; width: 31px; height: 31px; place-items: center; color: var(--muted); border: 1px solid var(--line); border-radius: 5px; background: #fff; }
    .icon-button:hover { color: var(--accent); border-color: #bdb4e7; }
    .icon-button svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .search-wrap { position: relative; flex: 1 1 auto; min-width: 0; }
    .search-wrap svg { position: absolute; top: 50%; left: 11px; width: 15px; height: 15px; color: var(--faint); stroke: currentColor; fill: none; stroke-width: 1.8; transform: translateY(-50%); }
    .search-input, .select-input, .text-input, .text-area { width: 100%; color: var(--ink); border: 1px solid var(--line-strong); border-radius: 5px; background: #fff; }
    .search-input { height: 35px; padding: 0 12px 0 34px; font-size: 12px; }
    .select-input, .text-input { height: 36px; padding: 0 10px; font-size: 12px; }
    .text-area { min-height: 100px; padding: 10px 11px; resize: vertical; font-size: 13px; line-height: 1.5; }
    .search-input::placeholder, .text-area::placeholder { color: #aaa8b0; }
    .toolbar > .select-input { flex: 0 0 170px; }
    .automation-table { overflow: hidden; }
    .table-head, .automation-row { display: grid; grid-template-columns: minmax(230px, 1.7fr) 110px 145px 84px 102px; gap: 16px; align-items: center; padding: 0 18px; }
    .table-head { min-height: 34px; color: var(--faint); font-size: 10px; font-weight: 760; letter-spacing: .09em; text-transform: uppercase; border-bottom: 1px solid var(--line); background: #fbfaf9; }
    .automation-row { min-height: 76px; border-bottom: 1px solid #ecebed; }
    .automation-row:last-child { border-bottom: 0; }
    .automation-row:hover { background: #fcfbff; }
    .automation-name { min-width: 0; }
    .automation-link { display: block; overflow: hidden; color: var(--ink); font-size: 13px; font-weight: 760; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
    .automation-link:hover { color: var(--accent); }
    .automation-description { overflow: hidden; margin-top: 5px; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .cell-muted { color: var(--muted); font-size: 11px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; width: max-content; padding: 4px 7px; color: var(--muted); font-size: 10px; font-weight: 760; border: 1px solid var(--line); border-radius: 4px; background: #f7f7f6; }
    .status-badge::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .status-badge.succeeded, .status-badge.ready, .status-badge.active { color: var(--green); border-color: #cce6d7; background: var(--green-wash); }
    .status-badge.running, .status-badge.pending { color: var(--accent); border-color: #dbd5f1; background: var(--accent-wash); }
    .status-badge.needs_human, .status-badge.paused { color: var(--amber); border-color: #ecd49d; background: var(--amber-wash); }
    .status-badge.failed, .status-badge.aborted { color: var(--red); border-color: #ebc6c4; background: var(--red-wash); }
    .status-badge.archived { color: var(--muted); border-color: var(--line); background: #f7f7f6; }
    .row-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .empty-state, .loading, .error-state { padding: 45px 22px; color: var(--muted); text-align: center; border: 1px dashed var(--line-strong); border-radius: 6px; background: rgba(255,255,255,.55); }
    .error-state { color: var(--red); border-color: #e4b5b2; background: var(--red-wash); }
    .empty-state strong { display: block; margin-bottom: 6px; color: var(--ink); font-size: 14px; }
    .empty-subcopy { color: var(--faint); font-size: 12px; line-height: 1.5; }
    .empty-steps { display: flex; justify-content: center; flex-wrap: wrap; gap: 7px 18px; margin-top: 18px; color: var(--muted); font-size: 11px; }
    .empty-steps span { display: inline-flex; align-items: center; gap: 6px; }
    .empty-steps span::before { display: grid; width: 18px; height: 18px; place-items: center; color: var(--accent-dark); font-size: 10px; font-weight: 800; border: 1px solid #d1cae8; border-radius: 50%; background: var(--accent-wash); }
    .empty-steps span:nth-child(1)::before { content: "1"; }
    .empty-steps span:nth-child(2)::before { content: "2"; }
    .empty-steps span:nth-child(3)::before { content: "3"; }
    .spinner { display: inline-block; width: 13px; height: 13px; margin-right: 7px; vertical-align: -2px; border: 2px solid #d8d3ec; border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .attention-summary { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 12px 14px; color: #79501a; font-size: 12px; border: 1px solid #edd7a5; border-radius: 5px; background: var(--amber-wash); }
    .attention-summary svg { width: 17px; height: 17px; flex: 0 0 auto; stroke: currentColor; fill: none; stroke-width: 1.7; }
    .detail-back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; color: var(--muted); font-size: 12px; text-decoration: none; }
    .detail-back:hover { color: var(--accent); }
    .detail-back svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.7; }
    .detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 21px 23px; border-bottom: 1px solid var(--line); }
    .detail-head h2 { margin: 0; font-size: 24px; letter-spacing: -.035em; }
    .detail-description { max-width: 680px; margin: 7px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; color: var(--faint); font-size: 11px; }
    .detail-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .detail-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(290px, .8fr); gap: 22px; padding: 22px 23px 25px; }
    .subsection + .subsection { margin-top: 25px; }
    .subsection h3 { margin: 0; color: var(--ink); font-size: 13px; letter-spacing: -.01em; }
    .subsection-intro { margin: 5px 0 12px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .steps { position: relative; display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .steps::before { position: absolute; top: 14px; bottom: 18px; left: 10px; width: 1px; content: ""; background: #d8d5e2; }
    .step { position: relative; display: grid; grid-template-columns: 21px minmax(0, 1fr); gap: 11px; padding: 0 0 18px; }
    .step:last-child { padding-bottom: 0; }
    .step-marker { z-index: 1; display: grid; width: 21px; height: 21px; place-items: center; color: var(--accent-dark); font-size: 10px; font-weight: 800; border: 1px solid #c9c2e7; border-radius: 50%; background: #f8f7fd; }
    .step-body { padding-top: 1px; }
    .step-title { color: var(--ink); font-size: 12px; font-weight: 740; }
    .step-note { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .step-kind { display: inline-block; margin-left: 6px; color: var(--faint); font-size: 9px; font-weight: 700; }
    .schema-list { display: grid; gap: 0; margin: 0; border-top: 1px solid var(--line); }
    .schema-row { display: grid; grid-template-columns: minmax(120px, .7fr) minmax(0, 1.2fr); gap: 13px; padding: 10px 0; border-bottom: 1px solid #ecebed; }
    .schema-key { color: var(--ink); font-size: 11px; font-weight: 730; }
    .schema-value { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .schema-type { display: inline-block; margin-left: 5px; padding: 2px 5px; color: var(--accent-dark); font-size: 9px; font-weight: 760; border-radius: 3px; background: var(--accent-wash); }
    .contract-details { margin-top: 12px; border-top: 1px solid var(--line); }
    .contract-details summary { padding: 11px 0 2px; color: var(--muted); font-size: 11px; font-weight: 730; cursor: pointer; }
    .contract-code { max-height: 180px; margin: 7px 0 0; padding: 10px; overflow: auto; color: #5d5870; font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; background: #f4f2f8; }
    .run-form-panel { align-self: start; padding: 18px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-soft); }
    .run-form-panel h3 { margin: 0; font-size: 15px; }
    .run-form-panel p { margin: 6px 0 16px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .field { display: grid; gap: 6px; margin-top: 12px; }
    .field:first-of-type { margin-top: 0; }
    .field label { color: var(--ink); font-size: 11px; font-weight: 720; }
    .field-hint { color: var(--faint); font-size: 10px; }
    .field-error { color: var(--red); font-size: 10px; }
    .run-form-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
    .privacy-note { color: var(--faint); font-size: 10px; line-height: 1.4; }
    .run-form-actions .button { flex: 0 0 auto; }
    .history-list { display: grid; gap: 9px; }
    .history-row { display: grid; grid-template-columns: minmax(0, 1fr) 125px 145px auto; gap: 15px; align-items: center; padding: 15px 17px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); }
    .history-row:hover { border-color: #beb6e1; }
    .history-goal { overflow: hidden; color: var(--ink); font-size: 12px; font-weight: 730; text-overflow: ellipsis; white-space: nowrap; }
    .history-meta { margin-top: 4px; color: var(--faint); font-size: 10px; }
    .history-value { color: var(--muted); font-size: 11px; }
    .run-detail { margin-top: 20px; overflow: hidden; }
    .run-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 20px 22px 17px; border-bottom: 1px solid var(--line); }
    .run-detail-head h2 { margin: 0; font-size: 18px; letter-spacing: -.025em; }
    .run-goal { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .result-box { margin: 20px 22px; padding: 18px 19px; border-left: 3px solid var(--green); background: var(--green-wash); }
    .result-box.business { border-left-color: var(--amber); background: var(--amber-wash); }
    .result-box.failure { border-left-color: var(--red); background: var(--red-wash); }
    .result-label { color: var(--muted); font-size: 10px; font-weight: 760; letter-spacing: .09em; text-transform: uppercase; }
    .result-answer { margin-top: 7px; color: var(--ink); font-size: 24px; font-weight: 780; letter-spacing: -.035em; white-space: pre-wrap; overflow-wrap: anywhere; }
    .result-detail { max-width: 740px; margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .timeline { margin: 0 22px 20px; padding: 0; list-style: none; border-top: 1px solid var(--line); }
    .timeline-item { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 12px 0; border-bottom: 1px solid #ecebed; }
    .timeline-dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--faint); }
    .timeline-dot.succeeded { background: var(--green); }
    .timeline-dot.failed { background: var(--red); }
    .timeline-dot.needs_human, .timeline-dot.paused { background: var(--amber); }
    .timeline-title { color: var(--ink); font-size: 11px; font-weight: 700; }
    .timeline-note { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .timeline-time { color: var(--faint); font-size: 10px; white-space: nowrap; }
    .handoff { margin: 0 22px 20px; padding: 16px; border: 1px solid #ead39b; background: var(--amber-wash); }
    .handoff h3 { margin: 0; color: #694a1c; font-size: 13px; }
    .handoff p { margin: 6px 0 0; color: #785d2b; font-size: 11px; line-height: 1.45; }
    .handoff-status { margin-top: 9px; color: #785d2b; font-size: 11px; font-weight: 700; }
    .handoff-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
    .intervention-image { display: block; width: 100%; max-height: 280px; margin-top: 13px; object-fit: contain; object-position: left top; border: 1px solid #ead39b; background: #fff; }
    .offline-preview { margin-top: 13px; padding: 10px; color: #785d2b; font-size: 10px; line-height: 1.4; border: 1px solid #ead39b; background: rgba(255,255,255,.45); }
    .evidence-details { margin: 0 22px 22px; border-top: 1px solid var(--line); }
    .evidence-details summary { padding: 14px 0 3px; color: var(--muted); font-size: 11px; font-weight: 750; cursor: pointer; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 10px; }
    .fact { min-width: 0; padding: 10px; border: 1px solid var(--line); background: var(--panel-soft); }
    .fact-label { color: var(--faint); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .fact-value { overflow: hidden; margin-top: 5px; color: var(--ink); font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .events { max-height: 270px; margin: 10px 0 0; padding: 11px; overflow: auto; color: #cdc8e6; font: 10px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; background: #282735; }
    .dialog { width: min(560px, calc(100% - 30px)); padding: 0; color: var(--ink); border: 1px solid var(--line-strong); border-radius: 7px; box-shadow: 0 25px 70px rgba(28, 25, 36, .2); }
    .dialog::backdrop { background: rgba(39, 36, 44, .32); }
    .dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 19px 20px 14px; border-bottom: 1px solid var(--line); }
    .dialog-head h2 { margin: 0; font-size: 18px; letter-spacing: -.025em; }
    .dialog-head p { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .dialog-body { padding: 18px 20px 20px; }
    .scope-note { margin-bottom: 16px; padding: 11px 12px; color: #5f4f89; font-size: 11px; line-height: 1.45; border-left: 2px solid var(--accent); background: var(--accent-wash); }
    .dialog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 17px; padding-top: 14px; border-top: 1px solid var(--line); }
    .toast { position: fixed; right: 21px; bottom: 20px; z-index: 5; max-width: 340px; padding: 11px 13px; color: #fff; font-size: 12px; border-radius: 5px; background: #302d3d; box-shadow: var(--shadow); transform: translateY(15px); opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; }
    .toast.is-visible { transform: translateY(0); opacity: 1; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (max-width: 900px) {
      .sidebar { flex-basis: 64px; padding: 18px 8px; }
      .brand { justify-content: center; padding: 0 0 24px; }
      .brand-copy, .nav-label, .nav-button span:not(.nav-icon), .nav-badge, .connection-card { display: none; }
      .nav-button { justify-content: center; padding: 11px 7px; }
      .topbar { padding: 23px 25px 0; }
      .content { padding: 24px 25px 52px; }
      .detail-grid { grid-template-columns: 1fr; }
      .table-head, .automation-row { grid-template-columns: minmax(220px, 1.7fr) 100px 125px 78px 86px; gap: 10px; padding: 0 13px; }
    }
    @media (max-width: 620px) {
      .app-shell { display: block; }
      .sidebar { position: static; display: flex; flex-direction: row; align-items: center; min-height: auto; padding: 10px 14px; border-right: 0; border-bottom: 1px solid var(--line); }
      .brand { padding: 0; }
      .nav { display: flex; gap: 2px; margin-left: auto; }
      .nav-button { min-width: 39px; }
      .topbar { align-items: flex-start; padding: 23px 18px 0; }
      .topbar h1 { font-size: 27px; }
      .target-chip { display: none; }
      .content { padding: 20px 18px 40px; }
      .section-header { align-items: flex-start; flex-direction: column; gap: 12px; }
      .section-header .button { width: 100%; }
      .toolbar { flex-wrap: wrap; }
      .search-wrap { flex-basis: 100%; }
      .toolbar > .select-input { flex: 1 1 140px; }
      .table-head { display: none; }
      .automation-row { display: flex; flex-wrap: wrap; gap: 8px 13px; padding: 14px; }
      .automation-name { flex: 1 1 100%; }
      .automation-row > .cell-muted { flex: 1; }
      .automation-row > .row-actions { margin-left: auto; }
      .history-row { grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; }
      .history-row .history-value { grid-column: 1; }
      .history-row .button { grid-column: 2; grid-row: 1 / span 2; }
      .detail-head, .run-detail-head { flex-direction: column; padding: 17px; }
      .detail-actions { justify-content: flex-start; }
      .detail-grid { padding: 17px; }
      .result-box { margin: 17px; }
      .timeline, .handoff, .evidence-details { margin-left: 17px; margin-right: 17px; }
      .timeline-item { grid-template-columns: 14px minmax(0, 1fr); }
      .timeline-time { grid-column: 2; }
      .run-form-actions { align-items: stretch; flex-direction: column; }
      .run-form-actions .button { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <div class="brand"><div class="brand-mark" aria-hidden="true">AC</div><div class="brand-copy"><div class="brand-name">Automation Companion</div><div class="brand-caption">Operator workspace</div></div></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">
        <button class="nav-button" data-view="workflows" aria-current="page" title="Automations"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 17h6M17 14v6"/></svg></span><span>Automations</span></button>
        <button class="nav-button" data-view="history" title="Run history"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4.5v4h4"/><path d="M12 8v4l3 2"/></svg></span><span>Run history</span></button>
        <button class="nav-button" data-view="attention" title="Needs attention"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4 21 19H3L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg></span><span>Needs attention</span><span class="nav-badge" id="attention-count" hidden>0</span></button>
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="connection-card" aria-live="polite"><div class="connection-label"><span class="connection-dot" id="side-connection-dot" aria-hidden="true"></span><span id="side-connection-status">Checking target</span></div><div class="connection-name" id="side-target">Configured target</div><div class="connection-note" id="side-connection-note">Connection details loading</div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><nav class="breadcrumbs" id="breadcrumbs" aria-label="Breadcrumb"><a href="#automations">Automations</a></nav><h1 id="view-title">Automations</h1></div><div class="target-chip"><span class="connection-dot" id="top-connection-dot" aria-hidden="true"></span><span id="top-target">Configured target</span></div></header>
      <div class="content">
        <section class="view is-active" data-panel="workflows" aria-labelledby="view-title">
          <div class="section-header"><div><h2>Automation library</h2><p>Save a workflow once. Run it again with fresh inputs.</p></div><button class="button primary" id="new-automation-button" type="button"><span aria-hidden="true">＋</span> New automation</button></div>
          <div class="toolbar" aria-label="Filter automations"><div class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/></svg><label class="sr-only" for="workflow-search">Search automations</label><input class="search-input" id="workflow-search" type="search" placeholder="Search automations" autocomplete="off"></div><label class="sr-only" for="workflow-status-filter">Filter automation status</label><select class="select-input" id="workflow-status-filter" aria-label="Filter automation status"><option value="all">All statuses</option><option value="ready">Ready</option><option value="archived">Archived</option></select><button class="icon-button" id="refresh-workflows" type="button" aria-label="Refresh automations" title="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-4L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14.8 4L21 15"/><path d="M21 20v-5h-5"/></svg></button></div>
          <div id="workflow-list" class="panel automation-table"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading automations</div></div>
        </section>
        <section class="view" data-panel="attention" aria-labelledby="view-title"><div class="section-header"><div><h2>Needs attention</h2><p>Runs paused because the automation needs an operator decision.</p></div><button class="button" id="refresh-attention" type="button">Refresh</button></div><div class="attention-summary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 21 19H3L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg><span>Claiming an intervention keeps the same live session. Your actions are recorded in the run evidence.</span></div><div id="attention-list" class="history-list"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading interventions</div></div></section>
        <section class="view" data-panel="history" aria-labelledby="view-title"><div class="section-header"><div><h2>Run history</h2><p>Search outcomes and reopen a run to inspect its result and timeline.</p></div><button class="button" id="refresh-runs" type="button">Refresh</button></div><div class="toolbar" aria-label="Filter run history"><div class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/></svg><label class="sr-only" for="run-search">Search run history</label><input class="search-input" id="run-search" type="search" placeholder="Search by goal or automation" autocomplete="off"></div><label class="sr-only" for="run-status-filter">Filter run status</label><select class="select-input" id="run-status-filter" aria-label="Filter run status"><option value="all">All outcomes</option><option value="succeeded">Completed</option><option value="needs_human">Needs attention</option><option value="failed">Failed</option><option value="business_outcome">Business outcome</option><option value="running">In progress</option></select></div><div id="run-list" class="history-list"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading runs</div></div><div id="history-detail"></div></section>
        <section class="view" data-panel="workflow-detail" aria-labelledby="workflow-detail-title"><div id="workflow-detail-host"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading automation</div></div></section>
        <section class="view" data-panel="run-detail" aria-labelledby="run-detail-title"><div id="run-detail-host"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading run</div></div></section>
      </div>
    </main>
  </div>

  <dialog class="dialog" id="new-automation-dialog" aria-labelledby="new-automation-title"><div class="dialog-head"><div><h2 id="new-automation-title">New automation</h2><p>Teach the companion a repeatable task in plain language.</p></div><button class="icon-button" id="close-new-automation" type="button" aria-label="Close new automation dialog">×</button></div><form class="dialog-body" id="task-form"><div class="scope-note">This companion currently learns the supported member servicing flows: savings balances, transaction searches, and loan payoff quotes. Describe the task with synthetic test data when you start; inputs are used for this run only.</div><div class="field"><label for="goal">What should the automation do?</label><textarea class="text-area" id="goal" name="goal" required autocomplete="off" placeholder="Look up member 12345 and tell me their savings balance."></textarea><span class="field-hint">A successful run becomes a reusable automation with inputs for future runs.</span></div><div class="example-row" style="display:grid;gap:6px;margin-top:13px"><span class="field-hint">Try an example</span><button class="button small" type="button" data-example-goal="Look up member 12345 and tell me their savings balance.">Savings balance for member 12345</button><button class="button small" type="button" data-example-goal="Find transactions for member 12345 from 2026-09-01 to 2026-09-11.">Transactions · Sep 1–11, 2026</button><button class="button small" type="button" data-example-goal="Get the loan payoff quote for member 12345 as of 2026-09-30.">Loan payoff quote · Sep 30, 2026</button></div><div class="dialog-actions"><button class="button" id="cancel-new-automation" type="button">Cancel</button><button class="button primary" id="run-button" type="submit">Learn automation</button></div></form></dialog>
  <dialog class="dialog" id="edit-automation-dialog" aria-labelledby="edit-automation-title"><div class="dialog-head"><div><h2 id="edit-automation-title">Edit automation</h2><p>Update the name or description shown to operators.</p></div><button class="icon-button" id="close-edit-automation" type="button" aria-label="Close edit automation dialog">×</button></div><form class="dialog-body" id="edit-automation-form"><div class="field"><label for="edit-name">Name</label><input class="text-input" id="edit-name" name="name" required></div><div class="field"><label for="edit-description">Description</label><textarea class="text-area" id="edit-description" name="description" required></textarea></div><div class="dialog-actions"><button class="button" id="cancel-edit-automation" type="button">Cancel</button><button class="button primary" id="save-edit-automation" type="submit">Save changes</button></div></form></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
  (() => {
    'use strict';
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const state = { activeView: 'workflows', runs: [], workflows: [], context: null, selectedWorkflowId: '', selectedRunId: '', pollTimers: new Map(), routeToken: 0, submitBusy: false, editWorkflowId: '', lastFocus: null };
    const labels = { pending: 'Queued', running: 'Running', succeeded: 'Completed', business_outcome: 'Business outcome', needs_human: 'Needs attention', paused: 'Human control', failed: 'Failed', aborted: 'Aborted', archived: 'Archived', ready: 'Ready' };

    function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
    function safeJson(value) { try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); } }
    function statusLabel(status) { return labels[status] || String(status || 'Unknown').replace(/_/g, ' '); }
    function formatDate(value) { if (!value) return 'Unknown time'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600); }
    function setLoading(element, text) { element.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>' + escapeHtml(text) + '</div>'; }
    function setError(element, message) { element.innerHTML = '<div class="error-state">' + escapeHtml(message) + '</div>'; }
    async function api(path, options) { const response = await fetch(path, options); const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { error: text || 'Unexpected server response' }; } if (!response.ok) { const raw = body.error || body.message || 'Request failed'; const detail = Array.isArray(body.details) ? body.details.map((item) => item?.message || item?.field).filter(Boolean).join('. ') : ''; throw new Error((String(raw).replace(/^[a-z0-9_]+$/, (value) => value.replace(/_/g, ' ')) + (detail ? ': ' + detail : '')).replace(/\.$/, '')); } return body; }
    function normalizeRows(payload, keys) { if (Array.isArray(payload)) return payload.filter(Boolean); for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key].filter(Boolean); return payload?.data && Array.isArray(payload.data) ? payload.data.filter(Boolean) : []; }
    function normalizeRuns(payload) { return normalizeRows(payload, ['runs', 'items']).filter((row) => row && row.id).sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))); }
    function normalizeWorkflows(payload) { return normalizeRows(payload, ['workflows', 'automations', 'capabilities', 'items']).filter(Boolean); }
    function workflowId(workflow) { return String(workflow?.id || workflow?.capabilityId || workflow?.workflowId || ''); }
    function workflowName(workflow) { return workflow?.name || workflow?.title || workflow?.displayName || workflow?.capabilityId || workflowId(workflow) || 'Untitled automation'; }
    function workflowDescription(workflow) { if (workflow?.description || workflow?.intentSignature?.description) return workflow.description || workflow.intentSignature.description; const objective = String(workflow?.intentSignature?.intent || workflow?.objective || ''); const descriptions = { lookup_member_savings_balance: "Read a member's current savings balance in Member Servicing.", lookup_member_transaction_history: "Find a member's transactions for a selected date range.", quote_member_loan_payoff: "Get a member's loan payoff quote for a selected date." }; return descriptions[objective] || 'A saved sequence of steps for Member Servicing.'; }
    function workflowStatus(workflow) { if (workflow?.archived === true || workflow?.status === 'archived') return 'archived'; return workflow?.status || workflow?.lifecycle || 'ready'; }
    function workflowVersion(workflow) { return workflow?.version || workflow?.schemaVersion ? String(workflow.version || ('schema ' + workflow.schemaVersion)) : '—'; }
    function workflowInputs(workflow) { return Array.isArray(workflow?.inputs) ? workflow.inputs : Array.isArray(workflow?.inputSchema?.fields) ? workflow.inputSchema.fields : workflow?.inputSchema?.properties ? Object.entries(workflow.inputSchema.properties).map(([name, schema]) => ({ name, ...schema })) : []; }
    function workflowOutputs(workflow) { return Array.isArray(workflow?.outputs) ? workflow.outputs : workflow?.outputSchema?.properties ? Object.entries(workflow.outputSchema.properties).map(([name, schema]) => ({ name, ...schema })) : []; }
    function workflowActions(workflow) { return Array.isArray(workflow?.actions) ? workflow.actions : Array.isArray(workflow?.steps) ? workflow.steps : []; }
    function runStatus(run) { return run?.status || run?.result?.status || 'unknown'; }
    function runWorkflowId(run) { return String(run?.workflowId || run?.capabilityId || run?.automationId || ''); }
    function runName(run) { const workflow = state.workflows.find((item) => workflowId(item) === runWorkflowId(run)); return run?.workflowName || (workflow && workflowName(workflow)) || run?.goal || 'Automation run'; }
    function effectiveResult(run) { return run?.result || run || {}; }

    function updateConnection(context) {
      state.context = context || {};
      const mode = String(context?.executionMode || '').toLowerCase();
      const name = context?.appName || context?.applicationName || context?.targetName || context?.name || context?.target?.name || context?.target?.applicationFamily || 'Configured target';
      const workspace = context?.workspaceName || context?.workspace || '';
      const live = mode === 'live';
      const offline = mode === 'offline';
      const status = offline ? 'Offline demo' : live ? (context?.discoveryConfigured === false ? 'Target configured' : 'Live target') : 'Target configured';
      $('#side-connection-status').textContent = status;
      $('#side-target').textContent = name;
      $('#top-target').textContent = name;
      $('#side-connection-note').textContent = offline ? (workspace ? workspace + ' · scripted execution' : 'Scripted execution · no browser') : live ? (workspace ? workspace + ' · configured target' : 'Configured target') : (workspace || 'Reachability is reported by the server');
      ['#side-connection-dot', '#top-connection-dot'].forEach((selector) => { const dot = $(selector); dot.classList.toggle('offline', offline); dot.classList.toggle('live', live); });
    }
    async function loadContext() { try { updateConnection(await api('/api/context')); } catch (_) { updateConnection({}); } }
    function updateAttentionCount() { const count = state.runs.filter((run) => ['needs_human', 'paused'].includes(runStatus(run))).length; const badge = $('#attention-count'); badge.hidden = count === 0; badge.textContent = String(count); }
    async function loadRuns() { const list = $('#run-list'); if (state.activeView === 'history') setLoading(list, 'Loading run history'); try { state.runs = normalizeRuns(await api('/api/runs')); updateAttentionCount(); renderRuns(); if (state.activeView === 'attention') renderAttention(); } catch (error) { if (state.activeView === 'history') setError(list, 'Run history is unavailable: ' + error.message); } }
    async function loadWorkflows() { const list = $('#workflow-list'); if (state.activeView === 'workflows') setLoading(list, 'Loading automations'); try { state.workflows = normalizeWorkflows(await api('/api/workflows')); renderWorkflows(); updateAttentionCount(); } catch (error) { if (state.activeView === 'workflows') setError(list, 'Automations are unavailable: ' + error.message); } }
    function filteredWorkflows() { const query = ($('#workflow-search')?.value || '').trim().toLowerCase(); const status = $('#workflow-status-filter')?.value || 'all'; return state.workflows.filter((workflow) => { const matchesQuery = !query || (workflowName(workflow) + ' ' + workflowDescription(workflow)).toLowerCase().includes(query); return (status === 'all' || workflowStatus(workflow) === status) && matchesQuery; }); }
    function renderWorkflows() { const list = $('#workflow-list'); const workflows = filteredWorkflows(); if (!state.workflows.length) { list.innerHTML = '<div class="empty-state"><strong>No automations yet</strong><span class="empty-subcopy">Start with New automation to teach a supported member servicing flow.</span><div class="empty-steps"><span>Describe the task</span><span>Learn the screens</span><span>Run it again</span></div></div>'; return; } if (!workflows.length) { list.innerHTML = '<div class="empty-state"><strong>No matching automations</strong><span class="empty-subcopy">Try a different search or status filter.</span></div>'; return; } const rows = workflows.map((workflow) => { const id = workflowId(workflow); const status = workflowStatus(workflow); const lastRun = state.runs.find((run) => runWorkflowId(run) === id); return '<div class="automation-row"><div class="automation-name"><a class="automation-link" href="#automations/' + encodeURIComponent(id) + '" data-workflow-id="' + escapeHtml(id) + '">' + escapeHtml(workflowName(workflow)) + '</a><div class="automation-description">' + escapeHtml(workflowDescription(workflow)) + '</div></div><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span><span class="cell-muted">' + escapeHtml(lastRun ? formatDate(lastRun.createdAt || lastRun.updatedAt) : 'No runs yet') + '</span><span class="cell-muted">' + escapeHtml(workflowVersion(workflow)) + '</span><div class="row-actions"><a class="button small" href="#automations/' + encodeURIComponent(id) + '" data-workflow-id="' + escapeHtml(id) + '">Open</a></div></div>'; }).join(''); list.innerHTML = '<div class="table-head"><span>Automation</span><span>Status</span><span>Last run</span><span>Version</span><span></span></div>' + rows; bindWorkflowLinks(list); }
    function filteredRuns() { const query = ($('#run-search')?.value || '').trim().toLowerCase(); const status = $('#run-status-filter')?.value || 'all'; return state.runs.filter((run) => { const haystack = (run?.goal || '') + ' ' + runName(run); return (!query || haystack.toLowerCase().includes(query)) && (status === 'all' || runStatus(run) === status); }); }
    function runRow(run) { const status = runStatus(run); return '<article class="history-row"><div><div class="history-goal">' + escapeHtml(run.goal || runName(run)) + '</div><div class="history-meta">' + escapeHtml(runName(run)) + ' · ' + escapeHtml(formatDate(run.createdAt || run.updatedAt)) + '</div></div><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span><span class="history-value">' + escapeHtml(run.mode === 'replay' ? 'Deterministic replay' : run.mode === 'discovery' ? 'Learned flow' : run.mode || '—') + '</span><a class="button small" href="#runs/' + encodeURIComponent(run.id) + '" data-run-id="' + escapeHtml(run.id) + '">Open</a></article>'; }
    function renderRuns() { const list = $('#run-list'); const runs = filteredRuns(); if (!state.runs.length) { list.innerHTML = '<div class="empty-state"><strong>No runs yet</strong><span class="empty-subcopy">Run an automation or learn one from New automation to start a history.</span></div>'; return; } if (!runs.length) { list.innerHTML = '<div class="empty-state"><strong>No matching runs</strong><span class="empty-subcopy">Try a different search or outcome filter.</span></div>'; return; } list.innerHTML = runs.map(runRow).join(''); bindRunLinks(list); }
    function renderAttention() { const list = $('#attention-list'); const runs = state.runs.filter((run) => ['needs_human', 'paused'].includes(runStatus(run))); if (!runs.length) { list.innerHTML = '<div class="empty-state"><strong>Nothing needs attention</strong><span class="empty-subcopy">Paused runs will appear here with the reason and same-session handoff controls.</span></div>'; return; } list.innerHTML = runs.map((run) => '<article class="history-row"><div><div class="history-goal">' + escapeHtml(run.goal || runName(run)) + '</div><div class="history-meta">' + escapeHtml(runName(run)) + ' · ' + escapeHtml(formatDate(run.createdAt || run.updatedAt)) + '</div></div><span class="status-badge ' + escapeHtml(runStatus(run)) + '">' + escapeHtml(statusLabel(runStatus(run))) + '</span><span class="history-value">' + escapeHtml(run.result?.reason || 'Operator action requested') + '</span><a class="button small" href="#runs/' + encodeURIComponent(run.id) + '" data-run-id="' + escapeHtml(run.id) + '">Review</a></article>').join(''); bindRunLinks(list); }

    function actionTarget(action) { const target = action?.target || {}; const strategy = Array.isArray(target.strategies) ? target.strategies[0] : target; if (!strategy) return ''; return strategy.label || strategy.name || strategy.text || strategy.relativeText || strategy.role || 'the matched control'; }
    function humanizeLabel(value) { return String(value || '').replace(/[_-]+/g, ' ').replace(/\\b\\w+/g, (word) => word.toLowerCase() === 'id' ? 'ID' : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }
    function actionKindLabel(kind) { return { click: 'Open', fill: 'Enter', selectOption: 'Choose', wait: 'Wait', extract: 'Read', finish: 'Verify', requestHuman: 'Human review', clickPoint: 'Click' }[kind] || humanizeLabel(kind || 'Step'); }
    function actionDescription(action) { if (!action) return 'Continue the saved workflow'; const target = humanizeLabel(actionTarget(action)); if (action.kind === 'fill') return 'Enter ' + target; if (action.kind === 'click') return 'Open ' + target; if (action.kind === 'selectOption') return 'Choose an option in ' + target; if (action.kind === 'wait') return 'Wait until ' + (action.condition || 'the page is ready'); if (action.kind === 'extract') return 'Read ' + humanizeLabel(action.output || 'the result'); if (action.kind === 'finish') return 'Verify the final checkpoint'; if (action.kind === 'requestHuman') return action.reason || 'Ask an operator to resolve the blocked step'; return actionKindLabel(action.kind); }
    function schemaRows(items, kind) { if (!items.length) return '<p class="empty-subcopy">No ' + kind + ' listed.</p>'; return '<div class="schema-list">' + items.map((item) => { const name = item.name || item.key || 'value'; const type = item.type || item.parseAs || 'string'; const detail = item.description || (kind === 'inputs' ? (item.sensitivity === 'member_identifier' ? 'Used for this run only.' : 'Enter a value for this run.') : item.currency ? 'Currency: ' + item.currency : 'Returned when the run completes.'); return '<div class="schema-row"><div class="schema-key">' + escapeHtml(humanizeLabel(name)) + '<span class="schema-type">' + escapeHtml(type) + '</span></div><div class="schema-value">' + escapeHtml(detail) + '</div></div>'; }).join('') + '</div>'; }
    function inputType(input) { const name = String(input.name || input.key || '').toLowerCase(); return input.type === 'date' || input.format === 'date' || input.sensitivity === 'date' || /(^|_)(date|from|to|as_of)(_|$)/.test(name) ? 'date' : 'text'; }
    function humanizeInputName(name) { return name.replace(/[_-]+/g, ' ').replace(/\\b\\w+/g, (word) => word.toLowerCase() === 'id' ? 'ID' : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }
    function runFormHtml(workflow) { const inputs = workflowInputs(workflow); if (!inputs.length) return '<p class="empty-subcopy">This automation needs no extra values. Run it directly.</p>'; return inputs.map((input) => { const name = String(input.name || input.key || 'input'); const label = input.label || humanizeInputName(name); const required = input.required !== false; const description = input.description || (input.sensitivity === 'member_identifier' ? 'Used for this run only.' : 'Enter a value for this run.'); return '<div class="field"><label for="run-input-' + escapeHtml(name) + '">' + escapeHtml(label) + (required ? ' <span aria-hidden="true">*</span>' : '') + '</label><input class="text-input" id="run-input-' + escapeHtml(name) + '" name="' + escapeHtml(name) + '" data-input-name="' + escapeHtml(name) + '" type="' + inputType(input) + '"' + (required ? ' required' : '') + ' autocomplete="off"><span class="field-hint">' + escapeHtml(description) + '</span></div>'; }).join(''); }
    function detailWorkflowHtml(workflow) { const id = workflowId(workflow); const status = workflowStatus(workflow); const actions = workflowActions(workflow); const inputs = workflowInputs(workflow); const outputs = workflowOutputs(workflow); const checkpoint = workflow.finalCheckpoint || workflow.checkpoint || (Array.isArray(workflow.postconditions) ? workflow.postconditions[0] : '') || 'The final result is verified by the replay runner.'; const steps = actions.length ? actions.map((action, index) => { const note = action.kind === 'extract' ? 'Result: ' + humanizeLabel(action.output || 'the result') : action.kind === 'finish' ? 'Checkpoint: ' + (action.checkpoint || checkpoint) : action.kind === 'wait' ? 'Page condition: ' + (action.condition || 'ready') : ''; return '<li class="step"><span class="step-marker" aria-hidden="true">' + (index + 1) + '</span><div class="step-body"><div class="step-title">' + escapeHtml(actionDescription(action)) + '<span class="step-kind">' + escapeHtml(actionKindLabel(action.kind)) + '</span></div>' + (note ? '<div class="step-note">' + escapeHtml(note) + '</div>' : '') + '</div></li>'; }).join('') : '<li class="empty-subcopy">Step details are not available for this automation.</li>'; const rawContract = { inputs, outputs, preconditions: workflow.preconditions || [], postconditions: workflow.postconditions || [], finalCheckpoint: checkpoint }; return '<a class="detail-back" href="#automations"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Back to automations</a><article class="panel"><div class="detail-head"><div><h2 id="workflow-detail-title">' + escapeHtml(workflowName(workflow)) + '</h2><p class="detail-description">' + escapeHtml(workflowDescription(workflow)) + '</p><div class="detail-meta"><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span><span>Version ' + escapeHtml(workflowVersion(workflow)) + '</span><span>' + escapeHtml(actions.length || 0) + ' steps</span></div></div><div class="detail-actions">' + (status === 'archived' ? '<button class="button" data-workflow-action="restore" data-workflow-id="' + escapeHtml(id) + '" type="button">Restore</button>' : '<button class="button" data-workflow-action="archive" data-workflow-id="' + escapeHtml(id) + '" type="button">Archive</button>') + '<button class="button" data-workflow-action="edit" data-workflow-id="' + escapeHtml(id) + '" type="button">Edit details</button></div></div><div class="detail-grid"><div><section class="subsection"><h3>Workflow steps</h3><p class="subsection-intro">The saved path runs in this order and checks each checkpoint.</p><ol class="steps">' + steps + '</ol></section><section class="subsection"><h3>Inputs for each run</h3><p class="subsection-intro">Provide fresh values each time. They are used only for this run.</p>' + schemaRows(inputs, 'inputs') + '</section><section class="subsection"><h3>What it returns</h3><p class="subsection-intro">The useful result from the completed run.</p>' + schemaRows(outputs, 'outputs') + '</section><section class="subsection"><h3>Completion check</h3><p class="subsection-intro">The run is complete only after this condition is verified.</p><div class="schema-row"><div class="schema-key">Final condition</div><div class="schema-value">' + escapeHtml(checkpoint) + '</div></div></section><details class="contract-details"><summary>Automation details</summary><p class="subsection-intro">The saved input, output, and checkpoint contract.</p><pre class="contract-code">' + escapeHtml(safeJson(rawContract)) + '</pre></details></div><form class="run-form-panel" id="run-workflow-form" data-workflow-id="' + escapeHtml(id) + '"><h3>Run this automation</h3><p>Provide fresh values for this run. The saved workflow stays reusable.</p>' + runFormHtml(workflow) + '<div class="run-form-actions"><span class="privacy-note">Inputs are not saved in browser storage.</span><button class="button primary" id="run-workflow-button" type="submit"' + (status === 'archived' ? ' disabled' : '') + '>Run automation</button></div><div id="run-submit-feedback" aria-live="polite"></div></form></div></article>'; }
    async function loadWorkflowDetail(id, token) { const host = $('#workflow-detail-host'); setLoading(host, 'Loading automation'); let workflow = state.workflows.find((item) => workflowId(item) === id); try { const payload = await api('/api/workflows/' + encodeURIComponent(id)); const detail = payload.workflow || payload.automation || payload; workflow = detail?.artifact ? { ...detail.artifact, ...detail, title: detail.title || detail.artifact.title, description: detail.description ?? detail.artifact.description } : detail; } catch (_) { /* The library endpoint may be list-only. */ } if (token !== state.routeToken) return; if (!workflow || !workflowId(workflow)) { setError(host, 'Automation not found.'); return; } state.selectedWorkflowId = id; host.innerHTML = detailWorkflowHtml(workflow); bindWorkflowDetail(host, workflow); }
    function moneyValue(value) { if (!value || typeof value !== 'object') return ''; const amount = value.amount ?? value.value; if (amount == null) return ''; const currency = value.currency || 'USD'; const number = Number(amount); if (!Number.isNaN(number)) try { return new Intl.NumberFormat([], { style: 'currency', currency }).format(number); } catch (_) { return currency + ' ' + amount; } return currency + ' ' + amount; }
    function resultCopy(run) { const result = effectiveResult(run); const status = result.status || runStatus(run); if (status === 'succeeded') { const outputs = result.outputs || {}; const entries = Object.entries(outputs); if (!entries.length) return { label: 'Completed', answer: 'Task completed', detail: result.checkpointVerified ? 'The final checkpoint was verified.' : 'The target reported completion.' }; const first = entries[0]; const answer = moneyValue(first[1]) || (typeof first[1] === 'string' || typeof first[1] === 'number' ? String(first[1]) : safeJson(first[1])); const detail = entries.length > 1 ? entries.slice(1).map((entry) => entry[0] + ': ' + (moneyValue(entry[1]) || String(entry[1]))).join(' · ') : (result.checkpointVerified ? 'Completed with a verified checkpoint.' : 'Completed.'); return { label: 'Result', answer, detail }; } if (status === 'business_outcome') return { label: 'Business outcome', answer: result.code || 'Business outcome', detail: result.details ? safeJson(result.details) : 'The target returned a business outcome for the caller.' }; if (status === 'needs_human' || status === 'paused') return { label: 'Action needed', answer: 'Operator review required', detail: result.reason || 'Automation paused and is waiting for operator input.' }; if (status === 'failed' || status === 'aborted') return { label: status === 'aborted' ? 'Run aborted' : 'Run stopped', answer: result.error?.message || 'The automation could not be completed.', detail: result.error?.code ? 'The system reported ' + result.error.code + '.' : 'Review the evidence below for details.' }; return { label: 'Run status', answer: statusLabel(status), detail: 'The run is still in progress.' }; }
    function timelineHtml(events) { if (!Array.isArray(events) || !events.length) return '<p class="empty-subcopy">Timeline events are not available yet.</p>'; return '<ol class="timeline">' + events.map((event) => { const outcome = String(event.outcome || event.status || 'recorded'); const title = event.kind === 'result' ? 'Run ' + statusLabel(outcome) : event.kind === 'human_action' ? 'Operator action recorded' : event.action?.kind ? 'Step · ' + actionKindLabel(event.action.kind) : humanizeLabel(event.kind || 'Run event'); const note = event.details?.message || event.details?.reason || event.action?.checkpoint || event.action?.condition || (event.error?.message) || (outcome === 'succeeded' ? 'Completed' : statusLabel(outcome)); return '<li class="timeline-item"><span class="timeline-dot ' + escapeHtml(outcome.split(':')[0]) + '" aria-hidden="true"></span><div><div class="timeline-title">' + escapeHtml(title) + '</div><div class="timeline-note">' + escapeHtml(String(note)) + '</div></div><time class="timeline-time">' + escapeHtml(formatDate(event.timestamp || event.createdAt)) + '</time></li>'; }).join('') + '</ol>'; }
    function handoffHtml(run) { const status = runStatus(run); const interventionId = run.interventionId || run.result?.interventionId; if (!interventionId || !['needs_human', 'paused'].includes(status)) return ''; const claimed = status === 'paused'; const mode = String(state.context?.executionMode || '').toLowerCase(); const preview = mode === 'live' ? '<img class="intervention-image" id="intervention-image" alt="Latest target state" src="/api/interventions/' + encodeURIComponent(interventionId) + '/screenshot">' : '<div class="offline-preview">' + (mode === 'offline' ? 'Offline demo mode has no live browser preview.' : 'Target preview is unavailable until the connection mode is confirmed.') + ' The handoff state and recorded actions are still available here.</div>'; return '<section class="handoff"><h3>' + (claimed ? 'You have control of the live session' : 'This run needs an operator') + '</h3><p>' + escapeHtml(run.result?.reason || 'Automation paused at a point that needs a human decision. Claim the same session, make the correction, then hand control back to continue.') + '</p><div class="handoff-status">' + (claimed ? 'Control state: human · automation is paused' : 'Control state: automation · waiting for a claim') + '</div>' + preview + '<div class="handoff-actions"><button class="button primary" data-intervention-action="claim" data-intervention-id="' + escapeHtml(interventionId) + '" type="button"' + (claimed ? ' disabled' : '') + '>Take control</button><button class="button" data-intervention-action="resume" data-intervention-id="' + escapeHtml(interventionId) + '" type="button"' + (!claimed ? ' disabled' : '') + '>Continue automation</button><button class="button danger" data-intervention-action="abort" data-intervention-id="' + escapeHtml(interventionId) + '" type="button">Abort run</button></div></section>'; }
    async function fetchEvents(runId) { try { return await api('/api/runs/' + encodeURIComponent(runId) + '/events'); } catch (_) { return []; } }
    async function buildRunDetail(run, host, token) { const events = await fetchEvents(run.id); if (token !== state.routeToken) return; const result = resultCopy(run); const status = runStatus(run); const evidence = '<details class="evidence-details"><summary>View technical evidence</summary><div class="facts"><div class="fact"><div class="fact-label">Status</div><div class="fact-value">' + escapeHtml(statusLabel(status)) + '</div></div><div class="fact"><div class="fact-label">Execution</div><div class="fact-value">' + escapeHtml(run.mode === 'replay' ? 'Deterministic replay' : run.mode || '—') + '</div></div><div class="fact"><div class="fact-label">Model calls</div><div class="fact-value">' + escapeHtml(run.llmCalls == null ? '—' : String(run.llmCalls)) + '</div></div><div class="fact"><div class="fact-label">Run ID</div><div class="fact-value" title="' + escapeHtml(run.id) + '">' + escapeHtml(run.id) + '</div></div></div>' + (events.length ? '<pre class="events">' + escapeHtml(safeJson(events)) + '</pre>' : '<p class="empty-subcopy">Event evidence is not available for this run.</p>') + '</details>'; host.innerHTML = '<a class="detail-back" href="#history"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6 6"/></svg>Back to run history</a><article class="panel run-detail"><div class="run-detail-head"><div><h2 id="run-detail-title">Run details</h2><p class="run-goal">' + escapeHtml(run.goal || runName(run)) + '</p></div><span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span></div><div class="result-box ' + (status === 'business_outcome' ? 'business' : status === 'failed' || status === 'aborted' ? 'failure' : '') + '"><div class="result-label">' + escapeHtml(result.label) + '</div><div class="result-answer">' + escapeHtml(result.answer) + '</div><div class="result-detail">' + escapeHtml(result.detail) + '</div></div>' + handoffHtml(run) + '<h3 class="sr-only">Run timeline</h3>' + timelineHtml(events) + evidence + '</article>'; bindInterventionButtons(host); }
    async function loadRunDetail(id, token) { const host = $('#run-detail-host'); setLoading(host, 'Loading run'); let run = state.runs.find((item) => item.id === id); try { const fetched = await api('/api/runs/' + encodeURIComponent(id)); run = fetched.run || fetched; } catch (_) { /* use list response while a legacy server catches up */ } if (token !== state.routeToken) return; if (!run || !run.id) { setError(host, 'Run not found.'); return; } state.selectedRunId = id; await buildRunDetail(run, host, token); if (token !== state.routeToken) return; if (['pending', 'running', 'needs_human', 'paused'].includes(runStatus(run))) schedulePoll(id, host, token); }
    function schedulePoll(runId, host, token) { if (state.pollTimers.has(runId)) window.clearTimeout(state.pollTimers.get(runId)); state.pollTimers.set(runId, window.setTimeout(async () => { if (token !== state.routeToken) return; try { const fetched = await api('/api/runs/' + encodeURIComponent(runId)); const run = fetched.run || fetched; if (token !== state.routeToken) return; await buildRunDetail(run, host, token); if (['pending', 'running', 'needs_human', 'paused'].includes(runStatus(run))) schedulePoll(runId, host, token); else { state.pollTimers.delete(runId); await loadRuns(); } } catch (_) { schedulePoll(runId, host, token); } }, 900)); }
    function bindWorkflowLinks(root) { $$('[data-workflow-id]', root).forEach((link) => link.addEventListener('click', () => { /* hashchange performs the guarded load */ })); }
    function bindRunLinks(root) { $$('[data-run-id]', root).forEach((link) => link.addEventListener('click', () => { /* hashchange performs the guarded load */ })); }
    function bindWorkflowDetail(root, workflow) { $$('[data-workflow-action]', root).forEach((button) => button.addEventListener('click', () => workflowAction(button.dataset.workflowAction, workflowId(workflow)))); const form = $('#run-workflow-form', root); if (form) form.addEventListener('submit', (event) => submitWorkflowRun(event, workflow)); }
    async function workflowAction(action, id) { const workflow = state.workflows.find((item) => workflowId(item) === id); if (!workflow) return; if (action === 'edit') return openEditDialog(workflow); try { await api('/api/workflows/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: action === 'archive' }) }); showToast(action === 'archive' ? 'Automation archived.' : 'Automation restored.'); await loadWorkflows(); await route(); } catch (error) { showToast(error.message); } }
    async function submitWorkflowRun(event, workflow) { event.preventDefault(); if (state.submitBusy) return; const form = event.currentTarget; const button = $('#run-workflow-button', form); const feedback = $('#run-submit-feedback', form); const inputs = {}; $$('[data-input-name]', form).forEach((input) => { inputs[input.dataset.inputName] = input.value; }); if (!form.reportValidity()) return; state.submitBusy = true; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Starting'; setLoading(feedback, 'Starting run'); try { const id = workflowId(workflow); const created = await api('/api/workflows/' + encodeURIComponent(id) + '/runs', { method: 'POST', headers: { 'content-type': 'application/json', 'Prefer': 'respond-async' }, body: JSON.stringify({ inputs }) }); const runId = created.runId || created.id || created.run?.id; if (!runId) throw new Error('The server did not return a run id.'); form.reset(); showToast('Run started.'); window.location.hash = '#runs/' + encodeURIComponent(runId); } catch (error) { setError(feedback, error.message); showToast(error.message); } finally { state.submitBusy = false; button.disabled = workflowStatus(workflow) === 'archived'; button.textContent = 'Run automation'; } }
    function openDialog(dialog, focusTarget) { state.lastFocus = document.activeElement; dialog.showModal(); document.body.classList.add('dialog-open'); window.setTimeout(() => (focusTarget || $('input, textarea, button', dialog))?.focus(), 0); }
    function closeDialog(dialog) { if (dialog.open) dialog.close(); document.body.classList.remove('dialog-open'); if (state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus(); state.lastFocus = null; }
    function openNewDialog() { $('#goal').value = ''; openDialog($('#new-automation-dialog'), $('#goal')); }
    function openEditDialog(workflow) { state.editWorkflowId = workflowId(workflow); $('#edit-name').value = workflowName(workflow); $('#edit-description').value = workflowDescription(workflow); openDialog($('#edit-automation-dialog'), $('#edit-name')); }
    async function submitTask(event) { event.preventDefault(); if (state.submitBusy) return; const input = $('#goal'); const button = $('#run-button'); const goal = input.value.trim(); if (!goal) return; state.submitBusy = true; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Learning'; try { const created = await api('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'Prefer': 'respond-async' }, body: JSON.stringify({ goal }) }); const runId = created.runId || created.id || created.run?.id; closeDialog($('#new-automation-dialog')); await loadRuns(); if (runId) { showToast('Learning run started.'); window.location.hash = '#runs/' + encodeURIComponent(runId); } else showToast('Learning run started.'); } catch (error) { showToast(error.message); const form = $('#task-form'); const feedback = document.createElement('div'); feedback.className = 'field-error'; feedback.textContent = error.message; form.appendChild(feedback); } finally { state.submitBusy = false; button.disabled = false; button.textContent = 'Learn automation'; } }
    async function submitEdit(event) { event.preventDefault(); if (state.submitBusy || !state.editWorkflowId) return; const button = $('#save-edit-automation'); const name = $('#edit-name').value.trim(); const description = $('#edit-description').value.trim(); if (!name || !description) return; state.submitBusy = true; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Saving'; try { await api('/api/workflows/' + encodeURIComponent(state.editWorkflowId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: name, description }) }); closeDialog($('#edit-automation-dialog')); showToast('Automation details saved.'); await loadWorkflows(); await route(); } catch (error) { showToast(error.message); } finally { state.submitBusy = false; button.disabled = false; button.textContent = 'Save changes'; } }
    async function interventionAction(action, id, button) { if (!action || !id || state.submitBusy) return; state.submitBusy = true; button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Working'; try { await api('/api/interventions/' + encodeURIComponent(id) + '/' + action, { method: 'POST' }); showToast(action === 'claim' ? 'Control claimed for the same session.' : action === 'resume' ? 'Automation is continuing.' : 'Run aborted.'); await loadRuns(); await route(); } catch (error) { button.disabled = false; button.textContent = action === 'claim' ? 'Take control' : action === 'resume' ? 'Continue automation' : 'Abort run'; showToast(error.message); } finally { state.submitBusy = false; } }
    function bindInterventionButtons(root) { $$('[data-intervention-action]', root).forEach((button) => button.addEventListener('click', () => interventionAction(button.dataset.interventionAction, button.dataset.interventionId, button))); }
    function viewMeta(view) { return { workflows: ['Automations', 'Automations'], attention: ['Needs attention', 'Needs attention'], history: ['Run history', 'Run history'], 'workflow-detail': ['Automations', 'Automation'], 'run-detail': ['Run history', 'Run details'] }[view] || ['Automations', 'Automations']; }
    async function route() { const token = ++state.routeToken; const raw = window.location.hash.replace(/^#/, '') || 'automations'; const parts = raw.split('/').filter(Boolean).map((part) => decodeURIComponent(part)); let view = parts[0] === 'runs' ? 'run-detail' : parts[0] === 'automations' && parts[1] ? 'workflow-detail' : parts[0] === 'attention' ? 'attention' : parts[0] === 'history' ? 'history' : 'workflows'; state.activeView = view; $$('.view').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === view)); $$('.nav-button').forEach((button) => button.setAttribute('aria-current', button.dataset.view === view || (view === 'workflow-detail' && button.dataset.view === 'workflows') || (view === 'run-detail' && button.dataset.view === 'history') ? 'page' : 'false')); const meta = viewMeta(view); $('#view-title').textContent = view === 'workflow-detail' && parts[1] ? 'Automation' : meta[1]; const crumbs = $('#breadcrumbs'); crumbs.innerHTML = '<a href="' + (view === 'history' || view === 'run-detail' ? '#history' : '#automations') + '">' + escapeHtml(meta[0]) + '</a>' + (view === 'workflow-detail' || view === 'run-detail' ? '<span class="breadcrumb-sep">/</span><span>' + escapeHtml(meta[1]) + '</span>' : ''); if (view === 'workflows') { await loadWorkflows(); await loadRuns(); } else if (view === 'history') { await loadRuns(); } else if (view === 'attention') { await loadRuns(); renderAttention(); } else if (view === 'workflow-detail') { if (!state.workflows.length) await loadWorkflows(); await loadWorkflowDetail(parts[1], token); } else if (view === 'run-detail') { if (!state.runs.length) await loadRuns(); await loadRunDetail(parts[1], token); } }
    $('#new-automation-button').addEventListener('click', openNewDialog);
    $('#close-new-automation').addEventListener('click', () => closeDialog($('#new-automation-dialog')));
    $('#cancel-new-automation').addEventListener('click', () => closeDialog($('#new-automation-dialog')));
    $('#close-edit-automation').addEventListener('click', () => closeDialog($('#edit-automation-dialog')));
    $('#cancel-edit-automation').addEventListener('click', () => closeDialog($('#edit-automation-dialog')));
    function restoreDialogFocus() { const focusTarget = state.lastFocus; document.body.classList.remove('dialog-open'); window.setTimeout(() => { if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus(); if (state.lastFocus === focusTarget) state.lastFocus = null; }, 0); }
    $('#new-automation-dialog').addEventListener('cancel', restoreDialogFocus);
    $('#edit-automation-dialog').addEventListener('cancel', restoreDialogFocus);
    $('#task-form').addEventListener('submit', submitTask);
    $('#edit-automation-form').addEventListener('submit', submitEdit);
    $('#refresh-runs').addEventListener('click', loadRuns);
    $('#refresh-attention').addEventListener('click', loadRuns);
    $('#refresh-workflows').addEventListener('click', loadWorkflows);
    $('#workflow-search').addEventListener('input', renderWorkflows);
    $('#workflow-status-filter').addEventListener('change', renderWorkflows);
    $('#run-search').addEventListener('input', renderRuns);
    $('#run-status-filter').addEventListener('change', renderRuns);
    $$('[data-example-goal]').forEach((button) => button.addEventListener('click', () => { $('#goal').value = button.dataset.exampleGoal || ''; $('#goal').focus(); }));
    $$('.nav-button').forEach((button) => button.addEventListener('click', () => { window.location.hash = button.dataset.view === 'workflows' ? '#automations' : '#' + button.dataset.view; }));
    function timelineControlLabel(event) { const control = event?.resolvedControl || {}; const strategy = event?.action?.target?.strategies?.[0] || {}; return control.label || control.relativeText || control.name || control.text || strategy.label || strategy.relativeText || strategy.name || strategy.text || ''; }
    function timelineHtml(events) { if (!Array.isArray(events) || !events.length) return '<p class="empty-subcopy">Timeline events are not available yet.</p>'; return '<ol class="timeline">' + events.map((event) => { const outcome = String(event.outcome || event.status || 'recorded'); const target = timelineControlLabel(event); const actionTitle = event.action?.kind ? actionKindLabel(event.action.kind) + (target ? ' ' + humanizeLabel(target) : '') : ''; const title = event.kind === 'result' ? 'Run ' + statusLabel(outcome) : event.kind === 'human_action' ? 'Operator action recorded' : actionTitle || humanizeLabel(event.kind || 'Run event'); const note = event.details?.message || event.details?.reason || event.action?.checkpoint || event.action?.condition || (event.error?.message) || (outcome === 'succeeded' ? 'Completed' : statusLabel(outcome)); const time = event.timestamp ? '<time class="timeline-time">' + escapeHtml(formatDate(event.timestamp)) + '</time>' : ''; return '<li class="timeline-item"><span class="timeline-dot ' + escapeHtml(outcome.split(':')[0]) + '" aria-hidden="true"></span><div><div class="timeline-title">' + escapeHtml(title) + '</div><div class="timeline-note">' + escapeHtml(String(note)) + '</div></div>' + time + '</li>'; }).join('') + '</ol>'; }
    window.addEventListener('hashchange', route);
    loadContext(); loadRuns(); route();
  })();
  </script>
</body>
</html>`;

/** Alias kept explicit so the server integration reads naturally. */
export function renderCompanionHtml(): string {
  return companionHtml;
}
