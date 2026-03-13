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
  REACTION_MONITOR_ONLY_MARKED,
  REACTION_MONITOR_MARKER_EMOJI,
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
const uniqueMonitorUsers = Array.from(new Set(monitorUsers));
const reactionTimeoutMinutes = parseInt(REACTION_TIMEOUT_MINUTES || '60', 10);
const reactionMonitorEnabled = monitorChannelIds.length > 0 && uniqueMonitorUsers.length > 0;
const alertThreshold = parseInt(NUDGE_ALERT_THRESHOLD || '5', 10);
const confirmReactionsEnabled = /^(1|true|yes|on)$/i.test(
  String(REACTION_MONITOR_CONFIRM_REACTIONS || ''),
);
const onlyMarkedEnabled = /^(1|true|yes|on)$/i.test(
  String(REACTION_MONITOR_ONLY_MARKED || ''),
);
const markerEmoji = String(REACTION_MONITOR_MARKER_EMOJI || 'triangular_flag_on_post')
  .trim()
  .replace(/^:/, '')
  .replace(/:$/, '')
  .toLowerCase();

const reactionMonitor = createReactionMonitor({
  channelIds: monitorChannelIds,
  monitoredUsernames: uniqueMonitorUsers,
  timeoutMs: Math.max(1, reactionTimeoutMinutes) * 60 * 1000,
});
const userIdCache = new Map();
const usernameIdCache = new Map();
const directChannelCache = new Map();
let botUserId = null;
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
 * Mattermost websocket event fields are usually JSON strings, but depending on
 * gateway/proxy layers they may already be objects.
 */
function parseEventJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  usernameIdCache.set(String(user.username).toLowerCase(), userId);
  return user.username;
}

async function getUserIdByUsername(username) {
  const cleanUsername = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!cleanUsername) return null;
  if (usernameIdCache.has(cleanUsername)) return usernameIdCache.get(cleanUsername);

  const user = await apiRequest('GET', `/users/username/${encodeURIComponent(cleanUsername)}`);
  if (!user || !user.id || !user.username) return null;

  userIdCache.set(user.id, user.username);
  usernameIdCache.set(String(user.username).toLowerCase(), user.id);
  return user.id;
}

async function getDirectChannelIdForUser(userId) {
  if (!botUserId || !userId) return null;
  if (directChannelCache.has(userId)) return directChannelCache.get(userId);

  const channel = await apiRequest('POST', '/channels/direct', [botUserId, userId]);
  if (!channel || !channel.id) return null;

  directChannelCache.set(userId, channel.id);
  return channel.id;
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
      try {
        const userId = await getUserIdByUsername(username);
        const directChannelId = userId ? await getDirectChannelIdForUser(userId) : null;

        if (directChannelId) {
          await client.postMessage(note, directChannelId);
        } else {
          console.warn(`Failed to open DM for @${username}, posting nudge message in source channel.`);
          await client.postMessage(note, item.channelId);
        }
      } catch (err) {
        console.warn(`Failed to deliver DM nudge message to @${username}, posting in source channel: ${err.message}`);
        await client.postMessage(note, item.channelId);
      }

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

async function tryTrackPostById(postId, options) {
  const opts = options || {};
  if (!postId) return false;

  const post = await apiRequest('GET', `/posts/${postId}`);
  if (!post || !post.id || !post.channel_id || !post.user_id) return false;

  const authorUsername = await getUsernameById(post.user_id);
  if (!authorUsername) return false;

  return reactionMonitor.trackPost({
    postId: post.id,
    channelId: post.channel_id,
    authorUsername,
    createdAtMs: opts.createdAtMs != null ? opts.createdAtMs : (post.create_at || Date.now()),
  });
}

/**
 * Connect to the Mattermost WebSocket event stream and dispatch incoming
 * channel posts to the command handlers.
 */
async function start() {
  const me = await apiRequest('GET', '/users/me');
  botUserId = me.id;
  console.log(`Logged in as @${me.username} (id: ${me.id})`);

  if (reactionMonitorEnabled) {
    console.log(
      `Reaction monitor enabled for channels ${monitorChannelIds.join(', ')} with timeout ${reactionTimeoutMinutes} minute(s) for users: ${uniqueMonitorUsers.join(', ')}`,
    );
    if (onlyMarkedEnabled) {
      console.log(`Only marked posts are tracked (marker emoji: :${markerEmoji}:).`);
    }
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
          const reaction = parseEventJson(event.data.reaction);
          if (!reaction || !reaction.post_id || !reaction.user_id) {
            console.warn('Reaction event ignored because payload was missing post_id/user_id.');
            return;
          }
          const reactionEmoji = String(reaction.emoji_name || '').trim().toLowerCase();
          const isMarkerReaction = reactionEmoji === markerEmoji;
        const username = await getUsernameById(reaction.user_id);
        if (username) {
            let result = reactionMonitor.recordReaction({
            postId: reaction.post_id,
            username,
          });

            if (!result.recognized && result.reason === 'post-not-tracked') {
              let tracked = false;

              if (onlyMarkedEnabled) {
                if (isMarkerReaction) {
                  tracked = await tryTrackPostById(reaction.post_id, { createdAtMs: Date.now() });
                  if (tracked) {
                    console.log(
                      `Tracking enabled for post ${reaction.post_id} after marker reaction :${markerEmoji}: by @${username}.`,
                    );
                  }
                }
              } else {
                tracked = await tryTrackPostById(reaction.post_id);
              }

              if (tracked) {
                result = reactionMonitor.recordReaction({
                  postId: reaction.post_id,
                  username,
                });
              }
            }

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
              console.log(
                `Reaction ignored for post ${reaction.post_id} from @${username} (reason: ${result.reason || 'unknown'}).`,
              );
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

      const post = parseEventJson(event.data.post);
      if (!post || !post.id || !post.channel_id || !post.user_id) {
      return;
    }

    // Ignore messages sent by the bot itself
    if (post.user_id === me.id) return;

    // Resolve the sender's username from the event broadcast data
    const senderUsername = event.data.sender_name
      ? event.data.sender_name.replace(/^@/, '')
      : post.user_id;

    if (reactionMonitorEnabled) {
        if (!onlyMarkedEnabled) {
          const tracked = reactionMonitor.trackPost({
            postId: post.id,
            channelId: post.channel_id,
            authorUsername: senderUsername,
            createdAtMs: post.create_at || Date.now(),
          });
          if (tracked) {
            console.log(`Tracking monitored post ${post.id} in channel ${post.channel_id}.`);
          }
        }
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
