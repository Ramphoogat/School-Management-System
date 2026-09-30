# Setup guide for a new developer

How to get the school platform running on your own computer, find your way around the code, and run the tests.
Related files: `README.md` (the plan and product rules), `PROGRESS.md` (what is built and what is left),
`SERVICES.md` (accounts and keys), `docs/API.md` (every API call), `docs/DEPLOYMENT.md` (going live).

---

## 1. What you need

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 or newer | Runs everything |
| pnpm | 10 (`npm i -g pnpm`) | The project is a pnpm workspace |
| Docker Desktop | any recent | Runs PostgreSQL (and, optionally, a test mail inbox) |
| Git | any | |

No accounts or keys are needed to run the app locally. Email, WhatsApp and online payment are switched off until you
add credentials (see `SERVICES.md`).

## 2. First run

From the project folder:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

On Windows PowerShell use `Copy-Item .env.example .env` instead of `cp`.

What each step does:

1. `pnpm install` installs every package for the whole workspace.
2. `.env` holds the settings. The defaults in `.env.example` work locally. Change nothing yet.
3. `docker compose up -d` starts PostgreSQL 16 on port 5432 (user, password and database are all `school`).
4. `pnpm db:migrate` creates the tables and generates the database client. If it asks for a migration name, you have
   changed `schema.prisma`; otherwise it just applies what exists.
5. `pnpm db:seed` creates a demo school with one person per role and a sample class.
6. `pnpm dev` starts the web app on <http://localhost:3000> and the API on <http://localhost:4000>.

Open <http://localhost:3000>, choose a role button and sign in. Locally the role button fills in the demo account.

