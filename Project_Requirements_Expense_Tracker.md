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
| `transactions` | `id`, `receipt_id`, `user_id`, `group_id`, `type`, `is_reviewed`, `vendor_or_source`, `date`, `total_amount`, `currency` | `is_reviewed = true` = master data. |
| `transaction_items` | `id`, `transaction_id`, `name`, `category`, `product_id`, `quantity`, `unit_price`, `item_total`, `mapping_status`, `suggested_product_id` | `mapping_status`: `auto_matched`, `needs_mapping_review`, `new_product_candidate`. |
| `products` | `id`, `group_id`, `name`, `category`, `created_at` | Shared product catalog. Unique on `(group_id, name)`. |
| `invitations` | `id`, `group_id`, `invited_email`, `invited_by`, `status` (`pending`/`accepted`/`declined`), `created_at`, `updated_at` | RLS uses `auth.jwt() ->> 'email'` for `invited_email` matching (not `auth.users` subquery). |

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
