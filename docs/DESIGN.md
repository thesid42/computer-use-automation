# Computer-Use Automation Companion — Product and system design

**Status:** final MVP design; fresh verification is tracked in [MVP-ACCEPTANCE.md](MVP-ACCEPTANCE.md).

The product demonstrates the path from a natural-language request to a reusable UI automation. A model discovers a workflow once, the system records a typed capability, and later runs replay that capability without an LLM deciding what to do.

## 1. Product definition

The Automation Companion is a local operator workspace for discovering and reusing automations against a configured back-office application. The operator can start a new discovery, browse run history, open a saved automation, edit its title and description, archive or restore it, and start a typed replay from its detail view. A Needs attention view explains blocked runs and exposes same-session human takeover.

The repository contains two independent applications:

1. legacy-demo/ is a synthetic, server-rendered member-servicing application. It is the target surface and has no dependency on the companion.
2. companion/ is the natural-language workspace, discovery recorder, capability compiler, deterministic replay engine, policy gate, evidence recorder, and handoff controller.

The companion reaches the target through its visible browser UI. The target offers no business API to the companion. The companion does not import target source, read its data store, or use hidden automation hooks. Companion HTTP endpoints are internal workspace/library routes and do not bypass the target UI.

The target currently exposes three supported read-only workflow families:

- savings balance lookup;
- savings transaction history search;
- loan account payoff quote.

The library and artifact contracts can retain more compatible saved workflows, but discovery and adapters support these three families in this MVP. The current main runtime is seeded with one savings-balance record; multi-workflow storage and API behavior are covered by local tests. Unsupported or ambiguous requests stop with clarification rather than inventing a capability.

## 2. Scope and product behavior

The MVP includes:

- a New automation discovery dialog accepting a plain-language goal;
- one configured target profile and one genuine LLM-driven discovery path;
- a durable multi-workflow library with active and archived metadata;
- automation detail showing description, ordered steps, typed inputs and outputs, and a replay form;
- editable title and description, archive, and restore operations;
- deterministic replay through a typed workflow-run endpoint and a local replay CLI;
- searchable run history with result, mode, activity, and redacted evidence;
- a Needs attention view with same-session human takeover and resume;
- policy checks, structured JSONL events, screenshots, and namespaced runtime storage.

A normal natural-language task does not require the operator to choose discovery versus replay. The Goal Controller matches an active compatible workflow when possible and runs discovery on a miss. The automation detail form is the explicit path when the operator already knows which saved workflow to run.

Persistence is local and single-process. Workflow metadata is durable and user-editable. The executable, versioned capability artifact and run evidence live in a separate runtime namespace and are linked by workflow ID/version. Archived workflows remain visible in the library but are excluded from automatic matching and direct replay until restored. A saved workflow record can be restored after restart; an interrupted browser session is not falsely presented as resumable.

## 3. User experience

The workspace has Automations, Run history, and Needs attention navigation, with New automation as the primary action. The New automation dialog asks for a goal while configured application context supplies the target URL and execution mode. The result view leads with the requested balance, transaction rows, payoff amount, or business outcome and keeps technical evidence behind run detail.

The Automations list shows titles, descriptions, compatibility, input/output contracts, active or archived state, and last-run information. The detail view shows ordered steps and locator intent, permits title/description edits, and renders a fresh input form from the typed artifact. Submitting that form calls the selected workflow direct-run endpoint; member IDs and dates are entered for that invocation and are never copied from prior runs into browser storage or metadata.

Run history is searchable by goal, workflow, status, and result text. Opening a run shows execution method, model-call count, typed result or failure, activity events, and available evidence. A run that needs a person carries its intervention reason, current step, latest target screenshot, and control owner. Take control claims the existing target session; Continue returns ownership to automation and causes a fresh observation before any next action.

Loading, empty, running, business-outcome, failure, archived, and human-control states have explicit copy. Status text is present even where color is used, and the layout remains usable with keyboard focus and a narrow viewport.

