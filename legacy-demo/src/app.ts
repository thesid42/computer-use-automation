import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import formbody from '@fastify/formbody';

type Session = {
  transientAttempts: Set<string>;
  pendingSupervisor: Set<string>;
  verified: Set<string>;
};

const SESSION_COOKIE = 'legacy_demo_session';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function sessionCookie(request: FastifyRequest): string | undefined {
  return request.headers.cookie?.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  )?.[1];
}

function sessionFor(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: Map<string, Session>,
): Session {
  const cookie = sessionCookie(request);
  const sessionId = cookie ?? randomUUID();
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      transientAttempts: new Set(),
      pendingSupervisor: new Set(),
      verified: new Set(),
    };
    sessions.set(sessionId, session);
  }
  if (!cookie) {
    reply.header(
      'set-cookie',
      `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
    );
  }
  return session;
}

function portal(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Member Servicing · MEMSERV</title>
  <style>
    html, body { height: 100%; }
    body { margin: 0; display: flex; flex-direction: column; color: #fff; background: #0f2a44; font: 13px Verdana, Arial, Helvetica, sans-serif; }
    .portalbar { display: flex; align-items: baseline; gap: 12px; padding: 8px 14px; border-bottom: 2px solid #d8b93a; }
    .portalbar b { font-size: 14px; letter-spacing: .02em; }
    .portalbar span { color: #b9c9d8; font-size: 11px; }
    .portal-options { padding: 9px 14px 10px; border-bottom: 1px solid #284a67; background: #163852; }
    .portal-options b { display: block; margin-bottom: 5px; color: #ffd97a; font-size: 11px; }
    .portal-options a { display: inline-block; margin: 0 5px 3px 0; padding: 3px 8px; color: #152c40; border: 2px outset #d4d0c8; background: #e8e4d8; font-size: 11px; font-weight: bold; text-decoration: none; }
    .portal-options a:active { border-style: inset; }
    iframe.workstation { flex: 1; width: 100%; min-height: 0; border: 0; background: #fff; }
  </style>
</head>
<body>
  <div class="portalbar"><b>Demo Credit Union · Member Servicing</b><span>Synthetic training environment — no real member data</span></div>
  <div class="portal-options" aria-label="Workstation options"><b>Workstation options</b><a href="/servicing">Member Search</a><a href="/servicing/overview">Member &amp; Account Overview</a><a href="/servicing/service-requests">Service Requests</a><a href="/servicing/branch-directory">Branch Directory</a><a href="/servicing/teller-totals">Teller Totals</a></div>
  <iframe class="workstation" title="Member Servicing Area" src="/servicing"></iframe>
</body>
</html>`;
}

type MemberProfile = {
  name: string;
  since: string;
  balance: string;
  available: string;
  contact: string;
  phone: string;
  transactions: Array<[string, string, string]>;
  loans?: LoanProfile[];
};

type LoanProfile = {
  id: string;
  type: string;
  maskedNumber: string;
  status: 'Open' | 'Closed';
  openedOn: string;
  principalCents: number;
  dailyAccrualCents: number;
};

const MEMBER_PROFILES: Record<string, MemberProfile> = {
  '12345': {
    name: 'Jordan Lee', since: '2011', balance: '$1,250.42', available: '$1,250.42',
    contact: '14 Elm St Apt 2, Riverton', phone: '(555) 014-2288',
    transactions: [
      ['2026-09-10', 'Payroll deduction', '$150.00'],
      ['2026-09-07', 'ATM withdrawal ****4242', '-$60.00'],
      ['2026-09-03', 'Dividend posting', '$0.41'],
      ['2026-08-28', 'Transfer to checking ****4310', '-$200.00'],
      ['2026-08-21', 'Payroll deduction', '$150.00'],
      ['2026-08-15', 'ATM withdrawal ****4242', '-$60.00'],
    ],
    loans: [{ id: 'auto-6655', type: 'Auto Loan', maskedNumber: '****6655', status: 'Open', openedOn: '2025-04-15', principalCents: 1875000, dailyAccrualCents: 41 }],
  },
  '77777': {
    name: 'Casey Morgan', since: '2018', balance: '$843.17', available: '$843.17',
  contact: '9 Foundry Rd, Riverton', phone: '(555) 019-3345',
    transactions: [
      ['2026-09-09', 'Payroll deduction', '$120.00'],
      ['2026-09-05', 'Debit purchase — grocery', '-$84.20'],
      ['2026-08-27', 'Payroll deduction', '$120.00'],
      ['2026-08-19', 'ATM withdrawal ****7721', '-$40.00'],
      ['2026-08-11', 'Dividend posting', '$0.22'],
    ],
    loans: [{ id: 'personal-7721', type: 'Personal Loan', maskedNumber: '****7721', status: 'Open', openedOn: '2024-11-02', principalCents: 960000, dailyAccrualCents: 23 }],
  },
};

const SERVICE_REQUESTS = [
  { id: 'SR-1048', memberId: '12345', opened: '2026-09-09', topic: 'Address update review', status: 'Open' },
  { id: 'SR-1031', memberId: '12345', opened: '2026-08-22', topic: 'Card delivery question', status: 'Closed' },
  { id: 'SR-0992', memberId: '77777', opened: '2026-08-05', topic: 'Statement copy request', status: 'Pending member' },
];

const BRANCHES = [
  { name: 'Downtown', code: '04', address: '18 Market Street, Riverton', hours: 'Mon–Fri 8:30 AM–5:00 PM', phone: '(555) 010-0404' },
  { name: 'Northside', code: '07', address: '250 North Avenue, Riverton', hours: 'Mon–Sat 9:00 AM–4:00 PM', phone: '(555) 010-0707' },
  { name: 'Lakeside', code: '11', address: '72 Harbor Road, Riverton', hours: 'Mon–Fri 9:00 AM–5:00 PM', phone: '(555) 010-1111' },
];

function memberFor(memberId: string): MemberProfile {
  return MEMBER_PROFILES[memberId] ?? {
    name: 'Valued Member', since: '—', balance: '$0.00', available: '$0.00',
    contact: 'On file', phone: 'On file', transactions: [],
  };
}

function memberIdForQuery(value: string): string | undefined {
  const query = value.trim().toLowerCase();
  if (!query) return undefined;
  if (MEMBER_PROFILES[query]) return query;
  return Object.entries(MEMBER_PROFILES).find(([, profile]) => profile.name.toLowerCase() === query)?.[0];
}

function overviewContent(memberQuery = ''): string {
  const query = escapeHtml(memberQuery);
  const memberId = memberIdForQuery(memberQuery);
  if (!memberQuery) {
    return '<h1>Member &amp; Account Overview</h1>' +
      '<p class="muted">Open a synthetic member record by ID or exact name. This screen is read-only.</p>' +
      '<form method="get" action="/servicing/overview"><table class="form-table"><tr><th><label for="overview-member">Member ID or Name</label></th><td><input id="overview-member" name="memberId" type="text" value="" autocomplete="off" required></td></tr></table><button type="submit">Open Overview</button></form>';
  }
  if (!memberId) {
    return '<h1>Member &amp; Account Overview</h1><p class="outcome">MEMBER_NOT_FOUND</p><p>No synthetic member matched <b>' + query + '</b>.</p><p class="backlink"><a href="/servicing/overview">Try another search</a></p>';
  }
  const id = escapeHtml(memberId);
  const profile = memberFor(memberId);
  return '<h1>Member &amp; Account Overview</h1>' +
    '<p class="backlink"><a href="/servicing/overview">« New Overview Search</a> · <a href="/servicing/member/' + id + '/summary">Full Member Summary</a></p>' +
    '<table class="grid"><caption>Member overview</caption><tr><th>Member ID</th><td>' + id + '</td></tr><tr><th>Member Name</th><td>' + escapeHtml(profile.name) + '</td></tr><tr><th>Branch</th><td>04 — Downtown</td></tr><tr><th>Status</th><td>Active</td></tr></table>' +
    '<table class="grid"><caption>Available accounts</caption><thead><tr><th>Account</th><th>Balance / status</th><th>Open</th></tr></thead><tbody>' +
      '<tr><td>Share Savings</td><td>' + escapeHtml(profile.balance) + '</td><td><a href="/servicing/member/' + id + '/accounts/savings">View</a></td></tr>' +
      '<tr><td>Loan Accounts</td><td>' + escapeHtml(profile.loans?.length ? profile.loans[0].status : 'None') + '</td><td><a href="/servicing/member/' + id + '/accounts/loans">View</a></td></tr>' +
    '</tbody></table>';
}

function serviceRequestsContent(memberQuery = '', statusFilter = ''): string {
  const memberId = memberIdForQuery(memberQuery);
  const visible = SERVICE_REQUESTS.filter((request) => (!memberId || request.memberId === memberId) && (!statusFilter || request.status === statusFilter));
  const rows = visible.map((request) => '<tr><td>' + escapeHtml(request.id) + '</td><td>' + escapeHtml(request.memberId) + '</td><td>' + escapeHtml(request.opened) + '</td><td>' + escapeHtml(request.topic) + '</td><td>' + escapeHtml(request.status) + '</td></tr>').join('');
  const query = escapeHtml(memberQuery);
  return '<h1>Service Requests</h1><p class="muted">Read-only queue of synthetic member requests. No request can be changed from this screen.</p>' +
    '<form method="get" action="/servicing/service-requests"><table class="form-table"><tr><th><label for="service-member">Member ID or Name (optional)</label></th><td><input id="service-member" name="memberId" type="text" value="' + query + '" autocomplete="off"></td></tr><tr><th><label for="service-status">Status</label></th><td><select id="service-status" name="status"><option value="">All statuses</option><option value="Open"' + (statusFilter === 'Open' ? ' selected' : '') + '>Open</option><option value="Pending member"' + (statusFilter === 'Pending member' ? ' selected' : '') + '>Pending member</option><option value="Closed"' + (statusFilter === 'Closed' ? ' selected' : '') + '>Closed</option></select></td></tr></table><button type="submit">Filter Requests</button></form>' +
    '<table class="grid" aria-label="Service requests"><caption>Service request queue</caption><thead><tr><th>Request</th><th>Member ID</th><th>Opened</th><th>Topic</th><th>Status</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">No requests found for that member.</td></tr>') + '</tbody></table>';
}

