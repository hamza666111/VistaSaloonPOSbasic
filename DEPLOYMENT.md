# Delivering Vista Saloon POS System

One salon per Supabase project and Vercel deployment. This is not a shared multi-tenant SaaS database. All explicitly authorized salon members currently have the same management privileges. Do not place unrelated buyers in one project.

The production integrity upgrade changes the inherited backend access and save paths intentionally. The original root SQL scripts remain historical references, not the deployment procedure. No live Supabase project has been contacted or migrated during this audit.

## Database installation and upgrade

Create a NEW Supabase project for the buyer. Never connect this white-label copy to the former customer's database.

For a fresh, empty database, apply these migrations once, in order:

1. `supabase/migrations/202610160001_base_schema.sql`
2. `supabase/migrations/202610170001_service_categories.sql`
3. `supabase/migrations/202610170002_app_settings.sql`
4. `supabase/migrations/202610170003_customer_activity.sql`
5. `supabase/migrations/202610180001_production_integrity.sql`

For an existing database initialized from the original root scripts, take a complete backup and test restoring it in a separate project first. Skip the fresh baseline; apply only unapplied migrations after reconciling migration history. Test the upgrade against that restored copy before upgrading customer data. Never reset the database or replay the old root scripts over real sales. See [Supabase migration guidance](https://supabase.com/docs/guides/deployment/database-migrations).

The final migration converts legacy service, team, deal and category label IDs into UUID strings, updating foreign keys and historical invoice JSON references. Its private mapping is retained in `private.legacy_ids`. Customer/invoice/item IDs already use PostgreSQL UUIDs. Core entity IDs have cryptographic defaults, primary keys and a permanent cross-entity registry. A pre-existing cross-entity UUID collision aborts the migration for review rather than silently merging data. Existing malformed data or unexpected custom constraints can also stop the transaction safely; investigate instead of bypassing checks.

Core records gain versions and deletion metadata. The migration revokes inherited anonymous access and direct browser writes, replaces public policies, secures existing category/branding mutations, adds atomic core RPCs, and disables/redacts obsolete `app_users` passwords/PINs. The old default admin is **not** a production login. This upgrade must be deployed alongside the new frontend. Do not run older additive migrations again afterward: they contain the historical compatibility permissions. Only the final upgrade itself is tested for replay without resetting sales, PIN configuration or authorization.

No Edge Functions exist or are required for these features. The application calls authenticated PostgreSQL RPCs. Do not deploy placeholder Edge Functions or put service-role credentials in the browser.

## Provision the owner's account

Create the owner through Supabase Dashboard > Authentication > Users with a strong, buyer-specific password. Disable public signup when the salon does not need it. Set the correct production Site URL and permitted redirect URLs before testing email changes. Supabase Auth handles password storage and session refresh; browser password comparison is not used in connected mode.

Copy the Auth user UUID, then run as the database administrator:

```sql
insert into private.pos_members(user_id, active)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid, true)
on conflict (user_id) do update set active = excluded.active;
```

An authenticated account without an active membership cannot read salon data or call management mutations. Membership cannot be granted through a public browser request. To revoke an account:

```sql
update private.pos_members set active = false
where user_id = 'REPLACE_WITH_AUTH_USER_UUID'::uuid;
```

After signing in, open Settings > Account and initialize a new invoice PIN. Leave Current PIN blank only on first setup. Existing PIN changes require the current PIN. PINs are salted bcrypt hashes in a private table; five failed checks lock that account's PIN attempts for 15 minutes. Edit/delete approval is bound to the signed-in user, invoice and action; it expires after 15 minutes and is consumed by a successful operation. Configure PIN before handing over the installation. Dashboard administrators remain trusted and can manage/recover database data.

Reference: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Vercel and local environment

Use only the new project's public URL and anon/publishable key:

```dotenv
VITE_ENABLE_REMOTE_SYNC=true
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_WHATSAPP_DEFAULT_COUNTRY_CODE=92
```

For localhost, place these in ignored `.env.local` and restart Vite. For Vercel, set the environment variables for the intended deployment and rebuild. Keep previews on a staging project. Never put `service_role`, secret keys or database passwords in `VITE_` variables; Vite embeds these values in public JavaScript. Production sign-in and data mutation are disabled if the backend is disconnected. The development demo still works locally with remote sync explicitly disabled.

Use HTTPS on deployed devices. Node.js 20.19+ or 22.12+ is required by the build. Current Tailwind 4 styling targets modern browsers: Safari 16.4+, Chrome 111+, Firefox 128+. Test the buyer's actual phones before delivery. `vercel.json` provides SPA route rewrites. See the [Tailwind browser requirements](https://tailwindcss.com/docs/upgrade-guide#browser-requirements).

## Save, synchronization and offline behavior

Connected mode displays a successful save only after a database acknowledgement. Invoice header/items and deal header/items commit in one transaction. A failed statement rolls the complete operation back. Durable per-tab request IDs and invoice UUIDs protect retries from a lost acknowledgement. Retry the same bill; if its contents changed after an uncertain save, first inspect Invoices before creating a replacement.

Invoice UUIDv4 generation is cryptographic. Random UUIDs cannot be mathematically promised never to collide; primary keys and a permanent ID registry reject collisions or reused entity IDs. IDs are immutable. Do not truncate the registry or reset IDs when cleaning historical data.

Snapshot reads return one consistent JSON response containing all core records, including more than the default 1,000 REST rows. Older responses cannot replace newer acknowledged data. Reads never seed catalog entries. Refreshes do not clear the active bill. Core data refreshes on reconnect, focus/visibility and every 15 seconds in visible tabs. Categories and branding retain Realtime plus polling. A missing migration or permission fails visibly rather than falling back to local credentials or local writes.

Versions reject stale edits from another tab/device. Edit forms retain the version they opened with, so background refreshes do not silently authorize overwriting a newer record. Review the latest data and reopen an edit after a conflict. Catalog ordering controls remain local presentation preferences and are not a shared business setting.

While an already-open application is offline, cached records remain viewable and the current bill remains editable. Database saves are blocked; reconnect and refresh before saving. The bill's lines, customer, discount, payment selection and checkout identity are stored per tab in session storage. Reload/route restoration is tested while the application can load. This is not a PWA and does not guarantee a cold launch/reload without network access. Closing the tab, clearing site data, private browsing restrictions or device loss can remove an **unsaved** draft. A browser cache or Excel export is not a database backup.

Production caches are scoped to the Supabase project, and do not persist application passwords, PINs or a trusted authentication flag. Supabase manages its own Auth tokens. Logout clears visible business records; the user must sign in again. Old local/demo queues are never uploaded into the new project. Old unsynchronized data remains under its previous browser key for explicit, administrator-reviewed recovery; do not blindly merge it into production.

## Intentional removal and recovery

Removing a service, customer or team member deactivates it and retains historical references. Settings can reactivate these records. Removing an invoice or deal sets `deleted_at` and removes it from normal listings without physically erasing it or its line items. Stale writes cannot recreate deleted records. Invoice removal still requires the confirmation and server-authorized PIN flow.

`private.pos_audit` records before/after values, timestamp, entity and acting Auth UUID. `private.pos_requests` stores acknowledged operations for retry handling. These contain customer/billing information: include them in backups and restrict administrator access. They have no automatic purge job. Plan retention/archiving for the installation's legal and operational requirements; do not delete idempotency/registry records casually.

For an accidental invoice removal, an administrator can inspect the exact UUID and audit history, then restore it intentionally:

```sql
select id, "customerName", date, total, deleted_at
from public.invoices where deleted_at is not null order by deleted_at desc;

-- Verify the intended invoice UUID before running this update.
update public.invoices set deleted_at = null
where id = 'REPLACE_WITH_VERIFIED_INVOICE_UUID'::uuid;
```

The record version/revision advances, and clients see the restored invoice after refresh. Do not use restore scripts to recreate a sale with a new UUID. For broader corruption or infrastructure loss, use a verified database restore, not browser caches.

## Checks required before selling each installation

Run the automated checks in `PRODUCTION_AUDIT.md`. Then complete these on the actual staging Supabase/Vercel deployment:

- Real Auth sign-in, token refresh, logout, owner membership and nonmember/anonymous denial. Test email change confirmation and revoked membership.
- Real pgcrypto PIN setup/change, wrong-PIN throttling and scoped edit/delete authorization. Embedded tests use explicit crypto shims and do not certify Supabase's bcrypt installation.
- Two real devices: service/customer/deal creation, concurrent edit conflicts, checkout, refresh, history, categories and branding. Test connection failure and verify only one sale after retry.
- Inspect imported legacy invoice JSON and line items before/after upgrade. Existing partial or inconsistent historical saves need administrator reconciliation; do not silently discard either representation.
- Enable and verify automated database backups and the required retention/recovery window. Perform a restore drill into a separate project. Verify inclusion of Auth configuration, private audit/registry data and any future storage assets. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).
- Test real receipt printer/paper sizing, phone browsers, manual WhatsApp opening and the customer's number formats. WhatsApp sending remains manual; no API or delivery guarantee is provided.
- Load-test the buyer's expected data volume. Full consistent snapshots avoid row caps but are not a claim of unlimited scale; large archives may require a separate paginated reporting design. Browser cache quotas also vary by device.

Passing local tests is evidence of the covered behavior, not an unconditional production certification or a guarantee against all infrastructure loss. Complete and record these installation checks before handing over a paid deployment.
