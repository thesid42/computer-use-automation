# Computer-Use Automation Companion — Design

**Status:** MVP revision in implementation; acceptance requires live evidence  
**Audience:** Engineering reviewers and implementers  
**Primary goal:** Demonstrate an LLM discovering an unseen UI workflow once, compiling the verified run into a typed capability, and replaying it deterministically without an LLM.

## 1. Product definition

The deliverable is a local **Automation Companion** that an operator can return to throughout the day. It keeps completed runs and a learned workflow available across restarts, shows progress while work happens, and makes blocked work actionable. An end user enters a natural-language request for the configured back-office application, such as:

> Look up member 12345 and tell me their current savings balance.

The user does not provide selectors, parameter declarations, output schemas, model settings, URLs, or a choice between discovery and replay. The system derives those implementation details internally.

The MVP contains two independently runnable applications:

1. **`legacy-demo/`** — a standalone, synthetic, legacy-style member-servicing application. It is the target surface and knows nothing about the automation system.
2. **`companion/`** — a standalone natural-language companion, discovery recorder, deterministic replay engine, policy gate, evidence recorder, and human-handoff UI. It knows the target only through configuration and browser-visible behavior.

They communicate only through the legacy application's browser UI over HTTP. The companion must not import legacy-demo code, read its data store, call hidden business APIs, or depend on its implementation details.

## 2. Scope

### In scope

- One natural-language front door in a local web companion.
- One configured target application profile.
- One learned capability: `member.lookup-savings-balance`.
- A real LLM-driven observe → decide → act discovery run.
- Screenshot plus accessibility/visible-control observations.
- Policy validation before every browser action.
- A typed, versioned, reviewable JSON capability artifact.
- Deterministic replay with no LLM calls.
- Typed outputs and explicit business, recoverable, and hard-failure results.
- Structured JSONL evidence and screenshots.
- Same-session human takeover, control ownership, and resume.
- A credible adapter seam for future browser/desktop surfaces and tenant variants.

### Explicitly out of scope

- Real banking systems, credentials, or PII.
- A public capability catalog or external agent-facing API.
- Code generation from artifacts.
- Formal draft/approved confidence lifecycle.
- LLM-assisted replay recovery.
- A second tenant implementation or cross-tenant demonstration.
- Repeated-run stability dashboards.
- Remote desktop/co-browsing infrastructure.
- Desktop automation implementation.
- Queues, clusters, distributed workers, or production authentication/RBAC.
- Irreversible financial transactions.

## 3. User experience

### Product correction: a reusable workspace

The original one-form page is insufficient for repeat use. The MVP must make three activities obvious: start a task, revisit a run, and reuse a learned workflow. The companion is an operator workspace with functional navigation, not a developer console or a dashboard of invented statistics.

- **New task:** one prominent goal composer and configured application context. The context API supplies the offline/live mode and provider-readiness fields; a successful task shows the requested balance first.
- **Run history:** browse previous completed tasks, select a run, and inspect its result, execution method, and activity. History survives a process restart. Sensitive inputs are masked; reusing a workflow asks for a fresh member identifier rather than storing the previous identifier in browser storage.
- **Learned workflow:** a plain-language description of the saved capability, its input and output contract, and a way to start another task. The schema-validated technical artifact is available through the read-only `/api/workflow` endpoint and the namespaced runtime file; the workspace keeps it out of the primary task flow. This is the local operator's saved workflow view, not the optional external capability marketplace/API.
- **Needs attention:** an interrupted run shows the reason, current step, screenshot, and current control owner. Take Control and Continue are available only in the appropriate state. The original session is retained until completion or abort.

Run progress must update before completion. Each submission receives its own run ID, so an unresolved run remains pollable while another task is submitted. Network errors preserve the current run so the user can recover the view without resubmitting the automation. Loading, empty, running, business outcome, failure, and human-control states each have deliberate presentation. Color supplements status text; keyboard focus, labels, and narrow-screen layouts remain usable.

