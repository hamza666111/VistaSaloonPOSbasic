# Connecting Vista Saloon POS System to a new Supabase project

The current local demo remains disconnected. No live database migration or Vercel deployment has been performed.

## Production security prerequisite

The inherited application compares credentials from `app_users` in the browser, persists credentials locally, and its supplied schema has open anonymous policies for existing records. This is not Supabase Auth and is not suitable for an untrusted public production deployment.

The category and App settings migrations preserve that access model for compatibility: category reads and narrowly scoped mutation/import RPCs are accessible to the public anon role. Direct inserts, updates, and deletes on the new tables are denied to browser roles, but that is not a substitute for user authorization. Anyone holding the public project configuration can call these RPCs, including updating branding. The project must remain a single salon installation; this does not add tenant isolation.

Before public launch, replace the browser password comparison with real server-verified authentication (such as Supabase Auth), remove the open policies on existing tables, and authorize existing data plus the category and App settings RPCs/tables for the actual salon users. Changing only the new category policies would leave the rest of the application exposed. That broader authentication migration is separate from category synchronization and has not been silently applied to the preserved business backend.

## Database setup

Create a NEW Supabase project for this installation. No SQL should be applied to the former customer's project.

For a **fresh, empty database**, run every file in `supabase/migrations` in this order:

1. `202610160001_base_schema.sql` - the preserved original core/package schema and default local admin seed. It refuses to run if any core application table already exists, preventing accidental baseline replay over an existing installation.
2. `202610170001_service_categories.sql` - categories, memberships and catalog RPCs.
3. `202610170002_app_settings.sql` - shared name, contact details, theme and logo.
4. `202610170003_customer_activity.sql` - the `customers.active` flag already used by the application's activate/deactivate actions.

