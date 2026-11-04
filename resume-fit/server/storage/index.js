import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { sqliteStore } from './sqlite.js';
import { supabaseStore } from './supabase.js';
export async function createStorage({ root, env = process.env } = {}) {
  const provider = env.STORAGE_PROVIDER || 'sqlite';
  if (provider === 'supabase') {
    const store = supabaseStore({
      url: env.SUPABASE_URL,
      secret: env.SUPABASE_SECRET_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
    await store.check();
    return store; // Never fall back to SQLite when remote storage is unavailable.
  }
  if (provider !== 'sqlite') throw Error('STORAGE_PROVIDER must be sqlite or supabase.');
  const dataDir = env.DATA_DIR || path.join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  return sqliteStore(new DatabaseSync(path.join(dataDir, 'resume-fit.sqlite')), {
    durable: env.SQLITE_PERSISTENT_DISK === 'true',
  });
}
