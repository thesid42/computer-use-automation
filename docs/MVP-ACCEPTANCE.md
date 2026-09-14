# MVP Acceptance Checklist

This checklist maps the assignment requirements to the current product contracts and the frozen local validation. The reported local checks are legacy-demo 24/24, companion 103/103, root typecheck passing, root build passing, and the scripted real-browser transaction/loan harness 2/2. Provider-backed discovery status is tracked separately below; the original sanitized provider evidence remains under evidence/ and is not presented as proof of expanded-flow provider coverage.

| Requirement | Implementation and evidence | Status |
| --- | --- | --- |
| Submit a natural-language goal | Request-first composer and Teach a task dialog; POST /api/tasks; active workflow matching or discovery | Covered by the real browser UI tests; fresh provider discovery is tracked separately (see Provider status) |
| Clarify missing request details | Server returns { status: "needs_input", message, conversationId }; the next answer resumes the same request | Covered by the real server/browser conversation test |
| Discover an unseen workflow with a real model through visible UI observation | OpenAI-compatible model adapter plus Playwright visible-UI adapter; grounded DOM/accessibility observation by default and optional screenshots; historical [discovery summary](../evidence/discovery-success/summary.json) | Fresh Nex evidence verifies service-request and branch-directory discovery; transaction and loan provider coverage is not claimed |
| Support bounded read-only target workflows | Savings balance; transaction search with Start Date/End Date; loan payoff with As-of Date; member/account overview; service requests filtered by member/status; branch directory filtered by city | Measured by target tests and scripted browser coverage; fresh provider discovery is not asserted |
| Compile a typed, versioned, reviewable artifact | capabilitySchema/compiler with typed inputs, outputs, actions, locators, outcomes, policy, checkpoints; strict invalid compilation returns CAPABILITY_COMPILE_INVALID; [current compiled artifacts and verification](../evidence/live-learning/final-verification-summary.json) | Measured in companion 103/103 and live branch/service discovery and replay |
| Keep sensitive run inputs out of compiled artifacts and redact persisted execution fields | Action values use input references; fresh member/date values are collected per run, sensitive event fields are redacted, and declared result data may remain for verification | Measured in companion 103/103 and scripted browser harness 2/2 |
| Persist a reusable multi-workflow library | Durable workflow metadata under the runtime workflow namespace, linked to versioned artifacts; GET /api/workflows and GET /api/workflows/:id | Measured in companion 103/103; the current main runtime retains a historically learned balance artifact for local review and does not seed production recipes |
| Edit and archive library metadata | PATCH /api/workflows/:id supports title, description, archived; archived workflows remain visible and are excluded from matching/direct run | Measured in companion 103/103 |
| Replay directly with typed inputs and no LLM decisions | POST /api/workflows/:id/runs validates { inputs }, refuses archived records, and invokes deterministic replay with llmCalls: 0; the everyday UI uses a free-text request with selected workflow context | Covered by companion tests and savings runtime verification |
| Return typed outputs and verify checkpoints | Money output for balance/payoff; rendered transaction result; final checkpoints in the artifact/result contract | Measured in target 24/24 and scripted browser harness 2/2 |
| Distinguish business outcomes, recoveries, and failures | MEMBER_NOT_FOUND, PERMISSION_DENIED, NO_TRANSACTIONS, NO_LOAN, invalid/unsupported date outcomes; bounded transient retry; structured hard failures | Measured in target 24/24 and companion 103/103 |
| Enforce safety policy | Origin/route/action/risk/control-owner gate; read-only workflows; visible Post Fee action blocked; no target API or hidden hooks | Measured in companion 103/103 and target 24/24 |
| Show progress and searchable history | Async run IDs, run detail/activity, newest-first searchable history, durable terminal summaries and redacted JSONL | Measured in companion 103/103 |
| Escalate and hand off the live session | Needs attention page, intervention screenshot/context, control lease, same headed session, redacted human events, resume/abort | Measured in companion 103/103 and savings runtime verification |
| Keep runtime metadata and execution namespaces separate | Workflow metadata, versioned artifacts, run evidence, and live/offline namespaces are persisted separately; incompatible/corrupt data is ignored | Measured in companion 103/103 |
| Run target and companion independently | Separate package/process/start commands; browser-visible UI boundary | Measured in target 24/24 and scripted browser harness 2/2 |
| Preserve legacy target constraints | Early-2000s dense UI with nested iframe, tables, server forms, discoverable workstation options, synthetic fixtures, and no hidden target business API | Measured by target tests |

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

The latest focused local checks cover the legacy target's workstation options and read-only filters, the request-first companion UI, archive/restore lifecycle, mobile layout, and a real server clarification round trip. The current configured-target UI also completed a clarified savings request in run `run-6ca54dd4-05a7-49f3-94fc-b87b28ea4031`, returning `$1250.42` with `checkpointVerified: true`; it resumed through replay with zero decision-model calls. The repository's broader typecheck, build, and replay checks should be rerun from the final checkout because backend source may evolve independently. These are local deterministic checks; they do not represent fresh provider-backed discovery.

## Provider status

Fresh Nex evidence is verified for two bounded, read-only families with changed inputs: [service-request discovery for member 12345](../evidence/live-learning/show-service-requests-for-member-12345.json) succeeded with the address-update and card-delivery rows; [the 77777 replay](../evidence/live-learning/show-service-requests-for-member-77777.json) returned the statement-only business outcome with a bounded retry, `checkpointVerified: true`, and zero LLM/intent calls. [Northside branch discovery](../evidence/live-learning/find-branches-matching-northside.json) and [Lakeside branch replay](../evidence/live-learning/find-branches-matching-lakeside.json) also succeeded with verified checkpoints. The current configured model is `nex-agi/nex-n2.5-mini:free` with `LLM_OBSERVATION_MODE=accessibility`; screenshots remain local evidence. Transaction and loan flows are validated by the scripted real-browser harness, but they have no current provider claim. Historical Nano attempts remain listed in [the expanded discovery report](../evidence/expanded-discovery-attempts.json) for context. The current main runtime should not be described as having every target family learned.

A provider key is needed only for a new live discovery. Copy companion/.env.example to companion/.env if that ignored file does not exist, then add the user-provided key. The companion process loads that package-local file through dotenv whether it is started from the repository root or from companion/. The key is used only for the provider request header and is not written to workflow metadata, artifacts, evidence, or logs. Offline mode and deterministic direct replay do not require a provider key.

The target workflow fixtures and exact UI labels are documented in [legacy-demo/README.md](../legacy-demo/README.md). The packaged evidence links above are sanitized and repository-relative. They preserve the original live discovery, zero-LLM replay, and MEMBER_NOT_FOUND replay. The separate [savings runtime verification](../evidence/savings-runtime-verification.json) records five direct replay/handoff scenarios plus one restart persistence check; it does not assert current expanded-flow or fresh provider-discovery results.
