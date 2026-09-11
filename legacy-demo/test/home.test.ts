import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

test('home page presents the legacy member servicing iframe', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Member Servicing/);
  assert.match(response.body, /<iframe[^>]+src="\/servicing"/i);
  assert.doesNotMatch(response.body, /data-testid/i);

  await app.close();
});

test('servicing area exposes a human-readable member search form', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/servicing' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Member Search/);
  assert.match(response.body, /label[^>]*for="member-id"[^>]*>Member ID/i);
  assert.match(response.body, /name="memberId"/i);
  assert.match(response.body, />Search</i);

  await app.close();
});

test('searching the success fixture renders a table result linked to Member Summary', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=12345',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Search Results/);
  assert.match(response.body, /<table/i);
  assert.match(response.body, /12345/);
  assert.match(response.body, /href="\/servicing\/member\/12345\/summary"/);
  assert.match(response.body, /Member Summary/);
  assert.match(response.headers['set-cookie']?.toString() ?? '', /legacy_demo_session=/);

  await app.close();
});

test('member summary leads through Accounts, Savings Account, and Balance Details', async () => {
  const app = await buildApp();
  const summary = await app.inject({ method: 'GET', url: '/servicing/member/12345/summary' });
  const accounts = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts' });
  const savings = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings' });
  const balance = await app.inject({ method: 'GET', url: '/servicing/member/12345/accounts/savings/balance' });

  assert.equal(summary.statusCode, 200);
  assert.match(summary.body, /Member Summary/);
  assert.match(summary.body, /href="\/servicing\/member\/12345\/accounts"[^>]*>Accounts</i);
  assert.equal(accounts.statusCode, 200);
  assert.match(accounts.body, /Accounts/);
  assert.match(accounts.body, /Savings Account/);
  assert.match(accounts.body, /Post Fee/);
  assert.equal(savings.statusCode, 200);
  assert.match(savings.body, /Savings Account/);
  assert.match(savings.body, /Balance Details/);
  assert.equal(balance.statusCode, 200);
  assert.match(balance.body, /Balance Details/);
  assert.match(balance.body, /Current Balance/);
  assert.match(balance.body, /\$1,250\.42/);

  await app.close();
});

test('an unknown identifier renders the MEMBER_NOT_FOUND business outcome', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=40404',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /MEMBER_NOT_FOUND/);
  assert.match(response.body, /No matching member found/i);

  await app.close();
});

test('the permission fixture renders a PERMISSION_DENIED business outcome', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=54321',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /PERMISSION_DENIED/);
  assert.match(response.body, /permission/i);

  await app.close();
});
