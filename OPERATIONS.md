# Forensique — Operations & Handoff Documentation

This document is the ops manual for the Forensique app. Read it end-to-end after Phase 3 handoff.

---

## 1. Stack overview

- **Frontend + backend**: Next.js 15 (App Router), deployed on Vercel. Marketing pages use SSG; the authenticated app is client-rendered.
- **Database + Auth**: Supabase (Postgres 15). Auth is Supabase's own email/password, with `handle_new_user` trigger auto-creating a `profiles` row on signup.
- **Payments**: Razorpay Subscriptions (test mode currently). One purchasable plan (`Test Series`, ₹149/mo). Notes and Combined plans exist as data rows but are non-purchasable.
- **Notes**: MDX files under `/content/notes/*.mdx`. Compiled server-side (`next-mdx-remote/rsc`) per-request, gated on subscription entitlement before compilation. Metadata (slug, title, summary) lives in the `notes` Postgres table for the public preview.

## 2. Environment variables

All live in `/app/.env` (locally) and in Vercel's Project Settings → Environment Variables (production).

| Variable | Purpose | Where used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Everywhere |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Anon (browser-safe) key | Client + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key, bypasses RLS. **NEVER expose to browser.** | Server routes only (`/api/admin/*`, `/api/attempt/create`, `/api/billing/*`, `/api/webhooks/razorpay`) |
| `RAZORPAY_KEY_ID` | Razorpay API key | Server routes |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Same value; needed on the client for the Checkout modal init | Client (pricing page) |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret | Server routes only |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC secret for webhook verification | `/api/webhooks/razorpay` |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the app | Emails, OG tags |

## 3. Deployment

