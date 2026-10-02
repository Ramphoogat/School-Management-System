# School Management Platform

A web-based school management system with **role-specific dashboards** (Student, Parent, Teacher, Clerk, Principal, Admin) built on a **Discord-style workspace**: each class is a group, each group has channels, and everything is managed from one consistent interface.

**Launch scope:** single school, notifications via **WhatsApp + email**. The architecture is prepared for multi-school expansion later (see section 13).

---

## Current status (2 Oct 2026)

The plan below has been built. All six phases work, plus extras that were not in the plan. This section is the up-to-date guide:
what the project is, how it is laid out, how to install it and how to run it. The rest of the file is the original plan and design,
kept because it still explains *why* things are the way they are. Where the plan and the code differ, this section and the code win.

### What exists

- **Roles and workspace:** six school roles (student, parent, teacher, clerk, principal, admin) plus a platform super admin. Permissions are checked on the API. Each class is a workspace with channels (announcements, attendance, homework, chat, voice, resources, grades, books). A sidebar groups the pages (School, People, Learning, Fees and records, Messaging, Storage, Security).
- **Academics:** attendance (approved leave counts), homework with file hand-ins, exams with approval, report cards and certificates as PDFs, academic years and terms, a configurable grade scale, timetable with clash checks.
- **Operations:** admissions with CSV import, fees with online payment (Razorpay), waivers, refunds and reminders, ID cards with photos, school documents, class resources (teachers upload to their own class; admin, principal and clerk can upload and delete in any class, from a file or a pasted link).
- **Communication:** editable announcements, class chat, voice channels, direct messages (attachments, edit, delete, read receipts, block, report and review), notifications by in-app, email and WhatsApp with quiet hours and editable wording. A **Notifications page** lists everything sent to you, read and unread, with filters and "mark all read".
- **Many schools on one platform:** a super admin creates and suspends schools; each school has its own address, branding, plan and data, and can export its data (or have it permanently deleted by the super admin).
- **Plan and data page:** shows the school plan and student limit, exports all school records as one file, and **bulk-adds people from a CSV** (admin and principal). Each new person gets a temporary password, the plan student limit is checked for the whole file, and the passwords can be downloaded once.
- **Settings page** (Security > Settings): password change and a single place to reach every setting the person may use.
- **MCP connections** (Settings > MCP connections): admin and principal create keys so an outside application, such as an AI assistant, can connect to the school MCP server (`POST /api/mcp`). A connection acts as the person who made it, with only their access, and only reads. Tools: `school_overview`, `list_classes`, `list_people`, `list_announcements`, `list_notifications`. Keys are stored hashed, shown once, rate-limited and can be disconnected at any time.
- **Storage:** local disk, any S3-compatible bucket, and Google Drive as extra storage, with optional ClamAV scanning. School cameras (HLS and MJPEG) for staff.
- **Languages and access:** English, Hindi, Telugu, Tamil, Marathi, plus partial Haryanvi and Sanskrit. Themes and wallpapers that keep text readable, and an accessibility pass (landmarks, skip link, keyboard, contrast). Some newer labels are still English-only.

### Technology

| Part | Choice |
|---|---|
| Web | Vite, React 19, TypeScript, Tailwind, shadcn/ui, react-router, recharts, socket.io-client (a single-page app, not Next.js) |
| API | NestJS 10, Prisma 6, PostgreSQL 16, Socket.IO, nodemailer |
| Shared | `packages/permissions` (roles and scope checks used by web and API), `packages/db` (schema, migrations, seed) |
| Queue and jobs | A database table polled inside the API and an in-process hourly reminder job. Redis and BullMQ are not used yet. |
| Files | Local disk by default, or an S3-compatible bucket (Amazon S3, Cloudflare R2, MinIO) via `S3_BUCKET`; optional Google Drive and ClamAV. |
| Tooling | pnpm workspace, Docker for PostgreSQL, Vitest |

### Project structure

