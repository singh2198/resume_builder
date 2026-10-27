import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import mammoth from 'mammoth';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPayments } from './payments.js';
import { buildExport } from './exports.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tailor } from './match.js';
import { pdfEngine, tailorPDF } from './pdf-layout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'resume-fit.sqlite'));
db.exec(
  'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, label TEXT NOT NULL, result TEXT NOT NULL)',
);
const app = express();
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        connectSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      },
    },
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const payments = createPayments({
  db,
  upload,
  buildExport,
  config: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
});
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  payments.webhook,
  payments.errors,
);
app.use(express.json({ limit: '256kb' }));
// Local application: reject cross-origin write requests (including multipart uploads).
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (
    origin &&
    ![
      process.env.APP_ORIGIN,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      `http://127.0.0.1:${process.env.PORT || 3001}`,
      `http://localhost:${process.env.PORT || 3001}`,
    ].includes(origin)
  )
    return res.status(403).json({ error: 'Origin is not allowed.' });
  next();
});
app.use(
  '/api',
  rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }),
);
app.use('/api/payments', payments.router);
// Legacy export URLs must never release files without a verified payment.
app.post(['/api/export', '/api/export-original', '/api/export-edited-original'], (_, res) =>
  res.status(402).json({ error: 'Complete the ₹1 payment before downloading.' }),
);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function valid(text, min = 20) {
  return typeof text === 'string' && text.trim().length >= min && text.length <= 60000;
}
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.post(
  '/api/extract',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF, DOCX, or TXT file.' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    let text;
    try {
      if (ext === '.pdf') text = (await pdfEngine(req.file.buffer)).text;
      else if (ext === '.docx')
        text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
      else if (ext === '.txt') text = req.file.buffer.toString('utf8');
      else return res.status(400).json({ error: 'Supported files: PDF, DOCX, TXT.' });
    } catch (error) {
      return res.status(422).json({
        error:
          ext === '.pdf'
            ? error.message
            : 'Cannot read this file. Try exporting a fresh DOCX or pasting the text.',
      });
    }
    if (!valid(text))
      return res.status(422).json({
        error:
          'Text must be 20–60,000 characters. Scanned PDFs need OCR first; paste their text here.',
      });
    res.json({ text: text.trim(), originalLayout: ext === '.pdf' });
  }),
);
app.post('/api/tailor', (req, res) => {
  const { resume, jd, save = false, label = 'Untitled application' } = req.body;
  if (!valid(resume) || !valid(jd))
    return res
      .status(400)
      .json({ error: 'Resume and job description must each contain 20–60,000 characters.' });
  const result = tailor(resume.trim(), jd.trim());
  if (save === true) {
    result.id = randomUUID();
    db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run(
      result.id,
      new Date().toISOString(),
      String(label).slice(0, 100),
      JSON.stringify(result),
    );
  }
  res.json(result);
});
function persistResult(result, save, label) {
  if (save === true || save === 'true') {
    result.id = randomUUID();
    db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run(
      result.id,
      new Date().toISOString(),
      String(label || 'Untitled application').slice(0, 100),
      JSON.stringify(result),
    );
  }
}
app.post(
  '/api/tailor-pdf',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file || !valid(req.body.jd))
      return res
        .status(400)
        .json({ error: 'Upload the original PDF and a job description of 20–60,000 characters.' });
    try {
      const { result } = await tailorPDF(req.file.buffer, req.body.jd);
      persistResult(result, req.body.save, req.body.label);
      res.json(result);
    } catch (error) {
      res.status(422).json({ error: error.message });
    }
  }),
);
app.post(
  '/api/preview-original',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file || !valid(req.body.jd))
      return res.status(400).json({ error: 'The original PDF and job description are required.' });
    try {
      const { result, orders } = await tailorPDF(req.file.buffer, req.body.jd);
      if (
        typeof req.body.text !== 'string' ||
        req.body.text.replace(/\r\n?/g, '\n') !== result.updatedResume
      )
        return res.status(409).json({
          error:
            'The draft was edited. Restore the generated draft to preserve the original layout, or choose a rebuilt export.',
        });
      const output = await pdfEngine(req.file.buffer, 'preview', orders);
      res.json({ pages: output.pages });
    } catch (error) {
      res.status(422).json({ error: error.message });
    }
  }),
);
app.post('/api/drafts', (req, res) => {
  const { text, jd = '', label } = req.body;
  if (!valid(text, 1) || typeof jd !== 'string' || jd.length > 60000)
    return res.status(400).json({ error: 'Draft must contain 1–60,000 characters.' });
  const result = { ...tailor(text, jd), updatedResume: text, changes: [], layoutMode: false };
  persistResult(result, true, label);
  res.status(201).json(result);
});
app.get('/api/history', (_, res) =>
  res.json(db.prepare('SELECT id,created,label FROM runs ORDER BY created DESC LIMIT 100').all()),
);
app.get('/api/history/:id', (req, res) => {
  const row = db.prepare('SELECT result FROM runs WHERE id=?').get(req.params.id);
  row
    ? res.json(JSON.parse(row.result))
    : res.status(404).json({ error: 'Saved result not found.' });
});
app.delete('/api/history/:id', (req, res) => {
  db.prepare('DELETE FROM runs WHERE id=?').run(req.params.id);
  res.status(204).end();
});
app.use(express.static(path.join(root, 'dist')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint not found.' });
  res.sendFile(path.join(root, 'dist', 'index.html'));
});
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
    error:
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Maximum upload size is 5 MB.'
        : 'Request could not be processed. Check the file and input sizes.',
  });
});
app.listen(Number(process.env.PORT) || 3001, '127.0.0.1', () =>
  console.log('ResumeFit: http://127.0.0.1:' + (process.env.PORT || 3001)),
);
