const STORAGE_KEY = 'resumefit-purchases';
let checkoutScript;
let purchases;
function storedPurchases() {
  if (purchases) return purchases;
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    purchases = stored && typeof stored === 'object' ? stored : {};
  } catch {
    purchases = {};
  }
  return purchases;
}
export function savedPurchase(fingerprint) {
  const stored = storedPurchases();
  return fingerprint ? stored[fingerprint] : stored[stored.last];
}
function remember(purchase) {
  const stored = storedPurchases();
  stored[purchase.fingerprint] = purchase;
  stored.last = purchase.fingerprint;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* In-memory retry still works. */
  }
}
async function json(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Payment request failed. Please retry.');
  return data;
}
export const paymentConfig = () => json('/api/payments/config');
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      const timeout = setTimeout(() => fail(), 20000);
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        checkoutScript = null;
        reject(Error('Razorpay checkout could not load. Check your connection and retry.'));
      };
      script.onload = () => {
        clearTimeout(timeout);
        window.Razorpay ? resolve() : fail();
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return checkoutScript;
}
function failureError(reason) {
  return Error(
    reason === 'website_mismatch'
      ? 'Razorpay rejected this payment: Business – Website Mismatch. Use the approved website configured in Razorpay. If your bank was debited, check the payment with Razorpay or your bank before paying again.'
      : 'Payment failed. If your bank was debited, check this attempt with Razorpay or your bank before paying again.',
  );
}
function openCheckout(purchase) {
  return new Promise((resolve, reject) => {
    let completed = false;
    let pollTimer;
    let checking = false;
    const finish = (error, response) => {
      if (completed) return;
      completed = true;
      clearInterval(pollTimer);
      // Mark settled before close: Razorpay may synchronously call ondismiss.
      checkout.close();
      if (error) reject(error);
      else resolve(response);
    };
    const checkout = new window.Razorpay({
      key: purchase.keyId,
      order_id: purchase.orderId,
      amount: purchase.amount,
      currency: purchase.currency,
      name: 'ResumeFit',
      description: `Resume download — ₹${purchase.amount / 100}`,
      theme: { color: '#256b57' },
      retry: { enabled: false },
      handler: (response) => finish(null, response),
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (completed) return;
          completed = true;
          clearInterval(pollTimer);
          reject(Error('Checkout closed. Checking payment status before another attempt.'));
        },
      },
    });
    checkout.on('payment.failed', (response) => {
      const details = `${response.error?.reason || ''} ${response.error?.description || ''}`;
      finish(failureError(/website|domain/i.test(details) ? 'website_mismatch' : 'payment_failed'));
    });
    checkout.open();
    if (!completed) {
      // UPI can complete outside the browser. Server status is authoritative if its callback is lost.
      pollTimer = setInterval(async () => {
        if (checking || completed) return;
        checking = true;
        try {
          const status = await paymentStatus(purchase);
          if (status.paid) finish(null, null);
          else if (status.paymentStatus === 'failed') finish(failureError(status.failureReason));
        } catch {
          /* Temporary network errors leave checkout open for manual dismissal. */
        } finally {
          checking = false;
        }
      }, 3000);
      pollTimer.unref?.();
    }
  });
}
const headers = (purchase) => ({ 'X-Download-Token': purchase.token });
const paymentStatus = (purchase) =>
  json(`/api/payments/${purchase.id}/status`, { headers: headers(purchase) });
async function isPaid(purchase) {
  return (await paymentStatus(purchase)).paid;
}