Persistence is intentionally local and single-process. Terminal run summaries and redacted JSONL events are restored from disk; a crashed browser session is not represented as resumable after restarting the application. Offline scripted artifacts and evidence are isolated from live execution so a demonstration cannot silently become a purported real learned workflow.

### 3.1 Launch

The user runs:

```bash
npm run companion
```

The command starts the companion server and prints its local URL. The operator opens that URL in a browser. Each application retains its own package, scripts, configuration, and process.

### 3.2 Natural-language task

The companion shows the configured app context and one prompt field:

```text
Connected: Demo Credit Union · Member Servicing

What would you like me to do?
[ Look up member 12345 and tell me their savings balance. ] [Run]
```

The target application is selected by an application profile, not encoded in the user's prompt. With multiple applications, a normal app selector could set that profile.

### 3.3 Discovery versus replay

The Goal Controller checks saved capability signatures before execution:

- Exactly one safe capability match with valid slot extraction → deterministic replay.
- No match → LLM discovery.
- Ambiguous match or missing information → ask a plain-language clarification.

The user does not choose the execution mode.

### 3.4 Result

The primary response is the requested result:

```text
Current savings balance: $1,250.42
```

After a new discovery, the UI may add:

```text
I completed this as a new workflow and saved it for reuse.
Learned: Look up a member's savings balance
Reusable input: Member ID
Returns: Current savings balance
```

The technical artifact remains available through `GET /api/workflow` and in the namespaced artifact directory.

## 4. Standalone application boundaries

```text
+-------------------------------+      browser-visible HTTP only      +-------------------------------+
| companion/                    | ----------------------------------> | legacy-demo/                  |
|                               |                                     |                               |
| Natural-language UI           | <---------------------------------- | Server-rendered legacy UI     |
| Goal controller               |       screenshots / visible state   | Synthetic member data         |
| Discovery + replay            |                                     | Runtime failure scenarios     |
| Policy + evidence             |                                     | Session state                 |
| Human control lease           |                                     | No automation imports/hooks   |
+-------------------------------+                                     +-------------------------------+
```

### Decoupling invariants

- Separate `package.json`, TypeScript configuration, tests, and start commands.
- No workspace-level source imports between applications.
- No shared database or shared in-process memory.
- Companion target URL is supplied by configuration.
- Companion discovers controls from the rendered surface; it does not use demo-specific test IDs.
- The demo can be opened and operated manually without the companion.
- The companion can start against another compatible URL without rebuilding the demo.

## 5. Proposed repository structure

```text
/
  README.md
  REPORT.md
  package.json                    # convenience scripts only
  docs/
    DESIGN.md
  legacy-demo/
    package.json
    tsconfig.json
    src/
    test/
    README.md
  companion/
    package.json
    tsconfig.json
    src/
      app/                        # web companion routes and assets
      domain/                     # contracts, result taxonomy, run state
      goal/                       # intent inference and capability matching
      discovery/                  # observe-decide-act loop
      replay/                     # deterministic executor
      surface/                    # SurfaceAdapter and Playwright adapter
      policy/                     # allowlist and risk gate
      artifact/                   # schema and compiler
      evidence/                   # JSONL and screenshots
      handoff/                    # lease and intervention flow
      llm/                        # OpenAI-compatible provider adapter
    test/
    config/
      demo-app.json
    README.md
  artifacts/
  evidence/
```

## 6. Target application: legacy-demo

The demo is a small server-rendered application with stable but intentionally imperfect markup:

- table-based navigation and result layouts,
- a nested iframe for the servicing area,
- no `data-testid` attributes,
- labels and visible text that a human can understand,
- synthetic data only.

### Happy path

```text
Home
 → Member Search
 → enter member ID
 → Search
 → open matching result
 → Member Summary
 → Accounts tab
 → select Savings Account
 → Balance Details
 → extract Current Balance
```

### Scenario coverage

- `12345`: success.
- unknown identifier: `MEMBER_NOT_FOUND` business outcome.
- a seeded identifier: permission denied business outcome.
- a seeded transient condition: one bounded retry succeeds.
- a seeded supervisor-verification state: human intervention required.
- a visible risky action such as “Post Fee”: blocked by the read-only companion policy.

