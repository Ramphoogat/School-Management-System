# Services, Tools and Keys

What this project uses, what needs an account or API key, and where to find it.
Everything marked **Required** is needed to run the app. Everything marked **Optional** is only
needed for that feature. All settings live in the root `.env` file (copy `.env.example`).

---

## 1. Quick summary

| Thing | Needed? | Needs an account or key? | Status in the app |
|---|---|---|---|
| Node.js + pnpm | Required | No | In use |
| PostgreSQL (via Docker) | Required | No (local password only) | In use |
| JWT secrets | Required | No, you make them up | In use |
| Email (SMTP) | Optional | **Yes**, an SMTP provider | Built and tested (with a local test mail catcher) |
| WhatsApp Business Cloud API | Optional | **Yes**, a Meta account | Built, **not tested against Meta** (no credentials yet) |
| Redis | Optional, later | No | **Not used yet** |
| Razorpay (online fee payment, refunds, webhook) | Optional | **Yes**, a Razorpay account | Built; signature check, refunds and webhook tested against a stand-in, **not tested against Razorpay** (no keys yet) |
| File storage (uploads) | Required (disk) or optional (bucket) | Disk: no. S3, R2 etc.: **yes**, a bucket and keys | Built. Local disk by default; S3-compatible bucket if `S3_BUCKET` is set. Bucket mode **not tested against a real provider** |
| Virus scanning (ClamAV) | Optional | No account; you run the scanner | Built; off unless `CLAMAV_HOST` is set. **Not tested against a real ClamAV** |
| TURN relay (voice) | Optional, likely needed | **Yes**, a provider or your own server | Wiring built; **never tried with a real relay** (section 10) |
| Super Admin and multi-school | Required for the platform owner | No, two settings in `.env` | Built and tested (section 11) |
| Domain name, server and HTTPS | Required for going live | Yes | See `docs/DEPLOYMENT.md` |

---

## 2. Required to run

### Node.js and pnpm
- Node 22 or newer, and pnpm 10 (`npm i -g pnpm`).
- No account or key.

### PostgreSQL
- The database. Runs in Docker from `docker-compose.yml` (`docker compose up -d`).
- No key. The local login is `school` / `school`, which is only for your own machine.
- `.env`: `DATABASE_URL=postgresql://school:school@localhost:5432/school`
- **For production:** use a managed Postgres (Neon, Supabase, AWS RDS, or your own server), set a strong
  password, and put its connection string in `DATABASE_URL`.

### JWT secrets (login tokens)
- Two long random strings that sign login tokens. You generate them; nothing to sign up for.
- `.env`: `JWT_SECRET` and `JWT_REFRESH_SECRET`
- Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- **Production:** use different, long, secret values. Anyone who has them can forge logins.

### Other required settings
- `UPLOAD_DIR` is the folder where uploaded files are stored when no bucket is configured (default `./uploads`). Back it up
  together with the database. See section 4b.
- `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` create the platform owner's account the first time the API starts (see section 11).
- `PORT` is the API port (default 4000).
- `WEB_ORIGIN` is the web app's address, used for CORS and chat (default `http://localhost:3000`).
  Use a comma-separated list for more than one.
- `VITE_API_URL` (in `apps/web/.env`) is the API address the browser calls (default `http://localhost:4000`).

---

## 3. Optional: Email (SMTP)

Sends announcements, homework alerts and the email fallback for WhatsApp.
**If `EMAIL_HOST` is empty, email is switched off** and email messages show as *failed* in the
Delivery log with the reason "Email is not configured".

You need an **SMTP provider**. Any of these work:

| Provider | Where to get the details |
|---|---|
| Gmail (small scale, testing) | Google Account → Security → 2-Step Verification → **App passwords**. Host `smtp.gmail.com`, port 587 |
| Brevo (free tier) | brevo.com → SMTP & API → SMTP. Host `smtp-relay.brevo.com`, port 587 |
| SendGrid / Mailgun / Amazon SES / Resend | The provider's SMTP settings page |

