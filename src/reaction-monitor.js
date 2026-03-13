'use strict';

/**
 * Build an in-memory monitor that tracks whether monitored users reacted to
 * new posts in one specific channel within a configured timeout.
 */
function createReactionMonitor(options) {
  const opts = options || {};
  const channelIds = Array.isArray(opts.channelIds)
    ? opts.channelIds
    : (opts.channelId ? [opts.channelId] : []);
  const channelSet = new Set(
    channelIds
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 60 * 60 * 1000;
  const monitoredUsernames = Array.isArray(opts.monitoredUsernames)
    ? opts.monitoredUsernames
    : [];

  const monitoredSet = new Set(
    monitoredUsernames
      .map((name) => String(name || '').trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  );

  // post_id -> { channelId, deadlineMs, pendingUsernames: Set<string> }
  const pendingByPostId = new Map();

  function trackPost(post) {
    if (channelSet.size === 0 || monitoredSet.size === 0) return false;
    if (!post || !post.postId || !channelSet.has(post.channelId)) return false;

    const author = String(post.authorUsername || '').trim().toLowerCase();
    const pendingUsernames = new Set(monitoredSet);
    if (author) {
      // The post author is not expected to react to their own post.
      pendingUsernames.delete(author);
    }

    if (pendingUsernames.size === 0) return false;

    const createdAtMs = post.createdAtMs != null ? post.createdAtMs : Date.now();
    pendingByPostId.set(post.postId, {
      channelId: post.channelId,
      deadlineMs: createdAtMs + timeoutMs,
      pendingUsernames,
    });

    return true;
  }

  function recordReaction(reaction) {
    if (!reaction || !reaction.postId || !reaction.username) {
      return { recognized: false };
    }
    const record = pendingByPostId.get(reaction.postId);
    if (!record) {
      return { recognized: false };
    }

    const username = String(reaction.username).trim().replace(/^@/, '').toLowerCase();
    if (!username) {
      return { recognized: false };
    }

    const recognized = record.pendingUsernames.delete(username);
    return {
      recognized,
      channelId: record.channelId,
      postId: reaction.postId,
      username,
    };
  }

  function collectExpired(nowMs) {
    const now = nowMs != null ? nowMs : Date.now();
    const missed = [];

    for (const [postId, record] of pendingByPostId.entries()) {
      if (record.deadlineMs > now) continue;

      if (record.pendingUsernames.size > 0) {
        missed.push({
          postId,
          channelId: record.channelId,
          missingUsernames: Array.from(record.pendingUsernames).sort(),
        });
      }

      pendingByPostId.delete(postId);
    }

    return missed;
  }

  return {
    trackPost,
    recordReaction,
    collectExpired,
  };
}

module.exports = { createReactionMonitor };
