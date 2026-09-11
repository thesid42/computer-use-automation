import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

function cookieFrom(response: { headers: { 'set-cookie'?: unknown } }): string {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) return String(value[0] ?? '').split(';')[0];
  return typeof value === 'string' ? value.split(';')[0] : '';
}

test('the transient fixture fails once and succeeds when retried in the same session', async () => {
  const app = await buildApp();
  const first = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=77777',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.equal(first.statusCode, 200);
  assert.match(first.body, /TEMPORARY_LOAD_FAILURE/);
  assert.match(first.body, /Retry Search/);

  const second = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=77777',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieFrom(first),
    },
  });

  assert.equal(second.statusCode, 200);
  assert.doesNotMatch(second.body, /TEMPORARY_LOAD_FAILURE/);
  assert.match(second.body, /Search Results/);
  assert.match(second.body, /href="\/servicing\/member\/77777\/summary"/);

  await app.close();
});

test('the savings page links balance details and transaction history', async () => {
  const app = await buildApp();
  const savings = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings' });

  assert.equal(savings.statusCode, 200);
  assert.match(savings.body, /href="\/servicing\/member\/12345\/accounts\/savings\/balance"[^>]*>Balance Details</);
  assert.match(savings.body, /href="\/servicing\/member\/12345\/accounts\/savings\/transactions"[^>]*>Transaction History</);

  const history = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings/transactions' });
  assert.equal(history.statusCode, 200);
  assert.match(history.body, /Transaction History/);
  assert.match(history.body, /<table/i);
  assert.match(history.body, /Payroll deduction/);
  assert.doesNotMatch(history.body, /data-testid/i);

  await app.close();
});

test('dead-end outcomes offer a way back to member search', async () => {
  const app = await buildApp();
  for (const memberId of ['40404', '54321']) {
    const response = await app.inject({
      method: 'POST',
      url: '/servicing/member-search',
      payload: `memberId=${memberId}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /href="\/servicing"[^>]*>Return to Member Search</);
  }
  await app.close();
});

test('detail screens link back and members carry distinct data', async () => {
  const app = await buildApp();
  const accounts = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts' });
  assert.match(accounts.body, /Back to Member Summary/);
  assert.match(accounts.body, /Share Certificate/);

  const balance = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings/balance' });
  assert.match(balance.body, /Back to Savings Account/);
  assert.match(balance.body, /\$1,250\.42/);

  const other = await app.inject({ method: 'GET', url: '/servicing/member/77777/accounts/savings/balance' });
  assert.match(other.body, /Member ID: 77777/);
  assert.doesNotMatch(other.body, /\$1,250\.42/);

  const summary = await app.inject({ method: 'GET', url: '/servicing/member/77777/summary' });
  assert.match(summary.body, /Casey Morgan/);
  assert.match(summary.body, /Contact on file/);

  await app.close();
});

test('teller totals render and ending the session clears it', async () => {
  const app = await buildApp();
  const totals = await app.inject({ method: 'GET', url: '/servicing/teller-totals' });
  assert.equal(totals.statusCode, 200);
  assert.match(totals.body, /Teller Totals/);
  assert.match(totals.body, /<table/i);

  const search = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=88888',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const cookie = cookieFrom(search);
  assert.match(search.body, /SUPERVISOR_VERIFICATION_REQUIRED/);

  const ended = await app.inject({ method: 'GET', url: '/servicing/end-session', headers: { cookie } });
  assert.match(ended.body, /Session Ended/);
  assert.match(ended.body, /Start New Session/);

  await app.close();
});

test('posting the visible fee control is refused as a restricted write', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/servicing/member/12345/accounts/post-fee',
    payload: '',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Post Fee/);
  assert.match(response.body, /restricted write/i);

  await app.close();
});