`.env`:
```
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-smtp-username
EMAIL_PASSWORD=your-smtp-password-or-app-password
EMAIL_FROM="School <no-reply@yourschool.com>"
```
- For real use, send from a domain you own and set up SPF/DKIM with your provider, or emails land in spam.
- **Testing without a real provider:** a local mail catcher (Mailpit) is running in Docker on SMTP port 1025
  with a web inbox at http://localhost:8025. Your current `.env` points at it
  (`EMAIL_HOST=localhost`, `EMAIL_PORT=1025`). Start it again with
  `docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`.
  **Remove those lines before going live.**

---

---

## 3b. Optional: Razorpay (online fee payment)

Lets parents pay an invoice online from the Fees page. **If the keys are empty, the "Pay online" button is
replaced by "Pay at the school office"**, and the clerk can still record cash, UPI, card, bank or cheque
payments and bulk mark invoices paid.

Steps:
1. Create an account at razorpay.com.
2. Dashboard → Settings → **API Keys** → Generate **Test Key** (start here). You get a Key ID and a Key Secret.
3. Put them in `.env`, restart the API. Never put the secret in the web app or commit it.
4. To go live, complete Razorpay's business verification (KYC), then generate **Live** keys and swap them in.

`.env`:
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
```
How it works (so you know what to look for): the API creates an order with Razorpay, the parent pays in
Razorpay's window (loaded from checkout.razorpay.com), and the API then checks Razorpay's signature on the
server before marking the invoice paid. The invoice is never marked paid from the browser alone.
Razorpay test cards and UPI ids are listed in their docs. Payments are in INR. Razorpay charges a fee per transaction.

### Webhook (needed so a payment is never lost)
If a parent pays but closes the browser before it returns to the app, only the webhook can tell the app the money arrived.
Set it up in the Razorpay dashboard: **Settings -> Webhooks -> Add new webhook**.
- **URL:** `https://YOUR-API-HOST/api/fees/razorpay/webhook` (it must be reachable from the internet over HTTPS; for local
  testing use a tunnel such as ngrok).
- **Secret:** a long random string you make up. Put the same value in `.env` as `RAZORPAY_WEBHOOK_SECRET` and restart the API.
  **Without it the API refuses every webhook call.**
- **Events to tick:** `payment.captured`, `order.paid`, `refund.processed`, `refund.failed`.
- What it does: marks the invoice paid if the browser never came back, is safe to receive twice, flags a wrong amount or a
  second different payment for a person to look at, and updates a refund when Razorpay reports it processed or failed.
- Check it: Razorpay dashboard -> Webhooks -> your webhook -> recent deliveries should show `200`.
- Never run against the real Razorpay yet; test it with test-mode keys first.

### Refunds
The principal and admin can refund a paid invoice in full or in part from the Fees page. Online payments are sent back through
Razorpay (using the same key pair); office payments are recorded as handed back. Razorpay may keep its own transaction fee on a
refunded payment. This has **not been run against Razorpay** yet.

### Fee reminders (the hourly job)
No account or key. Inside the API, a job runs **every hour between 08:00 and 20:00 server time** and sends a "due soon" and an
"overdue" reminder to the student and parents (email or WhatsApp, following their settings), once per stage per invoice; the
overdue reminder repeats weekly and stops after four. Paid, waived and waiver-pending fees are skipped. The clerk can also run it
by hand from the Fees page.
- `.env`: `FEE_REMINDERS=off` switches the job off. Use it on any second copy of the API, or two servers would both send.
- It uses the **server's clock and time zone**, so set the server to the school's zone.
- Reminders need working email (or WhatsApp) to reach anyone; failures show in the Delivery log.

## 4. Optional: WhatsApp (Meta WhatsApp Business Cloud API)

Sends urgent alerts and absence alerts. **If the two required values below are empty, WhatsApp is off**
and those messages fall back to email automatically.

