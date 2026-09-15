# Design Report

## Architecture

The system is a local Automation Companion that accepts a natural-language request and operates a separately deployed back-office application through its visible browser UI. The repository contains two independent applications: `legacy-demo/`, a synthetic early-2000s member-servicing workstation, and `companion/`, the workflow workspace and runtime. They have separate packages, processes, and state. The companion reaches only the configured target URL. It does not import target code or data, call a hidden business endpoint, or use target-specific automation hooks.

The companion has a request controller, model discovery runner, durable workflow library, deterministic replay runner, policy gate, evidence store, and human-control lease. A new request is matched against active compatible workflows when possible. A miss starts discovery through the New request composer. If the request lacks a needed detail, the server returns a conversation ID and a plain-language question; the next answer resumes that request. A successful discovery is compiled into a typed capability and saved with human-facing metadata. The detail view presents the steps and a free-text run box while keeping the technical contract secondary.

The target provides bounded, read-only member search, account overview, savings balance and transaction history, loan payoff, service requests, branch directory, and teller totals. The target and companion are useful independently: the target can be navigated directly, while the companion can learn through the same visible forms an operator would use.

## Artifact schema

A discovery produces a schema-validated, versioned capability rather than a model transcript. The artifact records a capability ID and semantic version, intent signature, typed inputs and outputs, expected business outcomes, risk and policy profile, ordered actions, locator strategies, preconditions, postconditions, waits, bounded retries, extraction rules, final checkpoint, and target compatibility.

Action values refer to inputs such as `fromInput: member_id`; concrete member IDs and dates are supplied on each run and are not compiled into the artifact or workflow metadata. The Playwright surface adapter records temporary references and grounded role/name, label, visible text, frame, URL, and constrained fingerprint data. It requires an unambiguous match during replay. Accessibility observation is the configured default; a multimodal configuration may add a local screenshot. Outputs are typed where useful, including money for balances and quotes and rendered tables for searches.

The retained [capability artifact](evidence/capability.json) is the current service-request workflow compiled from the genuine discovery in [discovery.json](evidence/discovery.json). It has a sensitive member input reference and a read-only policy profile; it does not contain the member value used for discovery.

## Determinism & error handling

Direct workflow runs and matched natural-language replays use the saved artifact without a model deciding individual actions. The runner validates the artifact and input object, confirms that automation owns the session, checks a precondition, resolves one target using a fixed strategy order, applies policy, performs the primitive action, waits for the declared condition, verifies the postcondition, detects declared outcomes, extracts outputs, and verifies the final checkpoint. It returns a run ID and structured result metadata. Direct replay reports zero model decision calls.

The result contract distinguishes success with `checkpointVerified: true`, caller-visible business outcomes such as `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`, `NO_TRANSACTIONS`, and `NO_LOAN`, human intervention, and hard failure. Malformed dates, reversed ranges, unsupported payoff dates, ambiguous or missing controls, unexpected dialogs, exhausted recovery, checkpoint mismatch, browser failure, parse errors, invalid invocation, and policy violations stop with the step, expected state, observed state, and evidence reference. The target's 77777 fixture demonstrates one bounded transient search failure followed by a visible Retry Search in the same session.

The current [replay log](evidence/replay.json) changes the learned service-request input to 77777, recovers through that bounded retry, and verifies the statement-copy result with zero model decision calls. The package includes three screenshots: discovery result, post-retry recovery, and final replay result. A compact [historical handoff summary](evidence/handoff-summary.json) separately records savings replay, outcome, and same-session handoff checks. Last code validation passed 24/24 target tests, 103/103 companion tests (including three browser workflow tests), typecheck, and build. Transaction and loan workflows have scripted browser coverage. Savings and branch workflows were learned previously, but only the current service-request proof is packaged here.

## Heterogeneity & multi-tenant

The `SurfaceAdapter` separates how a computer is perceived and acted on from the recorded flow. Playwright is the implemented browser adapter. A legacy browser adapter could map frames, visible text, accessibility controls, or visual anchors to server-rendered pages; a desktop adapter could map the same action contract to OS accessibility APIs. The artifact does not assume a clean DOM or a target API.

At larger scale, a workflow record would be scoped to an application family, tenant policy, and version. A tenant profile could supply base URL, branding aliases, detected version fingerprints, permissions, and narrowly scoped locator overrides. A shared artifact would be selected only when the surface fingerprint is compatible. Drift would create an explicit review or specialized version rather than silently changing a shared capability. This repository implements one target profile and bounded read-only workflows.

## Escalation & handoff

An explicit request for human help, a `needs_human` surface outcome, or the supervisor-verification fixture pauses automation and opens an intervention. Hard failures, including exhausted replay recovery, stop with diagnostic evidence rather than automatically offering a resumable handoff. The runner records the run, workflow, step, reason, observed context, control owner, and a screenshot when available. The Needs attention view exposes Take control, Continue automation, and Abort actions. Offline mode explains that no live browser preview is available.

Take control transfers an explicit lease to the human and rejects further automation actions. The headed target page remains the same session, preserving cookies, navigation, and form state. Continue returns the lease to automation, captures a fresh observation, and resumes from the same session. Abort closes the run safely. Human click, change, and navigation events are recorded with sensitive values redacted. The handoff summary preserves the small local handoff verification without implying remote co-browsing or a resumable browser after process restart.

## Safety

Discovery, typed replay, and matched replay share one policy gate. It allowlists origins and route patterns, allowed action kinds, a maximum risk class, and the current control owner. Actions are classified as `READ_ONLY`, `REVERSIBLE_WRITE`, or `IRREVERSIBLE_WRITE`. Delivered workflows are read-only. The visible Post Fee control is a policy-denial fixture and cannot post a fee or change target data.

The target contains synthetic records only. Provider keys belong in the ignored `companion/.env` and are sent only in the authorization header. Keys are not written to artifacts, workflow metadata, screenshots, evidence, JSONL events, summaries, or prompts. Known sensitive fields such as member identifiers and entered values are redacted in persisted event and user-facing activity paths; declared business outputs may retain data needed to verify a result. Artifacts keep input references. The target has no hidden API seam, and the companion cannot bypass the visible workflow. Production identity, encrypted retention, and enterprise audit controls remain future work.

## Cuts

The MVP prioritizes one complete vertical slice over breadth. It intentionally leaves out real bank integrations, target APIs, irreversible financial actions, desktop automation, a second tenant or surface variant, cross-tenant rollout infrastructure, distributed workers, production authentication and RBAC, a public capability catalog, generated code, a formal confidence/approval lifecycle, and open-ended model recovery during replay. The target remains bounded synthetic training data and does not claim arbitrary member-servicing coverage.

The root [README](README.md) keeps the exact install, run, discovery, replay, fixture, and verification commands, along with four prompts reserved for future user-led discovery: transaction history, loan payoff, member/account overview, and teller totals. They are not seeded capabilities. A failed or incomplete learning attempt must not create a saved workflow. The retained evidence package records the service-request discovery/replay and handoff summary needed to inspect the vertical slice; screenshots are local sanitized evidence. The final local checks and current package paths are recorded in the README so the submission can be evaluated from a clean checkout.
