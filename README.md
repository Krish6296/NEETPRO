# NEET Pro

NEET Pro is a full-stack NEET mock-test platform organized as an npm
workspaces monorepo.

## Project structure

```text
client/       React, Vite, Tailwind CSS student/admin application
server/       Express API and Prisma database schema, seed, and migrations
api/          Vercel serverless entry point for the Express API
```

## Setup

Requirements: Node.js 20+ and PostgreSQL.

1. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the Supabase pooled
   connection string, `DIRECT_URL` to the direct database connection string,
   and `JWT_SECRET` to a long random value. `CLIENT_ORIGIN` and `PORT` are
   optional for local development.
2. Install dependencies with `npm install`.
3. Generate Prisma Client with `npm run db:generate`.
4. Apply the checked-in migrations in development with `npm run db:migrate`.
   For a deployed Supabase database, use `npm run db:deploy` to apply
   migrations without creating a development migration.
5. Add demo data with `npm run db:seed`. It creates an admin at `ADMIN_PHONE`
   (default `+15550000001`), 360 illustrative sample questions, and two
   balanced 180-question full mock tests (45 Physics, 45 Chemistry, 90 Biology).
   These generated sample questions are for demonstrating the workflow; they
   are not verified NEET questions and should not be used as exam-preparation
   material.
   Full mocks use a 180-minute, +4/−1 format. After submission,
   students can filter every response by correct, incorrect, or unanswered and
   review their selected option, the correct answer, and the question's saved
   explanation.
6. Start the API and client with `npm run dev`. The API listens on port 3000.

