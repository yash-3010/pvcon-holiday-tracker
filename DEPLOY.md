# Deploying PVCON People

PVCON People runs on one AWS Lightsail Ubuntu server:

- **Next.js** (`next start`), kept alive by **pm2**;
- **Caddy** in front, providing HTTPS;
- a **SQLite** database file (WAL mode) and an **uploads** folder on the same disk;
- **cron**, which calls the app's scheduled jobs over HTTP;
- a nightly backup to **S3**.

This guide covers:

1. a fresh install;
2. the jobs, backups and updates;
3. the one-time move from the old Holiday Tracker (section 9).

Paths below assume the old app's layout on the server:

| | Path / name |
|---|---|
| Holiday Tracker checkout | `/var/www/pvcon-holiday-tracker` |
| Holiday Tracker database | `/var/www/pvcon-holiday-tracker/data/app.db` |
| Holiday Tracker pm2 process | `pvcon-holidays` |

The new app gets its own checkout, so the old one stays untouched for a rollback:

| | Path / name |
|---|---|
| PVCON People checkout | `/var/www/pvcon-people` |
| pm2 process | `pvcon-people` |
| Domain | `holidays.pvcon.in` (or a new name such as `people.pvcon.in`: set it in DNS, the Caddyfile and `APP_URL`) |

## 1. Server

- Ubuntu 24.04 LTS (22.04 works too).
- **2 GB RAM recommended.** `next build` needs more memory than serving does. On a 1 GB plan, add a 2 GB swap file
  before the first build. The Holiday Tracker's 512 MB plan is too small.
- Open TCP 22, 80 and 443 in Lightsail networking.
- Attach a static IP, and point the domain's `A` record at it.

Lightsail can't resize an instance in place. The usual route is a **new 2 GB instance** for PVCON People, while the
Holiday Tracker keeps running on the old one until go-live:

1. Create the instance (Ubuntu, the 2 GB plan, the same region).
2. Give it its own static IP.
3. Do sections 1–8 on it.
4. During the go-live (section 9.2), copy the old database across, then point DNS at the new instance.

The old instance stays as the rollback until you're confident, then delete it. Resizing the old instance instead
(snapshot, then a new instance from the snapshot on a bigger plan) also works, but it upgrades the live server
before the cutover.

```bash
# Swap (only on plans under 2 GB)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Company time zone, so crontab times below are Indian Standard Time
sudo timedatectl set-timezone Asia/Kolkata
```

## 2. Software

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential git curl unzip sqlite3 ufw fail2ban

# Node.js 22 LTS (Next.js 16 needs Node 20.9 or later)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# AWS CLI v2 (backups)
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
```

`better-sqlite3` is a native module: always run `npm ci` on the server. Never copy `node_modules` from another machine.

## 3. Code and configuration

```bash
sudo mkdir -p /var/www && sudo chown ubuntu:ubuntu /var/www
cd /var/www
git clone <repository-url> pvcon-people
cd pvcon-people
git checkout main            # or the release branch/tag being deployed
cp .env.example .env.local
chmod 600 .env.local
```

Fill `.env.local`. Next.js and the `npm run db:*` scripts both read it.

| Variable | Value |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` (Caddy is the only way in) |
| `DB_FILE` | `/var/www/pvcon-people/data/people.db`. Never the Holiday Tracker's `app.db`. |
| `ALLOWED_EMAIL_DOMAIN` | `pvcon.in` |
| `APP_URL` | `https://holidays.pvcon.in`, used for links in emails and payslip QR codes |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`. **Back it up separately** (password manager): without it, bank and ID numbers in backups can't be read. Never change it once data exists. |
| `CRON_SECRET` | `openssl rand -hex 32`, also used by the cron script (section 6) |
| `UPLOAD_DIR` | `/var/www/pvcon-people/data/uploads`: documents, receipts, logos and released payslip PDFs |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mail server. Without it, emails are skipped and logged. Check it under Settings → Email ("Send a test email"). |
| `PAYSLIP_SIGN_P12_PATH`, `PAYSLIP_SIGN_P12_PASSWORD` | Optional: a `.p12` certificate to sign payslip PDFs. Keep the file outside the checkout, readable by `ubuntu` only. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First super admin for a fresh install (forced password change at first sign-in) |
| `LOG_LEVEL` | `info` |
| `PORT` | `3000` |

## 4. Fresh install (no Holiday Tracker data)

For a move from the Holiday Tracker, follow section 9 instead.

```bash
cd /var/www/pvcon-people
npm ci
npm run build
mkdir -p data/uploads
npm run db:migrate
npm run db:seed

