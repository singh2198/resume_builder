import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
const cookieName = 'resumefit_workspace';
const duration = 30 * 24 * 60 * 60;
export function browserWorkspaces({
  secret = process.env.SESSION_SECRET,
  production = process.env.NODE_ENV === 'production',
} = {}) {
  if (production && (!secret || secret.length < 32))
    throw Error('Set SESSION_SECRET to at least 32 characters before public hosting.');
  // Retain the existing personal database workflow in local development.
  if (!production)
    return (req, _res, next) => {
      req.workspace = 'local';
      next();
    };
  const sign = (value) => createHmac('sha256', secret).update(value).digest('hex');
  return (req, res, next) => {
    if (req.path === '/api/health' || req.path === '/api/payments/webhook') return next();
    const token = (req.get('cookie') || '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    const [id, expires, signature, extra] = (token || '').split('.');
    const payload = `${id}.${expires}`;
    if (
      !extra &&
      /^[a-f0-9]{64}$/.test(id || '') &&
      /^\d{10}$/.test(expires || '') &&
      /^[a-f0-9]{64}$/.test(signature || '') &&
      Number(expires) > Math.floor(Date.now() / 1000) &&
      timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(payload), 'hex'))
    ) {
      req.workspace = id;
    } else {
      req.workspace = randomBytes(32).toString('hex');
      const value = `${req.workspace}.${Math.floor(Date.now() / 1000) + duration}`;
      res.append(
        'Set-Cookie',
        `${cookieName}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${duration}`,
      );
    }
    res.set('Cache-Control', 'no-store');
    next();
  };
}
export function initializeHistory(db) {
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'owner')
  )
    db.exec("ALTER TABLE runs ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'");
  db.exec('CREATE INDEX IF NOT EXISTS runs_owner_created ON runs(owner, created)');
  return {
    save: db.prepare('INSERT INTO runs (id,created,label,result,owner) VALUES (?,?,?,?,?)'),
    list: db.prepare(
      'SELECT id,created,label FROM runs WHERE owner=? ORDER BY created DESC LIMIT 100',
    ),
    find: db.prepare('SELECT result FROM runs WHERE id=? AND owner=?'),
    remove: db.prepare('DELETE FROM runs WHERE id=? AND owner=?'),
  };
}
export function dailyAIBudget(
  db,
  { limit = Number(process.env.MAX_AI_REQUESTS_PER_DAY || 100), now = () => new Date() } = {},
) {
  if (!Number.isInteger(limit) || limit < 0)
    throw Error('MAX_AI_REQUESTS_PER_DAY must be a nonnegative integer.');
  db.exec('CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)');
  const consume = db.prepare(`INSERT INTO ai_usage(day,requests) SELECT ?,1 WHERE ? > 0
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests < ? RETURNING requests`);
  return (_req, res, next) => {
    if (!consume.get(now().toISOString().slice(0, 10), limit, limit))
      return res.status(429).json({
        error:
          'The site has reached its daily AI request limit. Try tomorrow; editing and basic tailoring are still available.',
      });
    next();
  };
}