Steps, in order:
1. Create a **Meta Business account** at business.facebook.com and verify your business.
2. Go to developers.facebook.com → create an app → add the **WhatsApp** product.
3. In the app's WhatsApp → API Setup page you will find:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - a **temporary access token** (lasts about 24 hours; for real use create a **System User permanent
     token** in Business Settings → Users → System users) → `WHATSAPP_ACCESS_TOKEN`
4. Add and verify the real sending phone number (the test number only messages numbers you add by hand).
5. **Create a message template** in WhatsApp Manager → Message templates:
   - Category: *Utility*
   - Body text with one variable, for example: `School update: {{1}}`
   - Wait for Meta to approve it (minutes to a few days).
   - Put its name in `WHATSAPP_TEMPLATE_NAME` (and language code in `WHATSAPP_TEMPLATE_LANG`, e.g. `en`).

`.env`:
```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=          # not used by the app yet: replies from WhatsApp are not received
WHATSAPP_TEMPLATE_NAME=school_notification
WHATSAPP_TEMPLATE_LANG=en
```
Things to know:
- **Templates are mandatory.** WhatsApp only allows business-started messages through approved templates.
  The app sends your template with the whole message in `{{1}}`. If the template does not exist or is not
  approved, Meta rejects the send and the app falls back to email.
- **Opt-in is mandatory.** The app only sends WhatsApp to people who saved a phone number and switched on
  WhatsApp in **Notification settings**. The consent is stored with a time.
- Meta charges per conversation after a free monthly allowance. Check current pricing on Meta's site.
- This part has **not been run against Meta yet**. Expect to test with the API Setup test number first.

---

## 4b. Optional: File storage (disk or a bucket)

Homework files, class resources, school documents, message attachments, ID card photos and school logos are stored through one
small piece of code (`apps/api/src/storage/storage.ts`). Files are always checked first: only PDF, images, Word and text files
up to 10 MB are accepted, and the file's real content must match its name.

**Option A, this server's disk (the default, no account).** Files go into `UPLOAD_DIR` (default `./uploads`).
- On a real server set it to a folder outside the code, for example `UPLOAD_DIR=/var/lib/school-uploads`, owned by the user
  that runs the API.
- **Back this folder up with the database**, and restore them together. Losing it means every download says "file not found".
- A second server cannot see this disk, so this option means one server only.

**Option B, an S3-compatible bucket** (Amazon S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2). Set the bucket and keys
and the app uses it instead of the disk:
```
S3_BUCKET=school-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto                     # e.g. ap-south-1 for Amazon S3; "auto" for Cloudflare R2
S3_ENDPOINT=https://ACCOUNT.r2.cloudflarestorage.com   # leave empty for Amazon S3
S3_FORCE_PATH_STYLE=               # optional: true or false; default true when an endpoint is set
S3_PREFIX=                         # optional folder inside the bucket
```
- Where to look: Cloudflare R2 -> Manage API tokens (Object Read and Write, limited to the one bucket); Amazon S3 -> an IAM user
  with a policy limited to the one bucket.
- Keep the bucket **private**. The app hands files out itself after checking who is asking; nobody should get a public link.
- Turn on **versioning** so a deleted or overwritten file can be recovered.
- Files already on disk are **not moved** when you switch. Copy `UPLOAD_DIR` into the bucket (same key names) before switching.
- Built with its own request signing (no SDK). **Never tried against a real provider**; test upload, download and delete first.

## 4c. Optional: Virus scanning (ClamAV)

Every upload can be scanned before it is stored. You run a ClamAV daemon (`clamd`); there is no account or key.
```
CLAMAV_HOST=localhost      # empty = no scanning
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=20000    # optional
```
- Quick start: `docker run -d --name clamav -p 3310:3310 clamav/clamav` (the first start downloads signatures and takes a few minutes).
- When it is on, an infected file is refused, and **uploads are refused while the scanner is unreachable**. Keep the scanner running
  and give it enough memory (ClamAV needs roughly 1 to 2 GB).
- Keep the virus signatures updated (the Docker image does this by itself).

