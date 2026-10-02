# Deployment runbook

How to put the platform on a server, keep it running, back it up, update it and roll back.

> **Status: written from reading the code, not from a real deployment.** Nothing here has been run on a production server
> yet. Do the first deployment on a throwaway server, follow this page line by line, and correct it where it is wrong.
> Before real launch also clear the blockers in `PROGRESS.md` section 5A (demo data, security review, real services).

---

## 1. What you are deploying

| Piece | What it is | Where it runs |
|---|---|---|
| Web app | Static files (HTML, JS, CSS) from `apps/web/dist` | Any web server (Nginx) |
| API | NestJS app started with `node dist/main.js` | One Node process on port 4000, behind Nginx |
| Database | PostgreSQL 16 | Managed database (recommended) or your own server |
| Files | Homework, resources, documents, message attachments, ID card photos, logos | Server disk (`UPLOAD_DIR`) or an S3-compatible bucket |
| Optional | SMTP email, WhatsApp, Razorpay, ClamAV, TURN relay | See `SERVICES.md` |

**Run exactly one API process.** The notification queue, the hourly fee reminders, live presence and voice-call rooms live
inside the API process. Two servers would send reminders twice and split voice calls. (Moving to Redis and BullMQ is on the
to-do list; until then, one process.)

**Sizing to start with:** a small server (2 CPU, 2 to 4 GB RAM) is enough for one school. Voice calls go directly between
browsers, so they do not load your server.

## 2. Before you start

You need:

1. A **domain name** and access to its DNS.
2. A **server** (Ubuntu 22.04 or 24.04 assumed below) with a public IP, and a user with `sudo`.
3. **HTTPS.** It is not optional: browsers refuse the microphone, camera, screen sharing and app installation without it.
4. A **PostgreSQL 16** database and its connection string (`postgresql://user:password@host:5432/dbname`).
5. Long random secrets. Make three:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it once each for `JWT_SECRET` and `JWT_REFRESH_SECRET`, and think of a strong `SUPERADMIN_PASSWORD` (at least 8
characters; use a password manager).

Decide the addresses. The simplest setup uses one domain for everything:

- Web and API both at `https://school.example.com` (Nginx sends `/api` and `/socket.io` to the API).

## 3. Prepare the server

```bash
# Node 22 and pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
sudo npm i -g pnpm@10 pm2

# A user to run the app (not root)
sudo adduser --disabled-password --gecos "" school
sudo mkdir -p /srv/school /var/lib/school-uploads && sudo chown school:school /srv/school /var/lib/school-uploads
```

Open only ports 22, 80 and 443 in the firewall. Do **not** expose port 4000 or the database port to the internet.

## 4. Get the code and configure it

```bash
sudo -iu school
cd /srv/school
git clone <your repository address> app && cd app
pnpm install --frozen-lockfile
cp .env.example .env
nano .env
```

Set these in `.env` (the full list is in `.env.example` and `SERVICES.md`):

```
DATABASE_URL=postgresql://USER:PASSWORD@DBHOST:5432/school
JWT_SECRET=<long random value 1>
JWT_REFRESH_SECRET=<long random value 2>
PORT=4000
NODE_ENV=production
TRUST_PROXY=1
WEB_ORIGIN=https://school.example.com
UPLOAD_DIR=/var/lib/school-uploads
SUPERADMIN_EMAIL=you@yourdomain.com
SUPERADMIN_PASSWORD=<strong password>
```

Then, as needed: `EMAIL_*` (a real SMTP provider), `WHATSAPP_*`, `RAZORPAY_*` including `RAZORPAY_WEBHOOK_SECRET`,
`S3_*` instead of `UPLOAD_DIR` (Cloudflare R2 is recommended; `SERVICES.md` section 4b has the steps, then run `pnpm --filter @school/api storage:check`), `CLAMAV_HOST`. Leave a feature's values empty to keep it off.

Rules for `.env` on the server:

- **Never leave the placeholder secrets** (`change-me`). With `NODE_ENV=production` the API checks them at start-up and
  **refuses to start** (with a message saying what is wrong) if a JWT secret is missing, under 32 characters, a placeholder or
  equal to the other one, if `SUPERADMIN_PASSWORD` is a demo or under 12 characters, or if `WEB_ORIGIN` is localhost or not
  `https://`. Anyone who knows the secrets can forge sign-ins.
- `TRUST_PROXY=1` tells the API that Nginx is in front of it, so the sign-in limiter counts each visitor by their own address
  instead of Nginx's. Set it only when the API is reachable through Nginx alone (port 4000 closed to the internet); otherwise
  leave it empty.
