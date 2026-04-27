# Deploy — AWS Lightsail

Cheap path: 1 Lightsail Ubuntu instance + Caddy reverse proxy + SQLite + nightly S3 backup.

Estimated cost: **~$5/mo**.

## 1. Create instance

- AWS Console → Lightsail → Create instance
- Region: closest to India (e.g. `ap-south-1` Mumbai)
- Platform: **Linux/Unix**, Blueprint: **OS Only → Ubuntu 22.04 LTS**
- Plan: **$3.50/mo (512 MB / 2 vCPU / 20 GB)** — sufficient for 5 users
- Name: `pvcon-holidays`
- Create static IP and attach (free while attached)

Open ports in Lightsail networking: TCP 22, 80, 443.

## 2. DNS

In your DNS provider for `pvcon.in`:

```
A    holidays   <static-ip>
```

Wait for propagation.

## 3. Provision instance

SSH in:

```bash
ssh ubuntu@<static-ip>

sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential git curl unzip ufw

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pm2 process manager
sudo npm i -g pm2

# Caddy (auto HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# AWS CLI for backups
sudo apt install -y awscli
```

## 4. Deploy app

```bash
sudo mkdir -p /var/www && sudo chown ubuntu:ubuntu /var/www
cd /var/www
git clone <your-repo-url> pvcon-holiday-tracker
cd pvcon-holiday-tracker
npm ci
npm run build

# generate strong secret
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env.local
echo "AUTH_TRUST_HOST=true" >> .env.local
echo "DB_FILE=/var/www/pvcon-holiday-tracker/data/app.db" >> .env.local
echo "DATABASE_URL=file:/var/www/pvcon-holiday-tracker/data/app.db" >> .env.local
echo "ALLOWED_EMAIL_DOMAIN=pvcon.in" >> .env.local
echo "NODE_ENV=production" >> .env.local
echo "PORT=3000" >> .env.local

mkdir -p data
npm run db:migrate
# Seed only on first deploy, with the xlsx uploaded:
# scp -i key.pem 'PVCON Leave Tracker 2026.xlsx' ubuntu@<ip>:/tmp/seed.xlsx
# SEED_XLSX=/tmp/seed.xlsx npm run db:seed

# start
pm2 start "npm run start" --name pvcon-holidays
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash
```

## 5. Caddy reverse proxy + auto HTTPS

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
holidays.pvcon.in {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF

sudo systemctl restart caddy
```

Caddy fetches Let's Encrypt cert automatically. Browse `https://holidays.pvcon.in`.

## 6. Backups (S3, ~$0.01/mo)

Create S3 bucket `pvcon-holidays-backup` in same region. Lifecycle: expire after 90 days.

IAM user with `s3:PutObject` on the bucket. Configure on instance:

```bash
aws configure   # paste access key + secret + region
```

Backup script:

```bash
sudo tee /usr/local/bin/pvcon-backup.sh > /dev/null <<'EOF'
#!/bin/bash
set -e
DATE=$(date +%F)
DB=/var/www/pvcon-holiday-tracker/data/app.db
TMP=/tmp/app-$DATE.db
sqlite3 "$DB" ".backup $TMP"
gzip "$TMP"
aws s3 cp "$TMP.gz" "s3://pvcon-holidays-backup/$DATE.db.gz"
rm -f "$TMP.gz"
EOF
sudo chmod +x /usr/local/bin/pvcon-backup.sh
sudo apt install -y sqlite3

# Daily 2am UTC
( sudo crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/pvcon-backup.sh >> /var/log/pvcon-backup.log 2>&1" ) | sudo crontab -
```

## 7. Updates

```bash
cd /var/www/pvcon-holiday-tracker
git pull
npm ci
npm run build
npm run db:migrate
pm2 reload pvcon-holidays
```

Optional: GitHub Actions deploy workflow on push to `main` running the above via SSH.

## 8. Hardening

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Fail2ban for SSH:

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

## 9. Initial accounts (after seed)

| Email | Password | Role |
|---|---|---|
| admin@pvcon.in | Pvcon@1234 | admin |
| yash@pvcon.in | Pvcon@1234 | employee |
| sonam@pvcon.in | Pvcon@1234 | employee |
| raj@pvcon.in | Pvcon@1234 | employee |
| almas@pvcon.in | Pvcon@1234 | employee |

All forced to change password on first login.
