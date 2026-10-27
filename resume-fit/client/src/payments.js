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
function openCheckout(purchase) {
  return new Promise((resolve, reject) => {
    let completed = false;
    let failureMessage = '';
    const checkout = new window.Razorpay({
      key: purchase.keyId,
      order_id: purchase.orderId,
      amount: purchase.amount,
      currency: purchase.currency,
      name: 'ResumeFit',
      description: 'Resume download — ₹1',
      theme: { color: '#256b57' },
      handler: (response) => {
        completed = true;
        resolve(response);
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (!completed)
            reject(
              Error(failureMessage || 'Payment cancelled. Use the download button to try again.'),
            );
        },
      },
    });
    checkout.on('payment.failed', (response) => {
      // Razorpay offers another attempt inside the same modal. Keep the success handler active.
      failureMessage = response.error?.description || 'Payment failed. Please try again.';
    });
    checkout.open();
  });
}
const headers = (purchase) => ({ 'X-Download-Token': purchase.token });
async function isPaid(purchase) {
  return (await json(`/api/payments/${purchase.id}/status`, { headers: headers(purchase) })).paid;
}

async function completeDownload(purchase, onStatus) {
  onStatus('Checking payment');
  let paid = await isPaid(purchase);
  if (!paid) {
    // A prior success callback means capture may still be pending. Never charge twice.
    if (!purchase.submitted) {
      await loadCheckout();
      onStatus('Complete the ₹1 payment in Razorpay');
      const response = await openCheckout(purchase);
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
        'Payment is awaiting confirmation. Use “Recover last download” shortly; do not pay again.',
      );
  }
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
export async function paidDownload(fields, file, onStatus) {
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
  let purchase = savedPurchase(fingerprint);
  if (!purchase) {
    onStatus('Preparing your resume before payment');
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    if (file) form.append('file', file);
    purchase = {
      ...(await json('/api/payments/orders', { method: 'POST', body: form })),
      fingerprint,
    };
    remember(purchase);
  }
  remember(purchase);
  await completeDownload(purchase, onStatus);
}
export async function recoverDownload(onStatus) {
  const purchase = savedPurchase();
  if (!purchase) throw Error('No previous download in this browser session.');
  remember(purchase);
  await completeDownload(purchase, onStatus);
}
