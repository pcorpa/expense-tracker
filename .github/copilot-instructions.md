# Copilot Instructions

This repository contains a React + TypeScript Vite project for an expense tracker with Supabase and Google Gemini integration.

## Setup

- Install dependencies with `npm install`.
- Create a `.env` file from `.env.example`.
- Provide Supabase environment variables in `.env`.

## Development

- Run the app with `npm run dev`.
- The app entrypoint is `src/App.tsx`.
- Supabase client is initialized in `src/lib/supabase.ts`.
- Authentication state is managed in `src/lib/auth.ts`.

## Notes

- The database schema is in `supabase/schema.sql`.
- Replace the placeholder Gemini processing function with your Google AI implementation.
