# pac-quote-pdf-renderer

Stateless Node + Puppeteer service that turns a `QuoteSnapshotV1` payload into an
A4 PDF for Pac Technologies quotations. Deployed separately from Pac-Forge
(Fly.io / Render) and called from the Supabase `quote-render-pdf` Edge Function
over HTTP with a shared-secret bearer token.

## Endpoints

| Method | Path       | Auth                  | Returns |
| ------ | ---------- | --------------------- | ------- |
| GET    | `/healthz` | none                  | `{ ok: true }` |
| POST   | `/render`  | `Bearer <secret>`     | `application/pdf` |

The `/render` body must be `{ "snapshot": <QuoteSnapshotV1> }`. The snapshot is
the deterministic JSON built by `src/lib/quote-snapshot.ts` in the app.

## Environment variables

| Var | Required | Notes |
| --- | -------- | ----- |
| `PDF_RENDER_SECRET` | yes | Shared secret. Must match the Edge Function's `PDF_RENDER_SECRET`. |
| `PORT`              | no  | Default `3001`. |
| `HOST`              | no  | Default `0.0.0.0`. |
| `CHROMIUM_PATH`     | no  | Use a system Chrome/Chromium instead of `@sparticuz/chromium`. Helpful for local dev on Windows / macOS where the sparticuz binary is Linux-only. |
| `LOG_LEVEL`         | no  | Fastify logger level. Default `info`. |

## Local development

```bash
npm install
PDF_RENDER_SECRET=dev-secret CHROMIUM_PATH="/path/to/chrome" npm run dev
```

The `CHROMIUM_PATH` shortcut is only needed on Windows or macOS. On Linux the
`@sparticuz/chromium` bundled binary is used automatically.

## Tests

```bash
npm test
```

Vitest runs two suites:

1. **HTML render tests** (`render.test.ts`) — fast pure-template checks that
   never launch Chromium. They cover section visibility, pricing presentation
   modes (`subtotal_only`, `per_line_no_rates`, `full`), and structured vs.
   override T&Cs.
2. **PDF render test** (also in `render.test.ts`) — guarded by `CHROMIUM_PATH`.
   When set, the test launches Puppeteer and asserts the buffer starts with
   `%PDF`. CI should set `CHROMIUM_PATH` or run inside the Docker image.

## Deploy (Fly.io)

```bash
flyctl launch --no-deploy
flyctl secrets set PDF_RENDER_SECRET=$(openssl rand -hex 32)
flyctl deploy
```

The `Dockerfile` installs the Chromium runtime libraries Debian needs. Memory
budget: ~512 MB; Puppeteer launches a fresh browser per request.

## Architecture notes

- Stateless: no Supabase client, no DB connection. Pac-Forge passes the
  snapshot in directly so the renderer cannot leak data across tenants.
- The `snapshot_json` is intentionally the source of truth — once issued, the
  PDF is reproducible exactly from this payload.
- All visual styling lives in `src/templates/`. Brand tokens are duplicated
  from `src/index.css` deliberately so the renderer can evolve independently
  of the app's Tailwind config.
- Customer-visible pricing is driven by
  `snapshot.pricing_presentation.show_pricing_breakdown_detail`:
  - `subtotal_only` → render `totals.by_category_customer_visible` only.
  - `per_line_no_rates` → render `line_items` (no unit / rate columns).
  - `full` → render `line_items` with unit, hours, rate columns.
