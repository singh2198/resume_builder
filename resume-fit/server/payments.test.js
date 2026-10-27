import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
  for (const bad of [{ amount: 1 }, { currency: 'USD' }, { order_id: 'order_other' }]) {
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
  const names = ['window', 'document', 'sessionStorage', 'fetch', 'setTimeout'];
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
  const ui = { downloads: 0, checkouts: 0, stored: new Map() };
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, fixture.base).href, options);
  globalThis.sessionStorage = {
    getItem: (key) => ui.stored.get(key),
    setItem: (key, value) => ui.stored.set(key, value),
  };
  globalThis.setTimeout = (callback, delay) => {
    const timer = timers(callback, delay);
    timer.unref?.();
    return timer;
  };
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
      close() {}
      open() {
        ui.checkouts++;
        if (outcome === 'cancel') return this.options.modal.ondismiss();
        if (outcome === 'failure') {
          this.failure({ error: { description: 'Payment failed' } });
          return this.options.modal.ondismiss();
        }
        if (outcome === 'retry-success')
          this.failure({ error: { description: 'First attempt failed' } });
        const purchase = { orderId: this.options.order_id };
        const payment = fixture.captured(purchase, { id: `pay_browser${ui.checkouts}` });
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

test('a failed checkout attempt can succeed inside the same modal', async (t) => {
  const f = await setup(t);
  const { ui, client } = await clientSetup(t, f, 'retry-success');
  await client.paidDownload({ text: 'Retry resume', format: 'txt' }, null, () => {});
  assert.equal(ui.downloads, 1);
  assert.equal(ui.checkouts, 1);
});
