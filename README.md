# mattermost-nudge-bot

A Mattermost bot that tracks **nudges** (Anstupser) per user based on **missed
reactions** in a monitored channel and automatically sends an alert e-mail to
`ak-crewcare@krakelee.org` when someone receives **5 or more nudges in a single
calendar month**.

---

## Features

| Command | Description |
|---|---|
| `!nudge @username` | Disabled for setting nudges. The bot replies that nudges are automatic via reaction timeouts. |
| `!nudges` | Disabled by design (leaderboards are not shown). |

Primary nudge flow: configure reaction monitoring so nudges are created
automatically when monitored users do not react in time.

---

## Requirements

- Node.js ≥ 18
- A [Mattermost bot account](https://docs.mattermost.com/developer/bot-accounts.html) with a personal-access-token or bot token
- An SMTP server for sending alert e-mails

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/MinasMayth/mattermost-nudge-bot.git
cd mattermost-nudge-bot
npm install
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```dotenv
# Mattermost connection
MATTERMOST_URL=https://your-mattermost-instance.example.com
MATTERMOST_TOKEN=your-bot-token

# SMTP settings for alert e-mails
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=nudge-bot@krakelee.org

# Alert recipient (default: ak-crewcare@krakelee.org)
ALERT_EMAIL=ak-crewcare@krakelee.org

# Path to the JSON file used to persist nudge data (default: ./nudges.json)
STORAGE_FILE=./nudges.json

# Number of nudges per month that trigger the alert e-mail (default: 5)
NUDGE_ALERT_THRESHOLD=5

# Reaction monitor setup (recommended)
# Comma-separated channel IDs where posts are monitored
REACTION_MONITOR_CHANNEL_IDS=channelid1,channelid2
# Backward-compatible single channel ID option
REACTION_MONITOR_CHANNEL_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
# Comma-separated usernames that must react before timeout (with or without @)
REACTION_MONITOR_USERS=alice,bob,charlie
# Timeout window in minutes (default: 60)
REACTION_TIMEOUT_MINUTES=60
# Post a channel confirmation when a reaction is recognized (default: false)
REACTION_MONITOR_CONFIRM_REACTIONS=true
# Track only posts explicitly marked by emoji reaction (default: false)
REACTION_MONITOR_ONLY_MARKED=true
# Marker emoji used to enable tracking for a post (default: triangular_flag_on_post)
REACTION_MONITOR_MARKER_EMOJI=triangular_flag_on_post
```

### 3. Start

```bash
npm start
```

---

## How it works

1. The bot connects to the Mattermost WebSocket event stream.
2. If `REACTION_MONITOR_ONLY_MARKED=false`, every new post in
   `REACTION_MONITOR_CHANNEL_IDS` (or `REACTION_MONITOR_CHANNEL_ID`) starts a
   timeout window (`REACTION_TIMEOUT_MINUTES`).
3. If `REACTION_MONITOR_ONLY_MARKED=true`, a post starts tracking only after
   someone reacts to it with `REACTION_MONITOR_MARKER_EMOJI` (default
   `:triangular_flag_on_post:`).
4. The usernames listed in `REACTION_MONITOR_USERS` are expected to react to the
   post before the timeout.
5. If a configured user did not react in time, the bot records one nudge for
   that user in `nudges.json` and sends them a direct message.
6. Nudges are scoped to the **calendar month** in which they occur.
7. The first time a user's nudge count reaches the configured threshold (default
   **5**) in a given month, the bot sends an e-mail to the alert address.
8. Subsequent nudges in the same month do **not** send additional alert e-mails
   (the "alerted" flag is persisted to disk).

---

## Running tests

```bash
npm test
```

---

## Project structure

```
src/
  bot.js        Main entry point – WebSocket connection & event routing
   commands.js   Command parsing and dispatch (!nudge, !nudges disabled)
  storage.js    Nudge persistence (JSON file)
  mailer.js     Alert e-mail sending (nodemailer)
tests/
  storage.test.js
  commands.test.js
  mailer.test.js
.env.example    Environment variable template
```