async function confirmPayment(purchase, onStatus) {
  onStatus('Checking payment');
  const config = await paymentConfig();
  const differentKey = config.keyId && purchase.keyId !== config.keyId;
  const switchedMessage =
    'This checkout uses previous Razorpay keys. Return to Step 5 and click Pay to create a checkout with the current keys.';
  let paid;
  try {
    const status = await paymentStatus(purchase);
    paid = status.paid;
    if (!paid && status.paymentStatus === 'failed') {
      purchase.failed = true;
      remember(purchase);
      throw failureError(status.failureReason);
    }
    if (!paid && status.paymentStatus === 'authorized')
      throw Error(
        'Payment is authorized but not captured yet. Use Recover previous purchase to check again; do not pay again.',
      );
  } catch (error) {
    if (differentKey) throw Error(switchedMessage);
    throw error;
  }
  // Previously paid files remain downloadable; never reopen an unpaid checkout with stale keys.
  if (!paid && differentKey) throw Error(switchedMessage);
  if (!paid && !purchase.submitted && config.checkoutAllowed === false)
    throw Error(config.blockedReason || 'Live checkout is unavailable on this website.');
  if (!paid) {
    // A prior success callback means capture may still be pending. Never charge twice.
    if (!purchase.submitted) {
      await loadCheckout();
      onStatus(`Complete the ₹${purchase.amount / 100} payment in Razorpay`);
      let response;
      try {
        response = await openCheckout(purchase);
      } catch (error) {
        // Failure/cancellation is not proof of non-payment. Check the server before offering another attempt.
        const status = await paymentStatus(purchase);
        if (status.paid) return purchase;
        if (status.paymentStatus === 'failed') {
          purchase.failed = true;
          remember(purchase);
          throw failureError(status.failureReason);
        }
        if (status.paymentStatus === 'authorized')
          throw Error(
            'Payment is authorized but awaiting capture. Do not pay again; check Recover previous purchase shortly.',
          );
        throw error;
      }
      if (!response) return purchase; // Polling already confirmed capture on the server.
      purchase.submitted = response;
      remember(purchase);
    }
    onStatus('Verifying payment');
    paid = (
      await json(`/api/payments/${purchase.id}/verify`, {
        method: 'POST',
        headers: { ...headers(purchase), 'Content-Type': 'application/json' },
        body: JSON.stringify(purchase.submitted),
      })
    ).paid;
    for (let attempt = 0; !paid && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      paid = await isPaid(purchase);
    }
    if (!paid)
      throw Error(
        'Payment is awaiting confirmation. Use “Recover previous purchase” shortly; do not pay again.',
      );
  }
  return purchase;
}
export async function downloadPurchased(purchase, onStatus = () => {}) {
  if (!purchase) throw Error('Complete payment before downloading.');
  onStatus('Checking payment');
  if (!(await isPaid(purchase)))
    throw Error('Payment is not confirmed. Return to the payment step to retry.');
  onStatus('Downloading your resume');
  const response = await fetch(`/api/payments/${purchase.id}/download`, {
    headers: headers(purchase),
  });
  if (!response.ok)
    throw Error((await response.json()).error || 'Download failed. Retry without paying again.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = purchase.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function payForResume(fields, file, onStatus = () => {}) {
  const fileHash = file
    ? Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('')
    : '';
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({ ...fields, fileHash })),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  // Orders belong to the key that created them. A mode/key switch needs a fresh checkout.
  const config = await paymentConfig();
  if (!config.configured || !config.keyId)
    throw Error('Payments are not configured on the server.');
  if (config.checkoutAllowed === false)
    throw Error(config.blockedReason || 'Live checkout is unavailable on this website.');
  const scopedFingerprint = `${fingerprint}:${config.keyId}:${config.amount}`;
  const legacy = savedPurchase(`${fingerprint}:${config.keyId}`) || savedPurchase(fingerprint);
  let purchase =
    savedPurchase(scopedFingerprint) ||
    (legacy?.keyId === config.keyId && legacy?.amount === config.amount
      ? { ...legacy, fingerprint: scopedFingerprint }
      : null);
  if (purchase?.failed) {
    remember({ ...purchase, fingerprint: `${purchase.fingerprint}:failed:${purchase.id}` });
    purchase = null;
  }
  if (!purchase) {
    onStatus('Preparing your resume before payment');
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    if (file) form.append('file', file);
    purchase = {
      ...(await json('/api/payments/orders', { method: 'POST', body: form })),
      fingerprint: scopedFingerprint,
    };
    remember(purchase);
  }
  remember(purchase);
  return confirmPayment(purchase, onStatus);
}
export async function recoverPayment(onStatus = () => {}) {
  const purchase = savedPurchase();
  if (!purchase) throw Error('No previous download in this browser session.');
  remember(purchase);
  return confirmPayment(purchase, onStatus);
}

// Compatibility helpers for existing integrations: payment and download remain independently checked.
export async function paidDownload(fields, file, onStatus = () => {}) {
  const purchase = await payForResume(fields, file, onStatus);
  await downloadPurchased(purchase, onStatus);
}
export async function recoverDownload(onStatus = () => {}) {
  const purchase = await recoverPayment(onStatus);
  await downloadPurchased(purchase, onStatus);
}
