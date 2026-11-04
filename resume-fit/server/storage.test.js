import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { supabaseStore } from './storage/supabase.js';
import { createPayments } from './payments.js';

function remoteFixture() {
  const rows = { rf_purchases: new Map(), rf_runs: new Map(), rf_ai_usage: new Map() };
  const files = new Map(),
    calls = [];
  const control = { fail: null, public: false, tamper: false };
  const secret = 'sb_secret_test_server_only';
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(raw),
      method = options.method || 'GET';
    calls.push({ url, method, headers: options.headers });
    assert.equal(options.headers.apikey, secret);
    assert.equal(
      options.headers.Authorization,
      undefined,
      'New secret key must not be treated as a JWT',
    );
    assert.equal(options.redirect, 'error');
    if (control.fail?.(url, method)) return Response.json({ error: secret }, { status: 503 });
    if (url.pathname.startsWith('/storage/v1/bucket/'))
      return Response.json({ public: control.public });
    if (url.pathname === '/rest/v1/rpc/rf_consume_ai_budget') {
      const data = JSON.parse(options.body),
        used = rows.rf_ai_usage.get(data.p_day) || 0;
      if (used >= data.p_limit) return Response.json(false);
      rows.rf_ai_usage.set(data.p_day, used + 1);
      return Response.json(true);
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      if (method === 'DELETE') {
        for (const path of JSON.parse(options.body).prefixes) files.delete(path);
        return Response.json({});
      }
      const path = url.pathname
        .replace('/storage/v1/object/', '')
        .replace(/^authenticated\//, '')
        .split('/')
        .slice(1)
        .join('/');
      if (method === 'POST') {
        assert.equal(options.headers['x-upsert'], 'false');
        if (files.has(path)) return Response.json({}, { status: 409 });
        files.set(path, Buffer.from(options.body));
        return Response.json({ Key: path });
      }
      assert.ok(
        url.pathname.includes('/object/authenticated/'),
        'Private downloads use authenticated endpoint',
      );
      const bytes = files.get(path);
      return bytes
        ? new Response(control.tamper ? 'modified' : bytes)
        : Response.json({}, { status: 404 });
    }
    const name = url.pathname.split('/').at(-1),
      table = rows[name];
    assert.ok(table, 'Unexpected API table ' + name);
    if (method === 'POST') {
      const row = JSON.parse(options.body);
      table.set(
        row.id,
        name === 'rf_purchases'
          ? { status: 'pending', order_id: null, payment_id: null, ...row }
          : row,
      );
      return new Response(null, { status: 201 });
    }
    const matches = [...table.values()].filter((row) =>
      [...url.searchParams].every(([key, value]) => {
        if (['select', 'limit', 'order'].includes(key)) return true;
        return value === 'is.null' ? row[key] == null : String(row[key]) === value.slice(3);
      }),
    );
    if (method === 'PATCH') for (const row of matches) Object.assign(row, JSON.parse(options.body));
    if (method === 'DELETE') for (const row of matches) table.delete(row.id);
    return Response.json(matches.map((row) => ({ ...row })));
  };
  const connect = () => supabaseStore({ url: 'https://example.supabase.co', secret, fetchImpl });
  return { connect, rows, files, calls, control, secret };
}
const metadata = (id) => ({
  id,
  token_hash: 'test-token-hash',
  created: new Date().toISOString(),
  filename: 'resume.txt',
  content_type: 'text/plain',
  amount: 100,
});
const artifact = {
  filename: 'resume.txt',
  type: 'text/plain',
  bytes: Buffer.from('Synthetic resume file'),
};

