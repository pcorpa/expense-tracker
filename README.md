# Expense Tracker

A mobile-first, AI-powered expense tracker with receipt scanning, group management, analytics, and a structured review queue for data quality.

**Live app:** https://expense-tracker-five-steel-62.vercel.app

**Stack:** React 19 + TypeScript + Vite · Supabase (Postgres, Auth, Storage, Edge Functions) · Google Gemini 2.5 Flash · TanStack Query v5 · Recharts

---

## Features

- **Receipt OCR** — upload a receipt (JPEG, PNG, WebP, or HEIC); converted to JPEG client-side via `heic2any`, then sent to Gemini 2.5 Flash to extract store, date, items, quantities, unit prices, and totals
- **Failed receipt retry** — receipts that fail AI processing appear in the Review Queue with a Retry button
- **Manual entry** — log expenses without a receipt, with product autocomplete against the existing catalog
- **Review queue** — every AI-extracted transaction lands in a review queue; edit and approve to promote to master data (`is_reviewed = true`)
- **Analytics** — 7 tabs: Overview (KPIs + pie + bar), Trends (daily + 7/30-day moving averages), Products (inflation index), Anomalies (z-score > 2), Pareto (80/20), Groups (member contribution), Export (CSV + JSON)
- **Product normalization** — fuzzy-matching pipeline maps item names to a shared product catalog; unmatched items surface in the Product Audit page for manual review
- **Group management** — create groups, invite members by email; invitees receive a Supabase auth email (new users) or see the invitation in-app (existing users)
- **In-app invitations** — pending invitations shown with Accept/Decline UI; accepting automatically joins the group
- **14-category taxonomy** — fixed set of categories for consistent analytics (see requirements doc)
- **1% math tolerance** — item totals and receipt totals validated before approval
- **Auth** — email/password and Google SSO via Supabase Auth

---

## Tech stack

| Layer | Detail |
|---|---|
| Frontend | React 19, TypeScript, Vite, react-router-dom v7 |
| Data fetching | TanStack Query v5 |
| UI | Lucide icons, Sonner toasts, Recharts |
| Image handling | heic2any (HEIC → JPEG, client-side) |
| Backend | Supabase — Postgres + RLS, Auth, Storage, Edge Functions (Deno) |
| AI | Google Gemini 2.5 Flash via REST API |
| Email | Supabase built-in auth email (`inviteUserByEmail`) — no external email service required |
| Deployment | Vercel (frontend) + Supabase (backend) |

---

## Project structure

```
src/
  pages/
    Home.tsx                  landing/dashboard
    SignIn.tsx / SignUp.tsx
    UploadReceipt.tsx          receipt upload → Supabase Storage → process-receipts Edge Fn
    TransactionEntry.tsx       manual expense entry with product autocomplete + math validation
    ReviewQueue.tsx            audit queue — review and approve AI extractions
    ReviewItemEdit.tsx         inline item editor within the queue
    ReviewTransactionEdit.tsx  transaction-level editor
    ExpenseList.tsx            browsable expense history
    GroupManager.tsx           group creation and member invitations
    Invitations.tsx            pending invitations with Accept/Decline UI
    Analytics.tsx              7-tab analytics dashboard (Recharts)
    ProductAudit.tsx           fuzzy-match review — map item names to product catalog
    Profile.tsx                user profile

  components/
    NavBar.tsx                 desktop sidebar nav with badge counts
    MobileMenu.tsx             mobile drawer nav with badge counts
    ProtectedRoute.tsx
    PublicOnlyRoute.tsx

  lib/
    supabase.ts                Supabase client
    auth.tsx                   auth state context
    fuzzyMatch.ts              Fuse.js fuzzy matching + normalization pipeline
    usePendingAuditCount.ts    TanStack Query hook — pending product audit count
    usePendingInvitationsCount.ts  TanStack Query hook — pending invitations count

  types.ts                    canonical TypeScript types

supabase/
  schema.sql                  full DB schema + RLS policies (reference only)
  migrations/
    0001_init.sql             base schema (profiles, groups, members, receipts, transactions, items)
    0002_update_profiles_names.sql
    0003_fix_group_members_rls.sql
    0004_add_invitations.sql  invitations table + RLS
    0005_grant_service_role_invitations.sql
    0006_add_products.sql     products table + RLS (handles pre-existing table gracefully)
    0007_add_city_to_receipts.sql
    0008_product_normalization.sql  mapping_status + suggested_product_id columns on transaction_items
    0009_fix_product_rpc_no_group_id.sql
    0010_fix_invitations_rls.sql
    0011_fix_invitations_rls_jwt.sql  RLS uses auth.jwt() ->> 'email' for invited_email matching
  functions/
    process-receipts/         receipt_id + image_data → Gemini 2.5 Flash → transactions + items + products
    send-invitation/          saves invitation to DB + calls inviteUserByEmail for new users
```

