# MVP Acceptance Checklist

This checklist maps the assignment requirements to the current product contracts and the frozen local validation. The reported local checks are legacy-demo 21/21, companion 71/71, root typecheck passing, root build passing, and the scripted real-browser transaction/loan harness 2/2. Provider-backed discovery status is tracked separately below; the original sanitized provider evidence remains under evidence/ and is not presented as proof of expanded-flow provider coverage.

| Requirement | Implementation and evidence | Status |
| --- | --- | --- |
| Submit a natural-language goal | New automation dialog and POST /api/tasks; active workflow matching or discovery | Measured in companion 71/71; fresh provider discovery is not verified (see Provider status) |
| Discover an unseen workflow with a real vision-capable model | OpenAI-compatible model adapter plus Playwright visible-UI adapter; historical [discovery summary](../evidence/discovery-success/summary.json) | Historical savings evidence retained; fresh expanded-flow provider discovery was not reliable |
| Support the three bounded read-only target workflows | Savings balance; transaction search with Start Date/End Date and Transaction results; loan list/detail/payoff quote with As-of Date | Measured in target 21/21 and scripted browser harness 2/2; expanded flows are not provider-verified |
| Compile a typed, versioned, reviewable artifact | capabilitySchema/compiler with typed inputs, outputs, actions, locators, outcomes, policy, checkpoints; strict invalid compilation returns CAPABILITY_COMPILE_INVALID; [historical example artifact](../evidence/example-capability.json) | Measured in companion 71/71; expanded-flow provider verification was not achieved |
| Keep input values out of saved artifacts | Action values use input references; fresh member/date values are collected per run and redacted from metadata/evidence | Measured in companion 71/71 and scripted browser harness 2/2 |
| Persist a reusable multi-workflow library | Durable workflow metadata under the runtime workflow namespace, linked to versioned artifacts; GET /api/workflows and GET /api/workflows/:id | Measured in companion 71/71; the current main runtime seeds one balance workflow, with multi-workflow behavior covered by tests and API contracts |
| Edit and archive library metadata | PATCH /api/workflows/:id supports title, description, archived; archived workflows remain visible and are excluded from matching/direct run | Measured in companion 71/71 |
| Replay directly with typed inputs and no LLM decisions | POST /api/workflows/:id/runs validates { inputs }, refuses archived records, and invokes deterministic replay with llmCalls: 0 | Measured in companion 71/71 and savings runtime verification |
| Return typed outputs and verify checkpoints | Money output for balance/payoff; rendered transaction result; final checkpoints in the artifact/result contract | Measured in target 21/21 and scripted browser harness 2/2 |
| Distinguish business outcomes, recoveries, and failures | MEMBER_NOT_FOUND, PERMISSION_DENIED, NO_TRANSACTIONS, NO_LOAN, invalid/unsupported date outcomes; bounded transient retry; structured hard failures | Measured in target 21/21 and companion 71/71 |
| Enforce safety policy | Origin/route/action/risk/control-owner gate; read-only workflows; visible Post Fee action blocked; no target API or hidden hooks | Measured in companion 71/71 and target 21/21 |
| Show progress and searchable history | Async run IDs, run detail/activity, newest-first searchable history, durable terminal summaries and redacted JSONL | Measured in companion 71/71 |
| Escalate and hand off the live session | Needs attention page, intervention screenshot/context, control lease, same headed session, redacted human events, resume/abort | Measured in companion 71/71 and savings runtime verification |
| Keep runtime metadata and execution namespaces separate | Workflow metadata, versioned artifacts, run evidence, and live/offline namespaces are persisted separately; incompatible/corrupt data is ignored | Measured in companion 71/71 |
| Run target and companion independently | Separate package/process/start commands; browser-visible UI boundary | Measured in target 21/21 and scripted browser harness 2/2 |
| Preserve legacy target constraints | Early-2000s dense UI with nested iframe, tables, server forms, synthetic fixtures, and no hidden target business API | Measured in target 21/21 |

## Verification commands

From the repository root:

~~~bash
npm run install:all
npm exec --prefix companion playwright install chromium
npm test
npm run typecheck
npm run build
npm run test --prefix companion -- test/playwright-workflows.test.ts
~~~

## Frozen local validation

The final backend validation reported legacy-demo 21/21 tests passing, companion 71/71 tests passing, root typecheck passing, and root build passing. It includes strict compilation rejection as CAPABILITY_COMPILE_INVALID, compact redacted LLM action memory, and a bounded discovery guard whose default is 300 seconds and whose limit is configurable with DISCOVERY_MAX_ELAPSED_MS. The focused scripted real-browser harness for the transaction and loan workflows passed 2/2. These are local deterministic checks; they do not represent fresh provider-backed discovery.

## Provider status

No new workflow family completed reliable genuine provider discovery. The first transaction JSON run failed after 16 model calls after wandering into the progress bound. A tool-retry transaction run failed after 2 calls because the provider emitted unsupported or missing tool-call output. The loan JSON run reached Loan Accounts after 8 calls and then hit the 60-second provider timeout. The final transaction JSON run with the improved prompt reached 12 calls and failed on malformed action repair. A same-Nano standard-route attempt returned HTTP 404 after one call. The transaction and loan flows are validated by the scripted real-browser harness, but they are not provider-verified. Only savings retains genuine historical provider evidence; the current runtime repeat check is separately recorded in [savings runtime verification](../evidence/savings-runtime-verification.json).

A provider key is needed only for a new live discovery. Copy companion/.env.example to companion/.env if that ignored file does not exist, then add the user-provided key. The companion process loads that package-local file through dotenv whether it is started from the repository root or from companion/. The key is used only for the provider request header and is not written to workflow metadata, artifacts, evidence, or logs. Offline mode and deterministic direct replay do not require a provider key.

The target workflow fixtures and exact UI labels are documented in [legacy-demo/README.md](../legacy-demo/README.md). The packaged evidence links above are sanitized and repository-relative. They preserve the original live discovery, zero-LLM replay, and MEMBER_NOT_FOUND replay. The separate [savings runtime verification](../evidence/savings-runtime-verification.json) records five direct replay/handoff scenarios plus one restart persistence check; it does not assert current expanded-flow or fresh provider-discovery results.
