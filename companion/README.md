# Automation Companion

Standalone strict-TypeScript web companion for a configured browser-visible back-office target. It provides a local workflow library, natural-language discovery, deterministic replay, redacted run history, policy enforcement, and same-session human handoff.

The current target adapter supports three synthetic read-only workflow families:

1. Member savings balance lookup.
2. Savings transaction history search with start_date and end_date.
3. Loan payoff quote with as_of_date.

The library can store compatible workflows beyond these three records, but this MVP does not claim arbitrary task discovery or target coverage.

The expanded transaction and loan flows are verified by scripted browser tests; fresh Nano provider discovery is currently unreliable (see the [acceptance checklist](../docs/MVP-ACCEPTANCE.md) for the recorded attempts).

## Run

From this directory:

~~~bash
npm install
npx playwright install chromium
npm run companion
~~~

Open http://127.0.0.1:3000. The default target is http://127.0.0.1:3001 and can be changed with TARGET_URL. From the repository root, the equivalent commands are:

~~~bash
npm run install:all
npm exec --prefix companion playwright install chromium
npm run companion
~~~

The target itself is independent; start it in another terminal with npm run legacy from the repository root or npm run start from legacy-demo/.

The companion imports dotenv configuration automatically from this package directory. Copy the ignored environment template before the first live run:

~~~powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
~~~

On macOS/Linux:

~~~bash
test -f .env || cp .env.example .env
~~~

Edit the copied file and add the user-provided key; the checked-in example contains no key. The same companion/.env file is used when the process is started through the repository-root script.

## Live discovery configuration

The companion uses one OpenAI-compatible /chat/completions adapter. Set provider values before a live discovery:

~~~dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=replace-with-your-provider-key
LLM_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
LLM_ACTION_MODE=json
LLM_TIMEOUT_MS=60000
DISCOVERY_MAX_ELAPSED_MS=300000
TARGET_URL=http://127.0.0.1:3001
~~~

The default endpoint is NVIDIA NIM when LLM_BASE_URL is omitted; NVIDIA_API_KEY is accepted for that default endpoint. LLM_API_KEY is preferred. Provider timeouts are bounded to 5–120 seconds. Discovery is bounded to 300 seconds by default; DISCOVERY_MAX_ELAPSED_MS may set a value from 30 to 600 seconds. The key is sent in the authorization header only and is never placed in prompts, workflow metadata, artifacts, evidence, or logs. Tests and offline mode never create live-model evidence.

## Offline demonstration

For a scripted local run with no API key, live model, or target browser:

~~~bash
OFFLINE_DEMO=1 npm run companion
~~~

In PowerShell:

~~~powershell
$env:OFFLINE_DEMO='1'
npm run companion
~~~

Offline artifacts, workflow metadata, and run evidence are namespaced separately from live runtime data.

## Demo goals and target fixtures

Use these goals in the New automation dialog:

~~~text
Look up member 12345 and tell me their current savings balance.
Find transactions for member 12345 from 2026-09-01 through 2026-09-11 and show the filtered results.
Get an as-of 2026-09-30 payoff quote for member 12345's auto loan.
~~~

The standalone target documents the visible controls and exact routes in [legacy-demo/README.md](../legacy-demo/README.md). The normal member 12345 path returns a savings balance, three September transaction rows for the example range, and a deterministic payoff amount of $18,968.53. Member 77777 exercises the existing same-session Retry Search transient. Member 88888 exercises supervisor verification and human takeover. Unknown member and date/loan fixtures return explicit business outcomes rather than crashes.

## Workflow library and direct replay

The browser workspace opens on the Automation library. New automation opens discovery in a dialog. Each saved workflow has a detail view with its description, ordered steps, typed input/output contract, editable title/description, archive/restore controls, recent runs, and a fresh input form. A workflow run always takes fresh input values; previous member IDs and dates are not stored in browser storage or copied into metadata.

The direct run form calls POST /api/workflows/:id/runs with a body shaped like { "inputs": { "member_id": "12345" } }. It validates inputs, refuses archived workflows, runs the selected versioned artifact through the deterministic replay runner, and does not call the LLM for decisions. A successful direct replay reports llmCalls: 0.

To run an artifact with the local CLI from this directory:

~~~bash
npm run replay -- --artifact ./runtime/live/artifacts/member.lookup-savings-balance.json --input member_id=12345 --target http://127.0.0.1:3001 --headless
~~~

Use runtime/offline instead of runtime/live for an offline artifact. The CLI prints one JSON result and exits nonzero for invalid artifacts, invalid inputs, policy failures, browser failures, or other hard replay failures.

## Internal endpoints

- POST /api/tasks with { "goal": "..." } for a natural-language task; the server may match an active workflow or start discovery.
- GET /api/workflows lists durable workflow metadata.
- GET /api/workflows/:id returns metadata, the validated artifact, and recent workflow runs.
- PATCH /api/workflows/:id edits title, description, and archived state.
- POST /api/workflows/:id/runs runs a selected workflow with typed inputs and zero model decision calls.
- GET /api/runs and GET /api/runs/:runId provide redacted searchable history and details.
- GET /api/runs/:runId/events provides the structured activity feed.
- GET /api/interventions/:id/screenshot and POST /api/interventions/:id/claim, /resume, /abort support same-session handoff.
- POST /api/interventions/:id/actions records a redacted human-action event while the operator owns the lease.

These are local companion routes for the browser workspace and workflow library. They do not call a target API; all target actions still go through the rendered UI.

## Development

~~~bash
npm test
npm run typecheck
npm run build
npx vitest run test/playwright-workflows.test.ts
~~~

The repository preserves a sanitized historical provider-backed discovery package under ../evidence/. It contains a real discovery summary, artifact, zero-LLM replay, and MEMBER_NOT_FOUND replay without a provider key. The separate [savings runtime verification](../evidence/savings-runtime-verification.json) records five direct replay/handoff scenarios plus one restart persistence check with zero model decision calls. Neither package claims fresh provider discovery or verification of the expanded transaction and loan flows; the final provider attempts for those families were unreliable, while their scripted browser coverage is recorded in [the acceptance checklist](../docs/MVP-ACCEPTANCE.md). Only savings has genuine historical provider evidence.

The local review workspace contains the previously learned savings workflow. A fresh checkout starts with an empty library until discovery or artifact loading. The library and internal API support multiple compatible workflow records, and local tests cover that behavior; the running workspace should not be described as pre-seeding one saved record for each target family.
