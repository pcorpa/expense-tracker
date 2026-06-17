# Project Requirements & System Architecture: AI Expense Tracker

This document outlines the technical requirements, data models, and workflow architectures for the AI-powered expense tracking application. The system ensures strict data integrity and high-quality statistical modeling through robust normalization and automated AI ingestion.

---

## 1. Definition of "Statistical Truth" & Rules

- **Audit State:** A record is only considered "Master Data" when `is_reviewed = true`. Until then it remains a draft subject to changes.
- **Mathematical Tolerance Margin:** A **1% tolerance** is established for cross-validations.
  - *Rule:* `|(Quantity × Unit_Price) - Item_Total| ≤ (Item_Total × 0.01)`
  - *Purpose:* To handle minor discrepancies due to decimal rounding, particularly for weighed products (e.g., kilograms).
- **Header Integrity:** The sum of all `item_total` values must strictly match the `total_amount` of the transaction header within the 1% tolerance margin.
- **Uncertainty Handling:** If the AI encounters illegible data, it MUST default to `NULL` or `"Unknown"` to force human review — data hallucination is strictly forbidden.

---

## 2. Category Taxonomy

Only the following 14 categories are allowed across all transaction items:

- Comida
- Limpieza
- Salud
- Entretenimiento
- Hogar
- Transporte
- Vestimenta
- Restaurante
- Cuidado Personal
- Mascotas
- Servicios
- Educación
- Tecnología
- Otro

---

## 3. AI Specifications (Gemini 2.5 Flash)

The extraction engine uses the following protocol to transform receipt images into structured data. The prompt is in Spanish to match the expected receipt language.

**Extraction prompt:**
```
Analiza este ticket. Nombre: ${fileName}.
Categorías permitidas: Comida, Limpieza, Salud, Entretenimiento, Hogar, Transporte,
Vestimenta, Restaurante, Cuidado Personal, Mascotas, Servicios, Educación, Tecnología, Otro.
Reglas:
1. 'unit_price': Precio unitario.
2. 'quantity': Cantidad o peso.
3. 'item_total_from_ticket': El precio final de la línea.
4. Usa 'Unknown' si no es legible.
```

**Response schema (JSON):** `filename`, `date`, `vendor`, `city`, `total_amount`, and an array of `products` (each with `name`, `category`, `quantity`, `unit_price`, `item_total_from_ticket`).

---

## 4. Data Model

The database is normalized in Supabase Postgres to allow accurate time-series analysis and price variation tracking.

| Table | Key Columns | Notes |
|---|---|---|
| `profiles` | `id`, `email`, `first_name`, `last_name`, `created_at` | Linked to `auth.users`. |
| `groups` | `id`, `name`, `created_at` | Top-level grouping entity. |
| `group_members` | `group_id`, `user_id`, `role` (`admin`/`member`), `created_at` | Junction table. RLS: users see only their own memberships. |
| `receipts` | `id`, `user_id`, `group_id`, `image_url`, `status` (enum), `raw_ocr_json`, `city`, `created_at` | Status: `pending`, `processing`, `needs_review`, `completed`, `error`. |
| `transactions` | `id`, `receipt_id`, `user_id`, `group_id`, `type`, `is_reviewed`, `vendor_or_source`, `vendor_id`, `vendor_mapping_status`, `date`, `total_amount`, `currency`, `recurring_expense_id`, `installment_number` | `is_reviewed = true` = master data. `recurring_expense_id` links auto-generated transactions to their template. |
| `transaction_items` | `id`, `transaction_id`, `name`, `category`, `product_id`, `quantity`, `unit_price`, `item_total`, `mapping_status`, `suggested_product_id` | `mapping_status`: `auto_matched`, `needs_mapping_review`, `new_product_candidate`. |
| `products` | `id`, `group_id`, `name`, `category`, `created_at` | Shared product catalog. Unique on `(group_id, name)`. |
| `vendors` | `id`, `group_id`, `canonical_name`, `created_at` | Canonical vendor list per group. Unique on `(group_id, canonical_name)`. |
| `vendor_raw_mappings` | `id`, `group_id`, `raw_name`, `vendor_id`, `created_at` | Persistent raw→canonical mappings. Unique on `(group_id, raw_name)`. |
| `product_raw_mappings` | `id`, `group_id`, `raw_name`, `product_id`, `created_at` | Persistent raw item name → canonical product mappings. Unique on `(group_id, lower(raw_name))`. Mirrors `vendor_raw_mappings`. |
| `invitations` | `id`, `group_id`, `invited_email`, `invited_by`, `status` (`pending`/`accepted`/`declined`), `created_at`, `updated_at` | RLS uses `auth.jwt() ->> 'email'` for `invited_email` matching (not `auth.users` subquery). |
| `recurring_expenses` | `id`, `group_id`, `user_id`, `name`, `vendor_name`, `type` (`subscription`/`installment`/`periodic_bill`), `category`, `currency`, `amount`, `total_purchase_amount`, `total_installments`, `frequency`, `start_date`, `end_date`, `is_active`, `last_generated_date`, `notes` | Templates for auto-generating transactions. `last_generated_date` is the watermark used to avoid duplicate generation. |

