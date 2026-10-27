# ResumeFit

A complete local React + Node.js application for **truth-preserving resume prioritization**. Upload or paste a resume and job description, compare keywords, review a tailored draft, and export PDF, DOCX or TXT. Optional application history uses SQLite.

## Quick start

Install Node.js **22.13 or newer** (Node 22 LTS recommended) and **Python 3.10+** for PDF layout processing. Then open a terminal in this folder:

```sh
npm install
npm run setup:pdf
npm run dev
```

Open http://127.0.0.1:5173. Click **Try sample data**, then **Tailor my resume** to exercise the entire flow. Tailoring and previews need no API key or external AI account. Downloads require Razorpay configuration below; SQLite needs no separate installation. `npm run setup:pdf` creates a project-local Python environment and installs the pinned PDF engine. React and Express remain the frontend and backend; Express calls the PDF helper through stdin/stdout. Set `PDF_PYTHON` to an alternative Python executable if necessary.

For the built app:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. Development uses Vite's proxy to reach the Express backend on port 3001. `npm start` serves the built frontend and API together. SQLite is built into Node; an experimental-feature warning may appear on Node 22.

## ₹1 Razorpay download payments

Every PDF, DOCX or TXT export costs **₹1 (100 paise)**. The server fixes the price, prepares the exact file before checkout, and releases it only after verifying a captured payment. The old export endpoints return HTTP 402. Editing, saved drafts and image previews remain free. The final editor no longer exposes a downloadable PDF before payment.

1. Copy `.env.example` to `.env` in the project root.
2. In Razorpay **Test Mode → Account & Settings → API Keys**, generate a Key ID and Key Secret. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. These are server-only; never use a `VITE_` prefix for secrets.
3. Enable automatic capture in Razorpay payment capture settings. An authorized but uncaptured payment does not unlock a download.
4. Restart `npm run dev`, generate a resume, then click **Pay ₹1 & download**. Test payments are simulated; the UI identifies Test Mode.
5. For a publicly reachable HTTPS deployment, set `APP_ORIGIN` to the exact frontend origin (no trailing slash). Configure a Razorpay webhook at `https://your-domain/api/payments/webhook`, subscribe to `payment.captured` and `order.paid`, and use the same random secret as `RAZORPAY_WEBHOOK_SECRET`. Local development can recover status by polling without a webhook; Razorpay cannot reach localhost directly.
6. After account activation and successful test payments, configure live keys, live auto-capture and a live webhook, then restart the server to collect real ₹1 payments.

**Recovery:** Payment orders and their immutable files are stored in SQLite. **Recover last download** checks Razorpay before reopening checkout. If a payment was captured or the download failed, the same file can be downloaded again without another charge. Keep the same browser tab/session for recovery; its random access token is held in session storage. There is no user-account recovery system. A different export requires a new payment. Payment details and resume content are never placed in a public download URL, and only order metadata is sent to Razorpay.

**Storage:** Prepared files, including unpaid preparations, and payment records persist under `data/` (or `DATA_DIR`). Use a persistent disk and back up this directory for hosting. File retention/cleanup must preserve paid downloads you promise to support. Payment records are separate from optional saved draft history; deleting a draft does not delete a purchased file.

**Verification:** `npm test` includes payment tests with a simulated Razorpay API: fixed price, invalid signatures, incorrect amount/order/currency, capture status, access tokens, duplicate webhooks, recovery, provider errors, and paid PDF/DOCX/TXT downloads. These tests do not contact Razorpay or charge money. Run a real Razorpay Test Mode checkout with your own keys before going live.

Official setup: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/

For an Indian test-card payment, use Razorpay’s current test Visa `4100 2800 0000 1007`, a future expiry, any three-digit CVV and a simulated OTP of 4–10 digits. Use dummy customer details and do not save the card. See https://razorpay.com/docs/payments/payments/test-card-details/.

## Preserve your uploaded PDF format

1. Upload the **original PDF** in Your resume. Look for **Original PDF layout ready**.
2. Paste or upload the job description, then select **Tailor my resume**.
3. Use **Preview original layout** and **Download original-layout PDF**.

The layout engine moves existing vector PDF bullet bands within the same contiguous section. It keeps the source fonts (including embedded subsets), text sizes, colors, page dimensions, artwork and line spacing; it does not replace them with Helvetica. Source URI links are retained. Content outside each band is physically removed before embedding, avoiding hidden duplicate text in extraction. Text remains selectable; the output is not a screenshot. With no changes, the original PDF bytes are returned unchanged.

PDF text is read in visual page order, and graphical bullet dots are recognized. Wrapped bullet lines stay together. This fixes the earlier export's interleaved contact details, education dates and sections.

**Limits:** conservative detection is designed for ordinary single-column resumes. Unsupported groups remain unchanged; complex columns, overlapping elements, unusual bullets or cross-page paragraphs need manual review. Rotated, password-protected or more-than-10-page PDFs are rejected. Only URI links are copied on reconstructed pages; PDF form widgets, accessibility tags, signatures and other interactive annotations are not guaranteed to survive reconstruction. It is a resume formatting workflow, not a general PDF editor.

Editing the imported source text switches to rebuilt exports. Editing the generated draft uses the edited-original PDF engine for paid downloads. The free original-layout image preview applies to the generated draft; use **Restore generated draft** to return to it. The original PDF is held in browser memory for the current session and is not included in saved history. Reopened history needs the original PDF and JD uploaded again for a layout-preserving export.

**Rebuilt PDF**, DOCX and TXT remain available separately and do not preserve the source design. The plain-text editor is not a representation of the original-layout PDF.

The helper uses PyMuPDF (AGPL/commercial dual licensing). Review its license before distributing a proprietary hosted product: https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright.