```
school web app/
├── apps/
│   ├── api/                      NestJS API (port 4000, all routes under /api)
│   │   ├── src/
│   │   │   ├── main.ts, app.module.ts, env.ts
│   │   │   ├── auth/             sign-in, tokens, guards, rate limits, password reset
│   │   │   ├── users/ students/ classes/ links/ role-requests/   people, classes, parent links, approvals
│   │   │   ├── academic/ attendance/ leave/ homework/ exams/ timetable/   teaching and results
│   │   │   ├── admissions/ fees/ certificates/ idcards/ documents/        office work
│   │   │   ├── announcements/ chat/ messages/ voice/ notifications/       communication
│   │   │   ├── resources/ books/ storage/ import/ pdf/                    files, links, PDFs
│   │   │   ├── platform/ billing/ school-data/                            schools, plans, export and delete
│   │   │   ├── cameras/ insights/ audit/ events/ live/                    cameras, analytics, audit log, live updates
│   │   │   ├── mcp/              MCP server and connection keys
│   │   │   └── common/ prisma/   security headers, shared helpers, database service
│   │   ├── test/                 API tests (real database, real sign-ins)
│   │   └── scripts/              storage tools
│   └── web/                      React app (port 3000)
│       ├── src/
│       │   ├── App.tsx           every route and the permission it needs
│       │   ├── pages/            one file per screen (Home, Channels, Messages, Fees, SchoolPlan, SecuritySettings, Mcp, NotificationsPage, ...)
│       │   ├── components/       shared pieces; components/ui/ holds the shadcn/ui parts
│       │   └── lib/              api.ts, auth.tsx, nav.ts (sidebar), i18n/ (languages), live.ts, appearance.tsx, ...
│       └── test/                 web tests (Vitest, jsdom, Testing Library)
├── packages/
│   ├── db/                       prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
│   └── permissions/              roles and `resource:action:scope` rules, shared by web and API
├── docs/                         SETUP.md, API.md (every route), DEPLOYMENT.md
├── scripts/                      gen-api-docs.mjs
├── docker-compose.yml            PostgreSQL 16
├── .env.example                  every setting, with comments
├── PROGRESS.md                   what is done, unverified and left
└── SERVICES.md                   every outside account and key
```

### Install

You need **Node.js 22+**, **pnpm 10** (`npm i -g pnpm`), **Docker Desktop** (for PostgreSQL) and **Git**. No outside accounts are needed to run locally.

```bash
git clone https://github.com/Ramphoogat/School-Management-System.git
cd School-Management-System
pnpm install
cp .env.example .env        # on Windows PowerShell: Copy-Item .env.example .env
docker compose up -d        # starts PostgreSQL 16 on port 5432
pnpm db:migrate             # creates the tables (run again after pulling new migrations)
pnpm db:seed                # creates a demo school with one person per role
```

The defaults in `.env.example` work locally. Email, WhatsApp, online payment, S3, Google Drive and ClamAV stay off until you add their keys (see `SERVICES.md`).

### Run

```bash
pnpm dev                    # web on http://localhost:3000 and API on http://localhost:4000
```

Open <http://localhost:3000> and sign in with a demo account:

| Role | Email | Password |
|---|---|---|
| Student, Parent, Teacher, Clerk, Principal, Admin | `<role>@school.test` (e.g. `admin@school.test`) | `password123` |
| Super admin | `superadmin@school.test` | `password123` (created at API start from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`) |

These accounts are for your own machine only; never create them on a real server. After changing permissions (`packages/permissions`) or the database schema (`packages/db`), rebuild those packages and restart the dev server so the API picks the change up:

```bash
pnpm --filter @school/permissions build
pnpm --filter @school/db build
```

Other commands:

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package and both apps |
| `pnpm test` | Runs every test suite (API tests need PostgreSQL running) |
| `cd apps/api && pnpm test <name>` | One API test file, e.g. `pnpm test resources` |
| `cd apps/web && npx tsc -b` | Type-checks the web app |
| `pnpm db:generate` | Regenerates the database client after a schema change |

To read the email the app sends without a real provider, run Mailpit (`docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`), set `EMAIL_HOST=localhost` and `EMAIL_PORT=1025` in `.env`, and open <http://localhost:8025>.

### Configuration

All settings live in `.env` (documented line by line in `.env.example`). The important ones: `DATABASE_URL`, `JWT_SECRET` and `JWT_REFRESH_SECRET` (must be long and random in production), `WEB_ORIGIN`, `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`, and the optional groups for email (`EMAIL_*`), WhatsApp (`WHATSAPP_*`), Razorpay (`RAZORPAY_*`), file storage (`UPLOAD_DIR`, `S3_*`, `GDRIVE_*`) and virus scanning (`CLAMAV_*`). With `NODE_ENV=production` the API refuses to start with weak secrets or a localhost address.

### Tests

The API suite uses a real PostgreSQL database: each run creates its own temporary database and build folder, so runs never interfere. The web suite uses Vitest and jsdom against a stand-in API. Email, WhatsApp and Razorpay are replaced by stand-ins in tests.

### Not yet proven against the real thing

WhatsApp (Meta), Razorpay live payments and webhooks, a real email provider, an S3 or R2 bucket, ClamAV, voice on real devices and networks, and the installable-app worker. They are built and tested against stand-ins. The interface translations were written without a native-speaker review. See `PROGRESS.md` section 4 for the full list.

### Where to read more

- `PROGRESS.md`: what is done, what has not been verified, and what is left, in order.
- `docs/SETUP.md`: setting up a development machine in detail. `docs/API.md`: every API route and socket event. `docs/DEPLOYMENT.md`: putting it on a server.
- `SERVICES.md`: every outside account and key, and what to look for in each.

---

## 1. Core Idea

| Discord concept | School equivalent |
|---|---|
| Server | The School |
| Server group / category | A Class (e.g. "Grade 8-A") or a Department |
| Channel | A feature space inside the class (Announcements, Attendance, Homework, Chat, Resources, Grades) |
| Member | A user with a role in that class |
| Role | Student / Parent / Teacher / Clerk / Principal / Admin |
| DM | Teacher ↔ Student, Teacher ↔ Parent private messages |

Every user sees the **same shell**. Only the content and the actions inside it change with their role.

---

## 2. Layout (Same for Every Role)

```
┌────┬──────────────┬──────────────────────────────┬─────────────┐
│ 1  │      2       │              3               │      4      │
│Rail│ Channel list │        Main content          │ Context     │
│    │              │                              │ panel       │
└────┴──────────────┴──────────────────────────────┴─────────────┘
```

1. **Left rail:** Home, each Class the user belongs to, and role workspaces (Staff Room, Admin). Parents see their child's classes plus a **child switcher** when they have more than one child.
2. **Channel list:** features available in the selected class/workspace. Built from the user's permissions, so users never see things they cannot use.
3. **Main content:** the active feature (attendance table, assignment list, fee ledger, approvals queue).
4. **Context panel:** members, details, quick actions, and notifications for the current item.

A global **command bar** (`Ctrl/Cmd + K`) searches students, classes, and features, and runs quick actions such as "Mark attendance for 8-A" or "Approve all pending leave requests".

---

## 3. Roles and Dashboards

| Role | Purpose | Home dashboard shows | Can do |
|---|---|---|---|
| **Student** | Learn and track progress | Today's timetable, pending homework, attendance %, latest marks, announcements | Submit work, view grades and fees, chat in own classes |
| **Parent** | Follow their child's school life | Child switcher, today's attendance, homework due, fee dues, latest results, teacher messages | View child's attendance, marks, timetable and report cards; pay fees; request leave for child; message teachers |
| **Teacher** | Run classes | My classes, today's periods, pending grading, low-attendance students | Mark attendance (single or bulk), post homework, enter marks (single or bulk), message class and parents |
| **Clerk** | Administrative operations | Admissions queue, fee dues, document requests, ID/certificate requests | Register students and parents, record fees (single or bulk), issue certificates (single or bulk), manage records |
| **Principal** | Run the school | School-wide attendance, results trends, staff status, **approvals queue with bulk approve/reject** | Approve leaves/results/fee waivers/admissions/role requests individually or in bulk, create classes, view all data, approve and manage user roles |
| **Admin** | System owner | Users, roles, audit log, notification settings, system health, **approvals queue with bulk approve/reject** | Create users, approve and manage user roles individually or in bulk, configure school, manage integrations |

> Admin is a **technical** role (system setup, access, audit). Principal is an **academic/operational** role. Both can approve and manage user roles (see section 5), and both get bulk approval tools (see section 6).

---

## 4. How Access Works (Permissions)

Access is based on **role + scope**, not role alone.

```
permission = resource : action : scope
```

Examples:

- `attendance:write:own_class` (Teacher)
- `attendance:read:own` (Student)
- `attendance:read:own_child` (Parent)
- `fees:write:school` (Clerk)
- `results:approve:school` (Principal)
- `results:bulk_approve:school` (Principal)
- `users:manage:school` (Admin, Principal)

**Scopes:** `own` → `own_child` → `own_class` → `school`.

A request is allowed only when:

```
allowed = hasPermission(user.role, resource, action)
          AND inScope(user, target, scope)
```

How `inScope` is evaluated:

```
own        → target.student_id == user.id
own_child  → target.student_id ∈ user.linked_student_ids
own_class  → target.class_id   ∈ user.class_ids
school     → target.school_id  == user.school_id
```

Enforce this in **two places**: the API (authoritative) and the UI (hide what is not allowed). Never rely on the UI alone. A bulk action is just the same single-item check run once per item — see section 6.

### Permission matrix (starting point)

| Feature | Student | Parent | Teacher | Clerk | Principal | Admin |
|---|---|---|---|---|---|---|
| Announcements | read | read | post (class) | post (school) | post (school) | manage |
| Attendance | read own | read child | write class (bulk) | read school | read school | read |
| Homework / Assignments | submit | view child | manage class (bulk) | – | read school | read |
| Marks / Results | read own | read child | enter class (bulk) | read | **approve (bulk)** | read |
| Fees | read own | read + pay child | – | **manage (bulk)** | approve waivers (bulk) | read |
| Admissions / Records | – | read child | read class | **manage (bulk)** | approve (bulk) | manage |
| Timetable | read own | read child | read own | read | **manage** | manage |
| Leave requests | request | request for child | request | request | **approve (bulk)** | read |
| Messaging | class chat | DM teachers | class chat + DM | DM | all | – |
| Users and roles | – | – | – | – | **approve / manage (bulk)** | **approve / manage (bulk)** |
| Notification templates and channels | own preferences | own preferences | own preferences | own preferences | read | **manage** |

---

## 5. Role Management (Admin and Principal)

Both **Admin** and **Principal** can approve and manage user roles.

```
canManageRole(actor, targetRole) = actor.role ∈ {admin, principal}
                                   AND actor.id ≠ target.user_id      // nobody edits their own role
```

### Recommended guardrail (easy to change)

To prevent privilege escalation, restrict *which* roles a Principal can grant:

| Actor | Can grant / revoke |
|---|---|
| Admin | All roles |
| Principal | Student, Parent, Teacher, Clerk |

Granting or revoking **Admin or Principal** stays with Admin only. If you want Principal to have full power, remove this restriction in `packages/permissions`.

### Role request and approval flow

```
Clerk / Teacher submits request (new staff account, role change, parent link)
   └─► user.role_requested
        └─► Admin or Principal reviews (approve / reject, with reason — one at a time or in bulk)
             └─► user.role_approved / user.role_rejected
                  └─► role applied, sessions refreshed, audit log written,
                      email sent to the user
```

### Parent–student linking

A parent gets access to a child's data only through an **approved link**:

1. Clerk creates the parent record during admission and proposes the link (`parent → student`, relationship).
2. Admin or Principal approves the link (individually, or as part of a bulk admissions approval) — this grants access to child data.
3. The system stores `user.linked_student_ids`; all `own_child` checks use it.
4. Links can be revoked at any time; access ends immediately.

---

## 6. Bulk Actions and Approvals

Nobody should have to click "approve" one item at a time when ten, fifty, or two hundred are waiting. Every approval queue and every high-volume data-entry screen supports **select multiple → act once**.

### Who gets bulk tools

| Role | Bulk actions |
|---|---|
| **Principal** | Bulk approve/reject: results, leave requests, fee waivers, admissions, role requests |
| **Admin** | Bulk approve/reject: role requests, admissions (if routed to Admin), notification template changes |
| **Teacher** | Bulk mark attendance (whole class in one action, with per-student override), bulk enter/import marks (spreadsheet-style grid or CSV), bulk assign homework to multiple classes |
| **Clerk** | Bulk record fee payments (mark multiple invoices paid), bulk issue certificates, bulk import admissions (CSV), bulk generate ID cards |

### How it works in the UI

1. Every list screen (approvals queue, attendance grid, invoice list) has row **checkboxes** and a **"select all"** control, with filters (class, date range, status) to narrow the selection first.
2. A selection bar appears with the available bulk actions (Approve, Reject, Mark Paid, Mark Present, etc.).
3. Bulk **reject** and bulk **fee waiver** always ask for one shared reason/note, stored against every affected record.
4. A confirmation step shows a count ("Approve 42 results?") before committing — no silent mass changes.
5. After the action, a **result summary** shows how many succeeded and lists any that failed (for example, a role request that changed status before the bulk action ran), so nothing is silently skipped.

### How it works in the backend

```
POST /api/{resource}/bulk-approve
{ ids: [...], decision: 'approve' | 'reject', reason?: string }
```

- The endpoint loops the same single-item permission and scope check used for one-at-a-time approval (`hasPermission` + `inScope`) — bulk is never a separate, looser code path.
- Each item still emits its normal event (e.g. `results.approved` per student) so downstream dashboards and notifications behave exactly as if each item had been approved individually.
- The **audit log** records one bulk action entry (actor, action, count, reason) plus the individual per-record entries, so both "what happened overall" and "what happened to this specific record" are answerable.
- Bulk operations run in a single database transaction per batch (chunked for very large batches) so a partial failure doesn't leave inconsistent state.

---

## 7. How Dashboards Connect

Features are connected through **events**, not by modules calling each other. A module publishes an event; other modules subscribe.

```
Teacher marks attendance (bulk) ──► attendance.marked (per student) ──► Student dashboard (attendance %)
                                                                 ├──► Parent dashboard + WhatsApp alert if absent
                                                                 ├──► Principal dashboard (school stats)
                                                                 └──► Notification (if below threshold)

Teacher enters marks ──► results.submitted ──► Principal approval queue (bulk-approvable)
Principal bulk-approves ──► results.approved (per student) ──► Student + Parent see results

Clerk bulk-records fees ──► fee.paid (per invoice) ──► Student/Parent fee status, receipt (WhatsApp + email)
Parent pays via Razorpay ──► fee.paid (same flow)
Clerk admits student ──► student.admitted ──► Auto-added to class group + parent link request + welcome message

Clerk requests role  ──► user.role_requested ──► Admin/Principal approval queue (bulk-approvable)
Admin/Principal approves ──► user.role_approved ──► Rail and channel list rebuild for that user
```

### Connection rules

1. **One source of truth per data type.** Attendance lives in the attendance module; other dashboards read it.
2. **Cross-role workflows are approval chains.** Example: Teacher (submit) → Principal (approve, single or bulk) → Student and Parent (view).
3. **Real-time updates** (WebSocket) for chat, notifications, and approval queues. Everything else can be fetched normally.
4. **Everything important is audited**, including bulk actions (see section 6).

---

## 8. Notifications (WhatsApp + Email)

Notifications are a dedicated module. Feature modules never send messages directly; they publish events, and the notification module decides **who** gets **what** on **which channel**. A bulk action publishes one event per affected record, so notification behavior never differs between a single approval and a bulk one.

```
event ──► notification rules ──► template + recipient ──► queue (BullMQ) ──► WhatsApp / Email ──► delivery log
```

### Default rules

| Trigger event | Recipients | Channel |
|---|---|---|
| `attendance.marked` (absent) | Parent | WhatsApp |
| `fee.due` / `fee.overdue` | Parent | WhatsApp + email |
| `fee.paid` | Parent, Student | Email (receipt) + WhatsApp confirmation |
| `results.approved` | Parent, Student | Email + WhatsApp |
| `announcement.posted` (urgent) | Class members + parents | WhatsApp |
| `announcement.posted` (normal) | Class members + parents | Email |
| `homework.assigned` | Student, Parent | Email |
| `leave.approved` / `leave.rejected` | Requester | WhatsApp + email |
| `user.role_approved` / `user.role_rejected` | Affected user | Email |
| `user.role_requested` | Admin, Principal | Email |

### Rules for sending

1. **Preferences:** each user can enable or disable each channel per category, and set quiet hours.
2. **Fallback:** if WhatsApp delivery fails, fall back to email.
3. **Templates:** every message is a stored template with variables (`{student_name}`, `{date}`, `{amount}`). Admin manages templates.
4. **Delivery log:** store status (queued, sent, delivered, failed) for every message.
5. **Retries:** failed sends retry with backoff, then flag for review.
6. **Bulk sends are queued, not synchronous.** A 200-item bulk approval enqueues 200 notification jobs and returns immediately; delivery happens in the background.

### WhatsApp requirements

- Use the **WhatsApp Business Platform** (Meta Cloud API directly, or through a provider).
- Business-initiated messages must use **pre-approved templates**. Submit and get every template approved before launch.
- Collect **opt-in** from parents at admission and store the consent with a timestamp.

---

## 9. Architecture

Recommended starting point: a **modular monolith** (simple to deploy, easy to split later).

```
Web (Next.js + TypeScript)  ──►  API (NestJS)  ──►  PostgreSQL
        │                            │
        └──── WebSocket ─────────────┼──► Redis (cache, pub/sub, queues)
                                     ├──► File storage (assignments, documents)
                                     └──► WhatsApp API + Email provider
```

**This is the original suggestion. See "How it is actually built" at the top of this file for what was used.**

Suggested stack:

| Layer | Choice |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind, shadcn/ui |
| Backend | NestJS, Prisma ORM |
| Database | PostgreSQL |
| Real-time | Socket.IO (or NestJS gateways) |
| Queue / cache | Redis + BullMQ |
| Auth | JWT (access + refresh) with role and scope claims |
| Payments | Razorpay (fees) |
| Notifications | WhatsApp Business Platform + email (SMTP or transactional provider) |
| Deployment | VPS with Nginx + PM2 |

### Core data model

```
School ── Class ── ClassMember (user, role_in_class)
   │         └── Channel (type: announcements | attendance | homework | chat | ...)
   ├── User (role: student | parent | teacher | clerk | principal | admin)
   │     └── ParentStudentLink (parent_id, student_id, relationship, status, approved_by)
   ├── RoleRequest (target_user, requested_role, status, requested_by, decided_by, reason)
   ├── AcademicYear ── Term
   ├── Attendance (student, class, date, status, marked_by)
   ├── Assignment ── Submission
   ├── Exam ── Mark ── ResultApproval
   ├── FeeStructure ── Invoice ── Payment
   ├── Notification ── NotificationLog (channel, status)
   ├── NotificationTemplate, NotificationPreference, WhatsAppConsent
   ├── BulkActionLog (actor, resource, action, record_ids, reason, result_summary)
   └── AuditLog
```

Every table carries `school_id` from day one (see section 13).

### Folder structure

```
/apps
  /web                    # Next.js app (the dashboard shell)
  /api                    # NestJS app
/packages
  /ui                     # Shared components (Rail, ChannelList, DataTable, BulkSelectionBar)
  /permissions            # Role/permission definitions shared by web and api
  /events                 # Event names and payload types shared by web and api
  /features               # One folder per feature module
    /attendance
    /homework
    /results
    /fees
    /admissions
    /announcements
    /chat
    /notifications
    /user-roles
```

---

## 10. How to Add a New Feature

Every feature is a **self-contained module** described by a manifest. The shell reads manifests to build navigation, routes, and permissions automatically, so new features look and behave like existing ones without touching the shell.

### Step 1: Define the manifest

```ts
// packages/features/library/manifest.ts
import { FeatureManifest } from '@school/features-core';

export const libraryFeature: FeatureManifest = {
  key: 'library',
  label: 'Library',
  icon: 'book',
  channelType: 'library',            // shows up as a channel inside a class or workspace
  placement: ['class', 'staff'],     // where it appears
  routes: { base: '/library' },
  permissions: [
    'library:read:own',
    'library:read:own_child',
    'library:write:school',
    'library:bulk_write:school',
  ],
  roles: {
    student:   ['library:read:own'],
    parent:    ['library:read:own_child'],
    teacher:   ['library:read:own'],
    clerk:     ['library:read:own', 'library:write:school', 'library:bulk_write:school'],
    principal: ['library:read:own'],
  },
  emits:     ['library.book_issued', 'library.book_overdue'],
  listensTo: ['student.admitted'],
  notifications: [
    { event: 'library.book_overdue', to: ['student', 'parent'], channels: ['email', 'whatsapp'] },
  ],
  dashboardWidgets: ['library-due-books'],
};
```

### Step 2: Checklist

1. **Database:** add Prisma models with `school_id`; run the migration.
2. **API module:** controller, service, DTOs; guard every route with the permission decorator, including a bulk endpoint if the feature has a queue or list of items to act on.
3. **Permissions:** register the new permissions in `/packages/permissions`, including a `bulk_*` permission where relevant.
4. **Events:** declare the events in `/packages/events` and publish or subscribe. Bulk actions still emit one event per record.
5. **UI:** build the page using shared components from `/packages/ui`, including the shared `BulkSelectionBar` if the list can be multi-selected.
6. **Dashboard widgets:** register small cards for each role's home screen.
7. **Register the manifest** in the feature registry.
8. **Notifications:** add the notification rules and templates (WhatsApp templates need Meta approval before use).
9. **Audit:** log create/update/delete/approve actions, and a `BulkActionLog` entry for any bulk operation.
10. **Tests:** permission tests (each of the 6 roles allowed/denied), API tests, a bulk-action test (partial failure included), one end-to-end flow.

### Definition of done for any feature

- [ ] Appears only for roles that have permission
- [ ] Parent access limited to linked children
- [ ] Uses the shared shell, components, and empty/loading/error states
- [ ] Every API route is permission- and scope-checked, bulk endpoints included
- [ ] Emits/handles events instead of calling other modules directly
- [ ] Notification rules and templates defined (if the feature notifies anyone)
- [ ] Works on mobile
- [ ] Actions and bulk actions are audited
- [ ] Has at least one dashboard widget or a clear entry point

---

## 11. User-Friendly Design Rules

1. **One shell, many roles.** Same layout, same shortcuts, same components for everyone.
2. **Show only what matters.** The channel list contains only allowed features; no greyed-out clutter.
3. **Home is a to-do list, not a report.** Each role's home shows "what needs my action today" first.
   - Student: homework due, low attendance warning
   - Parent: child's attendance today, fees due, new results
   - Teacher: attendance not yet marked, submissions to grade
   - Clerk: pending admissions and fee dues
   - Principal and Admin: approvals waiting, with a one-click "select all" on the queue
4. **Two clicks to common tasks.** Marking attendance, posting homework, recording a fee, and paying a fee should each be reachable in two clicks or one command-bar action.
5. **Bulk by default on queues.** Any screen that lists more than a handful of similar items (approvals, invoices, attendance) gets checkboxes and a bulk action bar, not just a single-item action link.
6. **Clear status language.** Use consistent badges: Draft, Submitted, Approved, Rejected, Paid, Overdue.
7. **Fast feedback.** Optimistic updates, toasts, and undo where safe. Bulk actions show a progress/result summary, never a silent spinner.
8. **Mobile first for students, parents, and teachers.** The rail collapses to a bottom bar; the context panel becomes a drawer. Parents will mostly arrive from a WhatsApp link, so deep links must open the right page after login.
9. **Accessible.** Keyboard navigation, readable contrast, dark and light themes, and support for local languages.
10. **Never dead-end.** Every empty state explains what the page is for and offers the next action.

---

## 12. Key Flows

**Admit a student**
Clerk creates the student and parent records and proposes the parent link → Principal or Admin approves the admission and link (individually or as part of a bulk admissions approval) → accounts are created → student is added to the class group → parent's WhatsApp opt-in is recorded → welcome message posts in the class chat and goes to the parent.

**Daily attendance**
Teacher opens Attendance channel → marks class in one bulk action (default all present, override individual students) → saves → student, parent, and principal dashboards update → parents of absent students get a WhatsApp alert.

**Results publishing**
Teacher enters marks (bulk grid or CSV import) → submits → Principal reviews the queue and either approves individually or selects all and bulk-approves → results become visible to students and parents → both are notified.

**Fee collection**
Clerk records payments one at a time or bulk-marks a batch of invoices paid, or the parent pays via Razorpay → invoice(s) marked paid → receipts sent by email and WhatsApp.

**Change a user's role**
Clerk or Teacher submits a role request → Admin or Principal approves or rejects with a reason, one at a time or as a bulk decision on a filtered list → roles apply immediately → users are notified by email → audit log records the decision (bulk entry + per-user entries).

---

## 13. Multi-School (built)

The platform hosts many schools. This section was written as a set of rules to keep the door open; the door is now open, and the rules
still hold.

1. **`school_id` on every table** and in every query. A test fails if a new table is added without saying how it belongs to a school.
2. **Unique constraints include `school_id`** where it matters (the same email can exist at two schools).
3. **No hardcoded school data.** Name, tagline, accent colour and logo live in the database and are edited by the school's admin.
4. **Each school has its own address** (`greenfield.example.com`, or `/?school=greenfield` without subdomains) and its own sign-in page.
5. **A Super Admin role sits above Admin.** It is created at start from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`, lives in a hidden platform school, and
   can create, suspend and delete schools and add admins, but can never read any school's own records.
6. **Plans and billing.** The super admin defines plans (student limit and monthly price), gives one to each school and records the payments received.
   A school cannot go over its student limit, and cannot add students once its plan has been expired for two weeks.
7. **A school can export its own data** (admin only, one file, no passwords or private messages), and the super admin can permanently delete a suspended school
   and everything it owns, including stored files.

Not done: subscriptions paid online (payments are recorded by hand), and users who belong to more than one school with one login.

---

## 14. Suggested Build Order

| Phase | Scope |
|---|---|
| **1. Foundation** | Auth, 6 roles and permissions, shell layout (rail, channels, context panel), classes and members, user and role management with approval flow (Admin, Principal), bulk approve/reject on the role-request queue, parent–student linking, audit log |
| **2. Daily academics and alerts** | Announcements, class chat, attendance (bulk marking), homework and submissions, timetable, **notification service (email first, then WhatsApp)** |
| **3. Assessment** | Exams, marks entry (bulk/CSV), approval workflow with bulk approve, report cards |
| **4. Operations** | Admissions (bulk import), student records, fees and payments (Razorpay, bulk mark-paid), certificates (bulk issue) |
| **5. Leadership** | Principal analytics, approvals center (all queues bulk-enabled), leave management (bulk approve) |
| **6. Polish** | Command bar, CSV import/export, PWA, performance, and optional multi-school support (section 13) |

Start WhatsApp template approval with Meta during phase 1, since approval can take time.

---

## 15. Getting Started

```bash
# install
pnpm install

# start Postgres (Docker)
docker compose up -d

# environment: copy the example, then set real values for anything you use
cp .env.example .env

# database: apply migrations and load demo data
pnpm db:migrate
pnpm db:seed              # a school, one user per role, a sample class and a parent-child link

# run
pnpm dev                  # web on :3000, api on :4000

# tests
pnpm --filter @school/api test     # API (creates and removes its own database)
pnpm --filter @school/web test     # web app
```

`.env.example` lists every setting with a comment. The ones you need to run locally are `DATABASE_URL`, `JWT_SECRET` and `JWT_REFRESH_SECRET`.
Everything else turns a feature on: SMTP settings for email, WhatsApp settings, Razorpay keys and webhook secret, `S3_*` for a file bucket,
`CLAMAV_HOST` for virus scanning, and `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` for the platform's super admin. A feature whose settings are empty stays off.

Seeded demo logins (all `password123`): `student@`, `parent@`, `teacher@`, `clerk@`, `principal@`, `admin@school.test`. **Remove them and the demo data before any real launch.**
For a fuller walk-through see `docs/SETUP.md`.

---

## 16. Conventions

- **Naming:** events are `resource.action` (`attendance.marked`); permissions are `resource:action:scope`, bulk variants are `resource:bulk_action:scope`.
- **No cross-module imports.** Modules talk through events and shared packages only.
- **Every query is scoped by `school_id`** and by the user's scope, including inside a bulk operation's per-item check.
- **Parent access always goes through approved links**, never by matching names or phone numbers.
- **Shared types** for permissions and events live in `/packages`, used by both web and api.
- **Pull requests** must include the feature checklist from section 10.

---

## 17. Decisions Made

- Six roles: Student, Parent, Teacher, Clerk, Principal, Admin. **Board has been removed** — no Board dashboard, permissions, or events.
- Parent has read access to linked children, fee payment, leave requests, and teacher messaging.
- Launch is a single school; multi-school comes later (section 13).
- Notifications use WhatsApp and email at launch.
- Admin and Principal can both approve and manage user roles, individually or in bulk.
- Principal and Admin get bulk approve/reject on every approval queue (results, leave, fee waivers, admissions, role requests).
- Teachers and Clerks get bulk actions on their high-volume tasks (attendance, marks entry, fee recording, certificate issuance, admissions import).

- **Multi-school was built after launch scope** (section 13): many schools, a super admin who cannot read school data, plans and manual billing, per-school export and deletion.
- **Files** go to local disk or an S3-compatible bucket behind one small storage layer; private messages, passwords and stored files are never part of a school export.
- **Languages** are built into the app (English, Hindi, Telugu, Tamil, Marathi, plus partial Haryanvi and Sanskrit layers over Hindi). English text in the code is the key, so anything untranslated shows in English.
- **Accessibility** is checked automatically (axe on the main pages, contrast for every theme and wallpaper) but still needs a hands-on screen-reader pass.

The planning above was the starting point. `PROGRESS.md` is the working log and is kept up to date; this file's top section is the summary.