### RLS notes

- All tables have RLS enabled.
- `invitations` select/update policy uses `auth.jwt() ->> 'email'` — do NOT revert to `auth.email()` or `(select email from auth.users ...)` as both fail with 403 for authenticated users.
- `products` RLS is scoped to group membership.

---

## 5. Edge Functions

### `process-receipts`
- Invoked directly by the client after uploading a receipt image to Supabase Storage
- Client encodes the image as base64 and sends it in the request body with the `receipt_id`
- Function never downloads from Storage — eliminates storage policy complexity
- Runs as the authenticated user (JWT forwarded from client) for full RLS compliance
- Validates 1% math tolerance between item sum and receipt total before inserting
- On failure: marks receipt as `error`, surfaces in Review Queue for manual retry

### `send-invitation`
- Called by `GroupManager.tsx` when a user invites someone to a group
- Saves the invitation to the `invitations` table via upsert (on conflict `group_id, invited_email`)
- Calls `supabase.auth.admin.inviteUserByEmail` for the invited email:
  - If the invitee has no account → they receive a Supabase auth email with a signup link redirecting to `/invitations`
  - If the invitee already has an account → invite call fails silently; they see the invitation in-app
- Email delivery is non-fatal — the DB record is the source of truth
- **Email deliverability note:** Supabase free tier limits auth emails to 2/hour. Custom SMTP (Gmail) works but personal Gmail accounts may be flagged as phishing by recipients. A custom domain with SPF/DKIM is the reliable long-term solution.

---

## 6. Feature Phases

### Phase 1 — Core Architecture & Data Integrity ✅ Complete

- Relational schema in Supabase with RLS
- `TransactionEntry.tsx` — manual entry with math validation and product autocomplete
- `ReviewQueue.tsx` — audit queue with inline editing and approve flow
- `ReviewItemEdit.tsx` — item-level editor

### Phase 2 — Asynchronous AI Pipeline ✅ Complete

- Supabase Storage bucket `receipts` for receipt images
- `process-receipts` Edge Function — image → Gemini 2.5 Flash → structured data → DB
- HEIC/PNG/WebP support via `heic2any` client-side conversion
- Failed receipts surfaced in Review Queue with Retry AI button
- `ReviewTransactionEdit.tsx` — transaction-level editor

### Phase 3 — Statistical Analytics ✅ Complete

`Analytics.tsx` with 7 tabs:
- **Overview** — KPI cards + category pie chart + monthly bar chart
- **Trends** — daily spend line chart + 7-day and 30-day moving averages
- **Products** — unit price evolution per product (inflation index)
- **Anomalies** — items with z-score > 2 flagged automatically
- **Pareto** — ComposedChart bar+line showing 80/20 vendor/product concentration
- **Groups** — member contribution breakdown
- **Export** — CSV and JSON download of filtered data

