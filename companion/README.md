# Automation Companion

Standalone strict-TypeScript web companion for one configured, browser-visible back-office workflow. It discovers a member savings-balance lookup once, compiles a validated capability artifact, and deterministically replays it without an LLM.

## Run

```bash
cd companion
npm install
npm run companion
```

Open `http://127.0.0.1:3000`. The target is configured by `TARGET_URL`; it is never imported from `legacy-demo`.

For an offline, deterministic demo (no API key, browser, or live model):

```bash
OFFLINE_DEMO=1 npm run companion
```

On Windows Git Bash, the same command works. `TARGET_URL`, `PORT`, and `HOST` are also supported.

## Live discovery configuration

The companion uses one OpenAI-compatible `/chat/completions` adapter. The packaged acceptance evidence used OpenRouter; set provider values explicitly before starting a live run:

```text
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<user-provided-key>
LLM_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
LLM_ACTION_MODE=json
LLM_TIMEOUT_MS=60000
```

`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_ACTION_MODE`, and `LLM_TIMEOUT_MS` are read only from the environment. `LLM_ACTION_MODE=tool` enables strict function calling; JSON mode remains the default. The API key is sent in the authorization header and is not placed in prompts, artifacts, or evidence. Provider timeouts are bounded to 5–120 seconds with a 60-second default. No live-model evidence is created by tests or by offline mode.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Saved-artifact replay

Replay a validated capability artifact directly against a configured target without an LLM or API key:

```bash
npm run replay -- --artifact ./runtime/offline/artifacts/member.lookup-savings-balance.json --input member_id=12345 --target http://127.0.0.1:3001 --headless
```

The command prints one JSON result and exits nonzero for an invalid artifact, browser failure, policy failure, or other hard replay failure. It is a local developer/evaluator command, not an external capability catalog.

Tests use dependency injection: scripted models and an in-memory surface cover interpretation, matching, schema validation, policy, evidence redaction, discovery, replay, and handoff without credentials. A replay run records `llmCalls: 0` in the run response and result event.

Live-provider status (2026-09-10): the OpenRouter Nano Omni run completed discovery in 16 model calls and produced the typed balance `$1,250.42`; replay returned the same output with `llmCalls: 0`, and the unknown-member replay returned `MEMBER_NOT_FOUND` with `llmCalls: 0`. The companion fails closed on incomplete actions, limits repairs to two attempts per step, and preserves sanitized evidence in [the repository package](../evidence/README.md). Earlier failed provider attempts remain diagnostic-only under `tmp/`.

## Internal endpoints

- `POST /api/tasks` with `{ "goal": "..." }`
- `POST /api/tasks` with `Prefer: respond-async` returns `202` and a `runId` immediately; poll the run endpoint.
- `GET /api/context` for the configured app/workspace, target URL, execution mode, discovery readiness, and learned workflow.
- `GET /api/workflow` for the schema-validated learned artifact, or `null` when none is available.
- `GET /api/runs` for newest-first redacted in-memory run history, including terminal runs restored at startup.
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events`
- `GET /api/interventions/:id/screenshot`
- `POST /api/interventions/:id/claim`
- `POST /api/interventions/:id/resume`
- `POST /api/interventions/:id/abort`
- `POST /api/interventions/:id/actions` for redacted human-action records

The browser seam is `SurfaceAdapter`; `PlaywrightSurfaceAdapter` is the live implementation and `ScriptedDemoSurfaceAdapter` is the offline test/demo implementation. Policy checks origin, route, action kind, resolved target risk, and control owner before browser actions. Terminal run summaries and JSONL events are loaded again at startup. Live artifacts are written under `runtime/live/artifacts`; offline artifacts use the offline runtime namespace (an explicitly injected offline root retains its historical `artifacts/` and `evidence/` paths), so a scripted artifact cannot be selected by live execution. Pass `runtimeDir` or `storageRoot` to `createCompanion` in tests to inject another root.