## 4. Standalone application boundaries

~~~text
+-------------------------------+      browser-visible UI       +-------------------------------+
| companion/                    | -----------------------------> | legacy-demo/                  |
|                               | <----------------------------- |                               |
| discovery and replay          |   rendered pages/screenshots   | server-rendered target UI     |
| workflow library and UI       |                                 | synthetic member records      |
| policy, evidence, handoff     |                                 | session and failure fixtures  |
+-------------------------------+                                 +-------------------------------+
~~~

Each application has its own package, process, tests, and start command. TARGET_URL is configuration. There is no shared database or in-process import between the applications. This boundary exercises the assignment's no-API case: Playwright observes and acts on what a human could see, while the companion's own local API only serves its browser workspace.

## 5. Runtime architecture and local API

The companion is a local Fastify process. Its main components are:

- Goal Controller: validates a plain-language request and chooses an active compatible capability or discovery.
- Discovery runner: performs observe → decide → validate → act against a live browser surface and compiles the verified run.
- Workflow library: stores durable metadata for multiple artifacts, including title, description, archive state, and artifact linkage.
- Replay runner: executes a validated artifact with typed inputs and no model decision calls.
- Policy gate: checks origin, route, action kind, risk, and control ownership before every browser action.
- Evidence and run store: keeps redacted event streams, screenshots, terminal summaries, and searchable run metadata.
- Control lease: pauses automation, transfers the same session to a human, and transfers it back on resume.

Canonical companion endpoints are:

| Endpoint | Purpose |
| --- | --- |
| POST /api/tasks | Start a natural-language task; a miss may run discovery and save a workflow. |
| GET /api/workflows | List durable workflow metadata. |
| GET /api/workflows/:id | Read one workflow's metadata, contract, detail, and recent workflow runs. |
| PATCH /api/workflows/:id | Edit title, description, or archived state. |
| POST /api/workflows/:id/runs | Validate typed inputs and run the selected workflow through direct deterministic replay. |
| GET /api/runs and GET /api/runs/:runId | List/search and inspect redacted run history. |
| GET /api/runs/:runId/events | Read the structured activity feed. |
| intervention routes | Claim, resume, abort, and inspect a same-session intervention. |

The direct workflow-run endpoint accepts an input object such as { "inputs": { "member_id": "12345" } }. It does not call the LLM for decisions. A successful direct replay reports zero model decision calls. These endpoints are local internal APIs for the companion UI and automation library; they do not constitute a target business API.

The SurfaceAdapter seam isolates perception and action from the recorded flow:

~~~ts
interface SurfaceAdapter {
  start(target: TargetProfile): Promise<SessionHandle>;
  observe(session: SessionHandle): Promise<SurfaceSnapshot>;
  resolve(session: SessionHandle, target: TargetSpec): Promise<Resolution>;
  act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult>;
  extract(session: SessionHandle, spec: ExtractionSpec): Promise<unknown>;
  captureEvidence(session: SessionHandle): Promise<EvidenceCapture>;
  bringToHuman(session: SessionHandle): Promise<void>;
  close(session: SessionHandle): Promise<void>;
}
~~~

PlaywrightSurfaceAdapter is the implemented browser adapter. Accessibility, visible-text, frame, image-anchor, Windows UIA, and macOS accessibility adapters can implement the same seam later without changing the artifact action vocabulary.

## 6. Target application and supported workflows

The target is a synthetic legacy-style application with an intentionally dense early-2000s workstation appearance: nested iframe, table-based layouts, small system fonts, numbered fields, blue/gray title strips, square beveled controls, full-page server forms, and a status bar. It has no data-testid attributes or hidden automation API.

The balance path is:

~~~text
Member Search → enter member ID → Search → Member Summary
→ Accounts → Savings Account → Balance Details → Current Balance
~~~

The transaction path follows Savings Account → Transaction History, fills Start Date and End Date, submits Search Transactions, and extracts the rendered Transaction results table. Filtering is inclusive. Reversed or malformed dates return INVALID_DATE_RANGE; a valid range with no rows returns NO_TRANSACTIONS.

