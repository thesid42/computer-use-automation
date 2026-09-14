# Run evidence

The packaged acceptance evidence is a genuine OpenRouter live discovery, a deterministic replay with zero LLM calls, and the expected `MEMBER_NOT_FOUND` replay outcome. All target data is synthetic.

- [Example capability](example-capability.json)
- [Discovery success](discovery-success/summary.json), [event log](discovery-success/run.jsonl), and final [balance screenshot](discovery-success/screenshots/capture-000009.png)
- [Replay success](replay-success/summary.json) and [event log](replay-success/run.jsonl)
- [Replay member-not-found](replay-member-not-found/summary.json), [event log](replay-member-not-found/run.jsonl), and [outcome screenshot](replay-member-not-found/screenshots/member-not-found.png)
- [Savings runtime verification](savings-runtime-verification.json), a sanitized five-scenario direct replay/handoff check plus one restart persistence check with zero model decision calls
- [Expanded discovery attempts](expanded-discovery-attempts.json), the measured historical transaction and loan discovery failures, with provider, model, action mode, call counts, and outcomes. These attempts did not produce saved workflows.
- Fresh [Nex service-request discovery](live-learning/show-service-requests-for-member-12345.json) and [changed-input replay](live-learning/show-service-requests-for-member-77777.json), plus [Northside branch discovery](live-learning/find-branches-matching-northside.json) and [Lakeside branch replay](live-learning/find-branches-matching-lakeside.json). These reports contain sanitized live actions, verified checkpoints, and changed-input outcomes.

The historical balance package used OpenRouter (`https://openrouter.ai/api/v1`) with `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, temperature `0`, JSON action mode, and a 60-second bounded timeout. The fresh live-learning reports use OpenRouter with `nex-agi/nex-n2.5-mini:free`, tool action mode, `LLM_OBSERVATION_MODE=accessibility`, and a 45-second bounded timeout. The service-request replay and branch replay use changed inputs without new model decisions; transaction and loan live coverage remains unclaimed.

Provider keys, raw credentials, and concrete member identifiers are not included. Raw diagnostics remain in ignored local runtime paths; the expanded discovery report contains only sanitized metadata and failure summaries.

The runtime verification summary is separate from the original provider-backed discovery package. Its restart entry is one persistence check that restored 33 stored runs; those restored records are not counted as separate test cases.
