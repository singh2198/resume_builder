# Render Free + Supabase + real Razorpay payments

The backend now supports Supabase Postgres for purchase/history/AI-counter records and a private Supabase Storage bucket for purchased files. No Render disk is needed. SQLite remains available for local development.

## 1. Prepare the existing Supabase project

1. Open the Supabase project for ResumeFit, then **SQL Editor → New query**.
2. Copy and run the project's `supabase/schema.sql` (also provided as `resume-fit-supabase-schema.sql`). It creates `rf_runs`, `rf_purchases`, `rf_ai_usage`, an atomic AI-budget function and the private `resume-fit-purchases` bucket. It does not delete existing unrelated tables or records.
3. Under **Storage**, verify `resume-fit-purchases` is **private**. Do not add public/anonymous read policies.
4. In **Project Settings → API Keys**, get a server secret key starting with `sb_secret_`. A legacy `service_role` key also works. Never use a publishable/anon key for this backend.
5. Get the project URL from the **Connect** dialog, for example `https://YOUR-PROJECT.supabase.co`.

To allow local integration checks, put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the local server `.env` (never in chat). Leave `STORAGE_PROVIDER=sqlite` locally unless deliberately testing the remote setup. These keys are not sent to Razorpay or the browser.

## 2. Put credentials in Render's server environment

1. Open Render Dashboard → **resume-fit-free → Environment → Edit**.
2. Add each variable as a separate name/value row (without surrounding quotes):

```env
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=resume-fit-purchases
RAZORPAY_KEY_ID=rzp_live_YOUR_ACTUAL_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_MATCHING_LIVE_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
APP_ORIGIN=https://resume-fit-free.onrender.com
FREE_HOSTING_DEMO=false
MAX_AI_REQUESTS_PER_DAY=0
```

Keep the existing generated `SESSION_SECRET`; do not rotate it during ordinary deploys. Keep `NODE_ENV=production`, `HOST=0.0.0.0` and `TRUST_PROXY_HOPS=1`. Do not set `SQLITE_PERSISTENT_DISK=true` on Render Free. Do not put secrets in variables beginning with `VITE_`.

**Razorpay keys:** Razorpay Dashboard → switch to **Live Mode** → **Account & Settings → API Keys**. Copy the matching Live key ID and secret to the corresponding Render rows. If the original secret is unavailable, the account owner must regenerate it in Razorpay and update affected services. Do not paste real keys into source files, GitHub or chat.

Use Test Mode keys first for the hosted end-to-end test. Replace them with Live keys only after the public URL is approved by Razorpay and test capture/download/recovery pass.

3. After the schema exists and all required values are present, choose **Save, rebuild, and deploy** (or save and manually deploy the latest commit).
4. This existing app is Blueprint-managed. Change its Blueprint path from `resume-fit/render.yaml` to `resume-fit/render.supabase.yaml` after configuring secrets, so a later sync does not put it back into demo mode. The new Blueprint remains **plan: free** with no disk. Do not create a second service just to change settings.

## 3. Razorpay website and webhook

- Make sure `https://resume-fit-free.onrender.com` (or your final custom domain) is verified in Razorpay's Website/App settings.
- In **Live Mode**, add webhook URL `https://resume-fit-free.onrender.com/api/payments/webhook`.
- Subscribe to `payment.captured` and `order.paid`. Its secret must match `RAZORPAY_WEBHOOK_SECRET` in Render.
- Enable automatic payment capture. Uncaptured/authorized payments must not unlock files.
- A live successful payment is verified only after the user completes checkout; automated tests do not charge money.

## 4. Verify before accepting customers

- `/api/health` returns OK.
- `/api/payments/config` shows `storageProvider: "supabase"`, `durableStorage: true`, `demoMode: false`, `configured: true`, `checkoutAllowed: true`. After Live keys are installed, `testMode` must be false.
- Do a Test Mode payment, download the exact purchased file, restart/redeploy the service, and recover/download the same file without paying again.
- Supabase should contain the purchase row and its private object. The object must not be accessible by a public Storage URL or anon client.
- Unpaid downloads and incorrect access tokens must stay blocked.
- Enable Live keys only after these checks and Razorpay website approval. Complete one real ₹1 payment yourself, then verify captured status and the download.

The backend stores the file and record before asking Razorpay for an order. Storage failure prevents checkout; paid downloads still require a purchase token and captured payment. No public download URL is exposed. Existing local SQLite history/files are not automatically copied to Supabase; the local database is preserved.

## Free-tier limits

Render Free sleeps after inactivity. Supabase Free can pause low-activity projects and has storage/egress limits. Purchase data is no longer lost when Render restarts, but paused/unavailable Supabase can temporarily prevent checkout or downloads. Monitor quotas and retain backups; free tiers are not an uptime guarantee. Razorpay transaction fees and any enabled AI provider usage are separate from hosting.

## Verification status

Verified locally: frontend production build, 50 passing tests (including simulated Supabase/Razorpay restart recovery and failure cases), production-server history isolation and refusal of non-durable live checkout, plus real PostgreSQL migration/idempotency/permissions and a concurrent budget-cap test. Supabase API tests use a simulated remote service; the disposable PostgreSQL check does not validate a real Supabase account. External project credentials and schema setup are required for hosted verification. No successful live payment or customer charge is implied by implementation tests.

Official references:
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/storage/serving/downloads
- https://render.com/docs/configure-environment-variables
- https://razorpay.com/docs/payments/dashboard/account-settings/api-keys
