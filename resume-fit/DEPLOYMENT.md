# Production deployment

This app runs React, Express, Python/PyMuPDF and SQLite in one Docker web service. The production Blueprint is `resume-fit/render.production.yaml`; the existing `render.yaml` is a separate free demo and must not collect live payments.

Production uses Starter compute and a 1 GB disk mounted at `/app/data`, with `DATA_DIR=/app/data`. Obtain approval for Render charges before creating it. The current baseline is approximately USD 7.25/month before tax and metered extras; confirm the dashboard price.

Enter the existing Razorpay Live key ID and secret only in Render's server environment. Enter the Gemini key there as well. Never commit `.env`, payment databases or uploaded resumes. Generate a separate random webhook secret and configure it both in Render and Razorpay. Keep the generated session secret stable.

With the standard Render URL, application origins use `RENDER_EXTERNAL_URL`. For a custom domain, configure `APP_ORIGIN` to its exact HTTPS origin. Register the deployed URL in Razorpay Business website details and wait for approval before taking payments. Valid Live API credentials alone do not establish website approval.

Configure a Razorpay Live webhook at `https://YOUR-APP/api/payments/webhook` for `payment.captured` and `order.paid`, using the server webhook secret. Enable automatic capture. The fixed new-order amount is 100 paise (INR 1). Existing purchases retain their original prices.

Verify hosted health, tailoring, Gemini, original-layout PDF previews, blocked unpaid downloads and Razorpay checkout. A completed live transaction is a separate check and requires the user's payment action. Do not describe a pending or failed payment as captured. Keep durable data backed up.

Public saved history belongs to a signed browser cookie. Purchase recovery uses browser session storage; this release does not provide account-based purchase recovery.
