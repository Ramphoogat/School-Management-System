# API reference

_Generated from the controllers by `node scripts/gen-api-docs.mjs`. Do not edit by hand; change the code or the script and run it again._

## How the API works

- **Base address:** `http://localhost:4000/api` in development. Every path below starts with `/api`.
- **Format:** JSON in and out. File uploads use `multipart/form-data`. Errors look like `{ "statusCode": 400, "message": "…" }`, where `message` may be a list for validation errors.
- **Signing in:** `POST /api/auth/login` returns `accessToken` and `refreshToken`. Send `Authorization: Bearer <accessToken>` on every other call. When a call returns 401, `POST /api/auth/refresh` with the refresh token gives a new pair.
- **Who may call what:** the **Permission** column is a `resource:action` pair from `packages/permissions`. It is checked by the server on every call, together with scope (own class, own children, whole school). Routes marked _checked in code_ decide inside the handler, for example "the class teacher only". A dash means the route has no permission of its own: any signed-in person may call it, and the service narrows what they get (their own class, children or school). **Public** routes need no sign-in.
- **Schools:** every signed-in call is limited to the caller's own school. The Super Admin only reaches `/api/platform`.
- **Lists:** the audit log takes `page` and `pageSize`. Students, admissions, invoices, certificates and leave are cut off at the school's list size (School branding → Long lists); students, admissions and invoices send the real total in the `X-Total-Count` header.
- **Bulk actions** take a list of ids and return `{ succeeded, total, failed: [{ id, error }] }`. One bad row never blocks the others.
- **Live events:** Socket.IO on the same address and port, authenticated with `auth: { token }`. See the last section.

## academic

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/academic` | — |  |
| POST | `/api/academic/years` | `academic:manage` | Body: `PeriodDto` |
| POST | `/api/academic/years/:id/current` | `academic:manage` |  |
| DELETE | `/api/academic/years/:id` | `academic:manage` |  |
| POST | `/api/academic/years/:id/terms` | `academic:manage` | Body: `PeriodDto` |
| DELETE | `/api/academic/terms/:id` | `academic:manage` |  |
| GET | `/api/academic/grade-scale` | — |  |
| PUT | `/api/academic/grade-scale` | `academic:manage` | Replaces the whole scale. Grades already shown on report cards change with it, since they are worked out when viewed. Body: `ScaleDto` |
| DELETE | `/api/academic/grade-scale` | `academic:manage` | Back to the built-in scale. |

## admissions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/admissions` | _checked in code_ | Query: `status` |
| POST | `/api/admissions` | `admissions:write` | Body: `AdmissionDto` |
| POST | `/api/admissions/import` | `admissions:bulk_write` | Bulk import from CSV rows. Every row is validated and reported; good rows are not blocked by bad ones. Body: `ImportDto` |
| POST | `/api/admissions/bulk-approve` | `admissions:bulk_approve` | Body: `BulkDecideDto` |
| POST | `/api/admissions/:id/decide` | `admissions:approve` |  |

## announcements

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/announcements` | _checked in code_ | Query: `classId` |
| PUT | `/api/announcements/:id` | _checked in code_ | Fixes the wording. People are not sent it again, and it is marked "edited" so nobody is misled. Body: `UpdateAnnouncementDto` |
| DELETE | `/api/announcements/:id` | _checked in code_ | Removes it for everyone. Messages already sent stay in inboxes; the audit log keeps the title. |
| POST | `/api/announcements` | _checked in code_ | Body: `PostAnnouncementDto` |

## attendance

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/attendance/class/:classId` | _checked in code_ | Roster with the day's marks (unmarked students have status null). Query: `date` |
| POST | `/api/attendance/class/:classId/bulk` | _checked in code_ | Bulk marking: same per-student check, one audit entry per student plus a bulk entry. Body: `BulkMarkDto` |
| GET | `/api/attendance/student/:studentId` | _checked in code_ | Attendance summary for one student. Student: own. Parent: linked child. Staff: school. |
| GET | `/api/attendance/student/:studentId/calendar` | _checked in code_ | One month for the calendar: the student's daily marks, leave requests that touch the month, and what the school said that month (class and school-wide announcements with who wrote them, and homework). Same access as the summary. Query: `month` |

## audit

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/audit` | `audit:read` | Query: `page`, `pageSize` |

## auth

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | **Public** | Body: `LoginDto` |
| POST | `/api/auth/refresh` | **Public** | Body: `RefreshDto` |
| POST | `/api/auth/change-password` | — | Body: `ChangePasswordDto` |
| GET | `/api/auth/me` | — |  |

## billing

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/school/billing` | `billing:read` |  |

