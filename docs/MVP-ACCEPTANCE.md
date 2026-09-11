# MVP Acceptance Checklist

This checklist records both implemented behavior and the genuine live provider evidence packaged under `evidence/`. Scripted tests validate control flow and failure handling; the discovery acceptance row is backed by the OpenRouter run listed below.

| Requirement | Implementation and evidence | Status |
| --- | --- | --- |
| Submit one natural-language task | Companion UI and `POST /api/tasks`; `companion/test/app.test.ts` | Complete with scripted surface/model |
| Discover an unseen workflow with a real vision-capable model | OpenAI-compatible model adapter and Playwright surface in `companion/src/llm/client.ts` and `companion/src/surface/playwright.ts`; [live discovery summary](../evidence/discovery-success/summary.json) | Complete: OpenRouter Nano Omni, 16 model calls |
| Compile a validated, reusable artifact without raw member input | `compileCapability`, `capabilitySchema`, artifact redaction tests, and [example capability](../evidence/example-capability.json) | Complete with live artifact |
| Replay deterministically with zero model decision calls | `ReplayRunner`, replay tests, and `llmCalls: 0` result events | Complete |
| Return a typed balance and verify the final checkpoint | Money extraction and checkpoint validation in the replay/discovery runners | Complete with scripted and Playwright integration tests |
| Return business outcomes for known target outcomes | `MEMBER_NOT_FOUND` and `PERMISSION_DENIED` handling; legacy scenario tests | Complete |
| Handle a bounded transient failure | Surface retry behavior and bounded runner tests | Complete |
| Block a risky visible action | Policy resolution uses resolved target metadata; policy gap tests | Complete |
| Show progress before completion | Discovery/replay event sinks update the in-memory run store; async polling test | Complete |
| Support same-session human takeover and resume | Claim/resume/abort routes, control lease, screenshot refresh, handoff tests | Complete with scripted and Playwright surface tests |
| Persist reusable workflows and terminal run history across restart | Namespaced runtime artifacts, redacted summaries/JSONL, startup restoration; `backend-reliability.test.ts` | Complete with isolated temporary roots |
| Keep offline artifacts out of live execution | `runtime/offline` and `runtime/live` roots plus isolation test | Complete |
| Run the two applications independently | Separate packages and process/startup tests | Complete |
| Avoid target hidden APIs or source imports | Browser-visible Playwright adapter and repository boundary review | Complete |

## Evidence commands

Run the deterministic and browser-backed checks from the repository root:

```bash
npm test
npm run typecheck
```

These commands produce the deterministic and browser-backed checks used alongside the packaged live evidence. The live provider endpoint, model ID, and non-secret generation settings are recorded in [the discovery summary](../evidence/discovery-success/summary.json); the API key is never persisted.

## Live provider status

On 2026-09-10 the visible Playwright target completed live discovery through OpenRouter's `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` model. The run returned the typed balance `$1,250.42`, verified the final checkpoint, and compiled the reusable artifact after 16 bounded model calls. A subsequent replay returned the same balance with zero model calls, and a replay with the synthetic unknown-member fixture returned `MEMBER_NOT_FOUND` with zero model calls. The packaged [run logs and summaries](../evidence/README.md) contain only repository-relative evidence references; earlier failed attempts remain diagnostic-only under ignored `tmp/` paths.