### Phase 4 — Product Normalization Pipeline ✅ Complete

- `fuzzyMatch.ts` — Fuse.js fuzzy matching pipeline with configurable thresholds:
  - ≥ 90% similarity → `auto_matched` (product_id assigned, no review needed)
  - 60–89% → `needs_mapping_review` (suggested match surfaced for human confirmation)
  - < 60% → `new_product_candidate` (no match, new product to be created)
- `ProductAudit.tsx` — UI for reviewing fuzzy matches and creating new products
- `usePendingAuditCount` hook — badge count in NavBar/MobileMenu
- Migrations: `0008_product_normalization.sql`, `0009_fix_product_rpc_no_group_id.sql`

### Phase 5 — Groups & Invitations ✅ Complete

- `GroupManager.tsx` — group creation and member invitation by email
- `send-invitation` Edge Function — DB upsert + Supabase auth invite
- `Invitations.tsx` — in-app invitation page with Accept/Decline
  - Accept: upserts into `group_members` + updates invitation status
  - Decline: updates invitation status only
- `usePendingInvitationsCount` hook — badge count in NavBar/MobileMenu
- NavBar and MobileMenu updated with Invitations link and blue badge

### Phase 6 — Data Pipeline Quality & Vendor Normalization ✅ Complete

Driven by analysis of real receipt data (Uruguayan supermarkets, May–June 2026). The goal is to make the AI ingestion pipeline more robust against the real-world messiness of receipt OCR.

#### 6.1 Default Currency
- Change the app-wide default currency from `USD` to `UYU`.
- Keep currency editable per-transaction in `TransactionEntry.tsx`.

#### 6.2 Gemini Prompt Improvements
The extraction prompt (§3) needs four additions:

| Issue | Prompt fix |
|---|---|
| Inconsistent date formats | Explicitly instruct: return `date` as `DD/MM/YYYY`. |
| Multi-line vendor names | Instruct: `vendor` must be a single clean string with no line breaks. |
| Discounts (unit price ≠ line total) | Instruct: `unit_price` = shelf price, `item_total_from_ticket` = amount actually charged after any discount. Never recalculate `item_total` from `quantity × unit_price`. |
| Promotional free items (3×2, etc.) | Instruct: include zero-price items with `unit_price: 0` and `item_total_from_ticket: 0`. Negative-value discount lines should be included as separate items with a negative `item_total_from_ticket`. |

#### 6.3 Date Format Preference & Normalizer Utility
- New `date_format` column on `profiles`: `text not null default 'DD/MM/YYYY'`. Two allowed values: `'DD/MM/YYYY'` (default, Uruguay/Europe) and `'MM/DD/YYYY'` (US).
- User selects their preference in `Profile.tsx`. This preference is injected into the Gemini prompt (rule 7: `"date: Fecha en formato ${dateFormat}."`) and passed to the normalizer.
- `normalizeDate(raw: string, format: 'DD/MM/YYYY' | 'MM/DD/YYYY'): string | null` lives in `src/lib/dateUtils.ts` (client) and is inlined in the Edge Function (Deno).
- Logic: try ISO `YYYY-MM-DD` first (unambiguous); then slash/dot-separated parts — if the first component is > 12 it must be the day regardless of format preference; otherwise apply the user's format preference; return `null` for anything unparseable.
- `null` dates map to `NULL` in the DB and surface the transaction in the Review Queue for manual correction.

#### 6.4 Vendor Normalization Table & Fuzzy Matching
Mirrors the Phase 4 product normalization architecture:

- New `vendors` table: `id`, `group_id`, `canonical_name`, `created_at`. Unique on `(group_id, canonical_name)`.
- `vendor_aliases` table (or `vendor_id` column on `transactions`): maps raw AI-extracted vendor strings to a canonical vendor.
- Fuzzy matching thresholds (same philosophy as `fuzzyMatch.ts`):
  - ≥ 90% → `auto_matched` to canonical vendor
  - 60–89% → `needs_vendor_review` (surfaced in a vendor audit UI)
  - < 60% → `new_vendor_candidate`
