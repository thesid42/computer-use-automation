# Legacy Demo

Standalone synthetic legacy-style member-servicing application for the Automation Companion demo. It has no dependency on `companion/` and can be operated directly in a browser.

## Run

From this directory:

```bash
npm install
npm run start
```

The default listener is **http://127.0.0.1:3001**. Configure the listener with ordinary environment variables:

```bash
HOST=0.0.0.0 PORT=3200 npm run start
```

`npm run dev` starts the same server through `tsx watch`. The home page contains a nested iframe for the servicing area at `/servicing`.

## Fixture IDs

All records are synthetic:

| Member ID | Behavior |
| --- | --- |
| `12345` | Success; Jordan Lee; savings current balance `$1,250.42` |
| `54321` | Search result displays `PERMISSION_DENIED` |
| `77777` | First search in a session displays `TEMPORARY_LOAD_FAILURE`; retrying in the same cookie session succeeds |
| `88888` | Search displays `SUPERVISOR_VERIFICATION_REQUIRED`; the human must acknowledge the visible form in the same cookie session before the summary opens |
| Any other ID (for example `40404`) | Search displays `MEMBER_NOT_FOUND` |

The Accounts page visibly includes the risky **Post Fee** control. Its POST is refused with HTTP 403 because this demo is read-only.

## Screens

Every screen carries the workstation menubar (**Member Search**, **Teller Totals**, **End Session**) and detail screens link back to their parent plus a fresh search, so an operator (or automation) can always navigate without the browser back button. Dead-end outcomes (`MEMBER_NOT_FOUND`, `PERMISSION_DENIED`) offer a return to Member Search.

| Screen | Route |
| --- | --- |
| Member Search | `/servicing` |
| Search Results | `POST /servicing/member-search` |
| Member Summary (record + contact + notices) | `/servicing/member/:id/summary` |
| Accounts (open savings + closed certificate) | `/servicing/member/:id/accounts` |
| Savings Account | `/servicing/member/:id/accounts/savings` |
| Balance Details | `/servicing/member/:id/accounts/savings/balance` |
| Transaction History (per-member ledger) | `/servicing/member/:id/accounts/savings/transactions` |
| Teller Totals (drawer + counts, synthetic) | `/servicing/teller-totals` |
| Session Ended | `/servicing/end-session` |

Known members carry distinct data: `12345` (Jordan Lee, `$1,250.42`) and `77777` (Casey Morgan, `$843.17`) each have their own ledger.

## Test and build

```bash
npm test
npm run build
```

Tests use Fastify injection for the UI routes and a focused child-process test to verify the configurable standalone listener. No `data-testid` attributes or hidden business/automation APIs are used.