## certificates

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/certificates/bulk-issue` | `certificates:bulk_write` | Issues certificates for many students in one action. Each student is checked and numbered separately. Body: `BulkIssueDto` |
| GET | `/api/certificates` | _checked in code_ | Student: own. Parent: linked child. Staff with school read: all (filter by studentId). Query: `studentId` |
| GET | `/api/certificates/:id` | — |  |
| GET | `/api/certificates/:id/pdf` | — | The certificate as a downloadable PDF. |

## chat

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/chat/:classId/members` | — |  |
| GET | `/api/chat/:classId` | — | Query: `before`, `channelId` |

## classes

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/classes` | _checked in code_ | Staff-level roles see every class; others see classes they belong to or their linked children's classes. |
| GET | `/api/classes/:id/members` | _checked in code_ | Who is in the class, who is the class teacher, and who could still be added. |
| POST | `/api/classes/:id/members` | `classes:write` | Adds students and teachers. Each person joins with their own role; anyone already in the class is skipped. Body: `AddMembersDto` |
| DELETE | `/api/classes/:id/members/:userId` | `classes:write` |  |
| PUT | `/api/classes/:id/class-teacher` | `classes:write` | Sets (or clears) the class teacher. The teacher is added to the class if they are not already in it. Body: `ClassTeacherDto` |
| PUT | `/api/classes/:id/monitor` | _checked in code_ | Only a teacher of this class picks the class monitor (admins and principals cannot). The monitor must be a student in the class; null clears it. Body: `MonitorDto` |
| POST | `/api/classes/:id/channels` | _checked in code_ | Adds a custom text channel (like chat, with its own messages). Voice channels are created from the voice page. Body: `ChannelDto` |
| DELETE | `/api/classes/:id/channels/:channelId` | _checked in code_ | Only custom text channels can be removed; the standard ones stay. Their messages go with them. |
| POST | `/api/classes` | `classes:write` | Body: `CreateClassDto` |

## documents

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/documents` | _checked in code_ |  |
| POST | `/api/documents` | _checked in code_ | Body: `UploadMeta` |
| GET | `/api/documents/:id/file` | _checked in code_ |  |
| DELETE | `/api/documents/:id` | _checked in code_ |  |

## exams

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/exams` | _checked in code_ | Body: `CreateExamDto` |
| GET | `/api/exams` | _checked in code_ | Exams for a class. Teachers and staff see every status; students and parents only see approved results. Query: `classId` |
| DELETE | `/api/exams/:id` | _checked in code_ | Query: `reason` |
| GET | `/api/exams/queue` | `results:approve` | Approval queue for principal (school scope). Query: `status` |
| POST | `/api/exams/bulk-approve` | `results:bulk_approve` | Body: `BulkDecideDto` |
| POST | `/api/exams/:id/decide` | `results:approve` |  |
| GET | `/api/exams/:id/marks` | _checked in code_ |  |
| PUT | `/api/exams/:id/marks` | _checked in code_ | Bulk enter or import marks. Only while the exam is draft or was rejected. Body: `SetMarksDto` |
| POST | `/api/exams/:id/submit` | _checked in code_ |  |
| GET | `/api/results/student/:studentId` | _checked in code_ | Report card: approved results only. Student: own. Parent: linked child. Staff with school read: any student. Query: `termId` |
| GET | `/api/results/student/:studentId/pdf` | _checked in code_ | The same report card as a downloadable PDF. Query: `termId` |

## fees

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/fees/config` | _checked in code_ |  |
| GET | `/api/fees/invoices` | _checked in code_ | Student: own. Parent: linked children. Staff with school read: everything (filterable). Query: `classId`, `studentId`, `status` |
| POST | `/api/fees/invoices` | `fees:bulk_write` | Creates one invoice per student in a class (bulk). Students who already have this fee title are skipped. Body: `CreateInvoicesDto` |
| POST | `/api/fees/bulk-pay` | `fees:bulk_write` | Body: `BulkPayDto` |
| POST | `/api/fees/invoices/:id/pay` | `fees:write` |  |
| POST | `/api/fees/invoices/:id/request-waiver` | `fees:write` | Body: `WaiverRequestDto` |
| GET | `/api/fees/waivers` | `fees:approve` | Query: `status` |
| POST | `/api/fees/waivers/bulk-approve` | `fees:bulk_approve` | Body: `WaiverDecideDto` |
| POST | `/api/fees/reminders/run` | `fees:bulk_write` | Runs the reminder check now. The hourly job does the same automatically; nothing is sent twice. |
| POST | `/api/fees/invoices/:id/refund` | `fees:refund` | Refund a paid invoice, in full or in part. Online payments go back through Razorpay; anything paid at the office is recorded as handed back. Several partial refunds can follow one another until the whole payment has been returned; the invoice becomes "refunded" only then. The student and parents are told each time. Body: `RefundDto` |
| POST | `/api/fees/invoices/:id/online-order` | — | Step 1: create a Razorpay order for an invoice the parent may pay. |
| POST | `/api/fees/invoices/:id/online-verify` | — | Step 2: after checkout, verify the signature server-side and only then mark the invoice paid. Body: `VerifyDto` |
| POST | `/api/fees/razorpay/webhook` | **Public** | Body: `any` |

