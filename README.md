# Computer-Use Automation System

This repository is a small record-once, replay-many automation companion for a synthetic legacy member-servicing workstation. The operator writes an ordinary-language request in the companion. A request without a compatible saved workflow can be discovered by a model operating the target through Playwright. The verified actions become a typed capability artifact and a durable library record. Later requests use the saved artifact and replay deterministically, without a model choosing each action.

The target is deliberately a separate application. The companion imports no target source or data and calls no target business API; it reaches the target only through its configured, browser-visible URL. Both applications contain synthetic records and read-only workflows.

## Applications and evidence

- [legacy-demo/](legacy-demo/) is the standalone early-2000s-style target on port 3001. It uses nested frames, server-rendered forms, dense tables, and visible workstation navigation.
- [companion/](companion/) is the request workspace, discovery/replay engine, workflow library, policy gate, evidence recorder, and human-handoff controller on port 3000.
- [REPORT.md](REPORT.md) is the required short design report with the seven required sections.

The submission keeps one current live service-request discovery package plus a deterministic changed-input replay:

- [compiled capability](evidence/capability.json)
- [discovery log](evidence/discovery.json)
- [final replay log](evidence/replay.json)
- [handoff summary](evidence/handoff-summary.json)
- [discovery result screenshot](evidence/screenshots/discovery-result.png), [recovery screenshot](evidence/screenshots/replay-recovery.png), and [replay result screenshot](evidence/screenshots/replay-result.png)

The discovery used `nex-agi/nex-n2.5-mini:free` with grounded accessibility observation. It learned the member service-request path for member 12345, including the address-update and card-delivery rows. The retained replay changed the member to 77777, recovered from one transient search failure, and returned the statement-copy request with zero model decision calls. Savings and branch workflows were also learned previously; their redundant evidence packages are omitted. Transaction and loan workflows have scripted browser coverage. The four workflows reserved below remain unlearned in the local library.

## Prerequisites and install

Use Node.js 22+, npm, and Chromium installed for Playwright. A provider key is needed only for a new live discovery; offline mode, deterministic replay, and tests do not need one.

From the repository root:

~~~bash
npm run install:all
npm exec --prefix companion playwright install chromium
~~~

The first command installs both application packages. The second installs the browser used by the live Playwright adapter.

## Configure live discovery

The companion loads `companion/.env` through dotenv. Create the ignored file from the checked-in example, then add a user-provided key:

~~~powershell
if (!(Test-Path companion/.env)) { Copy-Item companion/.env.example companion/.env }
~~~

~~~dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=replace-with-your-provider-key
LLM_MODEL=nex-agi/nex-n2.5-mini:free
LLM_ACTION_MODE=tool
LLM_RESPONSE_FORMAT=none
LLM_OBSERVATION_MODE=accessibility
LLM_TIMEOUT_MS=45000
DISCOVERY_MAX_ELAPSED_MS=300000
TARGET_URL=http://127.0.0.1:3001
~~~

Discovery is bounded to 300 seconds by default; `DISCOVERY_MAX_ELAPSED_MS` accepts 30–600 seconds. The API key is used only in the provider authorization header. Never put it in an artifact, evidence file, or log.

## Run the two applications

Start each process in its own terminal:

~~~bash
# terminal 1
npm run legacy

# terminal 2
npm run companion
~~~

Open `http://127.0.0.1:3000`. The target is `http://127.0.0.1:3001` unless `TARGET_URL` points to another compatible browser-visible target. Use the companion's **New request** box for live discovery; a successful unfamiliar request reports its progress and saves an automation. A matching request replays the saved artifact against the configured target.

For a deterministic demonstration without a provider or live target browser:

~~~powershell
$env:OFFLINE_DEMO='1'
npm run companion
~~~

Offline and live runtime namespaces are separate.

## Demo prompts and target surface

Paste one of these into **New request**:

~~~text
Look up member 12345 and tell me their current savings balance.
Find transactions for member 12345 from 2026-09-01 through 2026-09-11 and show the filtered results.
Get an as-of 2026-09-30 payoff quote for member 12345's auto loan.
Show service requests for member 12345.
Find branches matching Northside.
~~~

The target's main synthetic fixtures are member 12345 (Jordan Lee, savings balance $1,250.42, Auto Loan), member 77777 (Casey Morgan, first search temporarily fails and then succeeds through **Retry Search**), and member 88888 (visible supervisor verification in the same session). Member 40404 returns `MEMBER_NOT_FOUND`; member 54321 returns `PERMISSION_DENIED`. Empty and invalid date searches return `NO_TRANSACTIONS` or `INVALID_DATE_RANGE`; payoff requests return `NO_LOAN`, `INVALID_AS_OF_DATE`, or `UNSUPPORTED_AS_OF_DATE`. The visible **Post Fee** control is a read-only policy-denial fixture.

