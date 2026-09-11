# Computer-Use Automation System

A focused take-home implementation of a record-once, replay-many computer-use system for a legacy back-office application.

The operator opens the companion workspace and submits a natural-language goal. If no active saved workflow matches, a vision-capable model discovers the flow by operating the target UI through Playwright. The verified run is compiled into a typed, reviewable artifact and durable workflow metadata. Later invocations either use the selected workflow's typed run form or match it from natural language and replay it deterministically without an LLM in the decision loop.

The MVP implements three synthetic, read-only workflow families:

- savings balance lookup;
- savings transaction history search by inclusive date range;
- loan payoff quote as of a supplied date.

The library can retain compatible saved workflows beyond those examples, but the target adapter and intent support are intentionally limited to these three families.

The expanded transaction and loan flows are verified by scripted browser tests; fresh Nano provider discovery is currently unreliable (see the [acceptance checklist](docs/MVP-ACCEPTANCE.md) for the recorded attempts).

## Applications

- [legacy-demo/](legacy-demo/) is a standalone synthetic member-servicing target. It has its own process, package, tests, nested iframe, dense table UI, and visible server forms.
- [companion/](companion/) is the standalone workspace, discovery/replay engine, workflow library, policy gate, evidence recorder, and human-handoff controller.

The companion and target share no source code or data. The companion reaches the target only through its configured URL and browser-visible UI. Its local /api routes are internal workspace/library routes; they are not hidden target business APIs.

## Design documents

- [Detailed design](docs/DESIGN.md)
- [MVP acceptance checklist](docs/MVP-ACCEPTANCE.md)
- [Required short report](REPORT.md)
- [Target workflow reference](legacy-demo/README.md)

## Prerequisites

- Node.js 22+
- npm
- Chromium installed for Playwright when running a real browser
- A provider API key only for live discovery; offline mode, direct replay, and tests do not need one

## Install

From the repository root:

~~~bash
npm run install:all
npm exec --prefix companion playwright install chromium
~~~

The first command installs the two application packages. The second installs the Chromium browser used by the live Playwright adapter.

## Environment

The companion imports dotenv configuration automatically from its package working directory. Put the following in companion/.env whether you start it from the repository root or from companion/. The file is ignored by git and the key is sent only in the provider authorization header.

PowerShell (safe when no companion/.env exists yet):

~~~powershell
if (!(Test-Path companion/.env)) { Copy-Item companion/.env.example companion/.env }
~~~

Bash (safe when no companion/.env exists yet):

~~~bash
test -f companion/.env || cp companion/.env.example companion/.env
~~~

Edit the copied file and add the user-provided key; the checked-in example contains no key.

~~~dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=replace-with-your-provider-key
LLM_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
LLM_ACTION_MODE=json
LLM_TIMEOUT_MS=60000
DISCOVERY_MAX_ELAPSED_MS=300000
TARGET_URL=http://127.0.0.1:3001
~~~

Use a real user-provided key for live discovery. Discovery is bounded to 300 seconds by default; DISCOVERY_MAX_ELAPSED_MS may set a value from 30 to 600 seconds. Do not put a key in an artifact, evidence file, or log.

## Run

Start the independently runnable applications in separate terminals:

Terminal 1:

~~~bash
npm run legacy
~~~

Terminal 2:

~~~bash
npm run companion
~~~

Open http://127.0.0.1:3000. The target listens on http://127.0.0.1:3001 by default. TARGET_URL can point the companion at another compatible browser-visible target.

For a deterministic local demonstration with no API key, live provider, or target browser:

~~~bash
OFFLINE_DEMO=1 npm run companion
~~~

In PowerShell:

~~~powershell
$env:OFFLINE_DEMO='1'
npm run companion
~~~

Offline artifacts and live artifacts use separate runtime namespaces.

## Demo goals

Enter these in the New automation dialog:

~~~text
Look up member 12345 and tell me their current savings balance.
Find transactions for member 12345 from 2026-09-01 through 2026-09-11 and show the filtered results.
Get an as-of 2026-09-30 payoff quote for member 12345's auto loan.
~~~

The target's normal synthetic fixtures are member 12345 (success), 77777 (one transient search failure then Retry Search succeeds), and 88888 (same-session supervisor verification). Unknown 40404 returns MEMBER_NOT_FOUND; 54321 returns PERMISSION_DENIED. Transaction searches can return NO_TRANSACTIONS or INVALID_DATE_RANGE. Payoff requests can return NO_LOAN, INVALID_AS_OF_DATE, or UNSUPPORTED_AS_OF_DATE. The visible Post Fee control demonstrates policy denial and remains read-only.

## Direct typed replay

After a workflow artifact exists, the detail page's input form calls the internal typed workflow-run endpoint. A direct run does not invoke the LLM for decisions and reports llmCalls: 0 on success or failure metadata.

The CLI can replay a saved artifact directly against a running target. From the repository root, using a live artifact:

~~~bash
npm run replay --prefix companion -- --artifact ./companion/runtime/live/artifacts/member.lookup-savings-balance.json --input member_id=12345 --target http://127.0.0.1:3001 --headless
~~~

For an offline artifact, use:

~~~bash
npm run replay --prefix companion -- --artifact ./companion/runtime/offline/artifacts/member.lookup-savings-balance.json --input member_id=12345 --target http://127.0.0.1:3001 --headless
~~~

The CLI prints one JSON result and exits nonzero for an invalid artifact, browser failure, policy failure, or other hard replay failure. Date and loan inputs use the same typed input contract as the workflow detail form.

## Internal companion API

The browser workspace uses these local routes:

- POST /api/tasks with { "goal": "..." } for natural-language discovery or active-workflow matching;
- GET /api/workflows to list durable library metadata;
- GET /api/workflows/:id to read one workflow, its validated artifact, and recent runs;
- PATCH /api/workflows/:id with title, description, and/or archived metadata;
- POST /api/workflows/:id/runs with { "inputs": { ... } } for direct typed deterministic replay;
- GET /api/runs and GET /api/runs/:runId for searchable/inspectable redacted history;
- GET /api/runs/:runId/events for structured activity;
- intervention routes for screenshot, claim, resume, abort, and human-action evidence.

These are local internal endpoints for the companion UI and workflow library. The target integration remains browser-only and uses no target API.

## Verify

Run checks appropriate to the current checkout:

~~~bash
npm test
npm run typecheck
npm run build
npm run test --prefix companion -- test/playwright-workflows.test.ts
~~~

The repository preserves sanitized historical live evidence under [evidence/](evidence/). That package records a provider-backed discovery and zero-LLM replay, but the commands above are the authority for current code after the expanded workflow and library changes.

The separate [savings runtime verification](evidence/savings-runtime-verification.json) records five direct replay/handoff scenarios plus one restart persistence check with zero model decision calls. It does not claim fresh provider discovery or verification of the expanded transaction and loan flows. Final provider attempts for the added families were unreliable; their local scripted browser coverage is measured in [the acceptance checklist](docs/MVP-ACCEPTANCE.md), while only savings has genuine historical provider evidence.

The local review workspace contains the previously learned savings workflow. A fresh checkout starts with an empty library until discovery or artifact loading. The library and internal API support multiple compatible workflow records, and that behavior is covered by the local test suite; the README does not present the three target families as three pre-seeded saved records.