Question image uploads use Supabase Storage. Create a public `question-images`
bucket (or set `SUPABASE_STORAGE_BUCKET`) and configure `SUPABASE_URL` plus a
server-only `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Never expose the service-role
key through a `VITE_` variable. Image uploads are limited to JPEG, PNG, and
WebP files up to 5 MB; without storage credentials, the API reports that image
storage is unavailable while question text and URL references continue to work.

## Supabase and Vercel deployment

1. Create a Supabase project. In **Authentication → Providers**, enable Phone
   and configure an SMS provider; production OTP uses Supabase Auth.
2. Set `DATABASE_URL` to the Supavisor transaction-pooler URL for application
   requests and `DIRECT_URL` to the direct database URL for Prisma migrations.
   Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `JWT_SECRET` in Vercel. Add
   `SUPABASE_SERVICE_ROLE_KEY` only if image uploads are needed. Keep all of
   these as server environment variables—never `VITE_` variables.
3. Import `Krish6296/NEETPRO` into Vercel with the repository root as the
   project root. `vercel.json` configures the Vite output and a serverless
   Express API. The build generates Prisma Client before building the app.
4. After setting the production environment variables, apply schema migrations
   with `npm run db:deploy` using the configured `DIRECT_URL`.
5. Set `CLIENT_ORIGIN` to the production site origin when using a custom domain;
   Vercel preview and project domains are allowed automatically.

Do not run `npm run db:seed` against a live student database: its generated
questions are illustrative demonstration content, not curated exam-preparation
material.

## Supabase MCP and agent skills

The VS Code MCP server configuration for the NEETPRO Supabase project is in
`.vscode/mcp.json`. Reload VS Code or refresh MCP servers, then authorize
Supabase when prompted. Optional Supabase agent skills can be installed with
`npx skills add supabase/agent-skills`.

## Study tools and offline practice

Students can create daily study sessions, set a study-time goal, and track
completed sessions and streaks. Planner data is stored in the browser on the
current device.

Completed test reviews are saved to a local offline practice pack. In a
production build, the service worker caches the app shell so students can
reopen NEET Pro without a network connection and practice saved questions.
Offline attempts are local-only and do not sync to server rankings. Open the
app online at least once to cache the app shell; review a completed test online
to add its questions to the offline pack. Planner entries and practice packs
remain in that browser's local storage.

The admin question bank supports search across question text, subject, chapter,
and tags, with subject/chapter/difficulty/status filters and pagination.

## Authentication and demo OTP

All `/api` endpoints except `/api/health` and the OTP request/verify endpoints
require `Authorization: Bearer <token>`. In non-production environments,
`POST /api/auth/otp/request` returns the configured `DEMO_OTP` (default
`123456`) so the app can be tested without SMS. This response explicitly marks
the OTP as demo-only. In production, the API sends and verifies OTPs through
Supabase Auth; configure Phone Auth and an SMS provider in the Supabase
dashboard, and set `SUPABASE_URL` plus `SUPABASE_ANON_KEY`. The API issues its
app JWT only after Supabase verifies the phone. The seed creates
a demo admin phone; set `ADMIN_PHONE` to the intended administrator before
seeding a non-production database.

## API contracts

Successful responses use JSON. Errors have the shape
`{ "error": { "code": "...", "message": "...", "details"?: ... } }`.
Collection responses are `{ items, page, limit, total, totalPages }`.

### Auth

- `POST /api/auth/otp/request` `{ phone }` → `201 { phone, challengeId,
  expiresInSeconds, demoOtp, demoOnly, warning }` in development.
- `POST /api/auth/otp/verify` `{ phone, code, challengeId? }` →
  `{ token, user }`.
- `GET /api/auth/me` → `{ user }`.

### Tests, questions, and attempts

- `GET /api/tests` (filters: `type`, `search`, `page`, `limit`) and
  `GET /api/tests/:testId` return published questions without answer keys to
  students. Admins can inspect all questions.
- Admin test management: `POST /api/tests`, `PATCH /api/tests/:testId`,
  `DELETE /api/tests/:testId`. Create/update accepts question IDs as
  `questionIds`. Supported test types are `FULL_MOCK`, `SUBJECT`, `CHAPTER`,
  and `PREVIOUS_YEAR`. Previous Year Questions tests can only contain published
  questions tagged `pyq` and `year:YYYY`. `POST /api/tests/:testId/generate`
  accepts `{ questionCount, subject?, chapter?, difficulty? }`.
- `GET /api/questions` supports `subject`, `chapter`, `difficulty`, `search`,
  and pagination. Admin question CRUD uses `POST /api/questions`,
  `PATCH /api/questions/:questionId`, and `DELETE /api/questions/:questionId`.
  Questions can include an `imageUrl`.
- Admin CSV import: `POST /api/questions/import` with `Content-Type: text/csv`.
  Required columns: `text,optionA,optionB,optionC,optionD,correctOptionId,
  subject,chapter`. Optional columns: `explanation,difficulty,status,tags`
  (`tags` separated by `|`). For questions verified against a published
  previous-year paper, include both `pyq` and `year:YYYY` tags (for example,
  `pyq|year:2024`). The Previous Year Questions test category only selects
  published questions with both tags; demo seed questions are deliberately
  excluded from it.
- Admin image upload: `POST /api/uploads/images` as `multipart/form-data`
  with an `image` file field returns `{ imageUrl }`. It accepts JPEG, PNG,
  and WebP files up to 5 MB and stores them in the configured public Supabase
  Storage bucket.
- `POST /api/attempts` `{ testId }` → `201 { attempt, questions, serverTime }`.
  It snapshots and shuffles test questions. Correct answers are never included
  in an active attempt.
- `PUT /api/attempts/:attemptId/answers/:questionId` accepts
  `{ selectedOption, timeSpent?, isMarkedForReview? }`; repeat saves upsert the
  same answer.
- `GET /api/attempts/:attemptId` returns the active attempt and saved answers.
  `POST /api/attempts/:attemptId/submit` grades synchronously and
  idempotently; scoring is +4 per correct answer, `negativeMarking` points
  deducted for an incorrect answer, and 0 for unanswered questions.
- `GET /api/attempts/:attemptId/result` and `GET /api/results` return graded
  results. Result details include correct answers and explanations.
  Each graded answer also includes `subject` and `chapter` for analytics,
  read from the related question record.

### Admin and health

- `GET /api/admin/users` (filters: `search`, `role`, `blocked`, pagination)
  lists users; `PATCH /api/admin/users/:userId/block` accepts `{ isBlocked }`.
- `GET /api/health` → `{ status: "ok", database: "connected" }`, or HTTP 503
  with `{ status: "degraded", database: "unavailable" }` if PostgreSQL cannot
  be reached.

The backend build/typecheck can be run with
`npm run build --workspace server` and `npm run typecheck --workspace server`.
Run `npm run typecheck` to check both workspaces and `npm run build` for both
production bundles. In development, the client is at
`http://localhost:5173` and proxies `/api` requests to the Express API.