Scenario values are synthetic fixtures. They are not exposed to the discovery model as hidden instructions.

## 7. Internal goal interpretation

For the single-workflow MVP, a conservative deterministic interpreter converts the user utterance into a provisional internal intent. This keeps repeated invocations independent of model availability. Broader intent interpretation is deferred; unsupported goals receive clarification rather than a fabricated workflow. For example:

```json
{
  "objective": "lookup_member_savings_balance",
  "entities": [
    {
      "proposedName": "member_id",
      "value": "12345",
      "sourceSpan": "member 12345",
      "type": "string",
      "sensitivity": "member_identifier"
    }
  ],
  "requestedOutputs": [
    {
      "proposedName": "current_savings_balance",
      "type": "money",
      "currency": "USD"
    }
  ],
  "risk": "read_only"
}
```

This structure is generated and validated internally. The user never authors it.

### Inference rules

- Concrete values must cite an exact source span from the user's utterance.
- Identifiers remain strings, even when numeric-looking.
- The compiler generalizes only values linked to user-input provenance and verified UI actions.
- Constraints remain conservative; one five-digit sample does not prove every valid member ID has five digits.
- Missing or ambiguous information produces a natural-language clarification.

## 8. Discovery model

### Initial model

Use NVIDIA NIM with:

```text
model: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
base URL: https://integrate.api.nvidia.com/v1
```

If live evaluation shows unreliable screenshot grounding or tool output, switch configuration to OpenRouter `qwen/qwen3-vl-30b-a3b-instruct`; Fireworks `accounts/fireworks/models/qwen3p7-plus` is a further manual alternative.

The implementation uses one OpenAI-compatible client configured by:

```env
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

No automatic provider/model switching occurs inside a run. Every discovery log records the exact provider endpoint, model ID, and non-secret generation settings.

## 9. Observe → decide → validate → act loop

```text
SurfaceSnapshot
  screenshot
  URL/title/frame path
  temporary interactable refs
  visible text/dialogs
        |
        v
Discovery model
  returns exactly one typed action
        |
        v
Schema validation
        |
        v
Policy and ownership gate
        |
        v
SurfaceAdapter action
        |
        v
