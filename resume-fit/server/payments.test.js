import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import multer from 'multer';
import { createPayments } from './payments.js';
import { buildExport } from './exports.js';

const config = {
  keyId: 'rzp_test_example',
  keySecret: 'test-secret',
  webhookSecret: 'webhook-secret',
};
async function setup(t, overrides = {}) {
  const db = new DatabaseSync(':memory:');
  let count = 0;
  const state = { calls: [], payments: new Map() };
  const fetchImpl = async (url, options) => {
    state.calls.push({ url, options });
    if (url.endsWith('/orders')) {
      const body = JSON.parse(options.body);
      return Response.json({
        id: `order_${++count}`,
        amount: body.amount,
        currency: body.currency,
      });
    }
    const order = url.match(/\/orders\/(order_\w+)\/payments$/)?.[1];
    if (order)
      return Response.json({
        items: [...state.payments.values()].filter((p) => p.order_id === order),
      });
    const payment = state.payments.get(url.split('/').at(-1));
    return Response.json(payment || {}, { status: payment ? 200 : 404 });
  };
  overrides.initialize?.(db);
  const payments = createPayments({
    db,
    upload: multer({ storage: multer.memoryStorage() }),
    buildExport,
    config,
    fetchImpl,
    ...overrides,
  });
  const app = express();
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    payments.webhook,
    payments.errors,
  );
  app.use(express.json());
  app.use('/api/payments', payments.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/payments`;
  const request = (route, body, token, method = body ? 'POST' : 'GET') =>
    fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://resume.example',
        ...(token ? { 'X-Download-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const order = async (fields = {}) => {
    const response = await request('/orders', {
      text: 'ALEX MORGAN\nReact developer with practical Node.js experience.',
      format: 'txt',
      ...fields,
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const captured = (purchase, overrides = {}) => {
    const payment = {
      id: 'pay_valid123',
      order_id: purchase.orderId,
      amount: 100,
      currency: 'INR',
      status: 'captured',
      captured: true,
      ...overrides,
    };
    state.payments.set(payment.id, payment);
    return payment;
  };
  const proof = (purchase, paymentId = 'pay_valid123') => ({
    razorpay_order_id: purchase.orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: createHmac('sha256', config.keySecret)
      .update(`${purchase.orderId}|${paymentId}`)
      .digest('hex'),
  });
  return { db, request, order, captured, proof, state, base };
}

test('server fixes price at ₹1, stores the file, and refuses unpaid or foreign access', async (t) => {
  const f = await setup(t);
  const purchase = await f.order({ amount: 1, currency: 'USD' });
  const sent = JSON.parse(f.state.calls[0].options.body);
  assert.equal(sent.amount, 100);
  assert.equal(sent.currency, 'INR');
  assert.equal(purchase.amount, 100);
  assert.equal('keySecret' in purchase, false);
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
  assert.equal((await f.request(`/${purchase.id}/download`, null, 'wrong-token')).status, 404);
  assert.equal((await f.request(`/${purchase.id}/status`)).status, 404);
  assert.equal(f.db.prepare('SELECT status FROM purchases').get().status, 'pending');
});

test('invalid files and missing credentials never create a Razorpay order', async (t) => {
  const f = await setup(t);
  assert.equal((await f.request('/orders', { text: '', format: 'txt' })).status, 422);
  assert.equal(
    (await f.request('/orders', { text: 'Resume', format: 'pdf', mode: 'original' })).status,
    422,
  );
  assert.equal(f.state.calls.length, 0);
  const missing = await setup(t, { config: {} });
  assert.equal((await missing.request('/orders', { text: 'Resume', format: 'txt' })).status, 503);
});

test('forged signatures and mismatched order, amount, currency, or payment ID cannot unlock', async (t) => {
  const f = await setup(t);
  const purchase = await f.order();
  f.captured(purchase);
  const proof = f.proof(purchase);
  for (const bad of [
    { ...proof, razorpay_signature: '0'.repeat(64) },
    { ...proof, razorpay_signature: 'invalid' },
    { ...proof, razorpay_order_id: 'order_other' },
    { ...proof, razorpay_payment_id: '../invalid' },
  ])
    assert.equal((await f.request(`/${purchase.id}/verify`, bad, purchase.token)).status, 400);
  for (const bad of [
    { amount: 1 },
    { amount: 1000 },
    { currency: 'USD' },
    { order_id: 'order_other' },
  ]) {
    f.captured(purchase, bad);
    assert.equal((await f.request(`/${purchase.id}/verify`, proof, purchase.token)).status, 400);
  }
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
});

test('authorized payment stays locked until capture; paid retries return the same file', async (t) => {
  const f = await setup(t);
  const purchase = await f.order();
  f.captured(purchase, { status: 'authorized', captured: false });
  const pending = await f.request(`/${purchase.id}/verify`, f.proof(purchase), purchase.token);
  assert.deepEqual(await pending.json(), { paid: false });
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
  f.captured(purchase);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(
      await (await f.request(`/${purchase.id}/verify`, f.proof(purchase), purchase.token)).json(),
      { paid: true },
    );
    const download = await f.request(`/${purchase.id}/download`, null, purchase.token);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.match(await download.text(), /ALEX MORGAN/);
  }
  assert.equal(f.state.calls.filter((c) => c.url.endsWith('/orders')).length, 1);
});

test('status reconciliation recovers a captured payment without the checkout callback', async (t) => {
  const f = await setup(t);
  const purchase = await f.order();
  f.captured(purchase);
  assert.deepEqual(await (await f.request(`/${purchase.id}/status`, null, purchase.token)).json(), {
    paid: true,
  });
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 200);
});

test('signed webhook unlocks once; invalid webhook and duplicate deliveries are safe', async (t) => {
  const f = await setup(t);
  const purchase = await f.order();
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: f.captured(purchase) } },
  });
  const send = (signature) =>
    fetch(f.base + '/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
      body,
    });
  assert.equal((await send('0'.repeat(64))).status, 400);
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
  const signature = createHmac('sha256', config.webhookSecret).update(body).digest('hex');
  assert.equal((await send(signature)).status, 200);
  assert.equal((await send(signature)).status, 200);
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 200);
});

test('all rebuilt export formats are prepared and released only after payment', async (t) => {
  const f = await setup(t);
  for (const format of ['pdf', 'docx', 'txt']) {
    const purchase = await f.order({ format });
    assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
    f.captured(purchase, { id: `pay_${format}` });
    assert.equal((await f.request(`/${purchase.id}/status`, null, purchase.token)).status, 200);
    const response = await f.request(`/${purchase.id}/download`, null, purchase.token);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    if (format === 'docx') assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    if (format === 'txt') assert.match(bytes.toString(), /ALEX MORGAN/);
  }
});

test('provider failure fails closed and cleans up unpayable prepared artifacts', async (t) => {
  const f = await setup(t, {
    fetchImpl: async () => {
      throw Error('offline');
    },
  });
  assert.equal((await f.request('/orders', { text: 'Resume', format: 'txt' })).status, 502);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM purchases').get().count, 0);
});

async function clientSetup(t, fixture, outcome = 'success') {
  const names = ['window', 'document', 'sessionStorage', 'fetch', 'setTimeout', 'setInterval'];
  const originals = Object.fromEntries(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  t.after(() => {
    for (const name of names) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  });
  const nativeFetch = globalThis.fetch;
  const timers = globalThis.setTimeout;
  const ui = {
    downloads: 0,
    checkouts: 0,
    closed: 0,
    stored: new Map(),
    origin: 'https://resume.example',
    outcome,
  };
  globalThis.fetch = (url, options = {}) =>
    nativeFetch(new URL(url, fixture.base).href, {
      ...options,
      headers: { Origin: ui.origin, ...options.headers },
    });
  globalThis.sessionStorage = {
    getItem: (key) => ui.stored.get(key),
    setItem: (key, value) => ui.stored.set(key, value),
  };
  globalThis.setTimeout = (callback, delay) => {
    const timer = timers(callback, delay);
    timer.unref?.();
    return timer;
  };
  const intervals = globalThis.setInterval;
  globalThis.setInterval = (fn, delay) => intervals(fn, delay === 3000 ? 10 : delay);
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({ click: () => ui.downloads++, remove() {} }),
  };
  globalThis.window = {
    Razorpay: class {
      constructor(options) {
        this.options = options;
      }
      on(name, callback) {
        this.failure = callback;
      }
      close() {
        ui.closed++;
        this.options.modal.ondismiss();
      }
      open() {
        ui.checkouts++;
        if (ui.outcome === 'cancel') return this.options.modal.ondismiss();
        if (
          ui.outcome === 'website-mismatch' ||
          ui.outcome === 'provider-failure-without-callback'
        ) {
          fixture.captured(
            { orderId: this.options.order_id },
            {
              status: 'failed',
              captured: false,
              error_reason: 'website_mismatch',
              error_description: 'Business – Website Mismatch',
            },
          );
          if (ui.outcome === 'website-mismatch')
            this.failure({ error: { reason: 'website_mismatch' } });
          return;
        }
        if (ui.outcome === 'failure') {
          this.failure({ error: { description: 'Payment failed' } });
          return this.options.modal.ondismiss();
        }
        if (ui.outcome === 'retry-success')
          this.failure({ error: { description: 'First attempt failed' } });
        const purchase = { orderId: this.options.order_id };
        const payment = fixture.captured(purchase, { id: `pay_browser${ui.checkouts}` });
        if (ui.outcome !== 'capture-without-callback')
          this.options.handler(fixture.proof(purchase, payment.id));
      }
    },
  };
  const client = await import(`../client/src/payments.js?test=${Date.now()}-${Math.random()}`);
  return { ui, client };
}

test('client checkout integrates with API and downloads only after verification, including free retries', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f);
  const fields = { text: 'ALEX MORGAN\nFrontend developer', format: 'txt', mode: 'rebuilt' };
  await client.paidDownload(fields, null, () => {});
  assert.equal(ui.checkouts, 1);
  assert.equal(ui.downloads, 1);
  await client.paidDownload({ ...fields, text: 'A different resume' }, null, () => {});
  await client.paidDownload(fields, null, () => {});
  await client.recoverDownload(() => {});
  assert.equal(ui.checkouts, 2, 'returning to a purchased file must not charge again');
  assert.equal(ui.downloads, 4);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS count FROM purchases WHERE status = 'paid'").get().count,
    2,
  );
});

for (const outcome of ['cancel', 'failure']) {
  test(`client ${outcome} never downloads and retains the order for recovery`, async (t) => {
    const f = await setup(t);
    const { ui, client } = await clientSetup(t, f, outcome);
    await assert.rejects(client.paidDownload({ text: 'Resume', format: 'txt' }, null, () => {}));
    assert.equal(ui.downloads, 0);
    assert.ok(client.savedPurchase());
    assert.equal(f.db.prepare('SELECT status FROM purchases').get().status, 'pending');
  });
}

test('original and edited PDFs use the layout engine and stay gated', async (t) => {
  const f = await setup(t);
  const { tailorPDF, pdfEngine } = await import('./pdf-layout.js');
  const source = await buildExport({
    body: {
      text: 'ALEX MORGAN\n\nSUMMARY\nFrontend developer building React applications.',
      format: 'pdf',
    },
  });
  const jd = 'Frontend developer with React and Node.js experience.';
  const { result } = await tailorPDF(source.bytes, jd);
  for (const mode of ['original', 'edited-original']) {
    const form = new FormData();
    form.append('file', new Blob([source.bytes], { type: 'application/pdf' }), 'resume.pdf');
    form.append('format', 'pdf');
    form.append('mode', mode);
    form.append('jd', jd);
    form.append(
      'text',
      mode === 'original'
        ? result.updatedResume
        : result.updatedResume.replace('Frontend', 'Senior'),
    );
    const response = await fetch(f.base + '/orders', { method: 'POST', body: form });
    assert.equal(response.status, 201, await response.clone().text());
    const purchase = await response.json();
    assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
    f.captured(purchase, { id: `pay_${mode.replace('-', '')}` });
    await f.request(`/${purchase.id}/status`, null, purchase.token);
    const download = await f.request(`/${purchase.id}/download`, null, purchase.token);
    assert.equal(download.status, 200);
    const pdf = Buffer.from(await download.arrayBuffer());
    const inspected = await pdfEngine(pdf);
    assert.equal(inspected.pageCount, 1);
    assert.match(inspected.text, /ALEX MORGAN/);
    if (mode === 'edited-original') assert.match(inspected.text, /Senior/);
  }
});

test('a racing failure callback cannot hide a captured payment', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f, 'retry-success');
  await client.paidDownload({ text: 'Retry resume', format: 'txt' }, null, () => {});
  assert.equal(ui.downloads, 1);
  assert.equal(ui.checkouts, 1);
});

test('stepper payment confirms without downloading; download is a separate verified action', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f);
  const fields = { text: 'ALEX MORGAN\nReviewed final draft', format: 'txt', mode: 'rebuilt' };
  const purchase = await client.payForResume(fields, null, () => {});
  assert.equal(purchase.amount, 100);
  assert.equal(ui.checkouts, 1);
  assert.equal(ui.downloads, 0, 'Step 5 must not start a download');
  await client.downloadPurchased(purchase, () => {});
  await client.downloadPurchased(purchase, () => {});
  assert.equal(ui.downloads, 2);
  assert.equal(ui.checkouts, 1, 'Step 6 must never open checkout');
  const recovered = await client.recoverPayment(() => {});
  assert.equal(recovered.id, purchase.id);
  assert.equal(ui.downloads, 2, 'Recovery must return the verified purchase before downloading');
  await client.payForResume(fields, null, () => {});
  assert.equal(ui.checkouts, 1, 'Returning to the same file must reuse its payment');
  await client.payForResume({ ...fields, text: 'A revised final resume' }, null, () => {});
  assert.equal(ui.checkouts, 2, 'A changed artifact needs its own purchase');
});

test('download step rejects unpaid purchases without opening checkout or releasing a file', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f);
  const purchase = await f.order();
  await assert.rejects(client.downloadPurchased(purchase), /not confirmed/);
  assert.equal(ui.checkouts, 0);
  assert.equal(ui.downloads, 0);
});

test('legacy purchases retain their original price after the ₹1 price migration', async (t) => {
  const f = await setup(t, {
    initialize(db) {
      db.exec(`CREATE TABLE purchases (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created TEXT NOT NULL,
      order_id TEXT UNIQUE, payment_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      filename TEXT NOT NULL, content_type TEXT NOT NULL, artifact BLOB NOT NULL
    )`);
      db.prepare(
        'INSERT INTO purchases (id, token_hash, created, order_id, filename, content_type, artifact) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        'legacy',
        createHash('sha256').update('legacy-token').digest('hex'),
        new Date().toISOString(),
        'order_legacy',
        'legacy.txt',
        'text/plain',
        Buffer.from('Legacy purchased resume'),
      );
    },
  });
  const legacy = { id: 'legacy', orderId: 'order_legacy', token: 'legacy-token' };
  assert.equal(f.db.prepare('SELECT amount FROM purchases WHERE id = ?').get('legacy').amount, 100);
  f.captured(legacy, { amount: 100 });
  const response = await f.request('/legacy/verify', f.proof(legacy), legacy.token);
  assert.deepEqual(await response.json(), { paid: true });
  assert.equal((await f.request('/legacy/download', null, legacy.token)).status, 200);
  const current = await f.order();
  assert.equal(current.amount, 100);
  assert.equal(
    f.db.prepare('SELECT amount FROM purchases WHERE id = ?').get(current.id).amount,
    100,
  );
});

test('switching Razorpay keys creates a fresh checkout and cannot reopen a cached test order', async (t) => {
  // Both provider configurations are simulated; no live Razorpay request is made.
  const keys = { ...config };
  const f = await setup(t, { config: keys });
  const { ui, client } = await clientSetup(t, f, 'cancel');
  const fields = { text: 'Mode switch resume', format: 'txt' };
  await assert.rejects(client.payForResume(fields, null));
  const old = client.savedPurchase();
  assert.equal(old.keyId, 'rzp_test_example');
  keys.keyId = 'rzp_live_simulated';
  await assert.rejects(client.recoverPayment(), /previous Razorpay keys/);
  assert.equal(ui.checkouts, 1, 'recovery must not reopen the stale test checkout');
  ui.outcome = 'success';
  const current = await client.payForResume(fields, null);
  assert.equal(current.keyId, 'rzp_live_simulated');
  assert.notEqual(current.id, old.id);
  assert.equal(ui.checkouts, 2);
  await client.payForResume(fields, null);
  assert.equal(ui.checkouts, 2, 'repeat use of the live purchase must not charge again');
});

test('failed checkout closes and website mismatch never unlocks a download', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f, 'website-mismatch');
  await assert.rejects(
    client.payForResume({ text: 'Website mismatch resume', format: 'txt' }, null),
    /Website Mismatch/,
  );
  assert.equal(ui.closed, 1);
  assert.equal(ui.downloads, 0);
  const purchase = client.savedPurchase();
  const status = await (await f.request(`/${purchase.id}/status`, null, purchase.token)).json();
  assert.equal(status.paymentStatus, 'failed');
  assert.equal(status.failureReason, 'website_mismatch');
  assert.equal((await f.request(`/${purchase.id}/download`, null, purchase.token)).status, 402);
});
for (const [outcome, paid] of [
  ['capture-without-callback', true],
  ['provider-failure-without-callback', false],
]) {
  test(`polling closes checkout when ${outcome}`, async (t) => {
    const f = await setup(t);
    const { ui, client } = await clientSetup(t, f, outcome);
    const attempt = client.payForResume({ text: 'Callback recovery resume', format: 'txt' }, null);
    if (paid) await attempt;
    else await assert.rejects(attempt, /Website Mismatch/);
    assert.equal(ui.closed, 1);
    assert.equal(ui.downloads, 0);
    const p = client.savedPurchase();
    const status = await (await f.request(`/${p.id}/status`, null, p.token)).json();
    assert.equal(status.paid, paid);
  });
}
test('new ₹1 checkouts do not reuse previous ₹10 orders; prior orders remain verifiable', async (t) => {
  const f = await setup(t);
  const fields = { text: 'Price change resume', format: 'txt' };
  const old = await f.order(fields);
  f.db.prepare('UPDATE purchases SET amount=1000 WHERE id=?').run(old.id);
  old.amount = 1000;
  const fingerprint =
    createHash('sha256')
      .update(JSON.stringify({ ...fields, fileHash: '' }))
      .digest('hex') +
    ':' +
    config.keyId;
  old.fingerprint = fingerprint;
  const { ui, client } = await clientSetup(t, f);
  ui.stored.set('resumefit-purchases', JSON.stringify({ [fingerprint]: old, last: fingerprint }));
  const current = await client.payForResume(fields, null);
  assert.equal(current.amount, 100);
  assert.notEqual(current.id, old.id);
  f.captured(old, { id: 'pay_old10', amount: 1000 });
  assert.deepEqual(
    await (await f.request(`/${old.id}/verify`, f.proof(old, 'pay_old10'), old.token)).json(),
    { paid: true },
  );
});
test('live checkout from localhost is blocked before creating an order', async (t) => {
  const f = await setup(t, { config: { ...config, keyId: 'rzp_live_simulated' } });
  const response = await fetch(f.base + '/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ text: 'Local live resume', format: 'txt' }),
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /approved public website/);
  assert.equal(f.state.calls.length, 0);
});

test('localhost recovery checks existing payments but never reopens an unpaid live checkout', async (t) => {
  const f = await setup(t, { config: { ...config, keyId: 'rzp_live_simulated' } });
  const { ui, client } = await clientSetup(t, f, 'cancel');
  await assert.rejects(client.payForResume({ text: 'Live recovery resume', format: 'txt' }, null));
  const purchase = client.savedPurchase();
  ui.origin = 'http://127.0.0.1:5173';
  await assert.rejects(client.recoverPayment(), /approved public website/);
  assert.equal(ui.checkouts, 1);
  f.captured(purchase);
  const recovered = await client.recoverPayment();
  assert.equal(recovered.id, purchase.id);
  assert.equal(ui.checkouts, 1);
});
