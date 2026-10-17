# Vista Saloon POS System

A local-first, white label unisex salon workspace built with React, TypeScript, Tailwind CSS, Vite, and Zustand. Includes point of sale, packages, invoices and thermal receipts, client history, team commissions, insights, and account settings.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No Supabase connection is enabled by default. No external fonts, imagery, analytics, or former salon review links are used.

Fresh-workspace login:

- Email: `admin@vistasaloon.local`
- Password: `VistaLocal123!`
- Invoice edit PIN: `9999`

Change these in Settings > Account. These are local demo credentials, not credentials for a hosted project. Existing app-level login and password storage behavior is retained; this is not a production authentication redesign.

Local data stays in this browser under `vistasaloon-basic-storage`. Browser storage is not a backup: clearing site data removes local sales and settings. Existing offline mutation queuing, unsynced-change prompts, and calculations are preserved. Do not reconnect a browser containing demo sales to a production project: queued changes can sync. Use a separate browser profile for a new customer deployment.

## Connect a new Supabase project later

1. Create a new project belonging to the new installation.
2. Follow [DEPLOYMENT.md](./DEPLOYMENT.md), including the fresh baseline, additive migrations and the production authentication prerequisite.
3. Copy `.env.example` to `.env.local`, set the new project URL and public anon key, and explicitly set `VITE_ENABLE_REMOTE_SYNC=true`.
4. Restart Vite. Settings > Categories shows shared refresh/save status and retry controls.

Never put a service role key in Vite variables. Vite variables are public browser configuration. No SQL was executed or remote records modified during this redesign.

Table definitions, indexes, policies, functions, data fields, and operational store methods are retained. Only the original admin seed email/password in SQL were rebranded to match the local login. Default staff labels and browser storage identity were made generic. The Supabase client is no longer exposed on `window`.

## Verification

```sh
npm run typecheck
npm run build
npm run test:ui
npm run test:categories
npm run test:category-sync
npm run test:migrations
```

For UI verification, start `npm run dev` separately. Tests use an installed Chrome (headless), isolated browser storage, and synthetic data; external network requests are blocked and asserted absent. Set `TEST_BASE_URL` to test another local server. Screenshots are written to ignored `.qa/`.

The smoke check covers sign-in, all application routes, settings tabs, discounted checkout, the print callback, local persistence, mobile layouts, navigation, and sign-out. A real thermal printer and a newly configured Supabase project still need integration testing before customer delivery.

## Cleanup

Removed unused template dependencies (animation, physics, 3D, translation, UI helpers, validation), the template Vite plugin, generator manifests, completed AI task notes, placeholder directory READMEs, unused background art, and the former receipt QR asset. Active duplicate matching, receipt caching, invoice editing, spreadsheet exports, Supabase setup scripts, and deployment route rewrites are retained.

Inherited dependency advisories remain, including the retained spreadsheet package. Resolve them in a separate dependency/security update before commercial deployment; a forced upgrade was not applied during the UI redesign.

## Local mock-data preview

The current checkout enables `VITE_DEMO_MODE=true` in ignored `.env.local` for local review. It retains sign-in and loads 18 fictional clients, 5 team members, 20 services, 5 packages, and 84 invoices across roughly two months. Samples cover cash/online payments, paid/unpaid sales, fixed/percentage discounts, walk-ins, mixed-team sales, commissions, and active/inactive catalog entries.

Use **Reset demo data** in Settings > Account to restore the sample records. Your edits persist until you reset. The invoice edit PIN remains `9999` unless changed in Account settings. Customer Excel export reads the local mock clients in demo mode; the original database export path remains unchanged outside demo mode.

Demo data uses `vistasaloon-demo-storage-v1`, separate from the regular workspace. It runs only in development with remote sync disabled. Set `VITE_DEMO_MODE=false` and restart Vite to return to the regular local workspace. Production builds never initialize demo records. Do not remove this isolation when connecting a real Supabase project.

## Service categories

Use Settings > Categories to create, rename, or remove categories and tick which services belong to each. A service can appear in multiple categories. The Services tab displays current assignments. New services appear in Uncategorized until assigned; category deletion leaves all services and historical sales intact.

On POS, use the filters beside Service menu. Category filtering combines with the existing service search. All services restores the complete active catalog; Uncategorized shows services with no category. Deals remain a separate section.

With Supabase configured, categories and memberships are shared through the additive migration in `supabase/migrations/202610170001_service_categories.sql`. Saves are server-confirmed, stale category names/deletions are checked, and Realtime plus reconnect/focus/polling refreshes other devices. Offline cache is read-only. With Supabase disconnected, local/demo behavior is retained. Demo reset only restores demo assignments. Existing service fields, invoice records, and operational store methods are unchanged. See [DEPLOYMENT.md](./DEPLOYMENT.md) for database setup, local import, Vercel configuration, and the inherited authentication security prerequisite.

## Invoice save / print / WhatsApp actions

POS offers **Save only**, **Save + Print**, and **Save + WhatsApp**. Save only persists the bill and starts a new bill without opening another window. Print runs after persistence succeeds. WhatsApp opens the customer's chat with the invoice details as a prefilled text message; the operator reviews it and presses Send manually. This uses WhatsApp click-to-chat, no API key, no automatic sending, and no file attachment.

