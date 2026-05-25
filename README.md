# Expense Tracker

A mobile-first React + TypeScript app using Vite and Supabase for expense tracking.

## Features

- Email/password and Google SSO authentication via Supabase
- Receipt image upload to Supabase Storage
- Daily batch processing of receipts via Gemini AI (placeholder function integration)
- Manual expense entry when no receipt is available
- Expense list, uploaded image queue, and profile page
- Supabase database schema for tickets and products

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
3. Set your Supabase credentials in `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Create the Supabase tables from `supabase/schema.sql`.
5. Create a Supabase storage bucket named `receipts`.
6. If you deploy the Supabase function, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the function environment.
7. Start the app:
   ```bash
   npm run dev
   ```

## Project structure

- `src/App.tsx` - main routing and layout
- `src/lib/supabase.ts` - Supabase client
- `src/lib/auth.ts` - auth state management
- `src/pages/` - UI screens for upload, sign-in, expenses, profile, and processing
- `supabase/schema.sql` - database schema for tickets and products

## Next steps

- Add a Supabase Edge Function or server endpoint to call Google Gemini and map the response to `tickets` and `products`
- Create the `receipts` storage bucket in Supabase
- Wire the batch processor for daily ticket ingestion
- Extend analytics and categories with charts
