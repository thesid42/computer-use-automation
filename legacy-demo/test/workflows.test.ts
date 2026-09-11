import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

test('transaction history exposes a date search and filters a named result table', async () => {
  const app = await buildApp();
  const page = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings/transactions' });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /label for="start-date"[^>]*>Start Date/i);
  assert.match(page.body, /label for="end-date"[^>]*>End Date/i);
  assert.match(page.body, /name="startDate"/i);
  assert.match(page.body, /name="endDate"/i);
  assert.match(page.body, /Search Transactions/i);

  const result = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/savings/transactions/search',
    payload: 'startDate=2026-09-01&endDate=2026-09-11',
    headers: formHeaders,
  });

  assert.equal(result.statusCode, 200);
  assert.match(result.body, /aria-label="Transaction results"/i);
  assert.match(result.body, /<caption>Transaction results<\/caption>/i);
  assert.match(result.body, /2026-09-10/);
  assert.match(result.body, /Payroll deduction/);
  assert.doesNotMatch(result.body, /2026-08-28/);

  await app.close();
});

test('transaction history reports invalid ranges and an empty business outcome', async () => {
  const app = await buildApp();
  const invalid = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/savings/transactions/search',
    payload: 'startDate=2026-09-12&endDate=2026-09-01',
    headers: formHeaders,
  });
  assert.equal(invalid.statusCode, 200);
  assert.match(invalid.body, /INVALID_DATE_RANGE/);

  const empty = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/savings/transactions/search',
    payload: 'startDate=2026-10-01&endDate=2026-10-31',
    headers: formHeaders,
  });
  assert.equal(empty.statusCode, 200);
  assert.match(empty.body, /NO_TRANSACTIONS/);
  assert.match(empty.body, /Transaction results/);

  await app.close();
});

test('loan list, detail, and payoff quote are linked through read-only forms', async () => {
  const app = await buildApp();
  const accounts = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts' });
  assert.match(accounts.body, /href="\/servicing\/member\/12345\/accounts\/loans"/i);

  const loans = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/loans' });
  assert.equal(loans.statusCode, 200);
  assert.match(loans.body, /Loan accounts/);
  assert.match(loans.body, /Auto Loan/);
  assert.match(loans.body, /href="\/servicing\/member\/12345\/accounts\/loans\/auto-6655"/i);

  const detail = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/loans/auto-6655' });
  assert.equal(detail.statusCode, 200);
  assert.match(detail.body, /Request Payoff Quote/);
  assert.match(detail.body, /Opened On/);

  const form = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/loans/auto-6655/payoff-quote' });
  assert.match(form.body, /label for="as-of-date"[^>]*>As-of Date/i);
  assert.match(form.body, /name="asOfDate"/i);

  const quote = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/loans/auto-6655/payoff-quote',
    payload: 'asOfDate=2026-09-30',
    headers: formHeaders,
  });
  assert.equal(quote.statusCode, 200);
  assert.match(quote.body, /Payoff quote review/);
  assert.match(quote.body, /Payoff Amount/);
  assert.match(quote.body, /\$18,968\.53/);
  assert.match(quote.body, /READ-ONLY QUOTE/);
  assert.doesNotMatch(quote.body, /payment or account change was submitted[^<]*yes/i);

  await app.close();
});

test('payoff quote distinguishes no loan, invalid dates, and unsupported dates', async () => {
  const app = await buildApp();
  const noLoan = await app.inject({ method: 'GET', url: '/servicing/member/40404/accounts/loans' });
  assert.equal(noLoan.statusCode, 200);
  assert.match(noLoan.body, /NO_LOAN/);

  const invalid = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/loans/auto-6655/payoff-quote',
    payload: 'asOfDate=2026-13-01',
    headers: formHeaders,
  });
  assert.match(invalid.body, /INVALID_AS_OF_DATE/);

  const unsupported = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/loans/auto-6655/payoff-quote',
    payload: 'asOfDate=2024-01-01',
    headers: formHeaders,
  });
  assert.match(unsupported.body, /UNSUPPORTED_AS_OF_DATE/);

  await app.close();
});
