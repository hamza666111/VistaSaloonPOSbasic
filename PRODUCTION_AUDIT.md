# Production integrity audit ? 18 October 2026

Scope: application source, Zustand persistence/synchronization, all domain creation/update/removal flows, invoice calculations/actions, SQL migrations/RPCs, customer spreadsheet flows, build/runtime dependencies and Vercel configuration. No Edge Functions are present. No online Supabase project was accessed.

## Findings and changes

| Finding | Implemented change |
| --- | --- |
| Label IDs in initial catalogs; noncryptographic UUID fallback | One cryptographic UUIDv4 generator throughout creation flows; PostgreSQL defaults and primary keys; permanent cross-entity UUID registry; immutable IDs; legacy label/reference migration, with mapping retained. |
| Header/items saved in separate transactions; missing queued invoice RPCs | Atomic authenticated `pos_mutate` RPC for core operations, with invoice/deal child rows in the same transaction. Removed the unsafe legacy execution/queue implementation. |
| Save could report success while only queued locally | New invoices are durably stored in a project/account-scoped IndexedDB queue, then uploaded automatically with explicit pending/synced/error states. Other mutations still require acknowledgement; the old unstructured queues are not replayed. |
| Lost replies or retries could duplicate sales | Persist an immutable invoice/request UUID pair in IndexedDB before sending; database request receipts; stable invoice UUID/date across retry/reload; exact invoice-content fence for a repeated create; cross-tab leases and an atomic local acknowledgement watermark. |
| Synchronization could clear a bill or replace newer changes | Cart and checkout draft are preserved; consistent versioned server snapshot; stale reads rejected; no optimistic whole-array rollback. |
| Default REST row caps could hide older records | Full consistent core snapshot RPC plus customer export from that snapshot. Import preflight remains paginated and server-side duplicate checks close concurrency races. Tested beyond 1,000 records. |
| Empty reads could recreate deliberately removed defaults | Connected catalogs start empty and reads never seed records. |
| Stale upserts could recreate or overwrite records | Explicit add/update/remove operations; record versions; no update-as-insert; forms retain their opening version. |
| Permanent invoice/deal deletion lacked recovery | Soft deletion retains headers and children; private before/after audit history. Customer/service/team removal remains deactivation. Direct browser DML is denied. |
| Plaintext browser login and public RLS exposed data | Supabase Auth plus explicit private membership allowlist; legacy credentials disabled/redacted; anonymous access revoked; management RPCs guarded. No production password/PIN/trusted-auth flag in business caches. |
| PIN verification was client-only | Private bcrypt hash, failed-attempt lockout, scoped expiring approval consumed by successful invoice edit/delete. |
| One browser key could mix local/demo/remote projects | New project-scoped production cache, isolated Auth storage, per-tab/user bill drafts and a separate transactional project/account invoice outbox. Legacy data never uploads automatically. |
| Asynchronous Auth restore lost deep links or could race logout | Protected routes wait for restoration; restore epochs and a local sign-out marker prevent delayed reauthentication after logout. |
| Currency fractions could disagree between views/server | Consistent two-decimal calculations and server-side validation/recalculation of invoice totals. |
| Browser cache failures could be silent | Cache warning is visible; a confirmed server save stays successful even when browser storage is full. |
| Vulnerable runtime/build dependencies | Compatible security updates plus React Router 7 and Tailwind 4 migration; unused Autoprefixer removed. Full npm audit reports zero known vulnerabilities at audit time. |
| Wrong key could be embedded in public builds | Vite rejects secret/service-role keys in the public Supabase key variable before bundling. Environment files remain ignored. |

The original root SQL files remain historical references. The new production upgrade intentionally changes backend schema, authorization and persistence; it is not a claim that the legacy backend remained untouched. The migration is prepared, not applied to any live project.

## Automated evidence

- TypeScript check and production build.
- Original baseline/additive migration compatibility suite.
- Full production migration chain against embedded PostgreSQL, including legacy ID/FK/invoice JSON migration, repeat upgrade, permissions, nonmember denial, atomic rollback, ID reuse rejection, retry identity conflicts, stale versions, deletion retention, PIN scope/lockout, and snapshots over 1,000 records.
- Two independent browser contexts using the actual Supabase client against a local HTTP adapter backed by the real migration SQL: Auth flow, 1,005+ invoices, delayed snapshots, concurrent edits, failed delivery with durable local checkout, lost acknowledgements, queue restoration after reload, automatic reconnect upload, same-origin tab races and stale snapshots, failed local transactions, offline printing, blocked-row recovery, draft fields/identity, cryptographic fallback, online-only edits, cache exclusions, protected deletion and logout.
- Shared category/branding two-browser tests: Realtime-independent polling, conflicts, failed/lost replies, merge/import, repeat migrations and offline read-only state.
- Excel import/export regression: formatted phone zeros, column mapping, duplicates, formulas/invalid rows, partial failure/retry, large-file/row guards, pagination and acknowledged connected saves.
- Existing local UI, category, invoice print/WhatsApp, App settings, mobile and mobile-billing suites. Seven phone/tablet/landscape viewports, all routes/settings sections, reduced keyboard viewports and touch flows are covered.
- Full dependency audit, whitespace check and tracked-file secret/configuration review.

Tests use synthetic data and block external requests. Embedded PostgreSQL does not include pgcrypto: production tests provide explicitly named test-only hash shims to exercise control flow. They do not validate bcrypt or the real Supabase Auth gateway. Live infrastructure checks below remain required.

## Conditions before customer delivery

1. Apply/test the final migration on a backed-up staging installation, provision real Auth users/membership, configure a private invoice PIN, and verify anonymous/nonmember denial and token refresh on the real gateway.
2. Verify real pgcrypto PIN hashing/throttling, email confirmations and account revocation. All salon members currently have equal management access; separate staff roles require a distinct authorization feature.
3. Enable database backups with an agreed retention/recovery window, and demonstrate a restore into another project. Browser caches and Excel exports are not backups. Private audit, idempotency and registry records have no automatic retention cleanup.
4. Reconcile any pre-existing historical invoice JSON/line-item mismatch rather than silently overwriting history. The migration preserves records; it cannot infer the intended content of an already corrupted old sale.
5. Test the actual Vercel domain, buyer's devices, thermal printer and WhatsApp behavior. Current browser requirements and cold-offline launch limitations are documented in DEPLOYMENT.md.
6. Load-test the installation's expected archive size. Full snapshots remove REST row caps, but do not provide unlimited scale or unlimited browser cache capacity.

There is no honest unconditional ?100% production ready? certification before those installation checks. Cryptographic randomness makes UUID collisions extraordinarily unlikely; database constraints/registry reject collisions and reuse rather than claiming randomness makes them mathematically impossible. The application now addresses the identified ghost-loss/save paths, while verified backups remain necessary for database administrator mistakes or infrastructure failure.

## Offline invoice queue update

The owner requested browser-persisted automatic invoice uploads after the initial online-only audit. New invoice checkout now succeeds only after its IndexedDB transaction commits, then attempts Supabase immediately when possible. It remains clearly pending until acknowledged. Server validation failures remain on-device for review/retry. Existing SQL/auth/idempotency safeguards are reused; no additional migration or anonymous access was introduced. Local-only demo behavior remains separate. Full cold-offline launching is still not provided, and unsynced device data is not a backup.
