# Supabase migration order

For a new, empty project, apply:

1. `migrations/202610160001_base_schema.sql`
2. `migrations/202610170001_service_categories.sql`
3. `migrations/202610170002_app_settings.sql`
4. `migrations/202610170003_customer_activity.sql`

For a database already initialized with the original root `supabase_schema.sql` and `supabase_packages.sql`, skip file 1 and apply only the missing additive upgrades. The baseline deliberately refuses an existing application schema. Never reset a customer's database to install these changes.

Run `npm run test:migrations` and `npm run test:shared-settings` locally. These use embedded PostgreSQL and isolated browsers, without connecting to Supabase. Follow [DEPLOYMENT.md](../DEPLOYMENT.md) before enabling a new project's connection; the inherited browser authentication and database authorization still require production hardening. No live project credentials belong in source control.