## homework

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/homework` | _checked in code_ | Assignments for a class. Student: own class. Parent: linked child's class. Teacher: own class. Staff: school. Query: `classId` |
| POST | `/api/homework` | _checked in code_ | Bulk assign to several classes. Each class is checked independently. Body: `AssignDto` |
| POST | `/api/homework/:id/submit` | _checked in code_ | Body: `SubmitDto` |
| GET | `/api/homework/:id/submissions` | _checked in code_ |  |
| POST | `/api/homework/:id/files` | _checked in code_ | Attach a file. A teacher of the class attaches to the assignment; a student of the class hands in against their own submission (created empty if they have not written anything yet). |
| GET | `/api/homework/files/:fileId` | _checked in code_ |  |
| DELETE | `/api/homework/files/:fileId` | _checked in code_ | The uploader or the class's teacher can remove a file. |

## idcards

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/id-cards/bulk` | `idcards:bulk_write` | Card data for many students at once (the page lays them out for printing). Students outside the school are reported, not dropped silently. Body: `BulkIdCardsDto` |
| GET | `/api/id-cards/photos` | `idcards:bulk_write` | Which students have a photo (and a version to bust caches when it changes). |
| PUT | `/api/id-cards/photo/:studentId` | `idcards:bulk_write` |  |
| GET | `/api/id-cards/photo/:studentId` | _checked in code_ |  |
| DELETE | `/api/id-cards/photo/:studentId` | `idcards:bulk_write` |  |

## insights

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/approvals/summary` | _checked in code_ | Approvals center: every queue the user can act on, in one place. |
| GET | `/api/home/todo` | _checked in code_ | Home is a to-do list: what needs this user's action today. |
| GET | `/api/analytics/overview` | _checked in code_ | Principal/admin dashboard numbers. |

## leave

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/leave` | _checked in code_ | Body: `RequestLeaveDto` |
| GET | `/api/leave` | — | Approvers and admin see the school's requests; everyone else sees requests they made or that are for their children. Query: `status` |
| GET | `/api/leave/:id` | — |  |
| POST | `/api/leave/:id/messages` | — | Body: `MessageDto` |
| POST | `/api/leave/bulk-approve` | `leave:bulk_approve` | Body: `BulkDecideDto` |

## links

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/links` | _checked in code_ |  |
| POST | `/api/links` | `admissions:write` | Body: `ProposeLinkDto` |
| POST | `/api/links/:id/approve` | `admissions:approve` |  |
| POST | `/api/links/:id/revoke` | `admissions:approve` |  |

## messages

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/messages/contacts` | `messages:write` | Query: `q` |
| GET | `/api/messages/unread` | `messages:write` |  |
| GET | `/api/messages/conversations` | `messages:write` |  |
| POST | `/api/messages/conversations` | `messages:write` | Open (or create) the conversation with someone. Starting one needs the rules above. Body: `StartDto` |
| GET | `/api/messages/conversations/:id` | `messages:write` | Query: `before` |
| POST | `/api/messages/conversations/:id/read` | `messages:write` |  |
| POST | `/api/messages/conversations/:id/attachments` | `messages:write` | Upload a file for the next message. It stays private to the conversation and is not shown until the message is sent. |
| DELETE | `/api/messages/attachments/:attachmentId` | `messages:write` | Take back a file that was uploaded but not yet sent. |
| GET | `/api/messages/attachments/:attachmentId` | _checked in code_ | The two people in the conversation can download its files. A reviewer can too, but only for a conversation they may review, and it is recorded. |
| POST | `/api/messages/conversations/:id` | `messages:write` | Body: `SendDto` |
| PUT | `/api/messages/message/:messageId` | `messages:write` | The sender can fix a message for 15 minutes. It is marked "edited" so nobody is misled. Body: `EditDto` |
| DELETE | `/api/messages/message/:messageId` | `messages:write` | The sender can delete a message any time. The text and files are erased and a "deleted" placeholder stays. |
| GET | `/api/messages/blocks` | `messages:write` |  |
| POST | `/api/messages/blocks` | `messages:write` | Stops them messaging you, and you messaging them, until you unblock. The school's leaders cannot be blocked. Body: `BlockDto` |
| DELETE | `/api/messages/blocks/:userId` | `messages:write` |  |
| POST | `/api/messages/conversations/:id/report` | `messages:write` | Filing a report is what lets the school read this one conversation. The other person is not told who reported. Body: `ReportDto` |
| GET | `/api/messages/reports` | `messages:moderate` | Query: `status` |
| GET | `/api/messages/reports/:reportId` | `messages:moderate` | Opens one reported conversation. Reading it is recorded in the audit log. |
| PUT | `/api/messages/reports/:reportId` | `messages:moderate` | Body: `ReviewDto` |

