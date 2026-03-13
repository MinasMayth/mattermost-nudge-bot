'use strict';

require('dotenv').config();

const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { dispatch } = require('./commands');
const storage = require('./storage');
const { sendAlert } = require('./mailer');
const { createReactionMonitor } = require('./reaction-monitor');

const {
  MATTERMOST_URL,
  MATTERMOST_TOKEN,
  STORAGE_FILE,
  NUDGE_ALERT_THRESHOLD,
  REACTION_MONITOR_CHANNEL_IDS,
  REACTION_MONITOR_CHANNEL_ID,
  REACTION_MONITOR_USERS,
  REACTION_TIMEOUT_MINUTES,
  REACTION_MONITOR_CONFIRM_REACTIONS,
} = process.env;

if (!MATTERMOST_URL || !MATTERMOST_TOKEN) {
  console.error('MATTERMOST_URL and MATTERMOST_TOKEN must be set in your environment or .env file.');
  process.exit(1);
}

const monitorChannelIds = String(
  REACTION_MONITOR_CHANNEL_IDS || REACTION_MONITOR_CHANNEL_ID || '',
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const monitorUsers = String(REACTION_MONITOR_USERS || '')
  .split(',')
  .map((name) => name.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);
const reactionTimeoutMinutes = parseInt(REACTION_TIMEOUT_MINUTES || '60', 10);
const reactionMonitorEnabled = monitorChannelIds.length > 0 && monitorUsers.length > 0;
const alertThreshold = parseInt(NUDGE_ALERT_THRESHOLD || '5', 10);
const confirmReactionsEnabled = /^(1|true|yes|on)$/i.test(
  String(REACTION_MONITOR_CONFIRM_REACTIONS || ''),
);

const reactionMonitor = createReactionMonitor({
  channelIds: monitorChannelIds,
  monitoredUsernames: monitorUsers,
  timeoutMs: Math.max(1, reactionTimeoutMinutes) * 60 * 1000,
});
const userIdCache = new Map();
let reactionTimeoutInterval = null;

/**
 * Make a JSON REST API request to the Mattermost server.
 */
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const base = new URL(MATTERMOST_URL);
    const isHttps = base.protocol === 'https:';
    const options = {
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path: `/api/v4${path}`,
      method,
      headers: {
        Authorization: `Bearer ${MATTERMOST_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const transport = isHttps ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Thin client object passed to command handlers so they can post messages.
 */
const client = {
  postMessage(message, channelId) {
    return apiRequest('POST', '/posts', { channel_id: channelId, message });
  },
};

async function getUsernameById(userId) {
  if (!userId) return null;
  if (userIdCache.has(userId)) return userIdCache.get(userId);

  const user = await apiRequest('GET', `/users/${userId}`);
  if (!user || !user.username) return null;
  userIdCache.set(userId, user.username);
  return user.username;
}

async function processExpiredReactionTimeouts() {
  const expired = reactionMonitor.collectExpired(Date.now());
  if (expired.length === 0) return;

  for (const item of expired) {
    for (const username of item.missingUsernames) {
      const result = storage.recordNudge(username, 'reaction-monitor', {
        filePath: STORAGE_FILE,
        threshold: alertThreshold,
      });

      const note = `@${username} did not react in time in the monitored channel and now has ${result.count} nudge(s) this month.`;
      await client.postMessage(note, item.channelId);

      if (result.alerted) {
        try {
          await sendAlert(username, result.count);
          console.log(`Alert sent for @${username} (${result.count} nudges).`);
        } catch (err) {
          console.error(`Failed to send alert for @${username}:`, err.message);
        }
      }
    }
  }
}

/**
 * Connect to the Mattermost WebSocket event stream and dispatch incoming
 * channel posts to the command handlers.
 */
async function start() {
  const me = await apiRequest('GET', '/users/me');
  console.log(`Logged in as @${me.username} (id: ${me.id})`);

  if (reactionMonitorEnabled) {
    console.log(
      `Reaction monitor enabled for channels ${monitorChannelIds.join(', ')} with timeout ${reactionTimeoutMinutes} minute(s) for users: ${monitorUsers.join(', ')}`,
    );
    if (!reactionTimeoutInterval) {
      reactionTimeoutInterval = setInterval(() => {
        processExpiredReactionTimeouts().catch((err) => {
          console.error('Failed processing reaction timeouts:', err);
        });
      }, 15000);
    }
  }

  const base = new URL(MATTERMOST_URL);
  const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${base.host}/api/v4/websocket`;

  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${MATTERMOST_TOKEN}` },
  });

  ws.on('open', () => {
    console.log('WebSocket connected.');
    // Authenticate over the WebSocket channel as well
    ws.send(JSON.stringify({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: MATTERMOST_TOKEN },
    }));
  });

  ws.on('message', async (raw) => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (reactionMonitorEnabled && event.event === 'reaction_added') {
      try {
        const reaction = JSON.parse(event.data.reaction || '{}');
        const username = await getUsernameById(reaction.user_id);
        if (username) {
            const result = reactionMonitor.recordReaction({
            postId: reaction.post_id,
            username,
          });

            if (result.recognized) {
              console.log(`Reaction recognized for post ${result.postId} from @${result.username}.`);
              if (confirmReactionsEnabled && result.channelId) {
                const emoji = reaction.emoji_name ? `:${reaction.emoji_name}: ` : '';
                await client.postMessage(
                  `${emoji}Reaction from @${result.username} registered for this message.`,
                  result.channelId,
                );
              }
            } else {
              console.log(`Reaction ignored for post ${reaction.post_id} from @${username} (post not tracked or user not pending).`);
            }
          } else {
            console.warn(`Reaction event received but username lookup failed for user_id ${reaction.user_id}.`);
        }
      } catch (err) {
        console.error('Failed to handle reaction_added event:', err);
      }
      return;
    }

    if (event.event !== 'posted') return;

    let post;
    try {
      post = JSON.parse(event.data.post);
    } catch {
      return;
    }

    // Ignore messages sent by the bot itself
    if (post.user_id === me.id) return;

    // Resolve the sender's username from the event broadcast data
    const senderUsername = event.data.sender_name
      ? event.data.sender_name.replace(/^@/, '')
      : post.user_id;

    if (reactionMonitorEnabled) {
      reactionMonitor.trackPost({
        postId: post.id,
        channelId: post.channel_id,
        authorUsername: senderUsername,
        createdAtMs: post.create_at || Date.now(),
      });
    }

    try {
      await dispatch(post, senderUsername, client);
    } catch (err) {
      console.error('Error dispatching message:', err);
    }
  });

  ws.on('error', (err) => console.error('WebSocket error:', err));
  ws.on('close', (code, reason) => {
    console.warn(`WebSocket closed (${code}: ${reason}). Reconnecting in 5 s…`);
    setTimeout(start, 5000);
  });
}

start().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

module.exports = { client, apiRequest };
