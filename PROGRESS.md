# School Management Platform: Progress and To-Do

Last updated: 30 Sep 2026 (night). Companion files: `README.md` (the plan and current status), `SERVICES.md` (accounts, keys and what to look for), `docs/SETUP.md` (new developer guide), `docs/API.md` (every API call), `docs/DEPLOYMENT.md` (going live).

---

## 1. What this is

A web platform with a Discord-style workspace: each class is a group with channels, and six roles
(Student, Parent, Teacher, Clerk, Principal, Admin) see the same shell with different content.
The plan in `README.md` had six phases. All six are built to a working first version, plus extras (voice, direct messages,
ID cards, user and class-member management, fee reminders and refunds). The gaps are listed in section 5.

### Latest updates (since the 29 Sep version of this file)
- **School plans and billing:** the super admin defines plans (student limit, monthly price), gives one to each school, and records payments received; each school sees its plan and usage, admins and principals get a banner when it is ending, and adding students is refused past the plan's limit or once it has been expired for two weeks.
- **A school's own data export** (admin only, one file, private messages and passwords left out) and **permanent deletion of a school** (super admin only, after suspending it, address typed to confirm, every row and stored file removed, a record kept in the platform log). A test fails if a new table is added without saying how it belongs to a school.
- **S3/R2 file storage** (set `S3_BUCKET`), with the request signing checked against Amazon's own published example.
- **Wallpapers can no longer make text unreadable:** the app measures the picture and the theme's text colour and enforces the least dimming that keeps text at 4.5:1.
- **Translation across the app** (about 650 strings in five languages, plus partial Haryanvi and Sanskrit layers), done with a codemod and a checker script so it stays complete.
- **Partial refunds**, academic years and terms, a configurable grade scale, school-wide documents, class resources, homework files and optional virus scanning.
- **Multi-school platform:** a Super Admin (created at API start from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`) creates schools with a first admin, suspends and restores a school, adds admins and resets their passwords. Each school has its own sign-in address (`?school=` link or subdomain) and the same email can exist at two schools. The Super Admin cannot see any school's records. A school's admin sets its name, tagline, brand colour and logo, shown on the sign-in page.
- **Languages:** Hindi, Telugu, Tamil, Marathi, Haryanvi (partial) and Sanskrit (partial) besides English (see section 5B for what is and is not translated).
- **Accessibility pass:** automated audit clean on the main pages, and every theme palette is checked for contrast.
- **PDFs:** certificates and report cards download as real PDF files.
- **ID card photos:** a photo can be added and cropped per student.
- **Direct messages** between teachers and students, and teachers and parents (plus clerk and principal).
- **Class members and user management screens** (the biggest gap in the last version is closed).
- **Fee reminders, full refunds and a Razorpay webhook.**
- **ID cards** (bulk), **custom text channels** with icons, **online presence** and a members panel, **class monitor**.
- **Responsive pass:** notifications card fixed, tables become cards on phones, dialogs scroll, everything checked down to 320px wide.
- **Sign-in always starts at Home** (a remembered page is only used for a real deep link, never after a sign-out).
- **Timetable rebuilt:** one grid per class, teacher clash checks.
- **Tests:** the API suite has 27 files and 345 tests (344 passed in the last full run; the one that failed is a timing test that passes on its own), the web app has 61 tests in 9 files (all passing), and every API run uses its own database and build folder.

## 2. How it is built

| Part | Choice |
|---|---|
| Web | Vite 7, React 19, TypeScript, Tailwind v3, shadcn/ui, react-router 7, recharts, socket.io-client (it is a single-page app, not Next.js) |
| API | NestJS 10, Prisma 6, PostgreSQL 16, Socket.IO, nodemailer |
| Shared | `packages/permissions` (roles, permissions and scope checks used by web and API), `packages/db` (Prisma schema, migrations, seed) |
| Tooling | pnpm workspace, Docker for Postgres, Mailpit (local test inbox), Vitest |

```
apps/web        the web app            apps/api       the NestJS API
packages/permissions                   packages/db    schema, migrations, seed
```

**Run it:** `docker compose up -d`, then `pnpm dev` (web on :3000, API on :4000).
**Tests:** `pnpm test` inside `apps/api` (or `pnpm test test/messages.test.ts` for one file). Each run creates its own
temporary database and compiled copy of the app, then removes them, so several runs can go at once.
Demo logins (all `password123`): `student@`, `parent@`, `teacher@`, `clerk@`, `principal@`, `admin@school.test`.
**These and their data must be removed before launch.**

## 3. What is done

### Foundation (Phase 1)
- Login with access and refresh tokens; role and class scope are re-read from the database on every request, so a role change or deactivation applies immediately. Signing in always starts at Home.
- Six roles with `resource:action:scope` permissions, enforced on the API (authoritative) and used by the UI to hide what a role cannot use.
- Discord-style shell: rail, channel list, main area, context panel. Dark and light themes, and an appearance dialog.
- **Top bar** on every page: the school name and logo (back to Home), where you are (for example "Grade 8-A › homework"), search (Ctrl/Cmd+K), a messages shortcut with its unread count, a notification bell (recent alerts, unread count, mark one or all read) and an account menu (status, settings, appearance, log out). It stays visible while a page loads. On phones it shrinks to the logo, the page name and four icons.
- Role requests: clerk or teacher submits, principal or admin approves or rejects. Includes the "principal cannot grant admin or principal" guardrail and "nobody edits their own role".
- **Bulk approve and reject** on every queue: one shared reason, a count confirmation, a per-item result summary, and one audit entry per record plus one for the bulk action.
- Parent–student links (propose, approve, revoke). A parent sees only approved links.
- **User management (admin only):** create a person with a one-time temporary password, edit details, change role as a separate step, deactivate and reactivate (blocks sign-in and every session at once), reset a password. The school can never be left without an active admin.
- **Class members:** add and remove students and teachers, choose the class teacher, and a teacher of the class picks the class monitor. A members panel shows who is online.
- Classes (create), audit log (paged), change-password, temporary-password banner.
- **Delete and restore a class (1 Oct):** only the principal and admin get a Delete button on each class (Classes page). It first asks for confirmation ("Delete Grade 8-A? … Nothing is erased. You can restore it at any time"), then shows a confirmation message with an Undo for 10 seconds. A deleted class is a recycle-bin delete: it vanishes at once from every list and from its students', teachers' and parents' access, but its members, channels, homework, marks, books and chat are kept. Below the class list a "Deleted classes" section (same two roles only) shows what was deleted, by whom, when and how many members, with a Restore button that brings it back exactly as it was. Nobody can add homework, exams, fees or admissions to a deleted class, and the school overview does not count it. A deleted class keeps its name, so creating a new class with that name says "was deleted, restore it or choose another name". Deleting and restoring are in the audit log. **Written but NOT yet run or looked at:** 13 API tests and 6 web tests exist for it, but no commands were run when it was built (by request), so they have never been executed, and the new database columns need the migration and a regenerated Prisma client before it works. Known limits: the principal, admin and clerk can still reach a deleted class's records by direct address (only its own members lose access), and it cannot be permanently erased from the app.
- **Custom text channels** in a class (with an icon picker); the standard channels stay.
- **Online presence:** who is online right now, with an "invisible" option.

### Daily academics (Phase 2)
- Announcements per class and school-wide, with the **sender choosing the channels** (email, WhatsApp, in-app).
- Attendance with bulk marking (whole class in one save, per-student override), student and parent views, low-attendance flag, and a month calendar of school days.
- Homework and submissions, including bulk assign to several classes. **Page redesigned (1 Oct):** a student sees a summary row (all, to do, overdue, handed in) that doubles as filters, then the work as cards with a coloured edge and a plain due label ("Due tomorrow", "Overdue by 2 days"), a short description with "Show more", the teacher's files, and a "Start your work" panel to write an answer, attach files and hand in or update. To-do work is listed first, most urgent on top. A teacher sees each assignment with a progress bar ("1 of 4 handed in"), a "See who handed in" list, and a "New homework" button that opens the form (title and instructions on one side, due date, classes and how to notify on the other).
- Timetable: a grid per class (including classes with none yet), colour-coded subjects, a teacher's own schedule, and an editor with live checks. The server refuses overlapping periods and a teacher booked in two classes at once.
- Class chat (live, Socket.IO). **Fix (1 Oct, not yet run):** the chat, messages, presence and voice connections used the stored sign-in token as it was, which lasts only 15 minutes, so a page left open for a while connected with a dead token and the chat sat on "Connecting…" forever. They now fetch a fresh token on every connection attempt (`freshAccessToken` / `socketAuth` in `apps/web/src/lib/api.ts`), and the chat shows the real reason when it cannot work ("Could not reach the chat server", "Your sign-in has expired", "Your role cannot use the chat in this class") with a Try again button. Only the student, teacher and principal can use class chat; the admin and clerk have no chat permission (by the current permission table), so for them the chat cannot work. Written without running anything; 7 web tests exist for the token helper but have never been executed.
- **Direct messages:** private one-to-one conversations with live delivery, an unread badge, a pop-up when a message arrives, and a Messages page that works on phones. Who may start a conversation follows the plan: teachers with their own students and those students' parents (plus the principal and clerk), students and parents with the teachers of their class, the clerk with parents, students, teachers and the principal, the principal with everyone except the admin. The admin has no messaging. Either person can keep replying only while the relationship still holds (for example a revoked parent link ends it, and the history stays readable). One in-app alert per sender until read, and a limit of 30 messages a minute per person.
- Notification service: events published by features, delivery through a background worker with retry and backoff, a WhatsApp-to-email fallback, per-person channel preferences, WhatsApp opt-in with a stored consent, and an admin delivery log.

### Assessment (Phase 3)
- Exams and marks: bulk grid, CSV import, absent marking, score limits.
- Submit for approval (every student needs a mark), then marks lock. The principal bulk approves or sends back with a reason.
- Students and parents see results only after approval. Report cards with percent, grade and overall total, printable and downloadable as PDF.

### Operations (Phase 4)
- Admissions: single entry and CSV import (bad rows reported, good rows kept). Bulk approval creates the student and parent accounts, joins the class, approves the parent link, and records WhatsApp consent. Siblings share one parent account. Temporary passwords are shown once and never stored.
- Student records page (search, class, parents).
- Fees: bulk invoice creation per class, filters (including overdue), bulk mark-paid with method and reference, receipts, waiver requests with principal bulk approval (a shared note is required), and Razorpay online payment with server-side signature verification. A calculator sits on the Fees page for quick sums.
- **Fee reminders:** an hourly job sends a "due soon" and an "overdue" reminder to the student and parents, once per stage per invoice. The overdue reminder repeats weekly and stops after four. Paid, waived and waiver-pending fees are skipped. The clerk can also run it on demand.
- **Refunds:** principal and admin refund a paid invoice in full or in part (several partial refunds until the payment is all returned; the invoice becomes refunded only then; two at once cannot over-refund). Online payments are sent back through Razorpay; office payments are recorded as handed back. Student and parents are told.
- **Razorpay webhook:** settles an invoice if the browser never came back, is safe to receive twice, flags a wrong amount or a second different payment, and updates a refund when Razorpay reports it processed or failed. Needs `RAZORPAY_WEBHOOK_SECRET`.
- Certificates: bulk issue with sequential numbers, printable view and PDF download.
- ID cards: clerk picks students, generates cards in bulk (school, name, class, stable card number, guardian) and adds and crops a photo per student, and prints the sheet.
- Homework files: teachers attach files to assignments, students hand in files (PDF, PNG, JPG, DOC, DOCX, TXT, up to 100 MB, 5 per person per assignment). Stored on disk under `UPLOAD_DIR`; downloads are permission-checked (student, their parents, class teacher, staff).
- **Books channel (1 Oct):** every class has a books channel, next to resources. The class's teacher, the clerk, the principal and the admin add books (a PDF, Word file, text file or picture up to 100 MB, with a title, author and short description; up to 100 per class; the teacher only to their own class, the others to any class) and can remove them. The class's students see them as cover cards and can read (opens a PDF or picture in a new tab) or download them. The principal or admin can open "Who can use it" on a book and withdraw it from one student (with an optional reason) or give it back; that student still sees the book, locked, with a message, cannot open or download it, and the others are not affected. Parents do not see books. Existing classes got the channel through the migration, and new classes get it automatically. Every add, removal, withdrawal and give-back is in the audit log. Covered by 16 API tests (who can add, see, read, withdraw and remove, across classes and schools) and 9 web tests; **the screens were not looked at in a browser** (by request: no dev server was run), and file storage was only the local test folder, not the R2 bucket.
- **Google Drive as extra storage (1 Oct):** besides the main storage (disk or the R2 bucket) the school can connect Google Drive (a service account, which works with or without Google Workspace, or a person's own sign-in). Every stored file is now recorded with where it is (a new table), so reading and deleting find it; existing files count as main storage. A new **Storage** page (workspace menu; clerk, principal and admin only) shows the room used in the main storage and in Drive, lets the school choose where its new files go (**Automatic**: main storage first, switching to Drive by itself when the main storage reaches `STORAGE_PRIMARY_LIMIT_GB` or refuses a file; **Main storage only**; **Google Drive only**), refuses to pick Drive while it is not connected, records each change in the audit log, and has a **Run the test** button for both places. School logos always stay in the main storage. Each school chooses for itself. Files are never moved automatically.
- **Add a file from a link (1 Oct):** everyone who may upload except students gets a **From a link** button beside the upload button for school documents, class resources, books (a "From this device / From a link" choice in the form) and teacher homework attachments. Supported: Google Drive files (a private one is read with the school's Drive account if shared with it), Google Docs/Sheets/Slides (saved as PDF), Dropbox, OneDrive/SharePoint, GitHub files and direct links. A round **?** button beside it explains which sources work, how to get a usable link, what does not work and, when Drive is connected, which address to share a private Drive file with. The server fetches the file with the same rules as an upload (type, size 100 MB, virus scan, audit), refuses private and internal addresses (and checks every redirect), and refuses students. There is no in-app Google Drive file picker; Drive files are added by pasting their share link.
- **Status of both:** written without running anything. API tests (`storage-drive.test.ts`, `link-import.test.ts`) and web tests (`storage-links.test.tsx`) were written but **never executed**, and the code was never compiled or type-checked; nothing was tried against real Google, Dropbox or OneDrive; the screens were not looked at. The migration `20261001120000_storage_drive` (two tables, plus recording the files already stored) and a regenerated database client are needed first. **Security note:** while setting this up I found the real R2 access key and secret pasted into `.env.example` (a file meant to be committed); I blanked them there. If that file was ever committed, shared or pushed, treat the key as leaked and replace it in Cloudflare.
- Resources channel: each class has a shared documents area. The class teacher uploads and removes files; students, parents of the class, and school staff download. Same file rules as homework (PDF, images, Word, text, 100 MB), up to 100 files per class.
- School documents: clerk, principal and admin publish forms, circulars and policies; everyone in the school downloads them.
- Welcome message: when a student is admitted, the class main chat gets "Welcome to the class, <name>!" posted under the name of whoever approved the admission, live for anyone with the chat open.
- Languages: English, Hindi, Telugu, Tamil, Marathi. Chosen on the sign-in page or in Appearance and remembered on the device; the browser language is used the first time. Dictionaries load on demand. The page language is set for screen readers.
- Accessibility review: automated audit (axe-core, WCAG 2 A/AA plus best practice) of home, fees, students, users, admissions, timetable, analytics, documents, settings and class pages (homework, chat, attendance) now reports no violations. Fixed: landmarks and a skip link, page titles that change per page, keyboard-reachable scrolling tables and expandable fee rows, names for dropdowns and date fields, an actions label on empty table headers, and Escape closing the mobile menu. Theme colours are now fitted for contrast (text 4.5:1, form outlines 3:1) at every hue; `pnpm --filter @school/web check:contrast` verifies all 720 generated palettes.
- Virus scanning: optional, through a ClamAV daemon. Set CLAMAV_HOST (and CLAMAV_PORT) and every upload (homework, resources, documents, message attachments) is scanned before it is stored; infected files are blocked and uploads are refused while the scanner is down. Off by default. Running ClamAV itself is up to whoever hosts the app.
- Academic years and terms (principal/admin set them up; one year is current; terms cannot overlap). New exams join the term their date falls in, and report cards can be filtered by term. Grade scale is configurable per school (principal/admin), with the standard A+ to F scale as the default; changing it updates every report card because grades are worked out when viewed.
- Phone numbers are entered with a country code.

### Leadership (Phase 5)
- Leave: request (a parent chooses a linked child), principal bulk approve or reject, requesters notified, and a conversation attached to each request.
- School overview (principal and admin): attendance today and 14-day trend, results by subject, fee collection, low-attendance students.
- Approvals center: every queue in one place. Home is a per-role to-do list (including unread messages).

### Polish (Phase 6)
- Command bar (Ctrl/Cmd+K): pages, class quick actions, student search, theme, sign out.
- CSV export (students, fees, attendance, audit log) and CSV template downloads. Cells are protected against spreadsheet formula injection.
- Installable app (PWA manifest, icons, service worker, offline banner).
- Performance: pages load on demand (first load about 424 KB, down from 964 KB).
- **Menu on small screens (1 Oct):** below the desktop width the narrow rail (Home and the classes) is always shown, and a slim handle tab fixed to the menu's edge, halfway down the screen, extends the workspace list right beside it (its arrow flips to close it). On a tablet (768 px and wider) the list pushes the page over and stays open while you move around; on a phone it opens over the page, which dims (tap it to close), and it closes at once when you choose a page or press Escape. There is no hamburger bar or pop-up drawer any more. Looked at in the browser at phone (375 px), tablet (768 px) and desktop (unchanged) sizes; not tried on a real phone or tablet, and no automated test covers it.
- **Small screens:** every data table becomes labelled cards on phones (with "Select all" kept for bulk actions), dialogs have a maximum height and scroll, and heights use the visible screen. Scanned at 320, 375 and 768px wide for all roles with no overflow found.

### Added beyond the original plan
- **Multi-school (Super Admin):** the platform owner creates schools (name, address slug, first admin), suspends or restores a school (everyone there is locked out at once, other schools untouched), adds admins and resets their passwords, and sees only people counts, never names or records. Nobody can create a Super Admin from inside a school. A school's admin edits its branding (name, tagline, colour, logo); the sign-in page shows the school's own look. Covered by 19 API tests.
- **Voice channels** in each class: the class teacher, clerk, principal and admin create many channels. Students and teachers talk, use their camera and share their screen. Private notes are saved automatically per person. Peer-to-peer WebRTC, up to 8 people per channel.
- **Voice moderation:** the class teacher, clerk, principal and admin can mute anyone in a call (the person is told and can unmute) or remove them (kept out of that channel for 5 minutes). Managers cannot be moderated and nobody moderates themselves. The server enforces it, and each action is audited. Covered by 3 new API tests.
- **Speaking indicators:** a green ring appears on the tile of whoever is talking (measured in the browser from the audio level; screen shares are ignored). Covered by 4 web tests of the level logic only.
- Sound cues for mute and unmute, camera on and off, sharing start and stop, and joining or leaving (yours and other people's).

### Quality
- **Automated API tests:** 393 tests in 30 files (full run on 1 Oct: all passed except one timing-sensitive typing-indicator test that failed once and then passed on two reruns). They include the books tests (16), security tests (18), password reset (10), list totals and size (7) and multi-school. They cover each role allowed and denied, bulk partial failure, audit trails, cross-school isolation, notification delivery, retry and fallback, direct-message rules, fee reminders and refunds, real socket connections for chat, voice and messages, and Razorpay signature and webhook handling. The web app typechecks clean.
- Two deliberately broken security rules were caught by the tests (a check that the tests would fail when they should).
- Bugs the tests and manual checks found and fixed: a database and app clock offset that could delay a queued message, socket origins read before `.env` loaded, a stale-build problem, a sign-out leaving the next person on the previous page, and test runs interfering with each other (each run now compiles into its own folder and uses its own database, so several runs, or another session working in the repo, cannot interfere).

## 4. What has NOT been verified

Be careful with these: they are built but were never proven against the real thing.

| Item | Status |
|---|---|
| WhatsApp sending | Code written and tested with a fake sender only. Never run against Meta. Needs credentials and an approved message template. |
| Razorpay | Signature check, refunds and webhook tested against a stand-in, not the real service. Order creation, checkout, real refunds and the webhook were never run (no keys). |
| Real email provider | Verified only against the local Mailpit inbox, not a real SMTP service. |
| Voice with real devices | Tested in two browser tabs using synthetic microphone, camera and screen sources. No real hardware, no different networks, no TURN relay. |
| Direct messages | Tested by the API tests and one browser session (the other person simulated through the API). Not tried with two real people on two devices. |
| Fee reminder job | The hourly schedule was not watched running; the reminder logic is tested by running it directly. |
| PWA service worker | Manifest and worker syntax checked. The test browser refuses service workers, so install and offline were never seen working. |
| Voice moderation and speaking rings | Server rules are tested with real socket connections. The buttons and the green ring were never seen in a real call: no browser check, no real microphone. |
| Sound cues | Confirmed they run and schedule different notes; nobody has listened to them yet. |
| CSV exports | Buttons render and compile; a downloaded file has not been opened. |
| Real phones | The layout was scanned in an emulated phone window only; no real phone, and no landscape check. |
| Newer screens | Class members, user management, custom channels, presence and the attendance calendar are covered by API tests where noted above, but their screens were not re-checked by hand in this update. |
| Multi-school | Covered by API tests (not re-run now). The Super Admin screens, school branding and per-school sign-in address were not checked by hand, and subdomain routing was never tried on a real domain. |
| PDFs and ID card photos | Written and compiled; a downloaded PDF and an uploaded photo were not opened and checked by eye. |
| Books channel and the new homework page | Written and tested with automated tests only. Nobody has opened them in a browser or on a phone: the layout, the cover colours, the dialog and the dimmed states have not been seen. Books were not tried with real PDFs through the R2 bucket. |
| Web app automated tests | 38 tests in 6 files (`apps/web/test`) cover the API client, helpers, language switcher, pager, and the whole app against a stand-in API: sign-in (wrong password, wrong role, deep link), which roles can open which pages, the super admin's landing page, and sign-out starting the next person at Home. Fees, attendance and other screens are not tested, and nothing runs in a real browser. |

## 5. What is left to do

### A. Before any real launch (blockers)
1. **Remove demo data and demo logins** (users, the sample class, test students, invoices, certificates, leave, exams, the test conversation).
2. **Real services:** an SMTP provider; Meta WhatsApp credentials plus template approval (start early, it can take days); Razorpay test keys and the webhook secret, then live keys after KYC. See `SERVICES.md` (now covers the webhook secret, the hourly reminder job, file storage, virus scanning, multi-school and a full list of settings).
3. **Security review** (use the pre-launch audit skill). Done so far (30 Sep evening): sign-in lockout (10 wrong passwords per email and 60 per network address in 15 minutes, plus 5 wrong current-password tries on a password change), no timing or lockout difference between real and unknown emails, refresh tokens re-check the person and school, and every token of a person can be ended at once (password change or reset, deactivation, and a "Sign out of all devices" button in Settings); security headers on every API response; the API refuses to start in production (`NODE_ENV=production`) with short, placeholder or equal JWT secrets, a demo Super Admin password, or a localhost/http `WEB_ORIGIN`. Self-service "Forgot your password?" is built: an emailed one-time link (valid 60 minutes, only the newest link works, only a hash is stored, the answer is identical for known and unknown addresses, 3 requests an hour per address and 20 per network), and using it signs the person out everywhere. It is tested with a fake mailer only: **never sent through a real email provider, and the email's wording and spam-folder behaviour have not been seen.** A Content-Security-Policy is written for Nginx (`docs/DEPLOYMENT.md` section 8, to be started in report-only mode); enforced against the built app in a real browser it produced no violations on sign-in, ten main screens, every class channel and the appearance dialog, but **Razorpay's payment window was never tried under it**, and it has not been run on a real server. Still open: no email verification, no two-factor sign-in, no per-device session list, the limiter lives in one server's memory (resets on restart, needs Redis for several servers), and no penetration test or outside review. Do not call the security review finished.
4. **Deployment:** server or VPS, HTTPS (also required for camera, microphone and PWA), production database with backups, process manager, environment validation, logging and error monitoring. Move `WEB_ORIGIN` to the real address.
5. **TURN server** for voice, or expect some networks to fail to connect.
6. **WhatsApp opt-in and templates:** confirm the wording of every template Meta must approve.
7. **Direct-message oversight is built** (a report lets the principal read that one conversation, and it is audited). Decide whether that policy suits your school before students can message teachers privately.

### B. Missing features from the plan (`README.md`) and gaps in new ones
Checked against the code and tests on 30 Sep (a longer list that used to be here is now built: direct-message attachments, edit and delete, read receipts and typing, email and WhatsApp copies, block and report with principal review, "which child" labels; quiet hours, the message-wording screen, urgent wording and live queue updates; leave counting in attendance; announcement edit and delete; exam delete; S3/R2 file storage; school plans, billing, data export and deleting a school).
- **Upload size is 100 MB** for homework, resources, books, documents and message attachments (changed from 10 MB on 1 Oct; one setting, `MAX_FILE_BYTES`). Not yet tried with a real 100 MB file through a browser, Nginx or the R2 bucket. Each upload is held in the API's memory while it is handled, so several large uploads at once need spare RAM; Nginx needs `client_max_body_size 105m`; and if ClamAV is used its `StreamMaxLength` (default 25 MB) and `CLAMAV_TIMEOUT_MS` must be raised or large files are refused. See `docs/DEPLOYMENT.md` section 15 and `SERVICES.md` 4b. ID card photos were raised from 1 MB to 10 MB and school logos from 500 KB to 5 MB (also 1 Oct; `MAX_PHOTO_BYTES` and `MAX_LOGO_BYTES`, with the logo screen's check and its text, and the translations, updated to match). ID photos are still cropped and shrunk in the browser, so real ones stay small; a 5 MB logo would slow the public sign-in page. Written without running anything: the two tests that check the oversize refusal (photo over 10 MB, logo over 5 MB) were adjusted but not run.
- **Books:** no editing of a title after adding (remove and add again); no notice goes to students when a book is added or withdrawn; withdrawal is one book and one student at a time (no "all books for this student" shortcut); parents cannot see a child's books.
- **School plans are billed by hand.** The platform records payments it receives (bank, UPI, cash, cheque) and extends the school's paid-up date. There is no online payment or invoice for the schools' own subscriptions, and the plan limits only cap the number of students (and block adding students once a plan has been expired for two weeks). Nothing else is switched off for an unpaid school.
- **A school's data export is one JSON file** of its records. It leaves out passwords, private messages and stored files (files can still be downloaded one by one). There is no export of the files themselves and no import back into another school.
- **Moving files from disk to a bucket is manual:** when `S3_BUCKET` is turned on, files already in `UPLOAD_DIR` are not copied over; copy them into the bucket under the same names. The S3 client was tested against Amazon's published signing example and a stand-in server, not a real bucket.
- **Virus scanning** is built but was tested only against a fake ClamAV server, and someone still has to run ClamAV.
- **Translation coverage:** English, Hindi, Telugu, Tamil, Marathi, and partial Haryanvi and Sanskrit layers (on top of Hindi). About 650 strings are translated in each: every screen's fixed text, menus, buttons, headings, empty states and toasts. Still in English: messages that come from the server (notifications, the to-do list, error text), a few sentences mixed with links, and some date formats. **The translations were written without a native-speaker review**, and Haryanvi and Sanskrit in particular are first drafts. Adding a language or a string means editing files in `apps/web/src/lib/i18n/`; `node scripts/i18n-check.mjs --strict` (in `apps/web`) lists anything missing and `node scripts/i18n-codemod.mjs` wraps new English text for translation.
- **Accessibility, still to do:** a hands-on screen-reader pass (NVDA/VoiceOver) and a check with a real keyboard-only user. The automated audit (axe) is clean on the pages that were audited, every theme palette and wallpaper is checked for contrast (`pnpm --filter @school/web check:contrast`), but automated checks cannot judge reading order or whether a screen makes sense when read aloud.

### C. Engineering and quality
- Web app tests: in place (Vitest, jsdom, Testing Library; run `pnpm test` in `apps/web`, 61 passing, including sign-in and role-access flows). Still to do: tests for the fee, attendance, homework and messages screens, end-to-end flows in a real browser, and running all tests in CI on every change.
- Replace the in-process notification queue (a database table polled by the API) and the in-process hourly reminder job with Redis and BullMQ once volume grows or more than one API server runs (otherwise two servers would both send reminders).
- Voice: a media server (for example LiveKit) if calls need more than 8 people (needs a hosted server; not started). Moderation and speaking indicators are built (see section 3, Added beyond the plan).
- Time zones: dates are stored and compared as UTC calendar days; decide the school time zone.
- Pagination and filtering: checked. The audit log is paged by the server. Every other long list is paged only in the browser, after the server has sent it, and the server cuts several lists off silently: students 300, admissions 500, invoices 500, certificates 300, leave requests 300, role requests 500. For students, admissions and invoices the server now also sends the real total and the screen shows a warning ("Showing the first 300 of 812") with the student count corrected, so nothing looks complete when it is not. The admin can now change the cut-off size (100 to 5000 rows, default 500) under School branding, "Long lists"; it applies to students, admissions, invoices, certificates and leave requests, and each change is audited. Verified with 7 API tests (only the admin can change it, range 100 to 5000, audited, applied to the lists, other schools unaffected); the migration was applied to the dev database. Not looked at in a browser. Still open: real server-side paging with "select all matching" for bulk actions (a bulk approve or mark-paid only acts on the rows loaded), and the same warning for certificates, leave and role requests. Search and class filters already work on the server.
- Rate limiting, request logging and audit-log filters and search.
- Documentation: written. `docs/SETUP.md` (new developer guide), `docs/API.md` (all routes and socket events, generated from the code by `node scripts/gen-api-docs.mjs`; re-run it when routes change), `docs/DEPLOYMENT.md` (server, Nginx, HTTPS, backups, updates, rollback) and the `SERVICES.md` entries. **The setup guide's steps were not followed on a clean machine, and the deployment runbook was never run on a real server;** both are written from reading the code, so expect to correct them the first time. The API reference lists each route's permission from its decorator; routes marked "checked in code" decide inside the handler and need reading the source for the exact rule, and it does not describe request or response fields beyond the input class name. Gaps the runbook records: no health-check route, no monitoring or error tracking, JWT secrets are not checked for strength, and per-school subdomains need the API to accept them in `WEB_ORIGIN`.
- Clean up: two dev-only allowances in `.env` and the test-only `NOTIFICATIONS_WORKER=off` switch are documented in code, but review them before production.

### D. Suggested next steps, in order
1. Wire up a real email provider and test end to end (also exercises reminders and receipts).
2. Security review, remaining part: an outside review, trying the password reset email through the real provider from step 1, and trying a Razorpay test payment under the Content-Security-Policy. Lockout, token revocation, headers and the reset link are built (section 5A).
3. WhatsApp templates submitted to Meta; test with Meta's test number. Razorpay test keys, webhook secret and a real test payment and refund.
4. Real-device test of voice, camera, screen share, direct messages on two phones, and the PWA install.
5. File storage: **Cloudflare R2 is the recommended choice** (no download fees; steps in `SERVICES.md` 4b). **Done (1 Oct):** the Cloudflare R2 bucket `school-files` and its token exist, the five `S3_*` values are in the local `.env`, and `storage:check` passed against the real bucket. **Still to do:** restart the API and try a real upload and download of each kind (homework file, resource, document, message attachment, ID photo, logo); copy existing files with `storage:migrate` when a server has any (the dev folder had none); keep a second copy of the bucket (R2 has no versioning); put the same settings in the production server's `.env`. Then, if wanted, run ClamAV.
6. Deployment, backups, monitoring; then remove demo data and launch a pilot with one class.

## 6. Notes on work outside this log
Some changes were made by you or by another session working in the same project while these updates were written: the Discord-style rail and sidebar, the theme palette and appearance dialog, the members panel and presence, user management, class members and monitor, custom channels, fee reminders, refunds and the webhook, ID cards, the calculator and the paginated audit log. They are in the code and their API behaviour is covered by the test suite. This file describes them from reading the code and tests, not from having built them in this session.

---

## Demo logins (local testing only)

Every account below has the password `password123`. On the sign-in page, pick the matching role first, then enter the email and password. (Locally, clicking a role button also fills these in for you.)

| Role | Email | Password |
|---|---|---|
| Student | `student@school.test` | `password123` |
| Parent | `parent@school.test` | `password123` |
| Teacher | `teacher@school.test` | `password123` |
| Clerk | `clerk@school.test` | `password123` |
| Principal | `principal@school.test` | `password123` |
| Admin | `admin@school.test` | `password123` |
| Super Admin | `superadmin@school.test` | `password123` |

Notes:
- The six school roles belong to the seeded "Demo School" (`pnpm db:seed` creates them). The Super Admin is created when the API starts, from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` in `.env`. It has no role button: leave the role unselected on the general sign-in page (no `?school=` address) and enter its email and password.
- Other demo people that exist in the dev database (for example Asha Rao and Ben Roy) were created through admissions and use their own temporary passwords, not `password123`.
- These are test credentials for a local database. Change or remove them, and set a strong `SUPERADMIN_PASSWORD`, before any real deployment.