- A `VendorAudit.tsx` page (or tab within `ProductAudit.tsx`) for reviewing unmatched vendors.
- Fixes the "Disco" vs "Supermercados Disco del Uruguay S.A." class of inconsistencies, which directly impacts the Pareto analysis accuracy.

#### 6.5 Discount & Promotion Handling (Schema Clarification)
- No schema changes needed: `unit_price` and `item_total` are already independent columns.
- The 1% tolerance rule (§1) explicitly does **not** apply when `item_total ≠ quantity × unit_price` due to a discount — the prompt instructs the AI to capture the actual charged amount.
- Zero-price promotional items (`item_total = 0`) are valid and must not be rejected by validation logic.
- The math validation in `process-receipts` must allow `item_total = 0` and skip the tolerance check for that line.

#### 6.6 CSV / Bulk Import Script *(dev tooling only)*
- A one-off Node/TypeScript script to import the Google Sheets CSV export (used to seed the dev database with real data).
- Handles: UTF-8 encoding, date normalization, grouping rows into transactions by `(Fecha, Vendedor, Ciudad)`, placeholder `image_url`, currency set to `UYU`, `is_reviewed = true`.
- Not part of the production app — dev tooling only.

### Phase 7 — Recurring Expenses ✅ Complete

Enables users to register fixed recurring costs once and have the app auto-generate approved transactions on their due dates.

#### 7.1 Three recurring expense types

| Type | Description | Key fields |
|---|---|---|
| `subscription` | Fixed amount, indefinite (Netflix, Spotify, gym) | `amount`, `frequency` |
| `installment` | Credit card purchase split across N periods | `total_purchase_amount`, `total_installments`, `frequency` |
| `periodic_bill` | Regular bill with an optionally variable amount (electricity, water) | `amount` as reference, `frequency` |

#### 7.2 Supported frequencies

`weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `every4months`, `every6months`, `annual`

#### 7.3 Auto-generation logic (`src/lib/recurringExpenses.ts`)

Client-side generation triggered when the user opens `/recurring`. Idempotent — uses `last_generated_date` as a watermark to avoid duplicates:

1. Start one period after `last_generated_date` (or at `start_date` if never generated)
2. Walk forward by `frequency` until today or `end_date`, whichever comes first
3. For installments: also stop when `total_installments` is reached
4. For each due date: insert one `transaction` (`is_reviewed: true`, `recurring_expense_id`, `installment_number`) + one `transaction_item`
5. Update `last_generated_date` on the template
6. If installment plan is complete: set `is_active = false`, `end_date = last due date`

Generated transactions appear in the expense list and analytics for their respective months automatically — no extra filtering logic needed.

#### 7.4 Installment tracking

- User enters `total_purchase_amount` + `total_installments`; the app derives `amount = total / installments`
- Each generated transaction stores `installment_number` (e.g. 3 of 12)
- The `/recurring` page shows a progress bar with paid count, percentage, and amount paid vs. total

#### 7.5 Lifecycle management

- **Cancel**: sets `is_active = false`, `end_date = today`; past transactions are preserved
- **Edit**: updates the template; does not retroactively modify already-generated transactions
- **Delete template only**: removes the template; linked transactions remain as standalone expenses (`recurring_expense_id` nulled via `ON DELETE SET NULL`)
- **Delete all**: removes template + all linked transactions and their items

#### 7.6 New pages

- `RecurringExpenses.tsx` (`/recurring`) — list with KPI summary row (monthly fixed total, active count, installments in progress), type-colored cards with left border accent, installment progress bars, collapsible inactive section
- `AddRecurringExpense.tsx` (`/recurring/new`) — visual tile type selector, live installment calculator, retroactive count note when start date is in the past
- `EditRecurringExpense.tsx` (`/recurring/:id/edit`) — edit form with inline cancel confirmation and a delete dialog offering two options (template only vs. all)

#### 7.7 Migration

`0020_recurring_expenses.sql` — creates `recurring_expenses` table with full RLS (mirrors `transactions` group membership policies) and adds `recurring_expense_id` + `installment_number` to `transactions`.

### Phase 8 — Shopping List, Product Admin Controls, Theme & i18n ✅ Complete

#### 8.1 Shopping List (`ShoppingList.tsx`, `/shopping-list`)

- Auto-generated monthly shopping list derived from the group's purchase history.
- Groups items by canonical product name and shows the average quantity purchased per visit.
- Cold-start fallback: when a group has no mapped purchase history, the page shows a helpful empty state rather than a blank list.
- Reflects confirmed product mappings so the list uses clean canonical names instead of raw receipt strings.

#### 8.2 Product Admin Controls & Confirmed Mappings

Mirrors the vendor admin controls introduced in Phase 6:

- **Product catalog panel** — the Product Audit page adopts a two-panel layout: left panel holds the review queue (potential matches + new candidates); right panel shows the canonical product catalog and confirmed mappings, sticky on desktop.
- **Inline rename / delete** — group admins can rename or delete canonical products directly from the right panel.
- **`product_raw_mappings` table** (`0021_product_admin_controls.sql`) — every confirmed raw item name → canonical product decision is stored persistently. Future scans auto-match the same raw name without manual review.
- **Confirmed mappings panel** — admins can view all confirmed mappings and delete individual ones. Deleting a mapping resets the `mapping_status` of all previously auto-matched `transaction_items` to `NULL` so they re-appear in the audit queue on the next scan (`0023`).
- **Admin-only RPCs**: `rename_product`, `delete_product`, `delete_product_raw_mapping` — all security-definer functions that enforce admin role checks.
- **RLS fix** (`0022`): Products that were previously inserted without `group_id` (a bug in migration 0009) were invisible through RLS. Migration 0022 back-fills `group_id` from `transaction_items` references and removes orphaned products.
- **Override flow improvement** — the "Wrong match?" override in the Potential Matches section now supports typing a new canonical name (creates a new product via `approve_product_mapping`) in addition to selecting from the existing catalog, matching the behaviour of the New Candidates section.

#### 8.3 Dark / Light Theme

- `ThemeProvider` and `useTheme` hook in `src/lib/theme.tsx`.
- Theme stored in `localStorage`; applied as a `data-theme` attribute on `<html>` driving CSS custom property overrides.
- Toggle button in `NavBar` and `MobileMenu`.

#### 8.4 Bilingual UI — Spanish / English

- Full translation coverage via `react-i18next`.
- Default language: Spanish (`es`). English (`en`) available as an alternative.
- Translation files: `src/i18n/locales/es.json` and `src/i18n/locales/en.json`.
- Language toggle in the nav bar; choice persisted to `localStorage`.

#### 8.5 Recurring Expenses Improvements

- **Custom category** — each recurring expense template can now have its own category; auto-generated transactions inherit it.
- **KPI split** — the `/recurring` summary row now shows separate KPI chips: monthly fixed total, active subscription count, and active installment count.
- **In-app confirm dialog** — cancel and delete actions use the shared `ConfirmModal` component instead of the browser's native `confirm()`.

#### 8.6 UX — In-App Confirmation Dialogs

- Replaced all `window.confirm()` calls app-wide with the shared `ConfirmModal` component (dark-mode aware, styled, non-blocking).
- Affected pages: `ProductAudit.tsx`, `VendorAudit.tsx`, `EditRecurringExpense.tsx`.

### Phase 9 — Scalability & Performance Hardening

Addresses the key bottlenecks identified via architectural review (June 2026). The app is functional for current usage but would degrade noticeably at 10k+ transactions or multiple active groups without these changes.

#### 9.1 Database Indexes

Add a migration (`0024_scalability_indexes.sql`) with the following missing indexes:

```sql
-- Most impactful: date-range filtering used in all list views
CREATE INDEX idx_transactions_group_date ON transactions(group_id, date DESC);