function branchDirectoryContent(city = ''): string {
  const query = escapeHtml(city);
  const visible = city ? BRANCHES.filter((branch) => (branch.name + ' ' + branch.address + ' Riverton').toLowerCase().includes(city.toLowerCase())) : BRANCHES;
  const rows = visible.map((branch) => '<tr><td>' + escapeHtml(branch.code) + '</td><td>' + escapeHtml(branch.name) + '</td><td>' + escapeHtml(branch.address) + '</td><td>' + escapeHtml(branch.hours) + '</td><td>' + escapeHtml(branch.phone) + '</td></tr>').join('');
  return '<h1>Branch Directory</h1><p class="muted">Synthetic branch locations and hours for the Member Servicing workstation.</p><form method="get" action="/servicing/branch-directory"><table class="form-table"><tr><th><label for="branch-city">City or branch</label></th><td><input id="branch-city" name="city" type="search" value="' + query + '" placeholder="Riverton" autocomplete="off"></td></tr></table><button type="submit">Find Branches</button></form><table class="grid" aria-label="Branch directory"><caption>Branch directory</caption><thead><tr><th>Code</th><th>Branch</th><th>Address</th><th>Hours</th><th>Phone</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">No branches matched that search.</td></tr>') + '</tbody></table>';
}

function parseDateOnly(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

function compareDateOnly(left: string, right: string): number {
  return left.localeCompare(right);
}

function money(cents: number): string {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function payoffAmount(loan: LoanProfile, asOfDate: string): string {
  const days = Math.round((Date.parse(asOfDate + 'T00:00:00Z') - Date.parse(loan.openedOn + 'T00:00:00Z')) / 86_400_000);
  return money(loan.principalCents + (days * loan.dailyAccrualCents));
}

function transactionHistoryContent(memberId: string, startDate = '', endDate = '', outcome?: string): string {
  const id = escapeHtml(memberId);
  const safeStart = escapeHtml(startDate);
  const safeEnd = escapeHtml(endDate);
  const profile = memberFor(memberId);
  const validRange = parseDateOnly(startDate) && parseDateOnly(endDate) && compareDateOnly(startDate, endDate) <= 0;
  const matches = validRange
    ? profile.transactions.filter(([date]) => compareDateOnly(date, startDate) >= 0 && compareDateOnly(date, endDate) <= 0)
    : [];
  const rows = matches.map(([date, description, amount]) =>
    '<tr><td>' + escapeHtml(date) + '</td><td>' + escapeHtml(description) + '</td><td>' + escapeHtml(amount) + '</td></tr>',
  ).join('');
  const result = outcome === 'INVALID_DATE_RANGE'
    ? '<p class="error">INVALID_DATE_RANGE</p><p>Enter valid calendar dates with the start date on or before the end date.</p>'
    : outcome === 'NO_TRANSACTIONS'
      ? '<p class="outcome">NO_TRANSACTIONS</p><p>No posted transactions were found in the requested date range.</p>'
      : '';
  const table = outcome === 'NO_TRANSACTIONS' || (validRange && !outcome)
    ? '<table class="grid" aria-label="Transaction results"><caption>Transaction results</caption><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3">No matching transactions</td></tr>') + '</tbody></table>'
    : '';
  return '<h1>Transaction History</h1>' +
    '<p class="backlink"><a href="/servicing/member/' + id + '/accounts/savings">« Back to Savings Account</a> · <a href="/servicing">New Search</a></p>' +
    '<p class="kv">Member ID: ' + id + ' · Share ID 01 — posted items.</p>' +
    '<h2>Search posted transactions</h2>' +
    '<form method="post" action="/servicing/member/' + id + '/accounts/savings/transactions/search">' +
      '<table class="form-table"><tr><th><label for="start-date">Start Date</label></th><td><input id="start-date" name="startDate" type="date" value="' + safeStart + '" required></td></tr>' +
      '<tr><th><label for="end-date">End Date</label></th><td><input id="end-date" name="endDate" type="date" value="' + safeEnd + '" required></td></tr></table>' +
      '<button type="submit">Search Transactions</button></form>' +
    (startDate || endDate ? result + table : '<p class="notice">Enter a start and end date, then select Search Transactions.</p>');
}

function loanFor(memberId: string, loanId: string): LoanProfile | undefined {
  return memberFor(memberId).loans?.find((loan) => loan.id === loanId);
}

function loanAccountsContent(memberId: string): string {
  const id = escapeHtml(memberId);
  const loans = memberFor(memberId).loans ?? [];
  const rows = loans.map((loan) =>
    '<tr><td><a href="/servicing/member/' + id + '/accounts/loans/' + escapeHtml(loan.id) + '">' + escapeHtml(loan.type) + '</a></td><td>' +
    escapeHtml(loan.maskedNumber) + '</td><td>' + escapeHtml(loan.status) + '</td><td><a href="/servicing/member/' + id + '/accounts/loans/' +
    escapeHtml(loan.id) + '">Open</a></td></tr>',
  ).join('');
  return '<h1>Loan Accounts</h1>' +
    '<p class="backlink"><a href="/servicing/member/' + id + '/accounts">« Back to Accounts</a> · <a href="/servicing">New Search</a></p>' +
    '<p class="kv">Member ID: ' + id + '</p>' +
    (loans.length
      ? '<table class="grid" aria-label="Loan accounts"><caption>Loan accounts</caption><thead><tr><th>Account</th><th>Account No.</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<p class="outcome">NO_LOAN</p><p>No loan accounts are available for this member.</p>');
}

function loanDetailContent(memberId: string, loanId: string): string {
  const id = escapeHtml(memberId);
  const loan = loanFor(memberId, loanId);
  if (!loan) {
    return '<h1>Loan Account</h1><p class="backlink"><a href="/servicing/member/' + id + '/accounts/loans">« Back to Loan Accounts</a></p>' +
      '<p class="outcome">NO_LOAN</p><p>No matching loan account was found.</p>';
  }
  const safeLoanId = escapeHtml(loan.id);
  return '<h1>' + escapeHtml(loan.type) + '</h1>' +
    '<p class="backlink"><a href="/servicing/member/' + id + '/accounts/loans">« Back to Loan Accounts</a> · <a href="/servicing">New Search</a></p>' +
    '<p class="kv">Member ID: ' + id + '</p>' +
    '<table class="grid" aria-label="Loan account detail"><caption>Loan account detail</caption>' +
      '<tr><th>Loan Type</th><td>' + escapeHtml(loan.type) + '</td></tr><tr><th>Account No.</th><td>' + escapeHtml(loan.maskedNumber) + '</td></tr>' +
      '<tr><th>Status</th><td>' + escapeHtml(loan.status) + '</td></tr><tr><th>Opened On</th><td>' + escapeHtml(loan.openedOn) + '</td></tr></table>' +
    '<a class="button" href="/servicing/member/' + id + '/accounts/loans/' + safeLoanId + '/payoff-quote">Request Payoff Quote</a>';
}

function payoffQuoteContent(memberId: string, loanId: string, asOfDate = '', outcome?: string): string {
  const id = escapeHtml(memberId);
  const loan = loanFor(memberId, loanId);
  if (!loan) return '<h1>Payoff Quote</h1><p class="outcome">NO_LOAN</p><p>No matching loan account was found.</p>';
  const safeLoanId = escapeHtml(loan.id);
  const safeDate = escapeHtml(asOfDate);
  let result = '';
  if (outcome === 'INVALID_AS_OF_DATE') {
    result = '<p class="error">INVALID_AS_OF_DATE</p><p>Enter a valid calendar date in YYYY-MM-DD format.</p>';
  } else if (outcome === 'UNSUPPORTED_AS_OF_DATE') {
    result = '<p class="outcome">UNSUPPORTED_AS_OF_DATE</p><p>Quotes are available from ' + escapeHtml(loan.openedOn) + ' through 2026-12-31.</p>';
  } else if (asOfDate) {
    result = '<table class="grid" aria-label="Payoff quote result"><caption>Payoff quote review</caption><tr><th>As-of Date</th><td>' + safeDate +
      '</td></tr><tr><th>Payoff Amount</th><td>' + payoffAmount(loan, asOfDate) + '</td></tr></table>' +
      '<p class="notice">READ-ONLY QUOTE — no payment or account change was submitted.</p>';
  }
  return '<h1>Request Payoff Quote</h1>' +
    '<p class="backlink"><a href="/servicing/member/' + id + '/accounts/loans/' + safeLoanId + '">« Back to ' + escapeHtml(loan.type) + '</a> · <a href="/servicing">New Search</a></p>' +
    '<p class="kv">Member ID: ' + id + ' · Loan ' + safeLoanId + '</p>' +
    '<form method="post" action="/servicing/member/' + id + '/accounts/loans/' + safeLoanId + '/payoff-quote">' +
      '<table class="form-table"><tr><th><label for="as-of-date">As-of Date</label></th><td><input id="as-of-date" name="asOfDate" type="date" value="' + safeDate + '" required></td></tr></table>' +
      '<button type="submit">Request Payoff Quote</button></form>' +
    result;
}

function page(title: string, content: string, _opts: { breadcrumb?: string } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · MEMSERV</title>
  <style>
    body { margin: 0; padding: 0; color: #1a1a1a; background: #5a6b7a; font: 13px Verdana, Arial, Helvetica, sans-serif; }
    .sysbar { padding: 2px 10px; color: #fff; background: #7a1f1f; font: bold 11px Verdana, Arial, sans-serif; letter-spacing: .04em; }
    .banner { border-bottom: 3px double #0f2a44; background: #0f2a44; }
    .banner table { width: 100%; max-width: 980px; margin: auto; border-collapse: collapse; }
    .banner td { padding: 10px 14px; color: #fff; vertical-align: middle; }
    .crest { width: 54px; height: 44px; color: #0f2a44; background: #d8b93a; font: bold 20px Georgia, serif; text-align: center; vertical-align: middle; border: 2px outset #fff; }
    .banner h1 { margin: 0; color: #fff; font: bold 17px Verdana, Arial, sans-serif; letter-spacing: .02em; }
    .banner .sub { margin-top: 2px; color: #b9c9d8; font-size: 11px; }
    .banner .session { text-align: right; font-size: 11px; line-height: 1.6; white-space: nowrap; }
    .banner .session b { color: #ffd97a; }
    .menubar { border-bottom: 1px solid #0f2a44; background: #d4d0c8; }
    .menubar div { max-width: 980px; margin: auto; padding: 4px 14px; }
    .menubar span, .menubar a { display: inline-block; margin-right: 4px; padding: 3px 10px; border: 1px solid transparent; font-size: 11px; font-weight: bold; color: #1a1a1a; text-decoration: none; }
    .menubar a { border: 1px outset #fff; background: #e8e4d8; }
    .menubar a:active { border-style: inset; }
    .menubar .menu-idle { color: #555; }
    .backlink { margin: 0 0 .6rem; font-size: 12px; }
    .crumb { max-width: 980px; margin: 8px auto 0; padding: 0 14px; color: #e8edf1; font-size: 11px; }
    main { max-width: 980px; margin: 8px auto 12px; padding: 0 14px; }
    .panel { border: 2px outset #fff; background: #f4f1e8; }
    .panel-title { padding: 5px 10px; color: #fff; background: #0f2a44; font-size: 12px; font-weight: bold; letter-spacing: .03em; }
    .panel-body { padding: 12px 14px 14px; }
    h1 { margin-top: 0; color: #0f2a44; font-size: 1.25rem; }
    h2 { color: #0f2a44; font-size: 1.05rem; }
    label { display: block; margin: 0.8rem 0 0.3rem; font-weight: bold; font-size: 12px; }
    .field-no { color: #7a1f1f; font-weight: bold; }
    input { width: 18rem; padding: 0.45rem; border: 2px inset #d4d0c8; font: 14px "Courier New", monospace; }
    button, .button { display: inline-block; margin-top: 0.8rem; margin-right: .5rem; padding: 0.45rem 0.85rem; border: 2px outset #d4d0c8; color: #fff; background: #315875; font-weight: bold; text-decoration: none; cursor: pointer; font-size: 12px; }
    button:active, .button:active { border-style: inset; }
    button.risky { border-color: #8d2f2f; background: #a33b3b; }
    table.grid { width: 100%; border-collapse: collapse; margin: 1rem 0; background: #fff; }
    table.grid caption { margin-bottom: 0.45rem; text-align: left; font-weight: bold; color: #0f2a44; }
    table.grid th, table.grid td { padding: 0.55rem; border: 1px solid #9aa8b5; text-align: left; font-size: 12px; }
    table.grid th { background: #0f2a44; color: #fff; }
    table.grid tr:nth-child(even) td { background: #eef2f6; }
    table.form-table { border-collapse: collapse; margin: .6rem 0; background: #fff; }
    table.form-table th, table.form-table td { border: 1px solid #9aa8b5; padding: .5rem .7rem; font-size: 12px; }
    table.form-table th { background: #dce5ec; color: #0f2a44; text-align: right; white-space: nowrap; }
    nav.tabs { margin: 0.8rem 0 1.2rem; padding: 0; background: transparent; }
    nav.tabs a { display: inline-block; margin-right: .3rem; padding: .4rem .9rem; border: 2px outset #fff; background: #dce5ec; color: #0f2a44; font-weight: bold; font-size: 12px; text-decoration: none; }
    .notice { padding: 0.7rem; background: #eef4f8; border-left: 4px solid #315875; font-size: 12px; }
    .outcome { padding: 0.7rem; background: #fff4d6; border-left: 4px solid #bd861d; font-weight: bold; }
    .error { padding: 0.7rem; background: #fbe7e7; border-left: 4px solid #a33b3b; font-weight: bold; }
    .muted { color: #53616d; font-size: 12px; }
    .kv { font-size: 12px; }
    dl.balance { display: grid; grid-template-columns: 220px 1fr; gap: .4rem 1rem; background: #fff; border: 1px solid #9aa8b5; padding: .8rem 1rem; font-size: 13px; }
    dl.balance dt { font-weight: bold; color: #0f2a44; }
    dl.balance dd { margin: 0; font: bold 15px "Courier New", monospace; }
    .statusbar { border-top: 1px solid #0f2a44; background: #d4d0c8; }
    .statusbar div { max-width: 980px; margin: auto; padding: 4px 14px; font-size: 11px; color: #333; }
    .help { margin-top: .8rem; font-size: 11px; color: #53616d; }
    iframe.workstation { width: 100%; height: 640px; border: 2px inset #fff; background: #fff; }
  </style>
</head>
<body>
  <div class="sysbar">SYNTHETIC TRAINING ENVIRONMENT — NO REAL MEMBER DATA — MEMSERV v4.2</div>
  <div class="banner"><table><tr>
    <td class="crest">DCU</td>
    <td><h1>Demo Credit Union · Member Servicing</h1><div class="sub">Legacy servicing workstation · Core host MEMSERV v4.2 · All records synthetic</div></td>
    <td class="session">Operator <b>TELLER-07</b> · Branch <b>04</b><br>Session <b>legacy-demo</b> · Screen <b>${escapeHtml(title)}</b></td>
  </tr></table></div>
  <div class="menubar"><div><a href="/servicing">Member Search</a><a href="/servicing/overview">Member &amp; Account Overview</a><a href="/servicing/service-requests">Service Requests</a><a href="/servicing/branch-directory">Branch Directory</a><a href="/servicing/teller-totals">Teller Totals</a><a href="/servicing/end-session">End Session</a></div></div>
  <main><div class="panel"><div class="panel-title">${escapeHtml(title)}</div><div class="panel-body">${content}</div></div></main>
  <div class="statusbar"><div>Workstation TELLER-07 · Branch 04 · Host MEMSERV v4.2 · Help desk x4419</div></div>
</body>
</html>`;
}

function html(reply: FastifyReply, title: string, content: string, breadcrumb?: string) {
  return reply.type('text/html; charset=utf-8').send(page(title, content, { breadcrumb: breadcrumb ?? title }));
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  const sessions = new Map<string, Session>();
  app.addHook('onClose', async () => { sessions.clear(); });

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(portal()));

  app.get('/servicing', async (_request, reply) => html(reply, 'Member Search', `
    <h1>Member Search</h1>
    <form method="post" action="/servicing/member-search">
      <table class="form-table">
        <tr><th><span class="field-no">001</span> <label for="member-id" style="display:inline">Member ID</label></th>
        <td><input id="member-id" name="memberId" type="text" autocomplete="off" required maxlength="12"></td></tr>
      </table>
      <button type="submit">Search</button>
    </form>
  `, 'Member Search'));

  app.get('/servicing/overview', async (request, reply) => {
    const query = request.query as { memberId?: string };
    return html(reply, 'Member & Account Overview', overviewContent(query.memberId?.trim() ?? ''), 'Member &amp; Account Overview');
  });

  app.get('/servicing/service-requests', async (request, reply) => {
    const query = request.query as { memberId?: string; status?: string };
    return html(reply, 'Service Requests', serviceRequestsContent(query.memberId?.trim() ?? '', query.status?.trim() ?? ''), 'Service Requests');
  });

  app.get('/servicing/branch-directory', async (request, reply) => {
    const query = request.query as { city?: string };
    return html(reply, 'Branch Directory', branchDirectoryContent(query.city?.trim() ?? ''), 'Branch Directory');
  });

  app.post('/servicing/member-search', async (request, reply) => {
    const body = request.body as { memberId?: string };
    const memberId = body.memberId?.trim() ?? '';
    const session = sessionFor(request, reply, sessions);

    if (memberId === '12345') {
      return html(reply, 'Search Results', `
        <h1>Search Results</h1>
        <table class="grid">
          <caption>Matching members</caption>
          <thead><tr><th>Member ID</th><th>Member Name</th><th>Branch</th><th>Action</th></tr></thead>
          <tbody><tr><td>12345</td><td>Jordan Lee</td><td>04</td><td><a href="/servicing/member/12345/summary">Member Summary</a></td></tr></tbody>
        </table>
      `, 'Member Search &gt; Search Results');
    }

    if (memberId === '88888') {
      session.pendingSupervisor.add(memberId);
      return html(reply, 'Supervisor Verification', `
        <h1>Supervisor Verification</h1>
        <p class="outcome">SUPERVISOR_VERIFICATION_REQUIRED</p>
        <p>A supervisor must review this synthetic member record before servicing can continue.</p>
        <form method="post" action="/servicing/member/88888/acknowledge-supervisor">
          <input type="hidden" name="acknowledged" value="yes">
          <button type="submit">Acknowledge Supervisor Verification</button>
        </form>
      `);
    }

    if (memberId === '77777' && !session.transientAttempts.has(memberId)) {
      session.transientAttempts.add(memberId);
      return html(reply, 'Temporary Service Issue', `
        <h1>Search Results</h1>
        <p class="error">TEMPORARY_LOAD_FAILURE</p>
        <p>The member service is temporarily unavailable.</p>
        <form method="post" action="/servicing/member-search">
          <input type="hidden" name="memberId" value="77777">
          <button type="submit">Retry Search</button>
        </form>
      `);
    }

    if (memberId === '77777') {
      return html(reply, 'Search Results', `
        <h1>Search Results</h1>
        <table class="grid"><caption>Matching members</caption><thead><tr><th>Member ID</th><th>Member Name</th><th>Branch</th><th>Action</th></tr></thead>
        <tbody><tr><td>77777</td><td>Casey Morgan</td><td>04</td><td><a href="/servicing/member/77777/summary">Member Summary</a></td></tr></tbody></table>
      `, 'Member Search &gt; Search Results');
    }

    if (memberId === '54321') {
      return html(reply, 'Search Results', `
        <h1>Search Results</h1>
        <p class="outcome">PERMISSION_DENIED</p>
        <p>Permission denied for this member record.</p>
        <p class="backlink"><a href="/servicing">Return to Member Search</a></p>
      `);
    }

    return html(reply, 'Search Results', `
      <h1>Search Results</h1>
      <p class="outcome">MEMBER_NOT_FOUND</p>
      <p>No matching member found.</p>
      <p class="backlink"><a href="/servicing">Return to Member Search</a></p>
    `);
  });

  app.post('/servicing/member/:memberId/acknowledge-supervisor', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const body = request.body as { acknowledged?: string };
    const cookie = sessionCookie(request);
    if (memberId !== '88888' || !cookie || body.acknowledged !== 'yes') {
      return reply.code(400).type('text/html; charset=utf-8').send(page('Verification Error', `
        <h1>Verification Error</h1><p class="error">Supervisor acknowledgement must be completed in the original session.</p>
      `));
    }
    const session = sessionFor(request, reply, sessions);
    if (!session.pendingSupervisor.has(memberId)) {
      return reply.code(400).type('text/html; charset=utf-8').send(page('Verification Error', `
        <h1>Verification Error</h1><p class="error">Supervisor acknowledgement must be completed in the original session.</p>
      `));
    }
    session.pendingSupervisor.delete(memberId);
    session.verified.add(memberId);
    return html(reply, 'Supervisor Verification', `
      <h1>Supervisor Verification</h1>
      <p class="notice">Supervisor verification acknowledged for this session. Acknowledged. Continue to Member Summary.</p>
      <a class="button" href="/servicing/member/88888/summary">Member Summary</a>
    `);
  });

  app.post('/servicing/member/:memberId/accounts/post-fee', async (_request, reply) => {
    return reply.code(403).type('text/html; charset=utf-8').send(page('Post Fee Restricted', `
      <h1>Post Fee</h1>
      <p class="error">This restricted write action is not available in the synthetic read-only demo.</p>
    `));
  });

  app.get('/servicing/member/:memberId/summary', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    if (memberId === '88888') {
      const sessionId = sessionCookie(request);
      if (!sessionId || !sessions.get(sessionId)?.verified.has(memberId)) {
        return html(reply, 'Supervisor Verification', `
          <h1>Supervisor Verification</h1>
          <p class="outcome">SUPERVISOR_VERIFICATION_REQUIRED</p>
          <p>Supervisor acknowledgement is required before this member summary can be opened.</p>
        `);
      }
    }
    const id = escapeHtml(memberId);
    const profile = memberFor(memberId);
    return html(reply, 'Member Summary', `
      <h1>Member Summary</h1>
      <p class="backlink"><a href="/servicing">« New Search</a></p>
      <p class="kv">Member ID: ${id}</p>
      <nav class="tabs"><a href="/servicing/member/${id}/accounts">Accounts</a><a href="/servicing/service-requests?memberId=${encodeURIComponent(memberId)}">Member Service Requests</a></nav>
      <table class="grid"><caption>Member record</caption>
        <tr><th>Member ID</th><td>${id}</td></tr>
        <tr><th>Member Name</th><td>${escapeHtml(profile.name)}</td></tr>
        <tr><th>Servicing Status</th><td>Active</td></tr>
        <tr><th>Branch</th><td>04 — Downtown</td></tr>
        <tr><th>Member Since</th><td>${escapeHtml(profile.since)}</td></tr>
      </table>
      <table class="grid"><caption>Contact on file</caption>
        <tr><th>Address</th><td>${escapeHtml(profile.contact)}</td></tr>
        <tr><th>Phone</th><td>${escapeHtml(profile.phone)}</td></tr>
      </table>
      <table class="grid"><caption>Notices</caption>
        <tr><th>Address on file</th><td>Verified 2024</td></tr>
        <tr><th>Holds</th><td>None</td></tr>
      </table>
    `, 'Member Search &gt; Member Summary');
  });

  app.get('/servicing/member/:memberId/accounts', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const id = escapeHtml(memberId);
    return html(reply, 'Accounts', `
      <h1>Accounts</h1>
      <p class="backlink"><a href="/servicing/member/${id}/summary">« Back to Member Summary</a> · <a href="/servicing">New Search</a></p>
      <p class="kv">Member ID: ${id}</p>
      <table class="grid">
        <caption>Share accounts</caption>
        <thead><tr><th>Account</th><th>Account No.</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td><a href="/servicing/member/${id}/accounts/savings">Savings Account</a></td><td>****4242</td><td>Open</td><td><form method="post" action="/servicing/member/${id}/accounts/post-fee"><button class="risky" type="submit">Post Fee</button></form></td></tr>
          <tr><td>Share Certificate</td><td>****9871</td><td>Closed 2023</td><td>—</td></tr>
        </tbody>
      </table>
      <table class="grid">
        <caption>Loan accounts</caption>
        <thead><tr><th>Account</th><th>Account No.</th><th>Status</th><th>Action</th></tr></thead>
        <tbody><tr><td><a href="/servicing/member/${id}/accounts/loans">Loan Accounts</a></td><td>Review account list</td><td>Available</td><td><a href="/servicing/member/${id}/accounts/loans">Open</a></td></tr></tbody>
      </table>
    `, 'Member Search &gt; Member Summary &gt; Accounts');
  });

  app.get('/servicing/member/:memberId/accounts/loans', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    return html(reply, 'Loan Accounts', loanAccountsContent(memberId), 'Member Search &gt; Member Summary &gt; Accounts &gt; Loan Accounts');
  });

  app.get('/servicing/member/:memberId/accounts/loans/:loanId', async (request, reply) => {
    const { memberId, loanId } = request.params as { memberId: string; loanId: string };
    return html(reply, 'Loan Account', loanDetailContent(memberId, loanId), 'Member Search &gt; Member Summary &gt; Accounts &gt; Loan Account');
  });

  app.get('/servicing/member/:memberId/accounts/loans/:loanId/payoff-quote', async (request, reply) => {
    const { memberId, loanId } = request.params as { memberId: string; loanId: string };
    return html(reply, 'Request Payoff Quote', payoffQuoteContent(memberId, loanId), 'Payoff Quote');
  });

  app.post('/servicing/member/:memberId/accounts/loans/:loanId/payoff-quote', async (request, reply) => {
    const { memberId, loanId } = request.params as { memberId: string; loanId: string };
    const body = request.body as { asOfDate?: string };
    const asOfDate = body.asOfDate?.trim() ?? '';
    const parsed = parseDateOnly(asOfDate);
    const loan = loanFor(memberId, loanId);
    let outcome: string | undefined;
    if (!loan) outcome = 'NO_LOAN';
    else if (!parsed) outcome = 'INVALID_AS_OF_DATE';
    else if (compareDateOnly(parsed, loan.openedOn) < 0 || compareDateOnly(parsed, '2026-12-31') > 0) outcome = 'UNSUPPORTED_AS_OF_DATE';
    return html(reply, 'Request Payoff Quote', payoffQuoteContent(memberId, loanId, asOfDate, outcome), 'Payoff Quote');
  });

  app.get('/servicing/member/:memberId/accounts/savings', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const id = escapeHtml(memberId);
    return html(reply, 'Savings Account', `
      <h1>Savings Account</h1>
      <p class="backlink"><a href="/servicing/member/${id}/accounts">« Back to Accounts</a> · <a href="/servicing">New Search</a></p>
      <p class="kv">Member ID: ${id}</p>
      <table class="grid"><caption>Account detail</caption>
        <tr><th>Account Type</th><td>Share Savings</td></tr>
        <tr><th>Account No.</th><td>****4242</td></tr>
        <tr><th>Status</th><td>Open</td></tr>
        <tr><th>Dividend Rate</th><td>0.40% APY</td></tr>
      </table>
      <a class="button" href="/servicing/member/${id}/accounts/savings/balance">Balance Details</a>
      <a class="button" href="/servicing/member/${id}/accounts/savings/transactions">Transaction History</a>
    `, 'Member Search &gt; Member Summary &gt; Accounts &gt; Savings Account');
  });

  app.get('/servicing/member/:memberId/accounts/savings/transactions', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const id = escapeHtml(memberId);
    const rows = memberFor(memberId).transactions
      .map(([date, description, amount]) => `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(description)}</td><td>${escapeHtml(amount)}</td></tr>`)
      .join('');
    return html(reply, 'Transaction History', `
      <h1>Transaction History</h1>
      <p class="backlink"><a href="/servicing/member/${id}/accounts/savings">« Back to Savings Account</a> · <a href="/servicing">New Search</a></p>
      <p class="kv">Member ID: ${id} · Share ID 01 — posted items.</p>
      <h2>Search posted transactions</h2>
      <form method="post" action="/servicing/member/${id}/accounts/savings/transactions/search">
        <table class="form-table"><tr><th><label for="start-date">Start Date</label></th><td><input id="start-date" name="startDate" type="date" required></td></tr>
        <tr><th><label for="end-date">End Date</label></th><td><input id="end-date" name="endDate" type="date" required></td></tr></table>
        <button type="submit">Search Transactions</button>
      </form>
      <table class="grid"><caption>Posted transactions</caption>
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `, 'Transaction History');
  });

  app.post('/servicing/member/:memberId/accounts/savings/transactions/search', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const body = request.body as { startDate?: string; endDate?: string };
    const startDate = body.startDate?.trim() ?? '';
    const endDate = body.endDate?.trim() ?? '';
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    let outcome: string | undefined;
    if (!start || !end || compareDateOnly(startDate, endDate) > 0) outcome = 'INVALID_DATE_RANGE';
    else if (!memberFor(memberId).transactions.some(([date]) => compareDateOnly(date, startDate) >= 0 && compareDateOnly(date, endDate) <= 0)) outcome = 'NO_TRANSACTIONS';
    return html(reply, 'Transaction History', transactionHistoryContent(memberId, startDate, endDate, outcome), 'Transaction History');
  });

  app.get('/servicing/member/:memberId/accounts/savings/balance', async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const id = escapeHtml(memberId);
    const profile = memberFor(memberId);
    return html(reply, 'Balance Details', `
      <h1>Balance Details</h1>
      <p class="backlink"><a href="/servicing/member/${id}/accounts/savings">« Back to Savings Account</a> · <a href="/servicing">New Search</a></p>
      <p class="kv">Member ID: ${id}</p>
      <dl class="balance"><dt>Current Balance</dt><dd>${escapeHtml(profile.balance)}</dd></dl>
      <table class="grid"><caption>Balance breakdown</caption>
        <tr><th>Available Balance</th><td>${escapeHtml(profile.available)}</td></tr>
        <tr><th>Holds</th><td>$0.00</td></tr>
        <tr><th>Last Dividend Posted</th><td>${escapeHtml(profile.transactions[0]?.[2] ?? '$0.00')} on the 1st</td></tr>
      </table>
    `, 'Member Search &gt; Member Summary &gt; Accounts &gt; Savings Account &gt; Balance Details');
  });

  app.get('/servicing/teller-totals', async (_request, reply) => html(reply, 'Teller Totals', `
    <h1>Teller Totals</h1>
    <p class="kv">Workstation TELLER-07 · Branch 04 · Synthetic business day.</p>
    <table class="grid"><caption>Drawer totals</caption>
      <tr><th>Opening Cash</th><td>$12,000.00</td></tr>
      <tr><th>Deposits Posted</th><td>$4,830.00</td></tr>
      <tr><th>Withdrawals Paid</th><td>$2,175.50</td></tr>
      <tr><th>Expected Cash</th><td>$14,654.50</td></tr>
    </table>
    <table class="grid"><caption>Transaction counts</caption>
      <tr><th>Member Searches</th><td>31</td></tr>
      <tr><th>Balance Inquiries</th><td>22</td></tr>
      <tr><th>Supervisor Overrides</th><td>2</td></tr>
    </table>
  `));

  app.get('/servicing/end-session', async (request, reply) => {
    const cookie = sessionCookie(request);
    if (cookie) {
      sessions.delete(cookie);
      reply.header('set-cookie', `${SESSION_COOKIE}=ended; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    }
    return html(reply, 'Session Ended', `
      <h1>Session Ended</h1>
      <p class="notice">Workstation session closed. Supervisor items and retry state were cleared with this session.</p>
      <a class="button" href="/servicing">Start New Session</a>
    `);
  });

  return app;
}
