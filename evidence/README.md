# Run evidence

The packaged acceptance evidence is a genuine OpenRouter live discovery, a deterministic replay with zero LLM calls, and the expected `MEMBER_NOT_FOUND` replay outcome. All target data is synthetic.

- [Example capability](example-capability.json)
- [Discovery success](discovery-success/summary.json), [event log](discovery-success/run.jsonl), and final [balance screenshot](discovery-success/screenshots/capture-000009.png)
- [Replay success](replay-success/summary.json) and [event log](replay-success/run.jsonl)
- [Replay member-not-found](replay-member-not-found/summary.json), [event log](replay-member-not-found/run.jsonl), and [outcome screenshot](replay-member-not-found/screenshots/member-not-found.png)
- [Savings runtime verification](savings-runtime-verification.json), a sanitized five-scenario direct replay/handoff check plus one restart persistence check with zero model decision calls
- [Expanded discovery attempts](expanded-discovery-attempts.json), the measured transaction and loan discovery failures, with provider, model, action mode, call counts, and outcomes. These attempts did not produce saved workflows.

The live provider was OpenRouter (`https://openrouter.ai/api/v1`) using `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, temperature `0`, JSON action mode, and a 60-second bounded timeout. Discovery completed in 16 model calls; replay completed with `llmCalls: 0`; the business outcome replay also completed with `llmCalls: 0`. The artifact uses a `relativeText: "Current Balance"` relationship for the definition-list value and contains no duplicate action IDs.

Provider keys, raw credentials, and concrete member identifiers are not included. Raw diagnostics remain in ignored local runtime paths; the expanded discovery report contains only sanitized metadata and failure summaries.

The runtime verification summary is separate from the original provider-backed discovery package. Its restart entry is one persistence check that restored 33 stored runs; those restored records are not counted as separate test cases.
