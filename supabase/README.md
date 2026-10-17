# Supabase setup

Follow [DEPLOYMENT.md](../DEPLOYMENT.md). For a new empty project apply, once and in order:

1. `migrations/202610160001_base_schema.sql`
2. `migrations/202610170001_service_categories.sql`
3. `migrations/202610170002_app_settings.sql`
4. `migrations/202610170003_customer_activity.sql`
5. `migrations/202610180001_production_integrity.sql`

The last migration is REQUIRED for the current connected frontend. It secures inherited permissions, retires legacy credentials, converts label IDs, and adds authenticated atomic saves, conflict protection, audit history and recoverable deletions. Provision a real Supabase Auth user, explicitly allow its UUID in `private.pos_members`, then initialize a PIN in Settings > Account.

For existing installations, back up and test restore/upgrade first; apply only missing migrations. Never reset customer data or replay old migrations/root scripts after hardening. No Edge Functions are supplied or needed. Never store service-role keys in frontend variables.

Run `npm run test:migrations`, `npm run test:production`, `npm run test:production-browser` and `npm run test:shared-settings`. These use local embedded PostgreSQL and synthetic browser/API fixtures. Real Supabase Auth, pgcrypto, Vercel, backups and printer acceptance remain deployment checks.
