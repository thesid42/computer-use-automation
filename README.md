# Computer-Use Automation System

A focused take-home implementation of a record-once, replay-many computer-use system for legacy back-office applications.

The user enters one natural-language task in the companion. If no saved capability matches, a vision-language model discovers the workflow by operating the live UI through Playwright. The successful run is compiled into a typed, reviewable artifact. Later invocations replay that artifact deterministically without an LLM in the decision loop.

## Standalone applications

- [`legacy-demo/`](legacy-demo/) is a standalone synthetic member-servicing application. It has its own package, process, tests, and README and can be operated manually.
- [`companion/`](companion/) is the standalone natural-language UI, discovery/replay engine, policy gate, evidence recorder, and human-handoff controller.

The applications share no source code or data. The companion reaches the demo only through its configured URL and browser-visible interface.

## Design

- [Detailed design](docs/DESIGN.md)
- [MVP acceptance checklist](docs/MVP-ACCEPTANCE.md)
- [Required short report](REPORT.md)

## Prerequisites

- Node.js 22+
- npm
- Chromium installed for Playwright when running real browser automation
- A compatible model API key only for live discovery. Deterministic replay and the test suite do not require one.

## Install

```bash
npm run install:all
```

## Run

Start the independently runnable applications in separate terminals:

```bash
npm run legacy
```

```bash
npm run companion
```

See each application's README for its exact environment variables, ports, synthetic fixture IDs, and standalone commands.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Core demonstration

1. Open the companion web UI.
2. Enter: `Look up member 12345 and tell me their current savings balance.`
3. With a model key configured and no matching artifact, the system performs discovery and saves a capability.
4. Submit the corresponding request for another member to exercise deterministic replay.
5. Use the documented synthetic fixtures to demonstrate a business outcome, transient recovery, policy denial, and same-session human intervention.

The companion also exposes a small internal API for its browser UI: `GET /api/context`, `GET /api/workflow`, and newest-first redacted `GET /api/runs` provide inspection and restart-aware history. `POST /api/tasks` remains synchronous by default; clients that send `Prefer: respond-async` receive a `202` with a run ID immediately and poll `GET /api/runs/:runId`. Saved live artifacts are isolated under `runtime/live/`; offline artifacts use the offline namespace and are never selected by live execution.

The repository must not claim a fake/scripted-model run as the assignment's required genuine LLM discovery evidence. Live evidence is generated only when a real provider key is configured.

The packaged live acceptance run used OpenRouter's `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` on 2026-09-10. Discovery completed with the typed balance `$1,250.42` after 16 bounded model calls, compiled a reusable artifact, and replay returned the same balance with `llmCalls: 0`; the unknown-member replay returned `MEMBER_NOT_FOUND` with `llmCalls: 0`. The [sanitized evidence package](evidence/README.md) includes the artifact, summaries, JSONL logs, and representative screenshots. Discovery validates each action before execution and allows only bounded repair calls; earlier failed provider attempts remain diagnostic-only under `tmp/`.