| Role | Email | Password |
|---|---|---|
| Student, Parent, Teacher, Clerk, Principal, Admin | `<role>@school.test` | `password123` |
| Super Admin | `superadmin@school.test` | `password123` (created when the API starts, from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` in `.env`). Leave the role unselected on the general sign-in page. |

These are for your own machine only. They must never exist on a real server.

### Optional: a test mail inbox

Announcements and reminders send email. To see them without a real provider, run Mailpit and point `.env` at it:

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

```
EMAIL_HOST=localhost
EMAIL_PORT=1025
```

Restart the API, then read the mail at <http://localhost:8025>.

## 3. How the project is laid out

```
apps/web           the web app (Vite, React 19, TypeScript, Tailwind, shadcn/ui, react-router)
apps/api           the API (NestJS 10, Prisma, Socket.IO)
packages/db        the Prisma schema, migrations and the seed script
packages/permissions   roles, permissions and scope checks, shared by web and API
docs/              this guide, the API reference, the deployment runbook
scripts/           helper scripts (for example the API reference generator)
```

### The API (`apps/api/src`)

One folder per feature (`fees`, `attendance`, `messages`, `voice`, `platform`, and so on). Each has a `*.module.ts` with
the controller (the routes), the service (the logic) and the DTO classes (input rules). Things to know:

- **Permissions** are written once in `packages/permissions/src/index.ts` as `resource:action:scope`. Routes declare what
  they need with `@RequirePermission('fees', 'read')`; finer rules ("only this class's teacher") are checked in the handler
  with `can(user, …)`. The web app uses the same file to hide what a role cannot use, but **the API is the authority**.
- **Every request re-reads the person's role, class and school from the database** (`auth/guards.ts`), so a role change or
  a deactivation applies at once. Every query is filtered by `schoolId`.
- **Every change is written to the audit log** through `AuditService.log`. Bulk actions write one entry per record plus one
  for the bulk itself.
- **Bulk actions** return `{ succeeded, total, failed[] }` and never let one bad row block the rest.
- **Notifications** are events published on the `EventBus`. A background worker inside the API reads the queue table every
  5 seconds and sends email or WhatsApp with retry. There is no Redis (yet).
- **Files** go through `storage/storage.ts`: local disk (`UPLOAD_DIR`) or an S3-compatible bucket if `S3_BUCKET` is set.
  Every upload passes the rules in `storage/upload-rules.ts` and, if `CLAMAV_HOST` is set, a virus scan.
- **Live features** (class chat, direct messages, presence, voice signaling, "this screen changed") use Socket.IO on the
  same port as the API.
- The app reads `.env` from the current folder or from the project root (`env.ts`).

### The web app (`apps/web/src`)

- `pages/` one file per screen, `components/` shared pieces, `components/ui/` the shadcn/ui parts.
- `lib/api.ts` is the only place that talks to the API. It adds the token, refreshes it when it expires, and turns errors
  into readable messages. `apiList` is for lists that report a total.
- `lib/auth.tsx` holds who is signed in. `lib/i18n.tsx` holds the interface languages: the English text in the code is the
  key, `t('Sign in')` returns the translation if there is one, and dictionaries live in `lib/i18n/`.
- `App.tsx` lists every route and which permission it needs.
- It is a single-page app, not Next.js.

### Database changes

Edit `packages/db/prisma/schema.prisma`, then run `pnpm db:migrate` and give the migration a name. Commit the new folder
under `packages/db/prisma/migrations/`. In production migrations are applied with `prisma migrate deploy`
(see `docs/DEPLOYMENT.md`), never `migrate dev`.

## 4. Tests

```bash
cd apps/api && pnpm test                 # the whole API suite
cd apps/api && pnpm test test/fees.test.ts   # one file
cd apps/web && pnpm test                 # the web app tests
cd packages/permissions && pnpm test     # the permission rules
```

- **API tests need PostgreSQL running** (`docker compose up -d`). Each run creates its own temporary database and its own
  compiled copy of the app, then removes both, so several runs (or a running dev server) cannot interfere.
- They call the real API with real sign-ins (through `supertest` and real Socket.IO connections). Email, WhatsApp and
  Razorpay are replaced by stand-ins, so the tests never send anything.
- **A new feature needs tests for: each role allowed, each role denied, another school denied, and the audit entry.** Copy
  the shape of an existing file such as `test/leave.test.ts`; `test/helpers.ts` builds a school with all six roles.
- The web tests use Vitest, jsdom and Testing Library against a stand-in API (`apps/web/test/app.test.tsx`).
- Type check the web app with `cd apps/web && npx tsc -b`.

## 5. Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web and API together, restarting on change |
| `pnpm db:migrate` | Apply or create a database migration (development only) |
| `pnpm db:seed` | Add the demo school (safe to repeat) |
| `pnpm build` | Build every package |
| `pnpm --filter @school/web check:contrast` | Check every theme colour for readable contrast |
| `node scripts/gen-api-docs.mjs` | Rebuild `docs/API.md` from the controllers |

## 6. Things that trip people up

- **Windows: "EPERM … query_engine-windows.dll.node" when generating the database client.** The running API holds that
  file. Stop `pnpm dev`, run the command again, then start it again.
- **After pulling changes** run `pnpm install`, then `pnpm db:migrate`, so new packages and new tables are picked up.
- **Camera, microphone and screen sharing** only work on `localhost` or over HTTPS.
- **Sign-in "not a <role>" error:** the role button you chose must match the account's role. Leave it unselected only for
  the Super Admin.
- **The demo data is not the real data.** Do not copy `.env` values from a real server into your local `.env`, and never
  commit `.env`.
- **Do not start a second API server against the same database** and expect everything to work: the notification queue,
  fee reminders, voice rooms and presence live inside one API process (see `PROGRESS.md`, section 5C).

## 7. Where to read next

1. `README.md` sections 3 to 6: the roles, the permission model and the bulk-approval rules.
2. `packages/permissions/src/index.ts`: who can do what.
3. One small feature end to end, for example `apps/api/src/leave/` with `apps/web/src/pages/Leave.tsx` and
   `apps/api/test/leave.test.ts`.
4. `PROGRESS.md`: what is done, what was never verified against the real service, and what is left.