pm2 start npm --name pvcon-people -- start
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash   # start on boot
pm2 install pm2-logrotate                                               # keep logs bounded
```

## 5. Caddy

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
holidays.pvcon.in {
    encode gzip
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

With a new domain (e.g. `people.pvcon.in`) the site block uses that name, and `APP_URL` matches it. Choose the domain
before the first payroll is released: payslip QR codes and email links carry it. To keep bookmarks and old links to the
Holiday Tracker working, add a redirect block, with the old name's DNS pointing at this server too:

```
holidays.pvcon.in {
    redir https://people.pvcon.in{uri} permanent
}
```

Caddy gets and renews the Let's Encrypt certificate itself. The app sets its own security headers (CSP, frame and
content-type options).

## 6. Scheduled jobs

Jobs are triggered by `POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`. Each run is recorded under a
run key (a day, a week, a month or a leave year), so calling a job again for the same key does nothing. The crontab can
therefore call monthly and yearly jobs every night: they act only once per period. Results show under
Settings → Jobs, which can also run any job by hand.

```bash
sudo mkdir -p /etc/pvcon
sudo tee /etc/pvcon/cron.env > /dev/null <<EOF
CRON_SECRET=$(grep ^CRON_SECRET= /var/www/pvcon-people/.env.local | cut -d= -f2-)
APP_INTERNAL_URL=http://127.0.0.1:3000
EOF
sudo chmod 600 /etc/pvcon/cron.env && sudo chown ubuntu:ubuntu /etc/pvcon/cron.env

