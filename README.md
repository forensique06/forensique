# Forensique

Production-ready web app for **UGC NET/JRF Forensic Science Paper II** exam preparation.

- Next.js 15 (App Router) + Supabase Postgres/Auth + Razorpay Subscriptions.
- CBT-style test-taking engine, deep topic tagging, post-test analytics, custom test builder, unit-wise notes.

**For anything ops-related** (deployment, adding tests, adding notes, database migrations, environment variables): read [`OPERATIONS.md`](./OPERATIONS.md) end-to-end. It's the source of truth.

## Local dev quick start

```bash
yarn install --ignore-engines
cp .env.example .env   # then fill in Supabase + Razorpay keys, see OPERATIONS.md §2
yarn dev
```

Open http://localhost:3000. The app expects a Supabase project with the migrations under `/supabase/migrations/` already applied — see [OPERATIONS.md §4](./OPERATIONS.md).

## Structure

See [OPERATIONS.md §9](./OPERATIONS.md).

## License

Proprietary. All rights reserved. UGC / NTA question text remains the property of the respective examining body.