## notifications

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/notifications` | _checked in code_ |  |
| POST | `/api/notifications/:id/read` | _checked in code_ |  |
| GET | `/api/notifications/channels` | _checked in code_ | Channels the platform can actually deliver on, so the UI can say so. |
| GET | `/api/notifications/preferences` | _checked in code_ |  |
| PUT | `/api/notifications/preferences` | _checked in code_ | Body: `PrefDto` |
| PUT | `/api/notifications/profile` | _checked in code_ | Phone number and WhatsApp opt-in (consent is stored with a timestamp). Body: `ProfileDto` |
| GET | `/api/notifications/quiet-hours` | _checked in code_ |  |
| PUT | `/api/notifications/quiet-hours` | _checked in code_ | Body: `QuietDto` |
| GET | `/api/notifications/templates` | — | Every notification the school sends, with its wording, the placeholders it allows, and whether the admin changed it. |
| PUT | `/api/notifications/templates/:event/:variant` | — | Body: `TemplateDto` |
| DELETE | `/api/notifications/templates/:event/:variant` | — |  |
| GET | `/api/notifications/log` | — | Delivery log for admins. |

## platform

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/tenant/:slug` | **Public** |  |
| GET | `/api/tenant/:slug/logo` | **Public** |  |
| GET | `/api/school` | — |  |
| PUT | `/api/school/list-limit` | `branding:manage` | The most rows a long list (students, invoices, admissions, certificates, leave) sends at once. Body: `ListLimitDto` |
| PUT | `/api/school/branding` | `branding:manage` | Body: `BrandingDto` |
| PUT | `/api/school/logo` | `branding:manage` |  |
| DELETE | `/api/school/logo` | `branding:manage` |  |
| GET | `/api/platform/schools` | `schools:manage` |  |
| GET | `/api/platform/schools/:id` | `schools:manage` |  |
| POST | `/api/platform/schools` | `schools:manage` | Creates a school and its first admin. The admin's one-time password is shown once. Body: `CreateSchoolDto` |
| PATCH | `/api/platform/schools/:id` | `schools:manage` | Body: `UpdateSchoolDto` |
| POST | `/api/platform/schools/:id/admins` | `schools:manage` | Another admin for a school, for example when the first one has left. Body: `AdminDto` |
| POST | `/api/platform/schools/:id/admins/:userId/reset-password` | `schools:manage` |  |
| GET | `/api/platform/plans` | `schools:manage` |  |
| POST | `/api/platform/plans` | `schools:manage` | Body: `PlanDto` |
| PATCH | `/api/platform/plans/:id` | `schools:manage` | Body: `UpdatePlanDto` |
| DELETE | `/api/platform/plans/:id` | `schools:manage` |  |
| POST | `/api/platform/schools/:id/payments` | `schools:manage` | A payment received from a school. It pays for the next months, counted from when the current period ends (or from today if it has run out). Body: `PaymentDto` |
| GET | `/api/platform/schools/:id/payments` | `schools:manage` |  |
| DELETE | `/api/platform/schools/:id` | `schools:manage` | Permanently deletes a school and everything it owns: people, classes, records, messages and stored files. It cannot be undone, so the school must be suspended first and its address typed out. The super admin still cannot read any of it. A record of the deletion (name, address, how many rows) is kept in the platform's own log. Body: `DeleteSchoolDto` |

