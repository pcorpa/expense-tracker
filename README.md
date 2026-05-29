# Expense Tracker

A mobile-first expense tracker with AI-powered receipt scanning, group management, and a structured review queue for data quality.

**Stack:** React 19 + TypeScript + Vite · Supabase (Postgres, Auth, Storage, Edge Functions) · Google Gemini 2.5 Flash · TanStack Query v5 · Recharts

---

## Features

- **Receipt OCR** — upload a receipt (JPEG, PNG, WebP, or HEIC); the image is converted to JPEG client-side if needed, then a Supabase Edge Function sends it directly to Gemini 2.5 Flash to extract the store, date, items, quantities, unit prices, and totals
- **Failed receipt retry** — receipts that fail AI processing appear in the Review Queue with a Retry button
- **Manual entry** — log expenses without a receipt, with product autocomplete against the existing catalog
- **Review queue** — every AI-extracted transaction lands in a review queue; edit and approve to promote it to master data
- **Group management** — create groups, invite members by email (sent via Resend), and track shared expenses
- **14-category taxonomy** — all expenses are classified into a fixed set of categories for consistent analytics
- **1% math tolerance** — item totals and receipt totals are validated before approval
- **Auth** — email/password and Google SSO via Supabase Auth

## Tech stack

| Layer | Libraries |
|---|---|
| Frontend | React 19, TypeScript, Vite, react-router-dom v7 |
| Data fetching | TanStack Query v5 |
| UI | Lucide icons, Sonner toasts, Recharts |
| Image handling | heic2any (HEIC → JPEG conversion, client-side) |
| Backend | Supabase — Postgres + RLS, Auth, Storage, Edge Functions (Deno) |
| AI | Google Gemini 2.5 Flash via REST API |
| Email | Resend (group invitations) |

## Project structure

```
src/
  pages/
    Home.tsx              landing page
    SignIn.tsx / SignUp.tsx
    UploadReceipt.tsx     receipt upload → storage
    TransactionEntry.tsx  manual expense entry
    ReviewQueue.tsx       audit queue — review and approve AI extractions
    ReviewItemEdit.tsx    inline item editor within the queue
    ExpenseList.tsx       browsable expense history
    ProcessedImages.tsx   list of processed receipt images
    GroupManager.tsx      group creation and member invitations
    Profile.tsx           user profile
  components/
    NavBar.tsx / MobileMenu.tsx
    ProtectedRoute.tsx
  lib/
    supabase.ts           Supabase client
    auth.tsx              auth state context
  types.ts                canonical TypeScript types

supabase/
  migrations/             incremental SQL migrations (0001–0005)
  schema.sql              full DB schema + RLS policies
  functions/
    process-receipts/     receipt_id + image_data → Gemini → transactions + items
    send-invitation/      group invitation emails via Resend
```

## Setup

### Prerequisites

- [pnpm](https://pnpm.io/)
- A [Supabase](https://supabase.com/) project
- A [Google AI Studio](https://aistudio.google.com/) API key (Gemini 2.5 Flash)
- A [Resend](https://resend.com/) account and API key (for group invitation emails)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

Create a `.env` file:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Supabase — database

Apply the schema and migrations via the Supabase CLI:

```bash
supabase db push
```

Or run `supabase/schema.sql` and the files in `supabase/migrations/` from the Supabase dashboard SQL editor.

### 4. Supabase — storage

Create a private Storage bucket named `receipts` in your Supabase project dashboard.

Then run this in the SQL editor to grant authenticated users upload access:

```sql
CREATE POLICY "Authenticated users can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'receipts');
```

> **If you applied `schema.sql` to an existing database** that already had `transaction_items` without `product_id`, run this migration before using the AI pipeline:
> ```sql
> ALTER TABLE transaction_items
>   ADD COLUMN IF NOT EXISTS product_id uuid references products(id) on delete set null;
> NOTIFY pgrst, 'reload schema';
> ```

### 5. Supabase — Google OAuth

In your Supabase project go to **Authentication → Providers → Google** and enable it. You'll need a Google OAuth 2.0 client ID and secret from [Google Cloud Console](https://console.cloud.google.com/). Add your app's redirect URL (`<SUPABASE_URL>/auth/v1/callback`) as an authorised redirect URI in Google Cloud.

### 6. Edge Functions

Deploy the functions:

```bash
supabase functions deploy process-receipts
supabase functions deploy send-invitation
```

Set the following secrets in your Supabase project (**Project Settings → Edge Functions → Secrets**):

| Secret | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `RESEND_API_KEY` | Resend API key for sending invitation emails |
| `APP_URL` | Your deployed app URL (used in invitation email link) |

> **Note:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — no need to set them manually. The `process-receipts` function runs as the authenticated user (user JWT forwarded from the client), so no service role key is required.

> **Note on Resend:** The free tier only sends to verified addresses. To send invitations to arbitrary emails, verify a domain at [resend.com/domains](https://resend.com/domains) and update the `from` address in `send-invitation/index.ts`.

### 7. Start the dev server

```bash
pnpm dev
```

## Status

| Phase | Status |
|---|---|
| Phase 1 — Core schema, auth, manual entry, review queue | Complete |
| Phase 2 — AI receipt pipeline (upload + Edge Functions) | Complete |
| Phase 3 — Analytics and charts (Recharts) | Not started |