-- Composite group membership lookup (speeds up RLS policy evaluation)
CREATE INDEX idx_group_members_user_group ON group_members(user_id, group_id);
```

#### 9.2 Pagination — ExpenseList

`ExpenseList.tsx` currently fetches **all** transactions with no limit. Replace with offset-based pagination:

- Add a page/offset state variable
- Use `.range(from, to)` on the Supabase query
- Render page controls (Previous / Next) or infinite scroll via an Intersection Observer
- Target: 50 rows per page

#### 9.3 Pagination — ReviewQueue & Audit Pages

Same pattern as 9.2 applied to:

- `ReviewQueue.tsx` — paginate the unreviewed transactions list
- `VendorAudit.tsx` and `ProductAudit.tsx` — paginate the pending items list to avoid loading all unreviewed records into memory for client-side fuzzy matching

Both audit pages currently run Fuse.js over the full unreviewed dataset. With pagination the fuzzy match only runs on the visible page, eliminating the CPU-bound hang at high volume.

#### 9.4 Route-Level Lazy Loading

In `App.tsx`, replace all static page imports with `React.lazy()` + `<Suspense>`:

```tsx
// Before
import ExpenseList from './pages/ExpenseList';

// After
const ExpenseList = React.lazy(() => import('./pages/ExpenseList'));
```

Wrap routes in a single `<Suspense fallback={<div>Loading...</div>}>`. This splits the bundle by route and eliminates the current single-chunk initial load.

#### 9.5 API Service Layer

Create `src/api/` with one file per domain. Each file exports typed async functions that wrap the Supabase calls currently scattered across page components:

- `src/api/transactions.ts` — `getTransactions()`, `createTransaction()`, `updateTransaction()`, `deleteTransaction()`
- `src/api/vendors.ts` — `getVendors()`, `getVendorMappings()`, `approveVendorMapping()`
- `src/api/products.ts` — `getProducts()`, `approveProductMapping()`
- `src/api/groups.ts` — `getGroups()`, `inviteMember()`

Pages import from `src/api/` and use `useQuery`/`useMutation` (already in use for audit counts) — no direct Supabase calls in components. This is a refactor of existing code; no new features.

#### 9.6 Consolidate Data Fetching to React Query

Replace the ~35 `useEffect + useState` data fetching patterns with `useQuery`. The React Query client is already set up in `App.tsx`. Migration is page-by-page; start with `ExpenseList.tsx` and `ReviewQueue.tsx` as the highest-traffic pages.

Benefits: automatic caching, deduplication of identical queries, consistent loading/error states, and background refetch.

#### 9.7 Bundle Analysis

Install `rollup-plugin-visualizer` (Vite-compatible):

```ts
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';
plugins: [react(), visualizer({ open: true })]
```

Run once to identify any unexpectedly large chunks. No ongoing requirement — dev tooling only.

#### 9.8 Verification

- Seed dev database with 10k transactions and confirm `ExpenseList` loads in < 500ms (paginated)
- Use Supabase dashboard → Query Performance to confirm `idx_transactions_group_date` is used for date-filtered queries
- Run `pnpm build` and inspect chunk sizes before/after lazy loading
- Open VendorAudit and ProductAudit with 500+ pending items; confirm no UI hang

---

## 7. Deployment Architecture

| Layer | Service | Branch |
|---|---|---|
| Frontend | Vercel | `main` → production, `dev` → preview |
| Database + Auth | Supabase (production project) | — |
| Edge Functions | Supabase (production project) | Deployed via CLI |
| Dev database | Supabase (dev project) | Used locally and for `dev` branch preview |

### Workflow
1. Work on `dev` branch, test against dev Supabase project (`.env.development`)
2. Schema changes: `supabase db push` while CLI linked to dev project
3. When ready: merge `dev` → `main`, link CLI to production, run `supabase db push` + `supabase functions deploy`
4. Vercel auto-deploys `main` to production on every push

### Key URLs
- Production app: `https://expense-tracker-five-steel-62.vercel.app`
- Production Supabase: `hppnikjyivfyueaarlzq`
- Dev Supabase: `ftzxgfzemlaqdmeyobpl`
