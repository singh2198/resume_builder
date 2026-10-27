import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { createPayments } from './payments.js';

test('free demo rejects live Razorpay keys before preparing an artifact or calling provider', async () => {
  const db = new DatabaseSync(':memory:');
  const payments = createPayments({
    db,
    upload: multer(),
    config: { demoMode: true, keyId: 'rzp_live_test_only', keySecret: 'test-only' },
    buildExport: () => assert.fail('Must not prepare a live purchase'),
    fetchImpl: () => assert.fail('Must not call live provider'),
  });
  const app = express();
  app.use('/api/payments', payments.router, payments.errors);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/payments`;
  try {
    const config = await (await fetch(url + '/config')).json();
    assert.equal(config.configured, false);
    assert.equal(config.demoMode, true);
    const order = await fetch(url + '/orders', { method: 'POST' });
    assert.equal(order.status, 503);
    assert.match((await order.json()).error, /Real payments are disabled/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM purchases').get().n, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
