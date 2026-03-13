# mattermost-nudge-bot

A Mattermost bot that tracks **nudges** (Anstupser) per user and automatically
sends an alert e-mail to `ak-crewcare@krakelee.org` when someone receives **5 or
more nudges in a single calendar month**.

---

## Features

| Command | Description |
|---|---|
| `!nudge @username` | Nudge a user. Records the nudge and replies with the current monthly count. When the threshold is reached for the first time that month, an alert e-mail is sent automatically. |
| `!nudges` | Show the nudge leaderboard for the current month. Users who have already triggered an alert are marked with 🚨. |

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
```

### 3. Start

```bash
npm start
```

---

## How it works

1. The bot connects to the Mattermost WebSocket event stream.
2. Every time a channel message matches `!nudge @username`, the nudge is
   written to a local JSON file (`nudges.json` by default).
3. Nudges are scoped to the **calendar month** in which they occur.
4. The first time a user's nudge count reaches the configured threshold (default
   **5**) in a given month, the bot sends an e-mail to the alert address.
5. Subsequent nudges in the same month do **not** send additional alert e-mails
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
  commands.js   Command parsing and dispatch (!nudge, !nudges)
  storage.js    Nudge persistence (JSON file)
  mailer.js     Alert e-mail sending (nodemailer)
tests/
  storage.test.js
  commands.test.js
  mailer.test.js
.env.example    Environment variable template
```