Invoice preview offers Print and WhatsApp actions plus Close. A previewed invoice is already saved: these actions reuse that record without creating or overwriting an invoice. They print or share its latest saved details.

WhatsApp requires an associated customer with a valid phone number. Walk-ins and invalid/missing numbers can still be saved or printed. International numbers can use `+` or `00`; Pakistani mobile formats such as `03001234567` and `3001234567` default to country code `92`. Set `VITE_WHATSAPP_DEFAULT_COUNTRY_CODE` at build time for another installation. Validation checks number formatting, not WhatsApp registration or delivery.

The browser/device chooses WhatsApp Web or the installed app and may require sign-in. A temporary blank tab is reserved on the click to avoid async-save popup blocking; it navigates to WhatsApp only after a successful save and closes on failure. If the browser blocks or closes it, the saved invoice shows an **Open WhatsApp** fallback link. Never click Save again just to retry sharing: use the link or open the saved invoice.

Run `npm run test:invoice-actions` with the local demo server running. The test intercepts popup/print actions and never contacts WhatsApp or sends messages.

Reference: [WhatsApp click-to-chat help](https://faq.whatsapp.com/5913398998672934).

## Salon branding and themes

Settings > App lets the salon owner change the salon name, address, contact number, theme color, and logo. Choose a preset or any six-digit custom color; readable shades are generated automatically. Color changes preview immediately; Save app settings commits the details. Cancel restores the saved theme.

Saved branding appears on the sidebar, login screen, invoice preview, both receipt print flows, and WhatsApp invoice text. Receipts stay printer-friendly. The app includes a subtle Developed by FlagVista watermark. Logos accept PNG/JPG/WebP up to 5 MB, resize to at most 512 pixels, and are saved as compact raster data without a separate storage bucket.

Disconnected mode saves branding in the current browser and shares changes between its open tabs. Connected mode uses `supabase/migrations/202610170002_app_settings.sql` for shared settings across devices, with acknowledged saves, version conflict checks, Realtime, and a 30-second polling fallback. Offline shared settings remain readable; editing requires reconnection. Local branding is not automatically uploaded when connecting a new project: configure it again in the shared App tab.

Run `npm run test:app-settings` against the local demo server and `npm run test:shared-settings` for the isolated PostgreSQL-backed multi-browser checks. Neither test contacts a live Supabase project.

## Mobile workspace

Phones and tablets use a compact salon toolbar and bottom navigation. More opens the full navigation drawer. On POS, choose a team member and services first, then use the persistent Review bill bar to select a customer, adjust the discount/payment, and save, print, or share. Back to services retains the active bill.

Settings uses a section selector on phones and searchable catalog cards with the original edit, status, delete and reorder actions. Invoice pagination uses a page selector. Customer selection opens a detail view with All customers to return to the list. Reports and visit history fit the screen without table panning.

Customer, invoice, export, PIN and duplicate dialogs scroll within the available screen, including short landscape or reduced keyboard viewports. They trap keyboard focus, support Escape, restore focus, and prevent background scrolling. Mobile fields use readable text, touch controls use generous targets, and navigation accounts for device safe areas. Thermal print styles stay separate.

Routes load on demand, and spreadsheet code downloads only when exporting. The initial production JavaScript entry is approximately 210 KB (69 KB gzip), compared with the previous combined entry of about 631 KB. Features, billing calculations, the operational store and database schema are unchanged by this mobile update.

Run `npm run test:mobile` against the local demo server. It uses Chrome touch emulation to exercise checkout, nested customer creation, receipt printing/sharing, PIN invoice editing, export, client navigation, catalog management, categories, branding, account PIN changes, reports, navigation and sign-out. All pages and settings sections are checked at 320, 360, 390, 430, 768 and 820 pixel widths plus 812x375 landscape. Screenshots are saved under ignored `.qa/mobile/`. Physical iOS/Android keyboard behavior, WhatsApp handoff and real printers still need device testing before delivery; desktop emulation cannot certify every device/browser combination.


Mobile billing opens on Services, with a separate Deals & offers tab. Search can show matches across both sections. Service badges show how many are on the bill; category filters stay visible as the service list scrolls, and the selected team shortcut returns to team selection. Review bill has a scrollable customer/services/payment area and a persistent total/checkout dock. Walk-in takes one tap, quick name/phone entry expands when needed, and Add more returns to the catalog without clearing the bill. Save only is the primary mobile action, with separate Save + Print and Save + WhatsApp controls. Run `npm run test:mobile-billing` to check these interactions and checkout reachability with long orders at phone, tablet, landscape and reduced keyboard viewport sizes.


## Complete Supabase setup

The migrations folder now includes a guarded fresh-project baseline plus additive category, app branding, and customer activity migrations. A fresh project must apply all four files in filename order. An installation already created using the original root SQL scripts must skip the fresh baseline and apply the missing additive upgrades. See [DEPLOYMENT.md](./DEPLOYMENT.md) for exact ordering and the existing authentication/permission prerequisites. The mobile redesign, manual WhatsApp sharing and receipt actions need no additional database fields.
