# Vista Saloon POS System

White-label unisex salon POS built with React, TypeScript, Zustand, Supabase and Vite. Includes mobile billing, services/categories, Deals & offers, customers and Excel import/export, team commissions, invoice history, receipts, manual WhatsApp sharing, insights and shared branding.

## Local preview

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Keep `VITE_ENABLE_REMOTE_SYNC=false` for disconnected development. Set `VITE_DEMO_MODE=true` to load fictional clients, staff, services, deals and sales in separate development storage. The local development login is `admin@vistasaloon.local` / `VistaLocal123!`, with invoice PIN `9999`. Reset sample data in Settings > Account. These credentials do not work in connected production. Production builds do not seed demo records or allow disconnected local login.

Open the URL printed by Vite. The default local preview is http://127.0.0.1:5173/. No external fonts, analytics or former salon links are used. Browser storage is not a backup.

## Production installation

Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for all five migrations, Supabase Auth user provisioning, the explicit salon membership allowlist, initial PIN configuration, Vercel environment variables, recovery and live acceptance checks. Use a separate Supabase project/deployment for each buyer.

The production integrity upgrade intentionally replaces the inherited browser password comparison, anonymous database access and optimistic offline queue. Saves require a server acknowledgement. Invoice/deal writes are transactional, stale edits are version checked, deleted invoices/deals remain recoverable, and permanent UUID reservations prevent ID reuse. Refreshes retain the bill and do not seed defaults. Old local queues are not uploaded to a newly connected project.

There are no Edge Functions. Backend operations use authenticated PostgreSQL RPCs. Never expose service-role keys in Vite configuration. The new migration is prepared locally; no live Supabase project has been modified during the audit.

## Features

- POS: choose a team member, select a customer or walk-in, filter/search services by category, add deals, discounts and payment state. Save only, Save + Print or Save + WhatsApp.
- Invoice history: click a row/card to preview, print or open manual WhatsApp sharing; edit/delete through the protected PIN flow. Preview never resaves a bill.
- Customer import: .xlsx/.xls/.csv, up to 5 MB and 1,000 rows per file. Match columns, preview duplicates/invalid rows, retain leading phone zeros and retry partial failures. Files are parsed locally. Only acknowledged rows count as imported in connected mode.
- Settings: manage services, categories, deals, team, clients, account and salon branding. Logo/name/contact details appear on the app and receipts. Colors are configurable; Developed by FlagVista remains subtle.
- Responsive pages: mobile service/deal tabs, touch-friendly bill review, responsive lists/cards and dialogs. Current Tailwind 4 requires modern browsers; see deployment requirements.
- Offline: already-open cached viewing and bill drafting; database saves require reconnection. Draft/session storage cannot replace cloud backups, and cold offline launching is not provided.

Manual WhatsApp uses `wa.me` with the customer's number and a prefilled text receipt; the operator presses Send. No API key, automatic sending or file attachment. Set `VITE_WHATSAPP_DEFAULT_COUNTRY_CODE` for the installation (default `92`). A popup fallback is shown if needed. Real printers and WhatsApp must be tested on the customer's devices.

## Validation

```sh
npm run typecheck
npm run build
npm audit
npm run test:migrations
npm run test:production
npm run test:production-browser
npm run test:shared-settings
npm run test:customer-import
npm run test:ui
npm run test:categories
npm run test:invoice-actions
npm run test:app-settings
npm run test:mobile
npm run test:mobile-billing
```

The UI smoke tests use the separate local development preview on port 5173 and isolated Chrome contexts. The production browser/SQL and import/shared-settings suites start their own localhost helpers and block external requests. Screenshots are saved in ignored `.qa/`. They never use the project's real Supabase environment. See [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md) for findings, coverage and remaining installation checks.

Original root SQL files remain historical references. Do not replay them against an existing customer database. Keep `.env.local`, database backups, private keys, generated build files and test artifacts out of source control.