## resources

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/resources/class/:classId` | _checked in code_ |  |
| POST | `/api/resources/class/:classId` | _checked in code_ |  |
| GET | `/api/resources/files/:id` | _checked in code_ |  |
| DELETE | `/api/resources/files/:id` | _checked in code_ | The class's teacher removes files. |

## role-requests

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/role-requests` | `role_requests:approve` | Query: `status` |
| GET | `/api/role-requests/mine` | — |  |
| POST | `/api/role-requests` | — | Body: `CreateRequestDto` |
| POST | `/api/role-requests/bulk-approve` | `role_requests:bulk_approve` | Body: `BulkDecideDto` |
| POST | `/api/role-requests/:id/decide` | `role_requests:approve` | Body: `DecideDto` |

## school-data

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/school/export` | `school:export` |  |

## students

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/students` | _checked in code_ | Student records: class and approved parents. For roles that manage admissions or records. Query: `q`, `classId` |

## timetable

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/timetable/me` | _checked in code_ | The user's own timetable: student's class, parent's children's classes, teacher's teaching slots, staff: everything. |
| GET | `/api/timetable/class/:classId` | _checked in code_ |  |
| PUT | `/api/timetable/class/:classId` | `timetable:write` | Replaces a class's whole timetable in one transaction. Body: `SetTimetableDto` |

## users

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/users/directory` | _checked in code_ | Lightweight lookup for forms (role requests, parent links). |
| GET | `/api/users` | _checked in code_ |  |
| POST | `/api/users` | `users:manage` | Creates a person with a one-time temporary password they must change at first sign-in. Body: `CreateUserDto` |
| PATCH | `/api/users/:id` | `users:manage` | Body: `UpdateUserDto` |
| PUT | `/api/users/:id/role` | `users:manage` | Changes a role directly (the request queue is still there for people asking for themselves). Anything tied to the old role is cleaned up: class membership, parent links, class teacher and monitor. Body: `RoleDto` |
| POST | `/api/users/:id/deactivate` | `users:manage` | Blocks sign-in and every existing session straight away. History is kept. |
| POST | `/api/users/:id/reactivate` | `users:manage` |  |
| POST | `/api/users/:id/reset-password` | `users:manage` | New one-time password, shown once. They must change it at next sign-in. |

## voice

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/voice/class/:classId` | _checked in code_ |  |
| POST | `/api/voice/class/:classId` | _checked in code_ | Body: `CreateChannelDto` |
| DELETE | `/api/voice/:id` | _checked in code_ |  |
| GET | `/api/voice/:id/notes` | _checked in code_ | Private notes: each person has their own per channel and nobody else can read them. |
| PUT | `/api/voice/:id/notes` | _checked in code_ | Body: `NoteDto` |

## Live events (Socket.IO)

Connect to the API address with `io(url, { auth: { token: accessToken } })`. A bad token is disconnected at once. Each event below is sent by the client; the server answers with an acknowledgement `{ ok, … }` where it says so.

### ChatGateway
_Source: `apps/api/src/chat/chat.module.ts`_

| Event | Notes |
|---|---|
| `set_status` |  |
| `join` |  |
| `leave` |  |
| `message` |  |

### MessagesGateway
_Source: `apps/api/src/messages/messages.module.ts`_

| Event | Notes |
|---|---|
| `dm:typing` | "Is typing…": only ever passed to the other person in that conversation, and at most once a second per person. |

### VoiceGateway
_Source: `apps/api/src/voice/voice.module.ts`_

| Event | Notes |
|---|---|
| `voice:join` |  |
| `voice:leave` |  |
| `voice:signal` | Relays a WebRTC offer, answer or ICE candidate to one specific person in the same call. |
| `voice:state` | Mic, camera and screen-share status, so everyone can show the right icons. |
| `voice:moderate` | Moderation: someone who manages the class (its teacher, clerk, principal, admin) can mute or remove another person in the call. Muting switches their microphone off (they can turn it back on). Removing ends their call and keeps them out for a few minutes. A person who could moderate cannot be moderated, and nobody moderates themselves. |

Events the server sends include `voice:peer-joined`, `voice:peer-left`, `voice:peer-state`, `voice:signal`, `voice:muted`, `voice:removed`, `voice:closed` (voice calls), plus chat, direct-message, presence and "screen changed" notices. See the gateway source files for the exact payloads.