The root `supabase_schema.sql` and `supabase_packages.sql` are retained as original references; do not run them again after the fresh baseline. For an **existing installation** created using those two scripts, skip the fresh baseline and apply only the unapplied additive migrations (the last three above). If using the CLI with an existing migration history, reconcile the existing baseline/history first; do not blindly replay the fresh baseline or use a database reset on customer data. See [Supabase database migration guidance](https://supabase.com/docs/guides/deployment/database-migrations).

Verify all 11 application tables exist and the category/branding RPCs were created. Category and App settings migrations add their three tables to `supabase_realtime` when that publication exists. If needed, enable Postgres Changes for these tables in the project's dashboard. Visible-tab polling remains available (15 seconds for categories, 30 seconds for branding).

The original billing definitions/store and original SQL files remain unchanged. The customer activity migration adds one column with existing clients defaulting to active and preserves any previously stored inactive values on reruns. No original grants or RLS policies are changed. Validate the core tables' API permissions against the actual authentication model in the new project before enabling remote sync; no broad API grants are supplied by these compatibility fixes. The production authentication/RLS prerequisite above still applies.

Category deletion only removes its new membership rows; it never deletes services or historical invoices. Upgrades are repeatable without resetting branding, sales, category data or account credentials. The fresh baseline intentionally runs once and is not a repeatable upgrade.

The shared catalog intentionally starts empty. A new browser does not upload its local defaults or recreate categories deleted elsewhere. Add categories in Settings > Categories. New services with no shared memberships appear in Uncategorized.

## Local connection / Vercel configuration

Use the new project's public URL and public anon/publishable key. A service role key must never appear in a `VITE_` variable.

```dotenv
VITE_ENABLE_REMOTE_SYNC=true
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
```

For localhost, put these in ignored `.env.local` and restart Vite. On Vercel, set them for the intended deployment environment, then rebuild/redeploy: Vite variables are embedded at build time. The retained `vercel.json` routes page reloads back to `index.html`. Never place live credentials in this repository.

Keep Preview deployments pointed at a test project. Keep the current local mock-data profile disconnected. Production builds never initialize demo records. Demo category storage and shared category caches have different keys; shared caches are also isolated by project host. The preserved legacy sales store has its own older storage behavior, so use a clean browser profile when first connecting a new installation and do not flush old/demo sales into it.

## Bringing genuine local categories forward

When connecting from the same browser/origin that contains real non-demo categories, Settings > Categories offers **Import local categories** after the first successful shared refresh. This is an explicit merge, not an automatic upload.

- Matching category names are reused without replacing shared categories.
- Assignments are added individually; existing assignments remain.
- Unknown service IDs are skipped and reported. The service records must already exist in the new database before their category assignments can be imported.
- An invalid import rolls back as one transaction.
- Local demo categories are not imported.
- Browser storage is origin-specific. If you need categories from localhost, connect that same localhost profile to the new project and import them before switching to the deployed origin.

## What synchronization guarantees

Connected mode treats Supabase as authoritative. A change is displayed as saved only after the database acknowledges it. Realtime notifications, reconnect, focus/visibility changes, and a 15-second polling fallback refresh the category snapshot without invoking the legacy sales sync or clearing the current bill.

Membership changes update one service/category pair rather than overwriting the entire assignment collection. Changes to different pairs therefore merge across devices. For simultaneous changes to the same pair, the last committed operation wins. Renaming/deleting a category uses its version; a stale operation is rejected and the latest catalog is refreshed. A name being typed is retained during background updates, with an explicit option to use the latest server name.

If a save fails or its acknowledgement is lost, an error is shown and the catalog is refreshed to reconcile whether the server committed it. Requests have a 15-second timeout. While offline or unable to confirm the shared catalog, cached categories remain viewable and editing is disabled. Offline category edits are deliberately not queued, avoiding hidden conflicting changes across browsers.

The snapshot RPC returns categories and memberships together, including more than 1,000 memberships, rather than relying on the default REST page size. An empty server catalog remains empty. Missing migration/permissions show an actionable error and retry control instead of silently switching to browser-only writes.

These guarantees apply to the category feature. The inherited core sales/authentication synchronization was preserved and is not a blanket guarantee that every existing feature has been hardened for concurrency or public production use.

## Verification before customer delivery

```sh
npm ci
npm run typecheck
npm run build
npm run test:ui
npm run test:categories
npm run test:category-sync
npm run test:migrations
```

The first two browser checks expect the regular local demo server running on port 5173. The category-sync test starts its own isolated Vite instance and local HTTP adapter backed by embedded PostgreSQL. It does not contact a real Supabase project. It verifies repeatable SQL, grants/constraints, two independent browser stores, concurrent membership changes, stale name/version checks, polling recovery, delayed reads, failed/lost acknowledgements, offline read-only caches, transactional import, deletion cascades, and a catalog with over 1,000 assignments.

After configuring the actual project, repeat these manual checks on two browsers/devices: add and rename a category, assign/remove services, confirm changes appear without reloading, disconnect/reconnect one device, refresh both browsers, and confirm a bill in progress remains unchanged. Validate actual Supabase Realtime and the final authorization policies in that environment before deployment. A real thermal printer still needs its own integration test.

Reference: [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Shared App settings

The second additive migration creates the singleton `app_settings` table and `get_app_settings` / `save_app_settings` RPCs. It leaves the original billing schema and operational store untouched. Apply it before enabling remote sync. Its seed is repeatable and preserves existing branding.

Settings > App configures shared salon name, address, phone, theme color, and logo. New projects start with Vista Saloon and blank contact details. Browser-only branding is not silently imported. Configure the salon after connecting. Logos are resized raster data stored in this row (maximum 360,000 characters); no Supabase Storage bucket is needed.

Saves require a server acknowledgement. Version checks reject stale edits while preserving the form draft. Realtime plus focus/reconnect and a 30-second visible-tab poll refresh other devices. Unchanged reads omit the logo payload. Offline cached branding remains visible and editing is disabled until a successful refresh. Changes do not reset an active bill or change invoice calculations. The saved current branding is used when printing historical invoices.

The inherited authentication production prerequisite above also applies to this table and its RPCs. Validate actual Supabase Realtime and authorization in the new project before launch. Run `npm run test:app-settings` and `npm run test:shared-settings` for local branding, receipt, logo, theme, conflict, migration, and multi-browser coverage.

## Mobile delivery checks

The mobile redesign adds no database migration. It retains the original billing/store operations and uses the additive migrations for categories, branding and customer activity. Run `npm run test:mobile` with the disconnected local demo server, plus the existing UI, category, invoice and app-settings suites. Verify navigation, customer entry with the keyboard open, a complete bill, invoice editing, download behavior, WhatsApp handoff and thermal printing on the customer's actual phones/tablets before launch. The production build loads routes and spreadsheet support on demand; deploy all generated assets together so the lazy-loaded chunks are available.


## Migration audit

`npm run test:migrations` initializes a fresh embedded PostgreSQL database using all four files, checks the existing service/customer/deal/invoice payloads, and then applies the additive upgrades repeatedly to both fresh and original-schema installations. It checks preservation of inactive clients, account passwords, invoices, branding and access grants. The separate `test:shared-settings` suite tests category/branding RPC roles and independent browsers. PGlite has built-in UUID generation but does not bundle pgcrypto, so the test omits only the extension installation statement; the actual Supabase project still needs its normal pgcrypto support. These checks do not replace testing actual Supabase API grants, Realtime and final production authorization. No live Supabase project was migrated during this audit.


## Customer spreadsheet import

Excel/CSV import needs no additional migration. Imported records use the existing customers columns: id, name, phone, email, notes and active. Ensure 202610170003_customer_activity.sql has been applied. Existing customer insert/read API permissions and the authentication prerequisite above still apply. Address imports map to notes rather than adding a separate address column. Connected imports check existing records with paginated reads and save through the preserved customer operation; this does not add a server-side phone uniqueness constraint. Validate imports against the actual project's permissions before delivery. `npm run test:customer-import` uses only isolated localhost servers and a mocked API.