test('remote records and private files survive new backend store instances; history stays owner-scoped', async () => {
  const f = remoteFixture(),
    first = f.connect();
  await first.check();
  await first.saveRun({
    id: 'run1',
    owner: 'browser-a',
    created: new Date().toISOString(),
    label: 'Synthetic',
    result: { updatedResume: 'React developer' },
  });
  await first.createPurchase(metadata('p1'), artifact);
  await first.attachOrder('p1', 'order_one');
  const second = f.connect();
  assert.equal((await second.listRuns('browser-b')).length, 0);
  assert.equal(await second.getRun('run1', 'browser-b'), null);
  await second.deleteRun('run1', 'browser-b');
  assert.equal((await second.getRun('run1', 'browser-a')).updatedResume, 'React developer');
  const row = await second.getPurchaseByOrder('order_one');
  assert.equal(row.id, 'p1');
  assert.deepEqual(await second.readArtifact(row), artifact.bytes);
  assert.equal(
    'artifact' in f.rows.rf_purchases.get('p1'),
    false,
    'Database stores metadata, not file bytes',
  );
  assert.equal(await second.consumeBudget(1), true);
  assert.equal(await f.connect().consumeBudget(1), false);
});
test('remote startup rejects public buckets and malformed or browser-only credentials', async () => {
  const f = remoteFixture();
  f.control.public = true;
  await assert.rejects(f.connect().check(), /must be private/);
  for (const secret of [
    'sb_publishable_unsafe',
    '',
    'eyJ.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.sig',
  ])
    assert.throws(
      () => supabaseStore({ url: 'https://example.supabase.co', secret }),
      /secret|service_role|anon/i,
    );
  assert.throws(
    () => supabaseStore({ url: 'http://example.supabase.co', secret: f.secret }),
    /HTTPS/,
  );
});
test('failed metadata writes clean up unreferenced files and sanitize provider details', async () => {
  const f = remoteFixture();
  f.control.fail = (url, method) => url.pathname === '/rest/v1/rf_purchases' && method === 'POST';
  await assert.rejects(
    f.connect().createPurchase(metadata('p1'), artifact),
    (error) => error.status === 503 && !error.message.includes(f.secret),
  );
  assert.equal(f.files.size, 0);
});
test('private file integrity and metadata failures do not release corrupted downloads', async () => {
  const f = remoteFixture(),
    store = f.connect();
  await store.createPurchase(metadata('p1'), artifact);
  f.control.tamper = true;
  await assert.rejects(
    store.readArtifact(await store.getPurchase('p1')),
    (error) => error.status === 503,
  );
});
test('captured files cannot be deleted by pending cleanup and duplicate confirmation is safe', async () => {
  const f = remoteFixture(),
    store = f.connect();
  await store.createPurchase(metadata('p1'), artifact);
  await store.markPaid('p1', 'pay_one');
  await store.markPaid('p1', 'pay_one');
  await store.deletePendingPurchase('p1');
  assert.equal(f.files.size, 1);
  assert.equal((await store.getPurchase('p1')).status, 'paid');
  await assert.rejects(store.markPaid('p1', 'pay_two'), (error) => error.status === 503);
});
async function paymentServer(t, f) {
  const state = { calls: 0, payment: null };
  const config = {
    keyId: 'rzp_test_fake',
    keySecret: 'test-secret',
    webhookSecret: 'test-webhook',
    requireDurableStorage: true,
  };
  const provider = async (url, options) => {
    state.calls++;
    if (url.endsWith('/orders'))
      return Response.json({ id: 'order_test', amount: 100, currency: 'INR' });
    if (url.endsWith('/payments'))
      return Response.json({ items: state.payment ? [state.payment] : [] });
    return Response.json(state.payment);
  };
  const payments = createPayments({
    store: f.connect(),
    upload: multer(),
    config,
    buildExport: async () => artifact,
    fetchImpl: provider,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/payments', payments.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/payments`;
  const call = (path, body, token) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://resume.example',
        ...(token ? { 'X-Download-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { call, state, config };
}
test('remote storage outage stops checkout before any Razorpay order is requested', async (t) => {
  const f = remoteFixture();
  f.control.fail = (url) => url.pathname.startsWith('/storage/v1/object/');
  const app = await paymentServer(t, f),
    response = await app.call('/orders', {});
  assert.equal(response.status, 503);
  assert.equal(app.state.calls, 0);
  assert.equal(f.rows.rf_purchases.size, 0);
});
test('remote checkout, signature/capture validation, restart recovery and gated file release work together', async (t) => {
  const f = remoteFixture(),
    first = await paymentServer(t, f);
  const purchase = await (await first.call('/orders', {})).json();
  assert.ok(purchase.token);
  assert.equal((await first.call(`/${purchase.id}/download`, null, purchase.token)).status, 402);
  const second = await paymentServer(t, f);
  second.state.payment = {
    id: 'pay_test',
    order_id: 'order_test',
    amount: 100,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  const proof = {
    razorpay_order_id: purchase.orderId,
    razorpay_payment_id: 'pay_test',
    razorpay_signature: createHmac('sha256', second.config.keySecret)
      .update('order_test|pay_test')
      .digest('hex'),
  };
  assert.equal(
    (
      await second.call(
        `/${purchase.id}/verify`,
        { ...proof, razorpay_signature: 'bad' },
        purchase.token,
      )
    ).status,
    400,
  );
  assert.equal((await second.call(`/${purchase.id}/verify`, proof, purchase.token)).status, 200);
  assert.equal((await second.call(`/${purchase.id}/download`, null, 'wrong-token')).status, 404);
  const downloaded = await second.call(`/${purchase.id}/download`, null, purchase.token);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), artifact.bytes.toString());
  assert.equal(second.state.calls, 1, 'Recovery must not create another Razorpay order');
});