sudo tee /usr/local/bin/pvcon-job > /dev/null <<'EOF'
#!/bin/bash
# Usage: pvcon-job <job-name>. Calls the app on localhost, bypassing Caddy.
set -uo pipefail
source /etc/pvcon/cron.env
echo "$(date -Is) $1 $(curl -sS -m 600 -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_INTERNAL_URL/api/cron/$1")"
EOF
sudo chmod 755 /usr/local/bin/pvcon-job
sudo touch /var/log/pvcon-jobs.log && sudo chown ubuntu:ubuntu /var/log/pvcon-jobs.log
```

`crontab -e` as `ubuntu` (times are IST, from step 1):

```cron
# PVCON People jobs (each acts once per run key; see Settings > Jobs)
*/10 * * * * /usr/local/bin/pvcon-job notifications:send          >> /var/log/pvcon-jobs.log 2>&1
5 0 * * *    /usr/local/bin/pvcon-job attendance:close-day        >> /var/log/pvcon-jobs.log 2>&1
15 0 * * *   /usr/local/bin/pvcon-job employee:lifecycle          >> /var/log/pvcon-jobs.log 2>&1
20 0 * * *   /usr/local/bin/pvcon-job compoff:expire              >> /var/log/pvcon-jobs.log 2>&1
25 0 * * *   /usr/local/bin/pvcon-job leave:year-end              >> /var/log/pvcon-jobs.log 2>&1
30 0 * * *   /usr/local/bin/pvcon-job leave:accrue                >> /var/log/pvcon-jobs.log 2>&1
45 2 * * *   /usr/local/bin/pvcon-job system:cleanup              >> /var/log/pvcon-jobs.log 2>&1
0 9 * * *    /usr/local/bin/pvcon-job notifications:digest        >> /var/log/pvcon-jobs.log 2>&1
30 9 * * 1   /usr/local/bin/pvcon-job timesheet:remind-approvers  >> /var/log/pvcon-jobs.log 2>&1
0 16 * * 5   /usr/local/bin/pvcon-job timesheet:remind-employees  >> /var/log/pvcon-jobs.log 2>&1
30 2 * * *   /usr/local/bin/pvcon-backup                          >> /var/log/pvcon-backup.log 2>&1
```

| Job | What it does |
|---|---|
| `notifications:send` | Publishes scheduled announcements and emails notifications not yet sent |
| `attendance:close-day` | Closes yesterday: auto clock-out, stops clocks left logging to a timesheet at the shift end, computes everyone's attendance, invites comp-off claims |
| `employee:lifecycle` | Marks people past their last working day as exited, and reminds HR about probations ending |
| `compoff:expire` | Lapses expired comp-off, and warns a week before expiry |
| `leave:year-end` | Once a leave year: carries forward up to each type's cap, lapses the rest, and grants the new year |
| `leave:accrue` | Once a month: monthly accruals and any missing annual grants |
| `system:cleanup` | Old reset tokens, read notifications over 90 days, and old runs of the 10-minute job |
| `notifications:digest` | The daily digest email for people who chose it |
| `timesheet:remind-approvers` | Monday: managers with submitted timesheets waiting |
| `timesheet:remind-employees` | Friday: people who haven't submitted this week |

Rotate `/var/log/pvcon-*.log` with logrotate, or truncate them now and then.

## 7. Backups and restore

The nightly backup holds two things:

- the database, as a consistent copy made with `sqlite3 .backup`, which is safe while the app runs;
- the uploads folder (payslip PDFs are kept byte for byte, and verification relies on them).

The secrets in `.env.local` are deliberately not in it: a backup that holds the key would expose the bank and ID
numbers it protects. Keep them as follows.

- **`DATA_ENCRYPTION_KEY` is the one secret that can't be replaced.** Bank account and ID numbers in the database
  and every backup are encrypted with it. Without it they can't be read, and a new key won't help. So:
  - store it, labelled "PVCON People — DATA_ENCRYPTION_KEY", in the company password manager (Bitwarden, 1Password
    or similar), shared with at least two people;
  - never put it in git, email, chat or the S3 bucket;
  - never change it once data exists (there is no re-encryption tool);
  - check it each quarter: restore a backup on a scratch machine with the saved key (section 7, restore) and open an
    employee's Bank & IDs tab.
- **Also store `AUTH_SECRET`, `CRON_SECRET` and the SMTP password** in the same vault entry. They can be replaced if
  lost (sign-ins and the crontab just need the new values), but keeping them saves a scramble during a restore.

Create an S3 bucket (for example `pvcon-people-backup`, region `ap-south-1`) with:

- default encryption;
- a lifecycle rule that expires objects after 90 days;
- an IAM user that may only `s3:PutObject` to it.

Run `aws configure` on the server with that user's key.

```bash
sudo tee /usr/local/bin/pvcon-backup > /dev/null <<'EOF'
#!/bin/bash
set -euo pipefail
APP=/var/www/pvcon-people
BUCKET=s3://pvcon-people-backup
STAMP=$(date +%F)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
DB=$(grep ^DB_FILE= "$APP/.env.local" | cut -d= -f2-)
UPLOADS=$(grep ^UPLOAD_DIR= "$APP/.env.local" | cut -d= -f2-)
sqlite3 "$DB" ".backup '$WORK/people.db'"
sqlite3 "$WORK/people.db" "pragma integrity_check" | grep -qx ok
gzip "$WORK/people.db"
tar -czf "$WORK/uploads.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
aws s3 cp "$WORK/people.db.gz" "$BUCKET/$STAMP/people.db.gz" --only-show-errors
aws s3 cp "$WORK/uploads.tar.gz" "$BUCKET/$STAMP/uploads.tar.gz" --only-show-errors
echo "$(date -Is) backup $STAMP ok"
EOF
sudo chmod 755 /usr/local/bin/pvcon-backup
sudo touch /var/log/pvcon-backup.log && sudo chown ubuntu:ubuntu /var/log/pvcon-backup.log
/usr/local/bin/pvcon-backup        # run once now and check the bucket
```

Restore a day's backup, as `ubuntu`:

```bash
pm2 stop pvcon-people
cd /var/www/pvcon-people/data
mv people.db people.db.broken; rm -f people.db-wal people.db-shm
aws s3 cp s3://pvcon-people-backup/2026-11-02/people.db.gz . && gunzip people.db.gz
mv uploads uploads.broken
aws s3 cp s3://pvcon-people-backup/2026-11-02/uploads.tar.gz - | tar -xz -C .
cd .. && npm run db:migrate && pm2 start pvcon-people
curl -s http://127.0.0.1:3000/api/health
```

Rehearse a restore onto a scratch directory every few months.

## 8. Updates

```bash
cd /var/www/pvcon-people
/usr/local/bin/pvcon-backup          # a fresh backup before every update
git fetch && git checkout <tag-or-branch> && git pull --ff-only
npm ci
npm run build
npm run db:migrate                   # new migrations only; refuses to touch a Holiday Tracker database
pm2 reload pvcon-people
curl -s http://127.0.0.1:3000/api/health   # {"status":"ok"} with database, migrations and storage "ok"
```

If the build fails, the running process is unaffected. Fix the problem, or check out the previous tag and rebuild.

## 9. Moving from the Holiday Tracker (one time)

The old database is **never upgraded in place**. `npm run db:migrate-legacy` reads it read-only and builds a new file.
It copies:

- users (old passwords keep working), with super admins for old admins;
- employee records `PV0001…`;
- holidays and optional picks;
- leave types from the latest policy;
- every leave, as a request plus ledger entries;
- attendance history in auto mode.

It then checks every employee's balance for every year against the old app's own calculation: casual, sick, unpaid and
optional. It exits non-zero on any difference. Years the old app had already closed stay closed, so the
`leave:year-end` job doesn't carry them forward twice.

### 9.1 Rehearse (days before)

Do sections 1–3 and the build from section 4 in `/var/www/pvcon-people`. Do not seed and do not start pm2 yet. Then:

```bash
cd /var/www/pvcon-people
sqlite3 /var/www/pvcon-holiday-tracker/data/app.db ".backup /tmp/app-rehearsal.db"
npm run db:migrate-legacy -- --from /tmp/app-rehearsal.db --to /tmp/people-rehearsal.db
```

Expect `Verification passed`. If it fails, the table shows which balances differ, and the new file is kept for
inspection. Don't go live until it passes.

To try the rehearsal copy in a browser, without touching the live site:

```bash
DB_FILE=/tmp/people-rehearsal.db UPLOAD_DIR=/tmp/uploads-rehearsal PORT=3001 npm run start
# from your machine: ssh -L 3001:127.0.0.1:3001 ubuntu@<server>, then open http://localhost:3001
```

Sign in with an old account and compare a few people's leave balances with the old app. Then stop it with Ctrl+C and
delete the `/tmp` files.

### 9.2 Go live (about 30 minutes, out of hours)

1. Tell everyone the old app is going away, and when.
2. Stop the old app and take a final copy:
   ```bash
   pm2 stop pvcon-holidays
   mkdir -p ~/cutover
   sqlite3 /var/www/pvcon-holiday-tracker/data/app.db ".backup $HOME/cutover/app-final.db"
   aws s3 cp ~/cutover/app-final.db s3://pvcon-people-backup/cutover/app-final.db
   ```
   On a new instance, run that on the old server, then copy the file to the new one, with `aws s3 cp` from the
   bucket or `scp`, into `~/cutover/app-final.db`. Run the remaining steps on the new server.
3. Build the new database (the target must not exist yet):
   ```bash
   cd /var/www/pvcon-people && mkdir -p data/uploads
   npm run db:migrate-legacy -- --from ~/cutover/app-final.db --to /var/www/pvcon-people/data/people.db
   ```
   It must end with `Verification passed`. If it doesn't, go to **Roll back** below.
4. Check that `DB_FILE` in `.env.local` points at that new file. Then:
   ```bash
   npm run db:migrate    # no-op: the migration already applied them
   npm run db:seed       # adds defaults; creates SEED_ADMIN_EMAIL only if it doesn't exist yet
   ```
5. Start the new app on the same port, and keep the old process stopped but defined:
   ```bash
   pm2 start npm --name pvcon-people -- start && pm2 save
   ```
   On a new instance, point the domain's DNS record at it now (or move the static IP), and wait for Caddy to get its
   certificate.
6. Install the crontab (section 6) and the backup (section 7). Remove the old app's backup line from root's crontab
   (`sudo crontab -e`).
7. Smoke test (section 9.3).
8. In the app, as a super admin:
   - **Time → Shifts:** migrated people are on the General shift in `auto` mode (present unless on leave, a holiday
     or a weekly off). Switch it to `punch` on the day staff start clocking in. A shift change rebuilds only today, so
     earlier days stay as they are.
   - **Settings → Company / Payroll / Email:** company details, payslip settings and a test email.
   - **Organization → Employees:** add departments, managers, bank details and salaries before the first payroll run.

### 9.3 Smoke test

- `curl -s http://127.0.0.1:3000/api/health` returns `"status":"ok"`.
- `https://<domain>` loads with a valid certificate. The app installs from the browser menu (web manifest).
- An old employee account signs in with its old password and sees the same leave balances as before.
- A super admin opens Settings → Jobs and runs `notifications:send`, which succeeds.
- A leave request and its approval work, and the approver gets a notification (and an email with SMTP set up).
- `/usr/local/bin/pvcon-backup` succeeds and the files appear in S3.

