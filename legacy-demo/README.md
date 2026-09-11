# Legacy Demo

Standalone synthetic legacy-style member-servicing application for the Automation Companion. It has no dependency on companion/ and can be operated directly in a browser. The surface intentionally resembles an early-2000s servicing workstation: nested frames, dense tables, small system fonts, blue and gray title strips, numbered field labels, square beveled controls, full-page server-rendered forms, and a workstation status bar. There are no data-testid attributes, hidden automation hooks, or target business APIs.

## Run

From this directory:

~~~bash
npm install
npm run start
~~~

The default listener is http://127.0.0.1:3001. Configure the listener with ordinary environment variables:

~~~bash
HOST=0.0.0.0 PORT=3200 npm run start
~~~

From the repository root, the equivalent convenience command is:

~~~bash
npm run legacy
~~~

The home page contains a nested iframe for the servicing area at /servicing. The companion must use the rendered browser UI and form posts; it must not import this application or call an internal data/API route.

## Synthetic fixtures

All records are synthetic:

| Member ID | Behavior |
| --- | --- |
| 12345 | Jordan Lee; savings balance $1,250.42; Auto Loan; normal transaction and payoff paths |
| 77777 | Casey Morgan; savings balance $843.17; Personal Loan; first member search returns TEMPORARY_LOAD_FAILURE, then Retry Search succeeds in the same cookie session |
| 88888 | Supervisor verification is required before the member summary can open; acknowledgement is a visible same-session form |
| 54321 | Member search displays PERMISSION_DENIED |
| Any other ID, for example 40404 | Member search displays MEMBER_NOT_FOUND and the loan list displays NO_LOAN |

## Supported UI workflows

The target exposes three read-only workflow families for the companion to learn:

1. Savings balance: member search → Member Summary → Accounts → Savings Account → Balance Details → Current Balance.
2. Transaction search: follow the Savings Account page's Transaction History link, enter Start Date and End Date, then select Search Transactions. The POST form filters the synthetic ledger inclusively. The result table is named Transaction results and contains Date, Description, and Amount. Reversed or malformed ranges return INVALID_DATE_RANGE. A valid range with no matching rows returns NO_TRANSACTIONS.
3. Loan payoff quote: from Accounts select Loan Accounts, open the Auto Loan or Personal Loan row, select Request Payoff Quote, enter As-of Date, and submit Request Payoff Quote. The result is a read-only Payoff quote review with As-of Date and Payoff Amount. Dates before the loan opened or after 2026-12-31 return UNSUPPORTED_AS_OF_DATE; malformed dates return INVALID_AS_OF_DATE; a member without a loan returns NO_LOAN. No payment or account change can be submitted.

Useful goal examples:

~~~text
Look up member 12345 and tell me their current savings balance.
Find transactions for member 12345 from 2026-09-01 through 2026-09-11 and show the filtered results.
Get an as-of 2026-09-30 payoff quote for member 12345's auto loan.
~~~

For the normal quote example, the deterministic synthetic result is Payoff Amount $18,968.53. The normal transaction example returns the 2026-09-03, 2026-09-07, and 2026-09-10 rows for member 12345.

## Routes and visible controls

| Screen | Route | Key visible controls |
| --- | --- | --- |
| Member Search | /servicing | Member ID, Search |
| Search Results | POST /servicing/member-search | Member Summary, Retry Search, or a named outcome |
| Member Summary | /servicing/member/:memberId/summary | Accounts |
| Accounts | /servicing/member/:memberId/accounts | Savings Account, Loan Accounts, Post Fee |
| Savings Account | /servicing/member/:memberId/accounts/savings | Balance Details, Transaction History |
| Transaction History | /servicing/member/:memberId/accounts/savings/transactions | Start Date, End Date, Search Transactions |
| Transaction search result | POST /servicing/member/:memberId/accounts/savings/transactions/search | Transaction results table |
| Loan Accounts | /servicing/member/:memberId/accounts/loans | Loan account row, Open |
| Loan Account | /servicing/member/:memberId/accounts/loans/:loanId | Request Payoff Quote |
| Payoff Quote form/review | /servicing/member/:memberId/accounts/loans/:loanId/payoff-quote | As-of Date, Request Payoff Quote, Payoff quote review |
| Balance Details | /servicing/member/:memberId/accounts/savings/balance | Current Balance |
| Teller Totals | /servicing/teller-totals | Drawer totals, Transaction counts |
| Session Ended | /servicing/end-session | Start New Session |

The Accounts page always links to Loan Accounts so an unknown member can produce the explicit NO_LOAN business outcome through the visible route. The Post Fee control is deliberately present as a risky read-only-demo control; its POST returns HTTP 403 and does not change data.

## Tests

~~~bash
npm test
npm run build
~~~

Tests use Fastify injection for the UI routes and a focused child-process test for the configurable standalone listener. They cover the visible transaction search, inclusive filtering, invalid and empty outcomes, loan navigation, payoff calculation, unsupported dates, and no-loan outcome. The browser surface remains a standalone target with synthetic data only.
