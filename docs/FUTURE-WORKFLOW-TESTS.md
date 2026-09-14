# Workflows reserved for your next test

The live library currently contains learned savings balance, branch directory, and member service-request workflows. An earlier invalid service workflow is archived. The four workflows below have no saved capability in that library and are reserved for the user's own discovery tests. Do not run live model discovery or seed capabilities for them during routine maintenance unless the user asks.

Transaction and loan paths have isolated scripted browser tests and earlier unsuccessful provider attempts. They are still unlearned in the live app. Scripted tests use temporary state and do not populate the live library.

| Unlearned workflow | Paste into the companion when ready | Check the first result |
| --- | --- | --- |
| Transaction history | Find transactions for member 12345 from 2026-09-01 to 2026-09-11. | Only the September 3, 7, and 10 records; no August records. |
| Loan payoff quote | Get the loan payoff quote for member 12345 as of 2026-09-30. | Read-only quote dated September 30, with payoff amount $18,968.53. |
| Member and account overview | Show the member and account overview for member 12345. | Jordan Lee's member details and available savings/loan accounts. |
| Teller totals | Show the teller drawer totals. | Opening cash $12,000.00 and expected cash $14,654.50 on the Teller Totals screen. No member number should be needed. |

Use the companion's **New request** free-text box. The first successful run should report discovery and add a new workflow to Automations. A matching request should then replay the learned artifact. Failed or incomplete learning must not produce a saved capability.

For a stronger replay check, change the transaction dates to August 1–31, or change the overview member to 77777. For the teller task, repeat the same request because it has no variable input. Check the actual returned data and verified checkpoint, not just the Completed label. Exact-template replay should use zero action-model calls and zero intent-model calls; an unfamiliar paraphrase can require intent interpretation.

The live provider can still refuse or time out on a novel task. These are intentionally unverified discovery cases, not a claim that every future request will succeed. Existing success, recovery, and regression evidence is described in [MVP acceptance](MVP-ACCEPTANCE.md).