Verified RunEvent + fresh observation
```

### Allowed discovery commands

- `click(ref)`
- `fill(ref, value | inputReference)`
- `selectOption(ref, option)`
- `wait(condition)`
- `extract(ref, parseAs)`
- `finish(outputs, checkpoint)`
- `requestHuman(reason)`
- `clickPoint(x, y)` only when no semantic reference exists

The model receives temporary references valid only for the current snapshot. It never supplies persistent selectors.

### Stopping conditions

- verified completion,
- explicit human request,
- maximum action count,
- wall-clock timeout,
- repeated materially identical state,
- policy denial,
- unrecoverable surface failure.

## 10. Surface abstraction

```ts
interface SurfaceAdapter {
  start(target: TargetProfile): Promise<SessionHandle>;
  observe(session: SessionHandle): Promise<SurfaceSnapshot>;
  act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult>;
  resolve(session: SessionHandle, target: TargetSpec): Promise<Resolution>;
  extract(session: SessionHandle, spec: { target: TargetSpec; parseAs: 'text' | 'money' | 'string' }): Promise<unknown>;
  captureEvidence(session: SessionHandle): Promise<{ path: string; url: string }>;
  bringToHuman(session: SessionHandle): Promise<void>;
  close(session: SessionHandle): Promise<void>;
}
```

The MVP implements `PlaywrightSurfaceAdapter`. Future browser-page, accessibility, image-anchor, UIA, or AX implementations map the same artifact primitives to their native mechanisms.

## 11. Run recording and capability compilation

Every executed action produces a verified `RunEvent` containing (where applicable):

- action and sanitized intent,
- temporary model reference,
- resolved control role/name/text/frame,
- input provenance rather than raw sensitive values,
- before/after state fingerprints,
- outcome and optional timing,
- evidence references.

The raw model transcript is not the capability.

The compiler combines:

1. user-utterance provenance,
2. provisional intent,
3. verified browser events,
4. final output extraction,
5. final visible checkpoint.

It then emits a typed artifact. Model proposals are accepted only when grounded in those inputs and valid against the artifact schema.

## 12. Capability artifact

The JSON artifact includes:

- schema version,
- capability ID and semantic version,
- title and intent signature,
- typed inputs and conservative validation,
- typed outputs,
- business outcomes,
- risk and policy profile,
- ordered actions,
- ordered locator strategies,
- preconditions and postconditions,
- explicit waits/retries,
- output extraction rules,
- final checkpoint,
- application-family compatibility metadata.

### Target strategy order

The artifact schema can represent accessible role/name, associated label, exact visible text, text-relative structure, frame path/URL, constrained fingerprints, and visual anchors. The MVP Playwright resolver implements role/name, label, visible text, relative text, and frame path/URL. Fingerprint and visual-anchor resolution remain an explicit adapter extension; an artifact does not silently fall back to an unsupported strategy. Replay requires exactly one acceptable match. Ambiguity is a failure, not permission to choose the first element. Absolute coordinates are not a normal replay locator.

## 13. Deterministic capability matching

For the one-capability MVP, each artifact contains an intent signature and deterministic phrase/slot patterns:

```json
{
  "intent": "lookup_member_savings_balance",
  "requiredConcepts": ["member", "savings", "balance"],
  "phrases": [
    "look up member {member_id} savings balance",
    "savings balance for member {member_id}"
  ]
}
```

A unique match with valid slot extraction invokes replay. A miss invokes discovery. An ambiguous match asks for clarification. This avoids putting an LLM in the replay decision loop for the MVP.

## 14. Deterministic replay

Replay accepts the saved artifact and resolved inputs internally. For each step it:

1. validates artifact and inputs,
2. verifies automation owns the session,
3. checks the precondition,
4. resolves the target using a fixed strategy order,
5. applies policy,
6. performs the primitive action,
7. waits on an explicit condition,
8. verifies the postcondition,
9. detects declared outcomes,
10. continues, retries, escalates, or terminates.

The replay module has no LLM dependency. Tests and evidence report `llmCalls: 0`.

## 15. Result taxonomy

```ts
type RunResult =
  | { status: "succeeded"; outputs: Record<string, unknown>; checkpointVerified: true }
  | { status: "business_outcome"; code: string; details?: Record<string, unknown> }
  | { status: "needs_human"; interventionId: string; reason: string; stepId: string }
  | { status: "failed"; error: RunFailure };
```

### Expected business outcomes

- `MEMBER_NOT_FOUND`
- `PERMISSION_DENIED`
- `ACCOUNT_NOT_FOUND`

### Recoverable conditions

- transient load failure,
- known harmless interstitial,
- stale observation,
- bounded slow response.

### Hard failures

- invalid invocation or artifact,
- target missing or ambiguous,
- unexpected dialog,
- exhausted recovery,
- checkpoint mismatch,
- output parse failure,
- browser/surface failure,
- policy violation.

Failures include step ID, expected state, observed state, and an evidence reference.

## 16. Safety and data handling

Every action in discovery and replay passes through the same policy gate.

### Policy dimensions

- allowed origins,
- allowed route patterns,
- allowed action kinds,
- maximum risk level,
- session control owner.

### Risk classes

- `READ_ONLY`
- `REVERSIBLE_WRITE`
- `IRREVERSIBLE_WRITE`

The MVP capability is read-only. A visible risky control is blocked under its policy. The model cannot override the gate.

### Sensitive-data rules

- synthetic records only,
- model keys only in ignored environment files,
- member identifiers masked in user-visible logs,
- no raw sensitive values in artifacts,
- typed actions store `fromInput` references,
- no hidden chain-of-thought persistence,
- screenshots in public evidence contain synthetic data.

## 17. Human escalation and same-session handoff

The companion is also the minimal operator surface.

### Control states

```text
AUTOMATION_CONTROL
  → INTERVENTION_OPEN
  → HUMAN_CONTROL
  → AUTOMATION_CONTROL | ABORTED