## 5. Used inside the app (no account needed)

| What | Used for | Notes |
|---|---|---|
| React 19, Vite, TypeScript | Web app | |
| Tailwind CSS + shadcn/ui | Styling and components | |
| NestJS 10 | API | |
| Prisma 6 | Database access and migrations | |
| Socket.IO | Live class chat | Runs inside the API; no separate service |
| bcryptjs | Password hashing | |
| nodemailer | Sends email through your SMTP provider | |
| pdfkit | Makes certificate and report card PDF files | Built into the API; no service |
| Vitest, Testing Library, jsdom | Tests | |

Run tests with `pnpm test`.

---

## 6. Not used yet (planned)

- **Redis + BullMQ**: the notification queue is currently a database table processed by the API itself. Fine
  for one school. Add Redis (`REDIS_URL`) when volume grows or you run several API servers. Free option: the
  Redis Docker image; hosted: Upstash or Redis Cloud.
- **A media server for big calls** (for example LiveKit): calls are limited to 8 people because everyone connects to everyone.
- **Hosting** (VPS with Nginx + PM2): your own server, domain name and HTTPS certificate (Let's Encrypt is free). The full
  step-by-step is in `docs/DEPLOYMENT.md`.
- **Monitoring and error tracking** (for example Sentry, an uptime checker): nothing is built in yet.

---

## 7. Demo data

`pnpm db:seed` creates one school, one user per role and a sample class. It is for a local machine only: **never run it on a real server.** Demo logins are
`<role>@school.test` with password `password123` (student, parent, teacher, clerk, principal, admin).
**Delete or change these before any real launch.**

---

## 8. Never commit secrets

`.env` is in `.gitignore`. Only `.env.example` (with empty or placeholder values) belongs in version control.
If a key is ever pasted somewhere public, treat it as leaked and regenerate it.

---

## 9. Install as an app (PWA)

The web app can be installed on a phone or computer ("Add to Home screen" / the install icon in Chrome).
No account or key is needed. Two things to know:
- **It only installs over HTTPS** (or on `localhost`). Your live site needs a certificate; Let's Encrypt is free.
- The service worker is only active in a production build (`pnpm build`), not in `pnpm dev`. It keeps the app screen
  available offline, but it never stores school data; sign-in and every page's data still need a connection.

---

## 10. Voice channels (voice, camera and screen sharing)

Each class has a **voice** section. Teachers (their own class), the clerk, principal and admin create as many voice channels
as they like; students and teachers join them to talk, use their camera, share their screen and take private notes.
Parents cannot join. Calls are not recorded and nothing is stored except the private notes.

**No account or key is needed to get started.** It uses WebRTC, so audio and video go straight between people's browsers.
Our own server only introduces them (over the same Socket.IO connection used for chat).

What to know before you rely on it:
- **HTTPS is required** for the microphone, camera and screen sharing (except on `localhost`). Browsers refuse them otherwise.
- **STUN** (finds a route between two browsers) uses Google's free public server by default. Nothing to sign up for.
  Change it with `VITE_STUN_URLS` in `apps/web/.env` (comma-separated).
- **TURN may be needed.** On some networks (strict school or office firewalls, some mobile networks) two browsers cannot
  connect directly and the call fails to connect. A TURN relay fixes that. It needs an account or your own server:

  | Option | Where to look |
  |---|---|
  | Metered, Twilio Network Traversal, Cloudflare Calls TURN | The provider's dashboard gives a URL, username and credential |
  | Your own server | Install **coturn** on your VPS (open UDP/TCP 3478 and a relay port range) |

  Then set in `apps/web/.env`:
  ```
  VITE_TURN_URL=turn:turn.example.com:3478
  VITE_TURN_USERNAME=your-username
  VITE_TURN_CREDENTIAL=your-credential
  ```
  These values are visible in the browser, so use a provider's time-limited or restricted credentials, not a master key.
  TURN relays cost bandwidth (video especially); check the provider's pricing.
- **Size limit: 8 people per channel.** Everyone sends their video to everyone else, so the load grows quickly.
  For bigger classes or lectures, a media server (for example LiveKit, which has a hosted plan with an API key and secret,
  or a self-hosted server) would be needed. That is a later change, not built.
- Screen sharing is not available in most **mobile** browsers; the button is hidden there.
- Set `WEB_ORIGIN` in the root `.env` to your real web address (comma-separated if more than one). The chat and voice
  connections use it to decide who may connect.

---

## 11. Multi-school: the Super Admin, school addresses and plans

One installation can serve many schools. Each school's data is separate (every record carries its school, and this is tested).

**The Super Admin** is the platform owner. It is created when the API starts, if none exists, from two settings:
```
SUPERADMIN_EMAIL=you@yourdomain.com
SUPERADMIN_PASSWORD=a-strong-password      # at least 8 characters
```
- Changing these later does **not** alter an existing Super Admin. Change the password inside the app.
- It can create, suspend, restore and delete schools, add a school's admin and reset an admin's password, manage plans and record
  payments. It **cannot read any school's records**. Sign in on the general sign-in page and leave the role unselected.
- A suspended school's people cannot sign in until it is restored.

**A school's sign-in address.** By default a school's link is `https://YOUR-SITE/?school=greenfield` (the app remembers it on that device).
For an address like `https://greenfield.example.com`, build the web app with `VITE_BASE_DOMAIN=example.com`, add wildcard DNS
(`*.example.com`) and a wildcard certificate. **Known gap:** the API only accepts origins listed in `WEB_ORIGIN`, so each new
subdomain must be added there (and the API restarted) until the API is changed. See `docs/DEPLOYMENT.md` section 11.

**Plans and billing.** The Super Admin can put a school on a plan (a student limit and a price) and record payments it receives.
There is no online billing of schools, only a record. A school past its paid-until date has a 14-day grace period, then can no longer
add students (existing people keep working). A school with no plan has no limit and no expiry. Schools see their own status under billing.

**School branding and list size.** A school's admin sets its name, tagline, colour and logo (shown on its sign-in page) and the
number of rows long lists send (School branding -> Long lists). No keys.

**School data export.** A school's admin can download all of the school's own data as a file, at most once every five minutes;
each export is written to the audit log.

---

## 12. Every setting in one place

Set these in the root `.env` (the API) unless the name starts with `VITE_` (the web app, set when it is built, in `apps/web/.env`).

| Setting | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Required | Sign login tokens (access tokens last 15 minutes, refresh tokens 7 days). **Not checked for strength: never leave the placeholders.** |
| `PORT` | Optional | API port, default 4000 |
| `WEB_ORIGIN` | Required | The web app's address(es), comma-separated. Used for CORS and live connections |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | Required for multi-school | Create the platform owner at first start |
| `UPLOAD_DIR` | Optional | Folder for uploaded files when no bucket is set |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | Optional | Store files in a bucket (section 4b) |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | Optional | Virus scanning (section 4c) |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` | Optional | Email through SMTP (section 3) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | Optional | WhatsApp (section 4) |
| `WHATSAPP_VERIFY_TOKEN` | Not used yet | Reserved for receiving WhatsApp replies |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Optional | Online fee payment and refunds (section 3b) |
| `RAZORPAY_WEBHOOK_SECRET` | Needed with Razorpay | Lets the webhook be accepted (section 3b) |
| `FEE_REMINDERS` | Optional | `off` stops the hourly fee reminder job |
| `NOTIFICATIONS_WORKER` | Tests only | `off` stops the message-sending worker. Never set on a real server |
| `REDIS_URL` | Not used yet | Reserved for the later queue |
| `VITE_API_URL` | Web build | The API's address as the browser sees it |
| `VITE_BASE_DOMAIN` | Web build, optional | Per-school subdomains (section 11) |
| `VITE_STUN_URLS`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | Web build, optional | Voice connection helpers (section 10) |