The workstation exposes these visible destinations:

| Destination | Route | Inputs or result |
| --- | --- | --- |
| Member search and summary | `/servicing` and `/servicing/member/:memberId/summary` | Member ID; accounts and member context |
| Member and account overview | `/servicing/overview` | Member ID or exact name |
| Service requests | `/servicing/service-requests` | Optional member/name and status filters |
| Branch directory | `/servicing/branch-directory` | Branch or city filter |
| Savings transactions | `/servicing/member/:memberId/accounts/savings/transactions` | Inclusive start and end dates |
| Loan payoff | `/servicing/member/:memberId/accounts/loans/:loanId/payoff-quote` | As-of date; read-only quote |
| Teller totals | `/servicing/teller-totals` | Drawer totals and transaction counts |

Four useful workflows remain reserved for future user-led discovery tests. They are prompts, not pre-seeded capabilities:

| Workflow | Prompt | Check |
| --- | --- | --- |
| Transaction history | `Find transactions for member 12345 from 2026-09-01 to 2026-09-11.` | September 3, 7, and 10 rows only |
| Loan payoff quote | `Get the loan payoff quote for member 12345 as of 2026-09-30.` | Read-only quote of $18,968.53 dated September 30 |
| Member/account overview | `Show the member and account overview for member 12345.` | Jordan Lee and available savings/loan accounts |
| Teller totals | `Show the teller drawer totals.` | Opening cash $12,000.00 and expected cash $14,654.50 |

For each reserved test, verify the returned data and final checkpoint. A successful first run should create a library record; an incomplete or failed discovery must not create one. Change a member or date range for the replay check and expect zero action-model and intent-model calls for an exact saved-workflow request.

## Run a goal, then replay the learned artifact

With both apps running in live mode, run these commands in PowerShell. On a fresh checkout the first request performs real discovery; if the workflow is already saved locally, it replays instead. The second invocation uses the artifact saved by that run, with a different member input.

~~~powershell
$base = 'http://127.0.0.1:3000'
$task = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json' -Body '{"goal":"Show service requests for member 12345"}'
$run = Invoke-RestMethod -Uri "$base/api/runs/$($task.runId)"
$run | ConvertTo-Json -Depth 8
if ($run.status -ne 'succeeded') { throw 'Discovery did not succeed; inspect the run before replaying.' }
$workflowId = $run.workflowId
$repeat = Invoke-RestMethod -Method Post -Uri "$base/api/workflows/$workflowId/runs" -ContentType 'application/json' -Body '{"inputs":{"member_id":"77777"}}'
Invoke-RestMethod -Uri "$base/api/runs/$($repeat.runId)" | ConvertTo-Json -Depth 8
~~~

Expect `mode: discovery` on the first fresh run, and `mode: replay`, `llmCalls: 0`, a verified checkpoint, and the statement-copy row on the second. The 77777 replay exercises the visible transient-error recovery. These requests use the companion API; all interaction with the target still happens through its browser UI.

## Replay the packaged example

The retained capability is replayable against the running target without a provider key or ignored runtime artifact. Run this command from the repository root; npm executes the script inside `companion/`, so the artifact path starts with `../`:

~~~bash
npm run replay --prefix companion -- --artifact ../evidence/capability.json --input member_id=12345 --target http://127.0.0.1:3001 --headless
~~~

The command prints one JSON result and exits nonzero for invalid artifacts, browser failures, policy failures, or other hard replay errors. The detail page's free-text run box uses the same selected workflow context while collecting fresh values for each run. The API-level typed route remains available for direct integrations.

## Internal companion API

The local workspace routes are:

- `POST /api/tasks` with `{ "goal": "..." }`; clarification answers add `conversationId`, and a selected saved workflow adds `context: { "source": "saved_automation", "workflowId": "..." }`.
- `GET /api/workflows` and `GET /api/workflows/:id` for the durable library and validated artifact.
- `PATCH /api/workflows/:id` for title, description, and archive state.
- `POST /api/workflows/:id/runs` with `{ "inputs": { ... } }` for typed deterministic replay.
- `GET /api/runs`, `GET /api/runs/:runId`, and `/api/runs/:runId/events` for searchable redacted history.
- Intervention routes for screenshot, claim, resume, abort, and human-action evidence.

These are companion workspace routes. The target remains browser-only.

## Verify

~~~bash
npm test
npm run typecheck
npm run build
~~~

The last code validation passed 24/24 legacy target tests, 103/103 companion tests (including three browser workflow tests), root typecheck, and build. This submission cleanup changes documentation and packaged evidence only. The evidence files contain synthetic target data; screenshots show those synthetic records. Intermediate screenshot references were pruned and retained references are relative to `evidence/`, as recorded in each log's packaging note.