```

### Escalation flow

1. Discovery or replay detects a blocked/unsafe condition.
2. The runner captures the latest target screenshot.
3. Automation pauses and creates an intervention containing the run, step, reason, and screenshot path.
4. The companion displays the reason and screenshot.
5. The user selects **Take Control**.
6. The lease changes from automation to human; the action gateway rejects automation input.
7. The existing headed target browser is brought forward.
8. The human operates that same session.
9. Lightweight page instrumentation records click/change/navigation events with sensitive values redacted.
10. The user returns to the companion and selects **Continue Automation** or **Abort**.
11. Resume captures a fresh state, transfers the lease, and re-observes before continuing.

The screenshot endpoint is local and run-scoped. During human control, the UI may refresh the image periodically without implementing remote input streaming.

## 18. Companion API seams

The browser UI may use these local endpoints:

- `POST /api/tasks` — submit one natural-language request; the default returns `201` after the run, while `Prefer: respond-async` opts into `202 { runId, status: "pending" }` for immediate polling.
- `GET /api/context` — returns the configured app/workspace, target URL, `offline`/`live` execution mode, provider readiness, and the learned workflow or `null`.
- `GET /api/workflow` — returns the current schema-validated workflow or `null`.
- `GET /api/workflows` — array compatibility alias used by the workspace view.
- `GET /api/runs` — newest-first redacted in-memory run history; terminal summaries restored at process startup are included.
- `GET /api/runs/:runId` — current status and final result.
- `GET /api/runs/:runId/events` — structured activity feed.
- `GET /api/interventions/:id/screenshot` — latest target screenshot.
- `POST /api/interventions/:id/claim` — transfer lease to human.
- `POST /api/interventions/:id/resume` — return lease to automation.
- `POST /api/interventions/:id/abort` — terminate safely.

These are internal companion endpoints, not the optional external capability catalog API.

## 19. Evidence

```text
runtime/
  offline/
    artifacts/member.lookup-savings-balance.json
    evidence/<runId>/{run.jsonl,summary.json,capture-*.png}
  live/
    artifacts/member.lookup-savings-balance.json
    evidence/<runId>/{run.jsonl,summary.json,capture-*.png}
```

A live discovery requires a user-provided provider API key. Deterministic tests use a scripted fake model only to verify system behavior; fake-model evidence is never presented as the required genuine LLM discovery evidence. Terminal summaries and redacted JSONL are restored on startup; an interrupted browser session is not resumed after a process restart. The offline namespace is also mirrored to the legacy local-demo paths for compatibility, while live loading reads only `runtime/live`.

## 20. Testing strategy

Use vertical test-driven slices:

1. Legacy app happy path and business outcomes.
2. Goal provenance and conservative intent normalization.
3. Artifact schema and sensitive-value exclusion.
4. Capability matching and slot extraction.
5. Policy denial before surface action.
6. Deterministic replay success with zero LLM calls.
7. Business-outcome replay.
8. Intervention creation and control-lease enforcement.
9. Same-session resume.
10. Companion task submission and result presentation.
11. Playwright end-to-end flow across independently running applications.

Live-model discovery is an explicit final integration check after deterministic tests pass.

## 21. Acceptance criteria

- A user submits only a natural-language goal through the companion.
- The first unseen request is executed by a real vision-capable model against the live target UI.
- The system emits a valid, reviewable artifact without requiring the user to author its schema.
- A later invocation uses the artifact with no LLM decision calls.
- Success returns a typed money result and a verified checkpoint.
- Not-found returns a business outcome rather than a crash.
- One transient condition is handled with bounded recovery.
- A risky action is blocked by policy.
- A blocked run displays a current screenshot in the companion.
- A human claims and operates the same target session, then returns control.
- Both applications run independently from their own folders.
- The companion contains no source import or hidden API dependency on the demo application.

The implementation and evidence status for these criteria is tracked in [MVP-ACCEPTANCE.md](MVP-ACCEPTANCE.md). The local deterministic and browser integration checks are complete; genuine live-model discovery evidence remains pending until a provider-backed run is captured.
