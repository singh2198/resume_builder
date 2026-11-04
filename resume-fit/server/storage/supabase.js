import { createHash } from 'node:crypto';
export const storageError = () =>
  Object.assign(
    new Error(
      'Persistent storage is unavailable. Retry shortly. If already paid, keep your purchase recovery details.',
    ),
    { status: 503 },
  );
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Elevated credentials never leave the server. Browser access is denied by RLS.
export function supabaseStore({ url, secret, bucket = 'resume-fit-purchases', fetchImpl = fetch }) {
  let origin;
  try {
    origin = new URL(url);
  } catch {
    throw Error('Set a valid SUPABASE_URL.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw Error('SUPABASE_URL must be an HTTPS project origin without a path.');
  if (!secret || (!secret.startsWith('sb_secret_') && !secret.startsWith('eyJ')))
    throw Error('Set the server-only SUPABASE_SECRET_KEY. Never use a publishable/anon key.');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket))
    throw Error('Choose a valid private SUPABASE_STORAGE_BUCKET.');
  const auth = { apikey: secret };
  if (secret.startsWith('eyJ')) {
    try {
      if (JSON.parse(Buffer.from(secret.split('.')[1], 'base64url')).role !== 'service_role')
        throw Error();
    } catch {
      throw Error('SUPABASE_SECRET_KEY must be a secret key or service_role key, not an anon JWT.');
    }
    auth.Authorization = `Bearer ${secret}`;
  }
  async function request(route, { method = 'GET', body, headers = {}, binary = false } = {}) {
    try {
      const response = await fetchImpl(origin.origin + route, {
        method,
        headers: {
          ...auth,
          ...(body !== undefined && !binary ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) throw Error();
      if (binary && method === 'GET') return Buffer.from(await response.arrayBuffer());
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      throw storageError();
    }
  }
  const table = (name, params = {}) => `/rest/v1/rf_${name}?${new URLSearchParams(params)}`;
  const object = (path, authenticated = false) =>
    `/storage/v1/object/${authenticated ? 'authenticated/' : ''}${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const objectPath = (id) => `${id}/resume`;
  const one = (rows) => rows?.[0] || null;
  const store = {
    kind: 'supabase',
    durable: true,
    async check() {
      for (const name of ['runs', 'purchases', 'ai_usage'])
        await request(table(name, { select: name === 'ai_usage' ? 'day' : 'id', limit: '1' }));
      const info = await request(`/storage/v1/bucket/${encodeURIComponent(bucket)}`);
      if (info?.public !== false) throw Error('The purchase storage bucket must be private.');
    },
    saveRun: (row) => request(table('runs'), { method: 'POST', body: row }),
    listRuns: (owner) =>
      request(
        table('runs', {
          select: 'id,created,label',
          owner: `eq.${owner}`,
          order: 'created.desc',
          limit: '100',
        }),
      ),
    async getRun(id, owner) {
      return (
        one(
          await request(
            table('runs', { select: 'result', id: `eq.${id}`, owner: `eq.${owner}`, limit: '1' }),
          ),
        )?.result || null
      );
    },
    deleteRun: (id, owner) =>
      request(table('runs', { id: `eq.${id}`, owner: `eq.${owner}` }), { method: 'DELETE' }),
    async consumeBudget(limit) {
      const result = await request('/rest/v1/rpc/rf_consume_ai_budget', {
        method: 'POST',
        body: { p_day: new Date().toISOString().slice(0, 10), p_limit: limit },
      });
      if (typeof result !== 'boolean') throw storageError();
      return result;
    },
    async getPurchase(id) {
      return one(await request(table('purchases', { id: `eq.${id}`, limit: '1' })));
    },
    async getPurchaseByOrder(id) {
      return one(await request(table('purchases', { order_id: `eq.${id}`, limit: '1' })));
    },
    async createPurchase(row, artifact) {
      const path = objectPath(row.id);
      await request(object(path), {
        method: 'POST',
        body: artifact.bytes,
        binary: true,
        headers: {
          'Content-Type': artifact.type,
          'x-upsert': 'false',
          'Cache-Control': 'no-store',
        },
      });
      try {
        await request(table('purchases'), {
          method: 'POST',
          body: {
            ...row,
            artifact_path: path,
            artifact_sha256: hash(artifact.bytes),
            artifact_size: artifact.bytes.length,
          },
        });
      } catch (error) {
        // A POST may commit before a network failure. Keep any object referenced by a stored row.
        try {
          if (!(await store.getPurchase(row.id)))
            await request(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
              method: 'DELETE',
              body: { prefixes: [path] },
            });
        } catch {}
        throw error;
      }
    },
    async attachOrder(id, order) {
      const rows = await request(
        table('purchases', { id: `eq.${id}`, status: 'eq.pending', order_id: 'is.null' }),
        {
          method: 'PATCH',
          body: { order_id: order },
          headers: { Prefer: 'return=representation' },
        },
      );
      if (!Array.isArray(rows) || rows.length !== 1) throw storageError();
    },
    async deletePendingPurchase(id) {
      const rows = await request(table('purchases', { id: `eq.${id}`, status: 'eq.pending' }), {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });
      for (const row of rows || [])
        await request(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
          method: 'DELETE',
          body: { prefixes: [row.artifact_path] },
        });
    },
    async markPaid(id, payment) {
      const rows = await request(table('purchases', { id: `eq.${id}`, status: 'eq.pending' }), {
        method: 'PATCH',
        body: { status: 'paid', payment_id: payment },
        headers: { Prefer: 'return=representation' },
      });
      if (Array.isArray(rows) && rows.length === 1) return;
      const current = await store.getPurchase(id);
      if (current?.status !== 'paid' || current.payment_id !== payment) throw storageError();
    },
    async readArtifact(row) {
      if (row.artifact_path !== objectPath(row.id)) throw storageError();
      const bytes = await request(object(row.artifact_path, true), { binary: true });
      if (bytes.length !== row.artifact_size || hash(bytes) !== row.artifact_sha256)
        throw storageError();
      return bytes;
    },
  };
  return store;
}