The payoff path follows Accounts → Loan Accounts → Auto Loan or Personal Loan → Request Payoff Quote, fills As-of Date, and submits the read-only quote form. The result is Payoff quote review with As-of Date and Payoff Amount. Dates before loan opening or after 2026-12-31 return UNSUPPORTED_AS_OF_DATE; malformed dates return INVALID_AS_OF_DATE; a member without a loan returns NO_LOAN. No payment or account change can be submitted.

Synthetic fixtures include 12345 for the normal paths, 77777 for the bounded transient search retry, and 88888 for same-session supervisor verification and human takeover. 54321 returns PERMISSION_DENIED and unknown IDs such as 40404 return MEMBER_NOT_FOUND. The visible Post Fee control is a read-only policy-denial fixture. These cases demonstrate runtime outcomes; they do not imply support for arbitrary member-servicing tasks or writes.

## 7. Discovery and recording

The model receives a screenshot, URL/title/frame context, visible text, and temporary control references for the current observation. It returns one typed action at a time. Allowed actions are click, fill, selectOption, wait, extract, finish, requestHuman, and a constrained clickPoint fallback. Schema validation, policy, and the control lease run before the adapter acts. A malformed proposal can receive only bounded repair attempts; the model never supplies a persistent selector directly to replay.

Every verified action becomes a sanitized event containing action kind, temporary reference, resolved role/name/text/frame, state fingerprints, outcome, timing where useful, and evidence references. Input provenance is stored as a reference such as fromInput: member_id; concrete member values are not compiled into artifacts. The raw model transcript is not the capability contract.

The provider is one OpenAI-compatible adapter. LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, action mode, and bounded timeout are loaded from environment configuration. The API key is used for the request header only; it is not written to workflow metadata, artifacts, run events, screenshots, or summaries. Offline mode injects a scripted model/surface for deterministic local demonstrations and tests and is kept in a separate namespace from live artifacts.

## 8. Capability artifact

The versioned artifact is the executable contract linked from a workflow library record. It contains:

- schemaVersion, capabilityId, semantic version, and application compatibility;
- an intent signature used for conservative natural-language matching;
- typed input declarations and validation, including member_id identifiers and ISO dates;
- typed outputs, such as USD money or a rendered transaction result;
- expected business outcomes and risk/policy profile;
- ordered actions with preconditions, postconditions, explicit waits, and bounded retries;
- ordered target strategies (role/name, label, visible text, relative text, frame path/URL, constrained fingerprint, or visual anchor where an adapter implements it);
- extraction rules and a final checkpoint.

The library owns human-facing metadata such as title, description, active/archive state, and last-run references. The artifact remains schema-validated, versioned runtime data. Separating those concerns lets an operator improve discoverability without silently changing a recorded action sequence.

Replay resolves strategies in a fixed order and requires exactly one acceptable match. Ambiguity, unsupported strategy fallback, and a missing target are errors. Absolute coordinates are not a normal replay locator.

## 9. Replay and result contract

For each replay step the runner validates the artifact and typed inputs, verifies automation owns the session, checks the precondition, resolves one target, applies policy, acts, waits, verifies the postcondition, detects declared outcomes, and records evidence. It has no LLM dependency. The final output is returned only after the final checkpoint is verified.

The result is one of:

~~~ts
type RunResult =
  | { status: 'succeeded'; outputs: Record<string, unknown>; checkpointVerified: true }
  | { status: 'business_outcome'; code: string; details?: Record<string, unknown> }
  | { status: 'needs_human'; interventionId: string; reason: string; stepId: string }
  | { status: 'failed'; error: RunFailure };
~~~

