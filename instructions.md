Prepare your YunoHost server

SSH into your server.

Ensure Node.js 18+ and git are installed.

Decide where the bot app will live, for example /opt/mattermost-nudge-bot.

Make sure the server can reach your Mattermost URL and SMTP server.

Create a Mattermost bot account

In Mattermost, go to System Console.

Enable bot account creation if disabled.

Create a new bot account:

Username example: nudgebot
Display name example: Nudge Bot
Description example: Tracks nudges and sends alert email
Generate an access token for the bot.
Save:
Mattermost base URL
Bot token
Team and channel where it should listen
Add the bot user to channels where nudging is allowed.

Set bot permissions in Mattermost

Bot needs to read posts/events and post messages.

Keep permissions minimal:

Read messages in joined channels
Post messages in joined channels
Do not grant admin permissions unless required.

Deploy the bot code on your YunoHost host

Clone project:

git clone https://github.com/MinasMayth/mattermost-nudge-bot.git /opt/mattermost-nudge-bot
Install dependencies:
cd /opt/mattermost-nudge-bot
npm install
Create environment file:
cp .env.example .env
Edit .env with your values:
MATTERMOST_URL=https://your-mattermost.example
MATTERMOST_TOKEN=your_bot_token
SMTP_HOST=your_smtp_host
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=nudge-bot@yourdomain
ALERT_EMAIL=target_alert_email
STORAGE_FILE=/opt/mattermost-nudge-bot/nudges.json
NUDGE_ALERT_THRESHOLD=5
Create a systemd service on YunoHost
Create /etc/systemd/system/mattermost-nudge-bot.service with:
[Unit]
Description=Mattermost Nudge Bot
After=network.target
[Service]
Type=simple
WorkingDirectory=/opt/mattermost-nudge-bot
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=5
User=root
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
Reload and start:
systemctl daemon-reload
systemctl enable mattermost-nudge-bot
systemctl start mattermost-nudge-bot
Check logs:
journalctl -u mattermost-nudge-bot -f
Test end-to-end
In a channel where bot is present, run:
!nudge @someone
Confirm bot replies with current monthly count.
Run:
!nudges
Confirm it returns leaderboard disabled message and does not show counts.
Trigger threshold in test channel and confirm email alert arrives.
Extra recommended steps

Security hardening
Store .env with restricted permissions:
chmod 600 /opt/mattermost-nudge-bot/.env
Run service as a dedicated low-privilege user instead of root.

Use SMTP credentials with app-specific password where possible.

Reliability

Add a daily backup for nudges.json.

Add health monitoring:

systemctl is-active mattermost-nudge-bot
alert if service restarts too often
Add log rotation if logs grow quickly.

Operations

Create a small admin runbook:

restart command
log path
where data file is stored
Pin Node.js major version to avoid surprise runtime changes.
Test monthly rollover behavior at month boundary.