import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { browserWorkspaces, initializeHistory, dailyAIBudget } from './workspaces.js';
const secret = 'test-secret-at-least-thirty-two-characters';
function visit(gate, cookie = '') {
  const req = { path: '/api/history', get: () => cookie };
  const res = {
    headers: {},
    append(key, value) {
      this.headers[key] = value;
    },
    set(key, value) {
      this.headers[key] = value;
    },
  };
  gate(req, res, () => {});
  return {
    owner: req.workspace,
    cookie: res.headers['Set-Cookie']?.split(';')[0],
    headers: res.headers,
  };
}
test('public visitors receive separate signed HttpOnly browser workspaces', () => {
  const gate = browserWorkspaces({ production: true, secret });
  const first = visit(gate),
    second = visit(gate);
  assert.notEqual(first.owner, second.owner);
  assert.equal(visit(gate, first.cookie).owner, first.owner);
  assert.match(first.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.notEqual(visit(gate, first.cookie.replace(first.owner, second.owner)).owner, second.owner);
});
test('public hosting requires a stable secret and local mode retains local history', () => {
  assert.throws(() => browserWorkspaces({ production: true, secret: '' }), /SESSION_SECRET/);
  assert.equal(visit(browserWorkspaces({ production: false })).owner, 'local');
});
test('migration preserves local data while restricting all hosted history operations by owner', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, label TEXT NOT NULL, result TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run(
    'old',
    '2026-01-01',
    'Private local resume',
    '{}',
  );
  const history = initializeHistory(db);
  initializeHistory(db); // Safe on restart.
  assert.equal(history.list.all('local').length, 1);
  assert.equal(history.list.all('visitor-a').length, 0);
  history.save.run('new', '2026-01-02', 'A resume', '{}', 'visitor-a');
  assert.ok(history.find.get('new', 'visitor-a'));
  assert.equal(history.find.get('new', 'visitor-b'), undefined);
  assert.equal(history.remove.run('new', 'visitor-b').changes, 0);
  assert.equal(history.remove.run('new', 'visitor-a').changes, 1);
  db.close();
});
test('daily AI cap persists across middleware instances and resets on the next UTC day', () => {
  const db = new DatabaseSync(':memory:');
  let day = '2026-10-28';
  const options = { limit: 2, now: () => new Date(day + 'T12:00:00Z') };
  const consume = (gate) => {
    let allowed = false,
      status;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    };
    gate({}, res, () => {
      allowed = true;
    });
    return { allowed, status };
  };
  const gate = dailyAIBudget(db, options);
  assert.equal(consume(gate).allowed, true);
  assert.equal(consume(gate).allowed, true);
  assert.equal(consume(dailyAIBudget(db, options)).status, 429);
  day = '2026-10-29';
  assert.equal(consume(gate).allowed, true);
  assert.equal(consume(dailyAIBudget(db, { ...options, limit: 0 })).status, 429);
  assert.throws(() => dailyAIBudget(db, { limit: -1 }), /nonnegative/);
  db.close();
});