- **Remove the local Mailpit lines** (`EMAIL_HOST=localhost`, port 1025) unless you mean them.
- `WEB_ORIGIN` must be exactly the address people type, with `https://` and no trailing slash. Comma-separate several.
  A wrong value breaks sign-in and live chat with a "CORS" error.
- File permissions: `chmod 600 .env`.

## 5. Build

```bash
pnpm --filter @school/db generate
pnpm --filter @school/permissions build
pnpm --filter @school/api build

# The web app bakes these values in at build time, so set them here, not on the server later:
VITE_API_URL=https://school.example.com pnpm --filter @school/web build
```

Optional web build settings: `VITE_STUN_URLS`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` (voice, see
`SERVICES.md` section 10) and `VITE_BASE_DOMAIN` (only for per-school subdomains, see section 11 below).

The web build lands in `apps/web/dist`. Copy it where Nginx serves it:

```bash
sudo mkdir -p /var/www/school && sudo rsync -a --delete apps/web/dist/ /var/www/school/
```

## 6. Set up the database

**Take a backup first if the database already has data** (section 9). Then apply the migrations:

```bash
pnpm --filter @school/db exec dotenv -e ../../.env -- prisma migrate deploy
```

- Use `migrate deploy` on a server, **never `migrate dev`** and never `db push`.
- **Do not run `pnpm db:seed` in production.** It creates demo people with the password `password123`.
- The first start of the API creates the Super Admin from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` if none exists.
  Changing those two settings later does **not** change an existing Super Admin; change the password in the app.

## 7. Start the API

```bash
cd /srv/school/app/apps/api
pm2 start dist/main.js --name school-api --time --update-env   # reads NODE_ENV from the root .env
pm2 save
pm2 startup        # prints one command; run it with sudo so the API restarts after a reboot
```

Check it: `pm2 logs school-api` should show the app starting and, the first time, "Super admin created". The API listens on
`127.0.0.1:4000` only if you keep it behind Nginx; `curl -i http://127.0.0.1:4000/api/tenant/none` should answer `404`
with a JSON body, which proves it is up. (There is no dedicated health-check route yet.)

## 8. Nginx and HTTPS

`/etc/nginx/sites-available/school`:

```nginx
server {
    listen 80;
    server_name school.example.com;

    root /var/www/school;
    index index.html;

    # Uploads are up to 100 MB (the API's own limit); leave a little room for the form fields around the file
    client_max_body_size 105m;

    # The API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Live features (chat, messages, presence, voice signaling) need WebSocket upgrades
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # The web app: unknown paths fall back to index.html (it is a single-page app)
    location / {
        try_files $uri /index.html;
    }

    # Never cache the app shell or the service worker; cache built assets for a long time
    location = /index.html { add_header Cache-Control "no-store"; }
    location = /sw.js { add_header Cache-Control "no-store"; }
    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/school /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d school.example.com     # adds HTTPS and the automatic renewal
```

The API itself sends `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and (in production)
`Strict-Transport-Security` on every API response. Nginx serves the web pages, so add the same headers in the HTTPS `server`
block for those:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000" always;
```

### Content-Security-Policy (recommended; start in report-only mode)

A Content-Security-Policy tells the browser which addresses the web app may load code, images and connections from, so an
injected script cannot run or send data elsewhere. Add this to the HTTPS `server` block for the web pages, **changing
`school.example.com` to your address**. Start with the **report-only** header:

```nginx
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://school.example.com https://api.razorpay.com https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
```

Then: use the site (sign in, open every screen, a class chat and voice channel, upload a file, change the appearance, and **make a
Razorpay test payment**) with the browser's developer console open. Any "Report Only" message in the console names something the
policy would block. Fix the policy for what is legitimate, and when a full round of use shows nothing, change the header name
to `Content-Security-Policy` (drop `-Report-Only`) and reload.

Notes:
- `'unsafe-inline'` is allowed for styles only, because the interface libraries add style rules while running. Scripts stay strict.
- If your API is on a **different address** from the web app (`VITE_API_URL` points elsewhere), add that address to `img-src`
  (school logos and ID card photos load from it) and `connect-src` (plus its `wss://` form for live features).
- Razorpay's checkout has not been tried under this policy. If the payment window fails to open or complete, the report-only
  messages will show which Razorpay address to add. Do not enforce the policy until a test payment works.
- The policy was checked in a real browser against the app (sign-in, the main screens, every class channel, the appearance dialog,
  live connections) with the enforced version and produced **no violations**; payments were not part of that check.
- The API's own responses do not carry a Content-Security-Policy; they are data, not pages.

