'use strict';

/**
 * Extract a Mattermost @mention username from a string.
 * Strips the leading "@" and any trailing punctuation.
 */
function parseMention(text) {
  const match = text.match(/@([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

/**
 * Handle the `!nudge @username` command.
 *
 * @param {object} message   – Parsed Mattermost post object
 * @param {string} senderUsername
 * @param {object} client    – Mattermost client (used to reply in channel)
 * @param {object} [opts]    – Overrides (filePath, threshold, now, alertOpts)
 */
async function handleNudge(message, senderUsername, client, opts) {
  await client.postMessage(
    'Manual nudges are disabled. Nudges are created automatically when monitored users do not react in time.',
    message.channel_id,
  );
}

/**
 * Handle the `!nudges` command.
 *
 * Leaderboards are intentionally disabled to avoid exposing per-user counts.
 *
 * @param {object} message
 * @param {object} client
 */
async function handleNudges(message, client) {
  await client.postMessage(
    'The `!nudges` leaderboard is disabled on this bot.',
    message.channel_id,
  );
}

/**
 * Dispatch an incoming message to the appropriate command handler.
 *
 * @param {object} message         – Mattermost post object
 * @param {string} senderUsername
 * @param {object} client
 * @param {object} [opts]
 */
async function dispatch(message, senderUsername, client, opts) {
  const text = (message.message || '').trim();

  if (/^!nudge\b/.test(text)) {
    await handleNudge(message, senderUsername, client, opts);
  } else if (/^!nudges\b/.test(text)) {
    await handleNudges(message, client, opts);
  }
}

module.exports = { parseMention, handleNudge, handleNudges, dispatch };
