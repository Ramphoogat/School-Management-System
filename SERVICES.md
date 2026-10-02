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
| Google Drive (extra storage) | Optional | **Yes**, a Google Cloud project and a service account (or a person's sign-in) | Built, with automatic switch-over when the main storage is full; **never tried against real Google** (section 4d) |
| Adding files from a link | Built in | No (Drive links work best with 4d) | Built; **never tried against the real sites** (section 4e) |
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

## 3c. Password reset needs email

The "Forgot your password?" link on the sign-in page emails a one-time link (valid 60 minutes, usable once). **It only works if email
(section 3) is set up.** Without `EMAIL_HOST`, the page still says "check your email" (so it never reveals who has an account), but
nothing is sent, and the API log says so. Until email works, an admin can reset a password from Users (a temporary password is shown
once). The link points at the first address in `WEB_ORIGIN`, so that must be the real https address. People may ask three times an
hour per address.

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

Homework files, class resources, books, school documents, message attachments, ID card photos and school logos are stored through one
small piece of code (`apps/api/src/storage/storage.ts`). Files are always checked first: only PDF, images, Word and text files
are accepted, and the file's real content must match its name. The limit is **100 MB** for homework, resources, books, documents
and message attachments (one setting, `MAX_FILE_BYTES` in `apps/api/src/storage/upload-rules.ts`); ID card photos are limited to
10 MB (`MAX_PHOTO_BYTES` in `apps/api/src/idcards/idcards.module.ts`; the browser crops and shrinks them first, so real ones are
tiny) and school logos to 5 MB (`MAX_LOGO_BYTES` in `apps/api/src/platform/platform.module.ts`). A large logo makes the public
sign-in page slower to load, so a small one is still better.

Things that grow with a 100 MB limit:
- **Memory:** an upload is held in the API's memory while it is checked, scanned and stored, so several large uploads at once need
  that much spare RAM (plan on 100 MB per upload in progress, plus the normal load).
- **Nginx:** `client_max_body_size` must be at least `105m` (see `docs/DEPLOYMENT.md`), or large uploads are refused with 413.
- **Virus scanning:** ClamAV refuses very large streams by default (its `StreamMaxLength` is 25 MB) and the app waits at most 20
  seconds for a scan. If you use ClamAV, raise `StreamMaxLength` in `clamd.conf` to at least 100M (and `MaxFileSize`, `MaxScanSize`),
  and raise `CLAMAV_TIMEOUT_MS` (for example to `120000`). Otherwise large uploads will be refused as "scanner unavailable".
- **Storage cost:** bigger files fill the disk or the bucket faster (R2 free allowance is 10 GB).

**Option A, this server's disk (the default, no account).** Files go into `UPLOAD_DIR` (default `./uploads`).
- On a real server set it to a folder outside the code, for example `UPLOAD_DIR=/var/lib/school-uploads`, owned by the user
  that runs the API.
- **Back this folder up with the database**, and restore them together. Losing it means every download says "file not found".
- A second server cannot see this disk, so this option means one server only.

**Recommended bucket: Cloudflare R2.** Files here are downloaded again and again (homework, documents, photos), and R2 charges
**nothing for downloads** (Amazon S3 charges per GB), stores at about two thirds of S3's price, and has a permanent 10 GB free
allowance. Choose Amazon S3 instead only if you already run on AWS or need data kept in Mumbai (`ap-south-1`); R2 has no India-only
choice. (Prices and limits change: confirm on the provider's pricing page.)

### Setting up Cloudflare R2, step by step
1. Create a Cloudflare account at cloudflare.com and, in the dashboard, open **R2 Object Storage**. R2 asks for a payment card
   even to use the free allowance; you are not charged inside it.
2. **Create bucket.** Name it, for example, `school-files`. Leave it **private** (do not turn on the public address or a custom
   public domain): the app hands files out itself after checking who is asking.
3. On the R2 page choose **Manage API tokens -> Create API token**. Permission **Object Read & Write**, and under "Specify bucket(s)"
   pick only `school-files`. Create it, then copy the **Access Key ID**, the **Secret Access Key** (shown once) and the
   **S3 endpoint** (it looks like `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
4. Put them in `.env` on the server (never in the web app, never in a chat or a repository):
```
S3_BUCKET=school-files
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```
5. Build and test the bucket **before** switching anything over:
```bash
pnpm --filter @school/api build
pnpm --filter @school/api storage:check
```
   It saves a small file, reads it back, deletes it and confirms it is gone, and says which step failed if not (a 403 usually means
   the token lacks write access to this bucket; a 404 usually means a wrong bucket name or endpoint).
6. **If the school already has files on disk**, copy them across (the originals stay where they are):
```bash
pnpm --filter @school/api storage:migrate -- --dry-run     # only lists what would be copied
pnpm --filter @school/api storage:migrate                  # copies and checks each file
```
   It is safe to run again. Files uploaded to the disk **after** the copy but before the restart would be missed, so run it once more
   right before restarting.
7. Restart the API. From then on every upload, download and delete goes to R2. Try one of each.
8. Keep the old disk folder for a while, and keep taking the backups in `docs/DEPLOYMENT.md` section 9.

**Checked against a real R2 bucket on 1 Oct 2026:** `storage:check` passed all four steps (save, read back, delete, confirm gone) with a
real Cloudflare account. What has **not** been seen is the app itself uploading a homework file, a photo or a logo and downloading it
again through the bucket, nor `storage:migrate` with real files (there were none to copy). `storage:check` is safe to repeat: it
touches only its own test file.

### Any S3-compatible bucket
Set the bucket and keys and the app uses it instead of the disk:
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
- **Recovering deleted files:** on Amazon S3 turn on **versioning**. Cloudflare R2 did not offer object versioning when this was
  written (check its current documentation), so on R2 keep a second copy instead, for example a nightly `rclone sync` of the bucket to a
  bucket at another provider or to a server you control (`docs/DEPLOYMENT.md` section 9).
- Files already on disk are **not moved** when you switch. Copy them first with `pnpm --filter @school/api storage:migrate` (see above).
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

## 4d. Optional: Google Drive as extra storage

Google Drive can hold files when the main storage (this server's disk or your bucket, section 4b) is full, or whenever a clerk,
principal or admin chooses it. It works with **Google Workspace** schools and with schools that only have a normal Gmail account.

**How the app uses it**
- Every stored file is remembered with where it went (the main storage or Drive), so reading and deleting always find it. Files are
  never moved automatically: only **new** files follow the current choice.
- On the **Storage** page (workspace menu; clerk, principal and admin) a school chooses where **its** new files go:
  - **Automatic (recommended):** the main storage first; Google Drive takes over when the main storage is full, which means either
    it holds `STORAGE_PRIMARY_LIMIT_GB` gigabytes or it refuses a file.
  - **Main storage only**, or **Google Drive only**.
- The page also shows how much room each place uses, whose Google account is connected, and a **Run the test** button.
- School logos always stay in the main storage (they are shown on the public sign-in page and must load fast).
- Files in Drive are still private: the app checks who is asking before it hands a file over, exactly as for any other file. Nobody
  gets a Drive link.

**Set it up (service account, recommended)**
1. Go to console.cloud.google.com and create a project (or pick one). **APIs and Services -> Library -> Google Drive API -> Enable.**
2. **IAM and Admin -> Service Accounts -> Create service account** (any name, for example `school-files`). Open it, then
   **Keys -> Add key -> Create new key -> JSON.** A key file downloads. Keep it secret.
3. In Google Drive make a folder (for example `School files`) and **share it with the service account's email address**
   (it looks like `school-files@your-project.iam.gserviceaccount.com`) as **Editor**. Copy the folder's id: it is the end of its
   address, `drive.google.com/drive/folders/<THIS PART>`.
   *Google Workspace schools:* for more room, make a **Shared drive**, add the service account as a **Content manager**, and use a
   folder inside it.
4. In the server's `.env` set (see `.env.example`):
```
GDRIVE_FOLDER_ID=<the folder id>
GDRIVE_SERVICE_ACCOUNT_JSON='<the whole key file on one line>'
STORAGE_PRIMARY_LIMIT_GB=10          # optional: Cloudflare R2's free allowance; empty = no limit
```
5. Restart the API, open **Storage** and press **Run the test**: it signs in, saves a small file in the folder, reads it back,
   deletes it and says which step failed if one does.

**How much room does it have?** A service account has only a small allowance of its own (historically about 15 GB; check Google's
current documentation, it has changed before). For more, use a Workspace **Shared drive** (it uses the organisation's storage) or the
personal sign-in below.

**Or sign in as a person (uses that person's own storage space)**: set `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET` and
`GDRIVE_REFRESH_TOKEN` instead of the service account, with the same `GDRIVE_FOLDER_ID` (a folder in that person's Drive). To get the
refresh token create an OAuth client in Google Cloud and authorise it for the Drive scope (the OAuth Playground can do this with your
own client). **Warning:** while the Google Cloud OAuth consent screen is in "Testing" mode, Google expires the refresh token after about
7 days, and Drive stops working until a new one is made. Publish the consent screen (or use the service account) to avoid this.

**Limits and things to know**
- Drive is slower than a bucket and has Google's own request and daily upload limits. It is meant as overflow, not as the main store.
- If Drive is chosen and Google refuses a file, the upload fails with an error; it is not quietly sent somewhere else. Only in
  **Automatic** mode does a failing main storage fall back to Drive.
- Switching to Drive needs the Drive connection to be working; the Storage page will not let anyone choose it until it is connected.
- Back up Drive-held files too: they are not in the bucket or the server's disk.
- **Never tried against real Google.** The sign-in, the upload, read and delete calls and the switching rules are tested against a
  stand-in server only. Run **Run the test** first, then try one real upload and download.

## 4e. Adding files from a link (and the "?" button)

Everyone who may upload files except **students** can also add a file by pasting a link: **school documents** (clerk, principal, admin),
**class resources** (the class teacher), **books** (teacher, clerk, principal, admin) and **homework attachments** (the class
teacher). A **From a link** button sits beside the normal upload button, and a round **?** button next to it opens the list of which
links work and how to get one.

- **Sources:** Google Drive files, Google Docs / Sheets / Slides (saved as a PDF), Dropbox, OneDrive and SharePoint, GitHub files, and any
  direct link to a file. The "?" list comes from the server, so it always matches what really works.
- **Private Google Drive files:** if the file cannot be opened publicly and Drive is connected (section 4d) the app opens it with its own
  Drive account. Share the file with the service account's email (the "?" window shows the address) as **Viewer**.
- **Same rules as an upload:** PDF, Word, text, PNG or JPG; up to 100 MB; the file's real content must match its type; virus scanning
  applies if it is on; it is stored wherever new files go (section 4d); it is in the audit log like any upload.
- **Safety:** the school's server fetches the address, so it refuses anything that points at a private or internal address (this
  machine, the school network, cloud metadata addresses), checks every redirect, and gives up on files over the size limit or sites that
  are too slow.
- **Not supported:** links that need a sign-in (other than the Drive case above), web pages that are not a file, folders. There is **no
  Google Drive file picker** inside the app (that would need a separate Google sign-in set up in the browser); Drive files are added by
  pasting their share link. Students always upload from their own device.
- **Never tried against the real sites.** The link rules and the download are tested against a small test server and the documented
  address formats; Google, Dropbox and OneDrive can change theirs.

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
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Required | Sign login tokens (access tokens last 15 minutes, refresh tokens 7 days). At least 32 random characters each and different from each other; checked at start-up when `NODE_ENV=production`. Changing one signs everyone out |
| `PORT` | Optional | API port, default 4000 |
| `NODE_ENV` | Set to `production` on a real server | In production the API **refuses to start** if a JWT secret is missing, under 32 characters, a placeholder or the same as the other; if the Super Admin password is a demo or under 12 characters; or if `WEB_ORIGIN` is localhost or not https. Elsewhere it only warns |
| `TRUST_PROXY` | Set to `1` behind Nginx | Number of proxies in front of the API, so the sign-in limiter sees each visitor's real address. Leave empty if reached directly |
| `LOGIN_MAX_PER_EMAIL`, `LOGIN_MAX_PER_IP`, `LOGIN_WINDOW_MINUTES` | Optional | Sign-in lockout: 10 wrong passwords per email and 60 per network address in 15 minutes, by default. Held in this server's memory, so it resets on restart and assumes one API process |
| `WEB_ORIGIN` | Required | The web app's address(es), comma-separated. Used for CORS and live connections |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | Required for multi-school | Create the platform owner at first start |
| `UPLOAD_DIR` | Optional | Folder for uploaded files when no bucket is set |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | Optional | Store files in a bucket (section 4b) |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | Optional | Virus scanning (section 4c) |
| `GDRIVE_FOLDER_ID` | Optional | The Drive folder for extra storage; empty keeps Google Drive off (section 4d) |
| `GDRIVE_SERVICE_ACCOUNT_JSON` (or `GDRIVE_CLIENT_EMAIL` + `GDRIVE_PRIVATE_KEY`) | With Drive | The service account's key, on one line in single quotes. A secret |
| `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN` | With Drive, instead | Sign in as a person instead of a service account. Secrets |
| `STORAGE_PRIMARY_LIMIT_GB` | Optional | Gigabytes the main storage may hold before "Automatic" switches to Google Drive. Empty = no limit |
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

## School cameras (principal and admin only)

The **School cameras** page shows live video. Browsers cannot play `rtsp://` streams, and most IP cameras only speak RTSP, so run
a small gateway on the school network and point the site at what it produces:

1. Install [go2rtc](https://github.com/AlexxIT/go2rtc) or [MediaMTX](https://github.com/bluenviron/mediamtx) on any always-on PC next to the cameras.
2. Give it each camera's RTSP address (`rtsp://user:password@192.168.1.50:554/stream1`).
3. In the site, open **School cameras → Add camera** and paste the gateway's address: an HLS playlist
   (`http://gateway:8888/gate/index.m3u8` on MediaMTX) or an MJPEG stream (`http://gateway:1984/api/stream.mjpeg?src=gate` on go2rtc).

The API server must be able to reach the gateway. The address is stored on the server and never sent to a browser; the browser
only talks to the API, which checks the user is a principal or admin and relays the video. Opening a camera is written to the
audit log. Cameras with no gateway but an HTTP MJPEG endpoint (many cheap cameras) work directly.

## Connect Google Drive (sign-in on the Storage page)

This is the easy way to link Drive: a clerk, principal or admin opens **Storage → Connect Google Drive**, signs in on Google's own
page and chooses Allow. The school then shows the Drive's used and total space, and staff (teachers, clerk, principal, admin; never
students or parents) can upload and view photos, videos and documents on the **Drive files** page.

One-time setup by whoever runs the server (free):

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and turn on the **Google Drive API**.
2. **APIs & Services → OAuth consent screen**: fill in the app name and your email. While it is in "Testing", add each Google account that
   will connect as a test user (or publish the app).
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorised redirect URIs* add
   `<API_PUBLIC_URL>/api/storage/drive/callback` (for local use: `http://localhost:4000/api/storage/drive/callback`).
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `API_PUBLIC_URL`, and restart the API.

How it behaves:

- The app asks only for the `drive.file` permission: it can see the folder and files it makes itself, **not** the rest of that Google account.
- Each school links its own Google account. The lasting access token is stored encrypted (key derived from `JWT_SECRET`, so keep that stable).
- A school's link is used first; the older server-wide settings (`GDRIVE_*`, section 4d) still work for schools that have no link.
- Disconnecting keeps the files in Drive. Connecting the same Google account again makes them reachable again.
- Never tried against real Google: only against a stand-in server in the tests.