MEMBER_NOT_FOUND, PERMISSION_DENIED, ACCOUNT_NOT_FOUND, NO_TRANSACTIONS, NO_LOAN, INVALID_DATE_RANGE, INVALID_AS_OF_DATE, and UNSUPPORTED_AS_OF_DATE are caller-visible target outcomes where declared by the workflow. A transient load, harmless known interstitial, stale observation, or bounded slow response may be retried according to the artifact. An invalid invocation, ambiguous target, unexpected dialog, exhausted recovery, checkpoint mismatch, extraction error, browser failure, or policy violation stops with the step, expected state, observed state, and evidence reference.

## 10. Heterogeneity and tenant reuse

The artifact expresses intent and control behavior independently of how a surface is perceived. A browser adapter can resolve role/name, label, visible text, frames, or visual anchors; a legacy browser or desktop adapter can map the same action contract to accessibility or OS-native controls. The artifact does not assume a clean DOM or a target API.

At larger scale, a library record would be scoped to an application family and tenant policy, while a tenant profile supplies base URL, branding aliases, version fingerprints, permissions, and narrowly scoped locator overrides. A shared artifact can be selected only when the target fingerprint is compatible. A mismatch creates a review or a specialized version; it never silently rewrites the shared artifact. This repository implements one target profile and three read-only workflow families, so tenant registry, cross-tenant rollout, and desktop adapters remain design seams rather than delivered infrastructure.

## 11. Safety and human handoff

Discovery and replay share the same policy gate. It allowlists origins and routes, allowed action kinds, a maximum risk class, and the current control owner. Actions are classified as READ_ONLY, REVERSIBLE_WRITE, or IRREVERSIBLE_WRITE. The demonstrated workflows are read-only, and the visible Post Fee action is denied before it can change the target.

The control state is explicit:

~~~text
AUTOMATION_CONTROL → INTERVENTION_OPEN → HUMAN_CONTROL
                                      ↘ AUTOMATION_CONTROL | ABORTED
~~~

When the runner is stuck, sees a required supervisor decision, or cannot safely recover, it pauses and records the run, capability, step, reason, state summary, current control owner, and a screenshot. The operator claims the lease, and the headed browser page already used by the runner is brought forward. Human click/change/navigation events are recorded with values redacted. Continue returns the lease to automation and forces a fresh observation; Abort closes the session safely. The local UI is a minimal operator surface, not a remote co-browsing product.

All target records and packaged screenshots are synthetic. Keys belong in ignored environment files. Operational member identifiers and entered input values are masked in user-visible activity; the rendered transaction result retains its business dates so the operator can verify the filtered ledger. Artifacts store input references, not raw values; and hidden chain-of-thought is not persisted. Runtime, workflow metadata, and offline namespaces keep scripted artifacts separate from live execution and keep credentials out of artifacts and logs.

## 12. Verification and evidence

The repository preserves the original sanitized package under [evidence/](../evidence/), including a genuine provider-backed discovery summary, a compiled artifact, a zero-LLM replay, and a MEMBER_NOT_FOUND replay. That package records the 2026-09-10 OpenRouter run and contains no key or raw credentials. It is historical evidence for the discovery/replay vertical slice; it does not claim current coverage of the three expanded target workflows or library edit routes. Run the final-checkout commands in [MVP-ACCEPTANCE.md](MVP-ACCEPTANCE.md) before recording current pass status.

The frozen local checks report 21/21 legacy target tests, 71/71 companion tests, passing root typecheck and build, and 2/2 scripted browser workflow tests. These checks do not represent fresh provider-backed discovery. The final transaction and loan provider attempts were unreliable: transaction JSON failed after 16 calls at the progress bound, a tool-retry run failed after 2 calls on unsupported or missing tool-call output, loan JSON reached Loan Accounts after 8 calls before a 60-second timeout, an improved-prompt transaction run failed after 12 calls during malformed action repair, and a same-Nano standard-route attempt returned HTTP 404 after one call. Only savings retains genuine historical provider evidence. The reproducible commands are:

~~~bash
npm test
npm run typecheck
npm run build
npm run test --prefix companion -- test/playwright-workflows.test.ts
~~~
