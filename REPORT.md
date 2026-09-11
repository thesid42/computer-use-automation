# Design Report

## 1. Architecture

The system is a local Automation Companion that accepts one natural-language request and operates a separately deployed back-office application through its visible user interface. The repository contains two independently runnable applications: `legacy-demo/`, a synthetic server-rendered member-servicing system, and `companion/`, the automation product. They have separate packages and processes. The companion knows the target only through configuration and browser-visible behavior; it does not import demo code, share its data store, or call hidden business APIs.

The companion has a Goal Controller, LLM discovery loop, deterministic replay engine, policy gate, evidence recorder, Playwright surface adapter, and human-control lease. On each request the Goal Controller either matches one learned capability or begins discovery. The OpenAI-compatible adapter supports the configured vision model; the packaged acceptance run used OpenRouter `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. Playwright performs every UI action. The model proposes one typed action at a time, but schema, policy, and ownership checks run before execution; malformed proposals receive at most two bounded repair calls per step. The local companion API supports synchronous tasks plus opt-in `Prefer: respond-async` submission, context/workflow inspection, and redacted newest-first run history. Terminal summaries and JSONL events reload on restart, and offline/live artifact roots are isolated.

The architecture is intentionally a single-node vertical slice. Local HTTP services and filesystem artifacts make behavior easy to inspect. Queues, distributed workers, and production identity infrastructure would obscure the load-bearing decisions without improving this demonstration.

## 2. Artifact schema

A successful discovery produces a versioned JSON capability rather than preserving the model transcript. The artifact defines a capability ID and semantic version, natural-language intent signature, typed inputs and outputs, business outcomes, risk/policy metadata, ordered steps, target strategies, preconditions, postconditions, bounded recovery behavior, output extraction, and a final checkpoint.

The user does not author this schema. An internal intent pass identifies candidate entities and outputs from exact spans of the user's sentence. The recorder then links those candidates to actions that actually occurred. For example, `12345` becomes `member_id` only after the system proves that the user supplied it and the value was entered into a Member ID control. The artifact stores `fromInput: member_id`, never the concrete sensitive value.

Targets contain ordered strategies rather than one brittle selector: accessible role/name, label, visible text, text-relative structure, frame fingerprint, constrained markup fingerprint, and finally a visual anchor when needed. Replay accepts only one unambiguous resolution. This schema is surface-neutral even though the MVP implements a Playwright browser adapter.

## 3. Determinism & error handling

Replay has no LLM dependency. It validates the artifact and invocation, confirms automation owns the session, checks each precondition, resolves the target using a fixed strategy order, applies policy, acts, waits on an explicit condition, and verifies the postcondition. It returns declared outputs only after the final checkpoint succeeds. Tests and evidence report zero LLM calls for replay.

The result contract distinguishes `succeeded`, `business_outcome`, `needs_human`, and `failed`. A missing member or denied permission is a caller-relevant business outcome, not a crash. A transient load may receive an explicitly bounded retry. Missing or ambiguous controls, unexpected dialogs, exhausted recovery, checkpoint mismatch, output parsing errors, surface failures, and policy violations stop with the exact step, expected state, observed state, and evidence reference. Top-level runner exceptions are converted into structured failures and close any owned session. Stable UI is assumed; runtime outcomes receive more design attention than speculative locator drift.

## 4. Heterogeneity & multi-tenant

The capability engine depends on a `SurfaceAdapter` contract for observation, target resolution, primitive actions, extraction, evidence, and session handoff. Playwright is the first adapter. A legacy-browser adapter could add image anchors or frame-specific behavior, while desktop adapters could map the same target strategies and actions to Windows UIA or macOS accessibility APIs.

Artifacts identify an application family rather than one tenant URL. A tenant profile would supply base URL, branding aliases, supported version fingerprints, policy restrictions, and narrowly scoped locator overrides. A replay should fail closed when the detected application fingerprint is incompatible; it should not silently mutate a shared capability. The MVP demonstrates one tenant and documents this specialization seam instead of building multi-tenant infrastructure.

## 5. Escalation & handoff

Discovery or replay can open an intervention when it detects no progress, an unknown state, a required human decision, or a risky operation. The runner pauses the automation, captures the current target screenshot, and records the run, capability, step, reason, state summary, and control owner. The companion displays that screenshot with Take Control, Continue, and Abort actions.

Take Control transfers an explicit lease from automation to the human and rejects further automation input. The same headed Playwright page is brought forward, preserving cookies, navigation history, form state, and session context. Lightweight page instrumentation records human click/change/navigation events with sensitive values redacted. Continue captures a fresh state, returns ownership, and forces automation to re-observe rather than assuming what the human changed. The local screenshot preview is deliberately not a remote co-browsing implementation.

## 6. Safety

The same action gateway protects discovery and replay. Policies allowlist origins, routes, action kinds, maximum risk, and current session owner. Actions are classified as read-only, reversible write, or irreversible write. The balance-lookup capability is read-only; a visible risky control in the demo proves that the model cannot override policy.

The repository and evidence use synthetic data. Keys live only in ignored environment files. Artifacts contain parameter references rather than raw values, member identifiers are masked in activity logs, and hidden chain-of-thought is not persisted. A production version would add enterprise identity, encrypted evidence retention, provider data-governance controls, and audit export.

## 7. Cuts

The MVP deliberately omits the optional capability catalog/API, generated automation code, formal approval/confidence lifecycle, LLM-assisted replay recovery, a second tenant demonstration, and repeated-run stability reporting. It also omits real bank integration, remote co-browsing, desktop automation, distributed execution, and irreversible financial actions. The companion's local natural-language front door and internal task endpoints are user experience for the core flow, not a generalized external catalog.

With more time, the next work would be a second application variant to validate tenant overrides, a desktop surface adapter, stronger visual-anchor resolution, encrypted/expiring evidence storage, and a production operator transport attached to the same control-lease model.

## 8. Live acceptance status

The deterministic and browser-backed checks pass, including the Playwright iframe integration and restart/persistence checks. The live acceptance run on 2026-09-10 used OpenRouter's `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` against the synthetic target. Discovery succeeded with output `$1,250.42`, checkpoint verification, and 16 total model calls including bounded repairs. Replay returned the same output with zero model calls, and the unknown-member replay returned `MEMBER_NOT_FOUND` with zero model calls. The [packaged evidence](evidence/README.md) contains the sanitized artifact, summaries, event logs, and screenshots; prior failed provider attempts remain diagnostic-only under `tmp/`.