**Auto-deploy from GitHub**: pushes to the `main` branch trigger a Vercel build automatically (Vercel's default GitHub integration). No manual deploy step. Preview deployments spin up on every non-main branch push.

**Build command**: `next build`. Run locally with `yarn build && yarn start`.

**Node version**: The Razorpay SDK and Supabase JS latest technically want Node 22+. Vercel defaults to a recent Node LTS which is fine. Locally in this sandbox Node 20 is used with `--ignore-engines` — for production Vercel, no override needed.

**First-time deploy checklist**:
1. Push repo to GitHub.
2. In Vercel, import the project. Framework preset auto-detects Next.js.
3. Set the 8 env vars from section 2 in Vercel → Settings → Environment Variables. Choose "All environments".
4. Deploy.
5. In Razorpay Dashboard, edit the webhook URL to point to `https://YOUR-VERCEL-DOMAIN.vercel.app/api/webhooks/razorpay`.
6. Repeat step 5 for the custom domain if / when set up.

## 4. Database migrations (`/supabase/migrations/`)

Four files, apply in order:

1. **`20250101000000_base_schema.sql`** — all tables, enums, indexes, seed plans + units, `handle_new_user` trigger.
2. **`20250101000001_rls_policies.sql`** — the final RLS state: content tables open, user-owned tables own-row + column-level UPDATE grants.
3. **`20250101000002_finalize_attempt_rpc.sql`** — the `finalize_attempt(uuid, boolean)` RPC that replaces the old `/api/attempt/submit` endpoint. `SECURITY DEFINER`, verifies `auth.uid()` ownership before doing anything.
4. **`20250101000003_notes_seed.sql`** — seeds the 10 notes metadata rows (one per unit) matching the MDX files in `/content/notes/`.

**To rebuild the database from scratch**:
1. Create a new Supabase project.
2. Open SQL Editor.
3. Paste and Run each migration file in numeric order.
4. Then run: `update plans set razorpay_plan_id = 'plan_...' where name = 'Test Series';` — the Razorpay plan ID cannot be seeded because it's created in the Razorpay dashboard.
5. Re-import test JSON files via the admin panel (see §5).
6. Promote your admin account: `update profiles set role = 'admin' where email = 'YOU@EXAMPLE.COM';`

**Going forward** (recommended): use the Supabase CLI:
```
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```
This will apply any *new* migration files that appear in `/supabase/migrations/` — don't re-apply the old ones manually.

## 5. Adding a new previous-year test

1. Assemble the JSON file matching the `UGC_NET_FS_2025_JUNE.json` shape (see `/public/UGC_NET_FS_2025_JUNE.json` as reference). Required fields per question: `question_code`, `content_format`, `question_text`, `options[]`, `correct_option_label`, `answer_status`, `unit`, `topic`, `subtopic`, `explanation`.
2. Sign in as admin. Header → **Admin**.
3. Either paste the JSON in the textarea or upload as a `.json` file, then click "Import".
4. The importer:
   - Validates: 4 options per question, exactly one correct on `answer_status: 'valid'` questions, `dropped` questions have null correct, passage references resolve, question codes are unique, units match the fixed 10-unit list.
   - Creates or reuses the exam, passages, taxonomy (units/topics/subtopics), questions, options, statements, match items, and answers.
   - Links questions to a `tests` row.
5. New tests default to `is_premium = true`. **Only** `test_id = 'UGC_NET_FS_2025_06'` is flagged as the free trial (`is_premium = false`). This is enforced in the importer (`isSampleFreeTrial` check in `/app/api/[[...path]]/route.js` `handleImport`).

**If you ever need another free-trial test**: either change that specific test's `is_premium` to `false` directly in SQL, or (better) extend the importer's `isSampleFreeTrial` check.

## 6. Adding / editing a Notes unit

Notes is now MDX-in-repo, not database-stored rich text.

1. Add or edit the MDX file: `/content/notes/{unit-slug}.mdx`. The slug must match what's in the `notes` table (`slug` column). See existing files for style; standard headings + lists + emphasis work out of the box.
2. If you're adding a **new** notes entry, insert its metadata row:
   ```sql
   insert into public.notes (unit_id, slug, title, summary, status, sort_order)
   values (
     (select id from public.units where name = 'Unit name from the fixed 10'),
     'my-new-slug',
     'Public Title',
     'Short public preview text — always visible.',
     'published',
     11
   );
   ```
3. Commit and push. Vercel redeploys; the new file is picked up.

**Gating**: `/app/app/notes/[slug]/page.js` reads the MDX from disk only if the viewer has an active subscription whose plan has `features.notes = true`. Non-entitled viewers see the metadata summary + a "Notes access — coming soon" paywall block. **The MDX itself is never sent to a non-entitled client**, which matters because static compilation of MDX would leak content via `_next/static/*.js`.

## 7. Razorpay plan changes

**Existing plan**: `Test Series`, ₹149/month, monthly billing.

**To create a new purchasable plan** (e.g. to launch Notes / Combined):
1. In Razorpay dashboard (Test then Live mode), create a Plan with the exact price and frequency.
2. Copy the resulting `plan_...` ID.
3. In Supabase: `update plans set razorpay_plan_id = 'plan_...', is_purchasable = true where name = 'Notes';` (or Combined).
4. The pricing page and checkout endpoint automatically start serving that plan as purchasable. No code change needed.

**Going live** (switching from test to live keys):
1. Recreate the plan in Razorpay Live Mode. New `plan_...` ID; update `plans.razorpay_plan_id`.
2. Create a new webhook in Live Mode with the same events; new webhook secret.
3. Swap `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Vercel env vars with the live equivalents.
4. Redeploy.

## 8. Common Supabase admin actions (SQL Editor)

```sql
-- Promote a user to admin
update public.profiles set role = 'admin' where email = 'someone@example.com';

-- Force-activate a subscription for a specific user (support scenario)
update public.subscriptions set status = 'active', expires_at = now() + interval '30 days'
where user_id = (select id from auth.users where email = 'someone@example.com');

-- Retire a bad question
update public.questions set status = 'archived' where question_code = 'UGC_NET_FS_2025_JUNE_Q042';

-- Revise an official answer key post-challenge
update public.answers set correct_option_id = '3', answer_key_version = answer_key_version + 1, revised_at = now()
where question_id = (select id from questions where question_code = 'UGC_NET_FS_2025_JUNE_Q042');
```

Revised answer keys do **not** rewrite already-graded attempts — the historical `test_attempts.score` and `attempt_responses.is_correct` remain as-taken by design. The solution-review screen shows the currently-correct answer, so newly-viewed reviews reflect the revision.

## 9. Where the code lives

```
/app
├─ app/                       Next.js App Router pages + API
│  ├─ page.js                Landing
│  ├─ (marketing)/           Pricing, FAQ, About, Contact, Terms, Privacy, Refund
│  ├─ auth/                  Signup/Signin (Supabase Auth)
│  ├─ dashboard/             Dashboard incl. subscription card
│  ├─ attempt/[attemptId]/   CBT test-taking engine
│  ├─ results/[attemptId]/   Solution review
│  ├─ analytics/             Trend charts, weak-area callouts
│  ├─ custom-test/           Custom test builder
│  ├─ notes/                 Notes index + gated MDX detail
│  ├─ admin/import/          Admin-only JSON importer
│  └─ api/[[...path]]/       Catch-all API route handler
├─ components/                site header/footer + shadcn primitives
├─ content/notes/             MDX notes files (one per unit)
├─ lib/supabase/              browser and admin clients
├─ supabase/migrations/       Version-controlled schema/RLS/RPC (§4)
└─ public/                    static assets + reference JSON
```

## 10. Auth settings to double-check

In Supabase Dashboard → Authentication → Providers → Email:
- **Confirm email = ON** (re-enable if disabled during development).
- **Enable email signup = ON**.
- **Password minimum length ≥ 8** recommended.
- Rate limits at default are fine for launch traffic.

## 11. Known deferred items (for future you)

- **Google OAuth**: Wire Google as a Supabase Auth provider. Just enable it in Supabase Dashboard → Providers → Google; the auth page will need a small "Sign in with Google" button.
- **Notes/Combined plans**: Ready to enable. Follow §7.
- **Email notifications**: Currently only Razorpay's built-in pre-debit notifications fire. Adding a transactional email provider (Resend, Postmark) is straightforward — a Postgres trigger on `subscriptions` insert can fire a webhook that calls the email provider.
- **User_topic_stats aggregation**: table exists but is never populated. Populate it inside `finalize_attempt` if you want analytics dashboards to stop doing on-the-fly aggregation.
- **Password reset flow**: Supabase Auth supports it out of the box, but there's no UI page at `/auth/reset` yet. Add one when needed.

## 12. Support & escalation

Users are told to email `support@forensique.in`, `content@forensique.in`, `privacy@forensique.in`. Set up these email addresses (Google Workspace, Zoho Mail, etc.) before real users arrive.