## 9. Backups (do this before launch, not after)

Two things hold your data. Back up both, **together**, and **practise a restore**.

**The database**, every night:

```bash
# /etc/cron.d/school-backup   (edit the connection string)
30 2 * * * school pg_dump "postgresql://USER:PASSWORD@DBHOST:5432/school" | gzip > /var/backups/school/db-$(date +\%F).sql.gz
```

Keep at least 14 days, and copy them off the server (another provider or region). A managed database with point-in-time
recovery is better still; turn it on.

**The files:**

- On disk (`UPLOAD_DIR`): copy `/var/lib/school-uploads` nightly, for example `rsync -a` to another machine or a bucket.
- On S3/R2: on Amazon S3 turn on **versioning**. Cloudflare R2 did not offer versioning when this was written, so keep a second copy
  instead: a nightly `rclone sync` from the bucket to another provider or your own server, and check now and then that it restores.

**Restore test** (do it once on a spare machine and write down how long it took):

```bash
createdb school_restore
gunzip -c db-2026-01-01.sql.gz | psql school_restore
```

Then point a test copy of the app at it and sign in.

## 10. First-launch checklist

1. `pm2 status` shows `school-api` online. `pm2 logs school-api` has no errors.
2. `https://school.example.com` loads and shows the sign-in page over HTTPS with a valid certificate.
3. Sign in as the Super Admin (leave the role unselected). **Change its password.**
4. Create the real school (Schools → Add school) and sign in as its first admin with the one-time password.
   The admin must change it at once.
5. Confirm there is **no** `student@school.test`, `admin@school.test` or any other demo account: try them and expect a failure.
6. Send yourself an email (create an announcement to yourself) and check it arrives and is not in spam. Then use
   "Forgot your password?" on the sign-in page for a test account, and check the link arrives, opens the right address (from
   `WEB_ORIGIN`), works once, and the second use is refused.
7. If Razorpay is on: make a test-mode payment and a refund, and check the webhook (Razorpay dashboard → Webhooks →
   recent deliveries show `200`). Webhook address: `https://school.example.com/api/fees/razorpay/webhook`.
8. If WhatsApp is on: send to a number you own that has opted in.
9. Try a voice call between two devices on **different networks** (one on mobile data). If it does not connect, you need a
   TURN relay (`SERVICES.md` section 10).
10. Try a file upload, download, and (if configured) an infected test file if ClamAV is on.
11. Take a backup and do a test restore (section 9).
12. Install the app on a phone ("Add to Home screen") to check the HTTPS and service worker.

## 11. Per-school subdomains (optional, not fully supported yet)

The app can give each school its own address (`greenfield.example.com`) with `VITE_BASE_DOMAIN=example.com` at web build time,
a wildcard DNS record (`*.example.com`) and a wildcard certificate (certbot needs the DNS challenge for that).

**Known gap:** the API allows only the origins listed in `WEB_ORIGIN`, and it does not accept a wildcard. A newly created
school's subdomain would be refused until you add it to `WEB_ORIGIN` and restart the API. Until the API is changed to accept
`*.example.com`, either add each school by hand, or use the default link style `https://school.example.com/?school=greenfield`
(no wildcard needed), which works today.

## 12. Updating to a new version

```bash
sudo -iu school && cd /srv/school/app
git pull
pnpm install --frozen-lockfile
# BACKUP the database first (section 9), because migrations only go forward
pnpm --filter @school/db generate
pnpm --filter @school/db exec dotenv -e ../../.env -- prisma migrate deploy
pnpm --filter @school/permissions build && pnpm --filter @school/api build
VITE_API_URL=https://school.example.com pnpm --filter @school/web build
sudo rsync -a --delete apps/web/dist/ /var/www/school/
pm2 restart school-api
```

People signed in stay signed in (tokens are checked against the database), and the web app is replaced on their next reload.
Restarting the API drops live connections for a few seconds; open voice calls end. Update outside school hours.

**Read the migration folder names in the pull** (`packages/db/prisma/migrations/`). If a migration removes or changes a
column, take extra care and test the update on a copy of the database first.

## 13. Rolling back

- **Code only (no new migration):** `git checkout <previous tag or commit>`, rebuild (section 12 without the migrate line),
  `pm2 restart school-api`.
- **A migration was applied:** migrations do not undo themselves. Restore the backup you took before the update, then check
  out the old code. Any data entered after that backup is lost, so decide quickly and tell users.
- Tag every release (`git tag v1.0.0 && git push --tags`) so there is always a name to go back to.

## 14. Watching it run