### 9.4 Roll back

The old app and its database were never modified, so going back only means starting it again:

```bash
pm2 stop pvcon-people
pm2 start pvcon-holidays && pm2 save
```

On a new instance, start `pvcon-holidays` on the old server and point DNS back at it.

Leave changes made in the new app since go-live are not copied back. Note them before rolling back. To retry later,
move `data/people.db*` aside and start again from 9.2.

## 10. Hardening

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo systemctl enable --now fail2ban
chmod 700 /var/www/pvcon-people/data
```

- Use SSH key sign-in only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- Apply security updates (`unattended-upgrades` is on by default in Ubuntu).
- Port 3000 is not exposed: only Caddy is.

## 11. Troubleshooting

| Symptom | Look at |
|---|---|
| Site down | `pm2 status`, `pm2 logs pvcon-people --lines 200` (JSON logs; errors carry a reference shown to the user) |
| `/api/health` 503 | `checks.migrations` pending: run `npm run db:migrate`. `storage`: permissions on `data/`. |
| No emails | Settings → Email: server status, outbox counts, test email |
| A job didn't run | Settings → Jobs (last run and its detail), `/var/log/pvcon-jobs.log`, `crontab -l` |
| HTTPS problems | `journalctl -u caddy --since today` |
| `next build` stops with `SecurityFatalError` | Next.js has found a published advisory for the installed version. Running the build again continues, but plan the Next.js upgrade (roadmap refinement 81). |