## What “tailor” means here

This version uses deterministic extraction and prioritization, **not generative AI**. It finds a documented, finite set of job keywords with aliases and reorders contiguous bullet groups so relevant experience comes first. Every original line remains in the resume; bullets never move between roles or projects. You can edit the generated text before downloading. It deliberately does not invent skills, credentials, dates, metrics, experience or a summary.

This is appropriate for a reliable first version with no API costs. It is not semantic rewriting or a production hiring system. It cannot guarantee interview selection or imitate proprietary ATS algorithms.

### Matching limitations

- Coverage = recognized JD keywords mentioned anywhere in resume / recognized JD keywords in JD, rounded to a percentage.
- Scores remain unchanged after reordering, because no keyword is added. No recognized JD keywords yields N/A.
- Vocabulary is in `server/match.js`; add domain-specific entries there. Technical roles have the broadest coverage.
- Required and preferred skills have equal weight. Negation, proficiency, years of experience and context are not understood. “No React experience” still matches React: check the displayed evidence.
- Plain-text prioritization affects consecutive lines beginning with `- `, `• ` or `* `. Original-PDF mode also detects graphical bullet dots and joins wrapped lines; ambiguous groups remain unchanged.
- DOCX/TXT imports use plain-text rebuilt exports. Uploaded PDFs support the original-layout path above. Scanned PDFs need external OCR first. Password-protected or malformed documents may fail.
- **Rebuilt PDF** uses Helvetica and is best suited to English / Latin text. Original-layout PDF retains source glyphs and fonts. Always review the PDF preview before submitting.

## Features

- React responsive workspace with accessible labels, progress and error states
- PDF / DOCX / TXT imports for both inputs, maximum 5 MB per file
- Paste text, maximum 60,000 characters per input
- Reproducible keyword coverage, gaps and source evidence
- Before/after change log
- Editable tailored text and three export formats
- Opt-in SQLite history, reopen and delete drafts
- Sample resume and job description
- Express validation, security headers, local-origin restriction and API rate limiting

## Data and privacy

The server binds to `127.0.0.1`. This is a **single-user local app**, without authentication. Do not expose it to a shared network or public hosting as-is. All local users with access to the app/database can read saved drafts.

Raw uploads stay in memory. Preparing a paid download stores the generated file and its payment record in SQLite, including preparations that have not yet been paid. Other unsaved resume/JD text is processed transiently. If Save is checked, the generated resume and analysis (including source evidence) are written to `data/resume-fit.sqlite`; the raw JD and upload are not saved. Delete through Saved applications to remove a record. Database storage is not encrypted, and SQL DELETE is not a secure erase of disk backups. Personal data is not sent to an AI provider. The UI uses Google Fonts; font requests contact Google, but no resume text is sent. System fonts are the fallback offline.

History stores the original generated draft. Manual editor changes are included in purchased exports and can be saved with **Save edited draft locally**; editing alone does not update the displayed score. Inputs changing dismiss the old result to avoid displaying stale analysis.

For a multi-user deployment, add authentication, per-user database ownership, TLS, explicit allowed origins, retention policy, encrypted storage, and isolated/time-limited document processing. The current file-size limit is not a decompression-bomb defense for untrusted public uploads.

## Code layout

```text
client/src/main.jsx      React workspace and interaction flow
client/src/style.css     Responsive styling
server/index.js         Express API, uploads, SQLite, exports
server/match.js          Keyword dictionary and safe bullet prioritization
server/match.test.js     Matching and factual-preservation tests
samples/                Example inputs
vite.config.js          Frontend build and development proxy
```

## API

- `GET /api/health` — server readiness
- `POST /api/extract` — multipart form with `file`; returns `{ text }`
- `POST /api/tailor-pdf` — multipart `file`, `jd`, optional `label`, `save`; returns draft and original-layout metadata
- `POST /api/export-original`, `/api/export-edited-original`, `/api/export` — legacy routes; always HTTP 402
- `POST /api/tailor` — JSON `{ resume, jd, label?, save? }`; returns draft, keyword coverage, evidence and changes
- `GET /api/history` — last 100 saved application metadata records
- `GET /api/history/:id` — a saved result
- `DELETE /api/history/:id` — permanently delete a saved record
- `GET /api/payments/config` — availability, test/live mode and fixed 100-paise price
- `POST /api/payments/orders` — multipart `text`, `format`, `mode`, optional `file` and `jd`; prepares file and returns Razorpay order plus private download token
- `POST /api/payments/:id/verify` — checkout proof; requires `X-Download-Token`
- `GET /api/payments/:id/status` — reconciles captured payment; requires `X-Download-Token`
- `GET /api/payments/:id/download` — purchased file only; requires `X-Download-Token`
- `POST /api/payments/webhook` — signed raw Razorpay webhook

## Validation

```sh
npm test
npm run build
```

With the server running, `node server/smoke.js` checks the API, persistence, ₹1 price and blocked unpaid exports using disposable sample data. Payment and export round trips are covered by `npm test` with a simulated gateway.

Tests cover alias handling, term boundaries, stable ranking, keeping achievements with their source roles, unsupported job vocabulary, and preserving every original resume line.

## Future semantic rewriting

A generative provider can be added server-side, with credentials in environment variables, explicit consent before transmitting personal data, a structured output schema, sentence-level source references and human review. Do not present a rewritten claim as verified merely because an AI generated it. The current extractive approach avoids that risk entirely.

PDF engine regression tests: `.venv/bin/python server/pdf/layout_test.py` (Windows: `.venv\Scripts\python.exe server/pdf/layout_test.py`). Tests cover unchanged-byte identity, reordered text without duplication, fonts, dimensions, URI links, and invalid permutations.
