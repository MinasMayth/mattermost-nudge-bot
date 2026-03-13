'use strict';

require('dotenv').config();

const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { dispatch } = require('./commands');

const {
  MATTERMOST_URL,
  MATTERMOST_TOKEN,
} = process.env;

if (!MATTERMOST_URL || !MATTERMOST_TOKEN) {
  console.error('MATTERMOST_URL and MATTERMOST_TOKEN must be set in your environment or .env file.');
  process.exit(1);
}

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

/**
 * Connect to the Mattermost WebSocket event stream and dispatch incoming
 * channel posts to the command handlers.
 */
async function start() {
  const me = await apiRequest('GET', '/users/me');
  console.log(`Logged in as @${me.username} (id: ${me.id})`);

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
