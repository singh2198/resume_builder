import express from 'express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const PRICE = 100; // ₹1 in paise. Never accept an amount from the browser.
const digest = (value) => createHash('sha256').update(value).digest('hex');
const validSignature = (value, expected) =>
  typeof value === 'string' &&
  /^[a-f0-9]{64}$/i.test(value) &&
  timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
const httpError = (status, message) => Object.assign(Error(message), { status });

export function createPayments({ db, upload, buildExport, config, fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created TEXT NOT NULL,
    order_id TEXT UNIQUE, payment_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
    filename TEXT NOT NULL, content_type TEXT NOT NULL, artifact BLOB NOT NULL
  )`);
  const router = express.Router();
  const ready = () => {
    if (config.demoMode && !config.keyId?.startsWith('rzp_test_'))
      throw httpError(
        503,
        'Real payments are disabled on this free demo. Only Razorpay Test Mode is supported.',
      );
    if (!config.keyId || !config.keySecret)
      throw httpError(503, 'Payments are not configured yet. Add Razorpay keys on the server.');
  };
  async function razorpay(route, options = {}) {
    ready();
    let response;
    try {
      response = await fetchImpl(`https://api.razorpay.com/v1${route}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw httpError(502, 'Cannot reach Razorpay. Retry this payment check shortly.');
    }
    if (!response.ok)
      throw httpError(
        502,
        'Razorpay could not process the request. Check server credentials or retry shortly.',
      );
    return response.json();
  }
  function purchase(req) {
    const row = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    const token = req.get('X-Download-Token');
    if (!row || typeof token !== 'string' || !validSignature(digest(token), row.token_hash))
      throw httpError(404, 'Download not found in this browser session.');
    return row;
  }
  function confirm(row, payment) {
    if (payment.order_id !== row.order_id || payment.amount !== PRICE || payment.currency !== 'INR')
      throw httpError(400, 'Payment does not match this ₹1 download.');
    if (payment.status !== 'captured' || payment.captured !== true) return false;
    db.prepare(
      "UPDATE purchases SET status = 'paid', payment_id = ? WHERE id = ? AND status = 'pending'",
    ).run(payment.id, row.id);
    return true;
  }
  async function reconcile(row) {
    if (row.status === 'paid') return true;
    const payments = await razorpay(`/orders/${encodeURIComponent(row.order_id)}/payments`);
    for (const payment of payments.items || []) {
      if (payment.status === 'captured' && confirm(row, payment)) return true;
    }
    return false;
  }
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/config', (_, res) =>
    res.json({
      configured: !!(
        config.keyId &&
        config.keySecret &&
        (!config.demoMode || config.keyId.startsWith('rzp_test_'))
      ),
      demoMode: !!config.demoMode,
      amount: PRICE,
      currency: 'INR',
      testMode: config.keyId?.startsWith('rzp_test_') || false,
    }),
  );
  router.post(
    '/orders',
    upload.single('file'),
    route(async (req, res) => {
      ready();
      let artifact;
      try {
        artifact = await buildExport(req);
      } catch (error) {
        throw httpError(422, error.message);
      }
      const id = randomUUID(),
        token = randomBytes(32).toString('hex');
      // Persist the file first, so payment is never requested for an unavailable export.
      db.prepare(
        'INSERT INTO purchases (id, token_hash, created, filename, content_type, artifact) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        digest(token),
        new Date().toISOString(),
        artifact.filename,
        artifact.type,
        artifact.bytes,
      );
      let order;
      try {
        order = await razorpay('/orders', {
          method: 'POST',
          body: JSON.stringify({
            amount: PRICE,
            currency: 'INR',
            receipt: id,
            notes: { product: 'ResumeFit download' },
          }),
        });
        if (!order.id || order.amount !== PRICE || order.currency !== 'INR')
          throw httpError(502, 'Razorpay returned an invalid order.');
        db.prepare('UPDATE purchases SET order_id = ? WHERE id = ?').run(order.id, id);
      } catch (error) {
        db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
        throw error;
      }
      res.status(201).json({
        id,
        token,
        orderId: order.id,
        keyId: config.keyId,
        amount: PRICE,
        currency: 'INR',
        filename: artifact.filename,
      });
    }),
  );
  router.get(
    '/:id/status',
    route(async (req, res) => {
      res.json({ paid: await reconcile(purchase(req)) });
    }),
  );
  router.post(
    '/:id/verify',
    route(async (req, res) => {
      ready();
      const row = purchase(req);
      const {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      } = req.body;
      if (
        orderId !== row.order_id ||
        typeof paymentId !== 'string' ||
        !/^pay_[A-Za-z0-9]+$/.test(paymentId)
      )
        throw httpError(400, 'Payment does not match this order.');
      const expected = createHmac('sha256', config.keySecret)
        .update(`${row.order_id}|${paymentId}`)
        .digest('hex');
      if (!validSignature(signature, expected))
        throw httpError(400, 'Payment signature verification failed.');
      const payment = await razorpay(`/payments/${encodeURIComponent(paymentId)}`);
      if (payment.id !== paymentId) throw httpError(400, 'Payment ID mismatch.');
      res.json({ paid: confirm(row, payment) });
    }),
  );
  router.get(
    '/:id/download',
    route(async (req, res) => {
      const row = purchase(req);
      if (row.status !== 'paid')
        throw httpError(402, 'Complete the ₹1 payment before downloading.');
      res.attachment(row.filename).type(row.content_type).send(Buffer.from(row.artifact));
    }),
  );
  // Mounted with express.raw BEFORE the application's JSON parser.
  const webhook = route(async (req, res) => {
    if (!config.webhookSecret) throw httpError(503, 'Payment webhook is not configured.');
    const signature = req.get('X-Razorpay-Signature');
    const expected = createHmac('sha256', config.webhookSecret).update(req.body).digest('hex');
    if (!validSignature(signature, expected)) throw httpError(400, 'Invalid webhook signature.');
    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw httpError(400, 'Invalid webhook payload.');
    }
    if (['payment.captured', 'order.paid'].includes(event.event)) {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        const row = db.prepare('SELECT * FROM purchases WHERE order_id = ?').get(payment.order_id);
        if (row) confirm(row, payment);
      }
    }
    res.json({ ok: true });
  });
  const errors = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Payment request failed. Retry shortly.' });
  };
  router.use(errors);
  return { router, webhook, errors };
}
