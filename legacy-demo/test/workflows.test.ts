import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

test('home page exposes legacy workstation options and keeps the framed surface', async () => {
  const app = await buildApp();
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Workstation options/);
  assert.match(home.body, /href="\/servicing\/overview"/);
  assert.match(home.body, /href="\/servicing\/service-requests"/);
  assert.match(home.body, /href="\/servicing\/branch-directory"/);
  assert.match(home.body, /iframe[^>]+class="workstation"/);
  await app.close();
});

test('overview, service requests, and branch directory provide bounded read-only searches', async () => {
  const app = await buildApp();
  const overview = await app.inject({ method: 'GET', url: '/servicing/overview?memberId=Jordan%20Lee' });
  assert.equal(overview.statusCode, 200);
  assert.match(overview.body, /Member overview/);
  assert.match(overview.body, /Jordan Lee/);
  assert.match(overview.body, /Share Savings/);

  const requests = await app.inject({ method: 'GET', url: '/servicing/service-requests?memberId=12345&status=Open' });
  assert.equal(requests.statusCode, 200);
  assert.match(requests.body, /name="memberId"/);
  assert.match(requests.body, /name="status"/);
  assert.match(requests.body, /SR-1048/);
  assert.doesNotMatch(requests.body, /SR-1031/);

  const branches = await app.inject({ method: 'GET', url: '/servicing/branch-directory?city=Northside' });
  assert.equal(branches.statusCode, 200);
  assert.match(branches.body, /name="city"/);
  assert.match(branches.body, /Northside/);
  assert.doesNotMatch(branches.body, /Lakeside/);
  await app.close();
});

test('member summary scopes its service request link to the current member', async () => {
  const app = await buildApp();
  const summary = await app.inject({ method: 'GET', url: '/servicing/member/12345/summary' });
  assert.equal(summary.statusCode, 200);
  assert.match(summary.body, /href="\/servicing\/service-requests\?memberId=12345">Member Service Requests/);

  const scoped = await app.inject({ method: 'GET', url: '/servicing/service-requests?memberId=12345' });
  assert.equal(scoped.statusCode, 200);
  assert.match(scoped.body, /value="12345"/);
  assert.match(scoped.body, /SR-1048/);
  assert.doesNotMatch(scoped.body, /SR-0992/);
  await app.close();
});

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
