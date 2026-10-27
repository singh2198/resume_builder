// Run against a locally started server: node server/smoke.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const resume = await readFile(new URL('../samples/resume.txt', import.meta.url), 'utf8');
const jd = await readFile(new URL('../samples/job-description.txt', import.meta.url), 'utf8');
const post = (route, data) =>
  fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
assert.equal((await fetch(base)).status, 200);
assert.equal((await fetch(base + '/api/health')).status, 200);
const response = await post('/api/tailor', { resume, jd, save: true, label: 'Smoke test' });
assert.equal(response.status, 200);
const result = await response.json();
try {
  assert.ok(result.id);
  assert.ok(result.missing.includes('Docker'));
  assert.deepEqual(result.updatedResume.split('\n').sort(), resume.trim().split('\n').sort());
  assert.equal((await fetch(base + '/api/history/' + result.id)).status, 200);
  for (const route of ['/api/export', '/api/export-original', '/api/export-edited-original']) {
    const exported = await post(route, { text: result.updatedResume, format: 'pdf' });
    assert.equal(exported.status, 402);
  }
  const config = await (await fetch(base + '/api/payments/config')).json();
  assert.equal(config.amount, 100);
  assert.equal(config.currency, 'INR');
  assert.equal((await post('/api/tailor', { resume: 'short', jd })).status, 400);
  const forbidden = await fetch(base + '/api/tailor', {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume, jd }),
  });
  assert.equal(forbidden.status, 403);
  console.log(
    'PASS: frontend, health, tailoring, history, unpaid export protection, fixed payment price, validation, origin checks.',
  );
} finally {
  await fetch(base + '/api/history/' + result.id, { method: 'DELETE' });
  assert.equal((await fetch(base + '/api/history/' + result.id)).status, 404);
}
