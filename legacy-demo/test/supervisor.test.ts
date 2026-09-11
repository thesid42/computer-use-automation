import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

function cookieFrom(response: { headers: { 'set-cookie'?: unknown } }): string {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) return String(value[0] ?? '').split(';')[0];
  return typeof value === 'string' ? value.split(';')[0] : '';
}

test('the supervisor fixture requires a visible acknowledgement in the same session', async () => {
  const app = await buildApp();
  const search = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=88888',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const cookie = cookieFrom(search);

  assert.equal(search.statusCode, 200);
  assert.match(search.body, /SUPERVISOR_VERIFICATION_REQUIRED/);
  assert.match(search.body, /Acknowledge Supervisor Verification/i);
  assert.match(search.body, /method="post"/i);
  assert.match(search.body, /name="acknowledged"[^>]+value="yes"/i);

  const acknowledged = await app.inject({
    method: 'POST',
    url: '/servicing/member/88888/acknowledge-supervisor',
    payload: 'acknowledged=yes',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
  });

  assert.equal(acknowledged.statusCode, 200);
  assert.match(acknowledged.body, /Supervisor verification acknowledged/i);
  assert.match(acknowledged.body, /href="\/servicing\/member\/88888\/summary"[^>]*>Member Summary</i);

  await app.close();
});

test('supervisor acknowledgement rejects a session that never opened verification', async () => {
  const app = await buildApp();
  const ordinarySearch = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=12345',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/servicing/member/88888/acknowledge-supervisor',
    payload: 'acknowledged=yes',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieFrom(ordinarySearch),
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /original session/i);

  await app.close();
});

test('supervisor member summary remains gated until that session acknowledges', async () => {
  const app = await buildApp();
  const search = await app.inject({
    method: 'POST',
    url: '/servicing/member-search',
    payload: 'memberId=88888',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const summary = await app.inject({
    method: 'GET',
    url: '/servicing/member/88888/summary',
    headers: { cookie: cookieFrom(search) },
  });

  assert.equal(summary.statusCode, 200);
  assert.match(summary.body, /SUPERVISOR_VERIFICATION_REQUIRED/);
  assert.doesNotMatch(summary.body, /Member ID: 88888/);

  await app.close();
});