---

## Environment variables

### Frontend (`.env` for production, `.env.development` for local dev against dev Supabase)

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
GMINI_API_KEY=your_gemini_key   # only needed locally; Edge Function uses its own secret
```

### Edge Function secrets (set via `supabase secrets set`)

| Secret | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key for Gemini 2.5 Flash |
| `APP_URL` | Deployed app URL — used as redirect in invitation emails |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.

---

## Dev / Production setup

The project uses two Supabase projects and two git branches:

| Branch | Vercel | Supabase |
|---|---|---|
| `main` | Production (`expense-tracker-five-steel-62.vercel.app`) | Production project |
| `dev` | Preview (auto-deployed by Vercel) | Dev project |

- Local `pnpm dev` uses `.env.development` pointing to the dev Supabase project
- `.env` points to production and is used by Vercel's production build
- After finishing work on `dev`, merge into `main` to deploy to production
- After merging, re-link the Supabase CLI to production and run `supabase db push` + `supabase functions deploy` for any schema/function changes

---

## Local setup

### Prerequisites

- [pnpm](https://pnpm.io/)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (or two — one for dev, one for production)
- A Google AI Studio API key (Gemini 2.5 Flash)
- Google OAuth 2.0 credentials (for Google Sign-In)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

Create `.env` (production) and `.env.development` (local dev):

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database

```bash
supabase link --project-ref your_project_ref
supabase db push
```

### 4. Storage

Create a private Storage bucket named `receipts` in the Supabase dashboard, then run in the SQL editor:

```sql
CREATE POLICY "Authenticated users can upload receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "Authenticated users can read receipts"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'receipts');
```

### 5. Google OAuth

Supabase dashboard → **Authentication → Providers → Google** → enable and add your OAuth client ID and secret. Add `https://<your-supabase-project>.supabase.co/auth/v1/callback` as an Authorized Redirect URI in Google Cloud Console.

### 6. Edge Functions

```bash
supabase functions deploy process-receipts
supabase functions deploy send-invitation
supabase secrets set GEMINI_API_KEY=your_key APP_URL=https://your-app.vercel.app
```

### 7. Email (optional)

Invitations work without email — invitees see them in-app on the Invitations page. To also send email notifications, configure custom SMTP in Supabase dashboard → **Project Settings → Authentication → SMTP Settings**. A custom domain with SPF/DKIM is recommended for reliable deliverability; personal Gmail SMTP works but emails may be flagged as phishing by recipients.

### 8. Start dev server

```bash
pnpm dev
```

---

## Data integrity rules

These rules are enforced throughout and must not be relaxed:

- **1% tolerance:** `|(qty × unit_price) - item_total| ≤ item_total × 0.01`
- **Header integrity:** `sum(item_total)` must match `transaction.total_amount` within 1%
- **Audit gate:** `is_reviewed = true` is the only definition of master data
- **Unknown handling:** illegible AI fields → `NULL`, never hallucinate
- **14 categories only** — see `Project_Requirements_Expense_Tracker.md` for the full list

---

## Phase status

| Phase | Status |
|---|---|
| Phase 1 — Core schema, auth, manual entry, review queue | Complete |
| Phase 2 — AI receipt pipeline (upload → Gemini → review) | Complete |
| Phase 3 — Analytics dashboard (7 tabs, Recharts) | Complete |
| Phase 4 — Product normalization pipeline (fuzzy matching, ProductAudit) | Complete |
| Phase 5 — Groups, invitations, in-app notification | Complete |
