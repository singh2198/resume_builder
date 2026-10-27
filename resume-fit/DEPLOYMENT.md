# Put ResumeFit online with Render

This setup runs React, Express, Python/PyMuPDF and SQLite together. It is configured for a public, single-instance pilot with anonymous browser workspaces. No Render service has been created yet.

## 1. Publish the deployment changes to GitHub

Repository: https://github.com/singh2198/resume_builder

The application lives in `resume-fit/` within the repository. Commit and push the reviewed application/deployment changes. Do not commit `.env`, local database files, purchased files, or keys. `.env.example` must contain placeholders only. The local package-lock change predates deployment preparation; review it before including it in a commit.

## 2. Create the Render service

Sign in at https://dashboard.render.com/ and connect the GitHub repository.

Option A — Blueprint:

- Choose **New → Blueprint**, select the repository and branch containing these changes.
- Set Blueprint path to `resume-fit/render.yaml`.
- Review the paid Starter service and 1 GB persistent disk cost before creating resources.
- Enter the requested secret/environment values. Render generates `SESSION_SECRET`; keep it stable across deploys.

Option B — manual Web Service:

- Choose **New → Web Service**, connect the repository and select **Docker**.
- Root Directory: `resume-fit`
- Dockerfile Path: `./Dockerfile`; Docker Build Context: `.`
- Use a paid service and add a persistent disk at `/app/data`, initially 1 GB.
- Health Check Path: `/api/health`
- Add the environment settings below before the first deployment.

Render gives the service an HTTPS address such as `https://your-service.onrender.com`. Persistent disks require paid compute; the free plan is unsuitable for retaining this app's SQLite payment records and files.

## 3. Set server environment variables

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `DATA_DIR=/app/data`
- `TRUST_PROXY_HOPS=1` for Render's reverse proxy
- `SESSION_SECRET`: a stable random secret of at least 32 characters (Blueprint generates it). Generate manually with `openssl rand -hex 32` if needed.
- `MAX_AI_REQUESTS_PER_DAY=100`: global maximum provider attempts per UTC day. Set `0` to disable AI. This bounds request count, not an exact monetary spend; also set provider spending limits.
- `APP_ORIGIN=https://your-service.onrender.com`, with no trailing slash. If absent, the app uses Render's automatic `RENDER_EXTERNAL_URL`. Update this when using a custom domain.
- `OPENAI_API_KEY`: enter your real key directly in Render's environment settings.
- `OPENAI_MODEL=gpt-4.1-mini`, or a compatible model available to your account.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: begin with Test Mode credentials.
- `RAZORPAY_WEBHOOK_SECRET`: a separately generated secret, matching Razorpay's webhook configuration.

Render supplies `PORT`. The Docker image supplies `PDF_PYTHON=/opt/pdf-venv/bin/python`. Never upload the local `.env` as source code. Keep keys out of `VITE_` variables. The local OpenAI test returned a quota/rate-limit error; API credit/quota must be resolved before hosted AI generation can succeed.

## 4. Configure payments

In Razorpay, set the webhook URL to `https://your-service.onrender.com/api/payments/webhook`, subscribe to `payment.captured` and `order.paid`, and match `RAZORPAY_WEBHOOK_SECRET`. Enable automatic capture.

Complete a Test Mode checkout and verify that the paid file downloads. Only switch to live credentials after account activation and successful hosted testing. The price remains fixed at ₹1 on the backend. Webhook access uses Razorpay's signature verification.

## 5. Verify the live URL before sharing

- `/api/health` returns `{ "ok": true }`.
- Upload a sample PDF and tailor it; verify its text and layout.
- Generate an AI improvement and apply it after review.
- Save a draft in a normal browser window. Open the site in a separate private/incognito window and confirm that the original saved draft is not visible.
- Finish a Razorpay Test Mode payment and verify paid download/recovery.
- Redeploy once and confirm saved drafts and purchased files survive.

The deployment is not verified until these checks pass on the actual hosted URL.

## Public-pilot limits

Visitors do not create accounts. A signed, HttpOnly, Secure cookie identifies each browser workspace for up to 30 days. Clearing cookies or changing devices loses history access. The session cookie cannot be forged without `SESSION_SECRET`. Existing local history is not exposed to hosted browser workspaces. Download recovery still uses the existing purchase access token; it is not cross-device account recovery.

Keep one server instance with the attached SQLite disk. For a larger product, add durable user accounts, cross-device recovery, retention/deletion controls and a managed database. Rate limits and a global daily AI cap reduce abuse but are not a full bot defense. The uploaded-document processing limits still need review for a high-traffic public service.

## Optional custom domain

After the Render URL works, add your domain in the service's **Settings → Custom Domains**, follow Render's DNS instructions, update `APP_ORIGIN` and the Razorpay webhook URL, then repeat checkout and download checks.

## Local verification status

Verified locally: production frontend build, 29 automated tests, formatting, and a production-mode HTTP smoke test covering signed browser sessions, isolated history save/read/delete, the global AI cap, the served React page and unpaid export protection. The smoke test uses synthetic data and makes no OpenAI calls. A Docker build is not confirmed while Docker Desktop/the Docker daemon is stopped. No hosting resources or charges have been created by this preparation.

Official references:
- https://render.com/docs/web-services
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec
