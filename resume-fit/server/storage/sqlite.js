import { initializeHistory } from '../workspaces.js';
export function sqliteStore(db, { durable = false } = {}) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, label TEXT NOT NULL, result TEXT NOT NULL)',
  );
  const history = initializeHistory(db);
  db.exec(`CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created TEXT NOT NULL,
    order_id TEXT UNIQUE, payment_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
    filename TEXT NOT NULL, content_type TEXT NOT NULL, artifact BLOB NOT NULL
  )`);
  if (
    !db
      .prepare('PRAGMA table_info(purchases)')
      .all()
      .some((column) => column.name === 'amount')
  )
    db.exec('ALTER TABLE purchases ADD COLUMN amount INTEGER NOT NULL DEFAULT 100');
  db.exec('CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)');
  const consume = db.prepare(`INSERT INTO ai_usage(day,requests) SELECT ?,1 WHERE ? > 0
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests < ? RETURNING requests`);
  return {
    kind: 'sqlite',
    durable,
    saveRun: (row) =>
      history.save.run(row.id, row.created, row.label, JSON.stringify(row.result), row.owner),
    listRuns: (owner) => history.list.all(owner),
    getRun(id, owner) {
      const row = history.find.get(id, owner);
      return row ? JSON.parse(row.result) : null;
    },
    deleteRun: (id, owner) => history.remove.run(id, owner),
    consumeBudget: (limit) => !!consume.get(new Date().toISOString().slice(0, 10), limit, limit),
    getPurchase: (id) => db.prepare('SELECT * FROM purchases WHERE id=?').get(id),
    getPurchaseByOrder: (id) => db.prepare('SELECT * FROM purchases WHERE order_id=?').get(id),
    createPurchase(row, artifact) {
      db.prepare(
        'INSERT INTO purchases (id,token_hash,created,filename,content_type,artifact,amount) VALUES (?,?,?,?,?,?,?)',
      ).run(
        row.id,
        row.token_hash,
        row.created,
        row.filename,
        row.content_type,
        artifact.bytes,
        row.amount,
      );
    },
    attachOrder: (id, order) =>
      db.prepare('UPDATE purchases SET order_id=? WHERE id=?').run(order, id),
    deletePendingPurchase: (id) =>
      db.prepare("DELETE FROM purchases WHERE id=? AND status='pending'").run(id),
    markPaid: (id, payment) =>
      db
        .prepare("UPDATE purchases SET status='paid',payment_id=? WHERE id=? AND status='pending'")
        .run(payment, id),
    readArtifact: (row) => Buffer.from(row.artifact),
  };
}