There is **no built-in monitoring, health-check route or error tracking yet.** Until there is:

- `pm2 logs school-api` and `pm2 monit` show errors and memory. Set up log rotation: `pm2 install pm2-logrotate`.
- Use an outside uptime check (UptimeRobot, Better Stack) on `https://school.example.com/api/tenant/none` expecting `404`,
  or on the home page expecting `200`, and get alerts by email or phone.
- In the app: **Admin → Delivery log** shows failed email and WhatsApp messages; the **Audit log** shows every change.
- Disk space: watch the uploads folder and the backup folder (`df -h`).
- Add an error tracker (for example Sentry) before launch if you can. See `PROGRESS.md` section 5A.

## 15. Server settings worth knowing

| Setting | Meaning |
|---|---|
| `FEE_REMINDERS=off` | Stops the hourly fee reminder job (it runs between 8:00 and 20:00, server time). Use it on any extra copy of the API. |
| `NOTIFICATIONS_WORKER=off` | Stops the notification worker. For tests only; on a real server email and WhatsApp would stop being sent. |
| `CLAMAV_HOST` / `CLAMAV_PORT` / `CLAMAV_TIMEOUT_MS` | Virus scan every upload. Uploads are refused while the scanner is unreachable. With the 100 MB upload limit, raise ClamAV's `StreamMaxLength` (default 25 MB) to at least `100M` and set `CLAMAV_TIMEOUT_MS` to about `120000`, or large files will be refused. |
| Upload size (100 MB) | One setting in the code, `MAX_FILE_BYTES` in `apps/api/src/storage/upload-rules.ts`. Each upload is held in memory while handled, so size the server's RAM for a few at once, and keep Nginx's `client_max_body_size` at `105m` or more. |
| `GDRIVE_FOLDER_ID` + `GDRIVE_SERVICE_ACCOUNT_JSON` / `GDRIVE_CLIENT_*` | Extra storage in Google Drive (`SERVICES.md` 4d). A secret key lives here, so keep `.env` private (`chmod 600`). The server must be able to reach `www.googleapis.com` and `oauth2.googleapis.com`. Back up Drive-held files too. |
| `STORAGE_PRIMARY_LIMIT_GB` | Gigabytes the main storage may hold before "Automatic" sends new files to Google Drive. Empty = only when the main storage refuses a file. |
| Adding files from a link | The API downloads files from addresses people paste, so it needs outbound internet access. It refuses private and internal addresses itself, but also **do not give the API server access to anything sensitive on its own network** it does not need. Allow outbound HTTPS (and HTTP) from the API to the internet only. |
| Server time zone | Reminder hours and "today" follow the server clock. Set the server to the school's time zone (`timedatectl set-timezone Asia/Kolkata`). |

## 16. If something goes wrong

| Symptom | Look at |
|---|---|
| Blank page or "CORS error" in the browser console | `WEB_ORIGIN` does not exactly match the address in the browser. Fix `.env`, `pm2 restart school-api`. |
| Sign-in works but chat, presence or calls do not | Nginx is missing the `/socket.io/` block or the WebSocket headers. |
| Every page says "Loading…" or fails with 502 | The API is down: `pm2 status`, `pm2 logs school-api`. |
| Uploads fail with 413 | `client_max_body_size` in Nginx is below 100 MB (use `105m`), or the file really is over the app's 100 MB limit. |
| Large uploads fail or the API restarts while people upload | Each upload is held in the API's memory while it is checked and stored, so several 100 MB uploads at once need that much spare RAM. Give the server enough memory (see section 15) and watch `pm2 monit`. |
| "Email is not configured" in the Delivery log | `EMAIL_HOST` is empty or wrong. |
| Fee paid at Razorpay but invoice still unpaid | Webhook not reaching the API or `RAZORPAY_WEBHOOK_SECRET` is wrong; check Razorpay's webhook delivery log. The clerk can mark it paid by hand meanwhile. |
| Voice call never connects for some people | Their network blocks direct connections: add a TURN relay. |
| Everyone was signed out | `JWT_SECRET` or `JWT_REFRESH_SECRET` changed. That is the expected effect of changing it. |
| The API exits at start-up with "will not start with unsafe settings" | Read the list it prints and fix those values in `.env` (section 4). |
| A real user is told "Too many sign-in attempts" | They (or someone pretending to be them) got the password wrong 10 times in 15 minutes. It clears by itself after the time shown, or restart the API to clear it at once. Everyone sharing one school network can hit the per-network limit if `TRUST_PROXY` is not set. |
| `prisma generate` says EPERM on Windows | The API is running and holds the file. Stop it first. |
