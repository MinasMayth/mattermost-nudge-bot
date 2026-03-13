'use strict';

const { createReactionMonitor } = require('../src/reaction-monitor');

describe('createReactionMonitor', () => {
  test('tracks posts only in the configured channel', () => {
    const monitor = createReactionMonitor({
      channelId: 'target-channel',
      monitoredUsernames: ['alice', 'bob'],
      timeoutMs: 1000,
    });

    expect(monitor.trackPost({
      postId: 'p1',
      channelId: 'other-channel',
      authorUsername: 'charlie',
      createdAtMs: 0,
    })).toBe(false);

    expect(monitor.trackPost({
      postId: 'p2',
      channelId: 'target-channel',
      authorUsername: 'charlie',
      createdAtMs: 0,
    })).toBe(true);
  });

  test('tracks posts in any configured channel when channelIds is used', () => {
    const monitor = createReactionMonitor({
      channelIds: ['a', 'b'],
      monitoredUsernames: ['alice'],
      timeoutMs: 1000,
    });

    expect(monitor.trackPost({
      postId: 'p1',
      channelId: 'a',
      authorUsername: 'charlie',
      createdAtMs: 0,
    })).toBe(true);

    expect(monitor.trackPost({
      postId: 'p2',
      channelId: 'b',
      authorUsername: 'charlie',
      createdAtMs: 0,
    })).toBe(true);

    expect(monitor.trackPost({
      postId: 'p3',
      channelId: 'c',
      authorUsername: 'charlie',
      createdAtMs: 0,
    })).toBe(false);
  });

  test('does not expect the post author to react', () => {
    const monitor = createReactionMonitor({
      channelId: 'target-channel',
      monitoredUsernames: ['alice', 'bob'],
      timeoutMs: 1000,
    });

    monitor.trackPost({
      postId: 'p1',
      channelId: 'target-channel',
      authorUsername: 'alice',
      createdAtMs: 0,
    });

    const expired = monitor.collectExpired(1001);
    expect(expired).toHaveLength(1);
    expect(expired[0].missingUsernames).toEqual(['bob']);
  });

  test('removes users from missing list when they react in time', () => {
    const monitor = createReactionMonitor({
      channelId: 'target-channel',
      monitoredUsernames: ['alice', 'bob'],
      timeoutMs: 1000,
    });

    monitor.trackPost({
      postId: 'p1',
      channelId: 'target-channel',
      authorUsername: 'charlie',
      createdAtMs: 0,
    });

    expect(monitor.recordReaction({ postId: 'p1', username: 'alice' })).toBe(true);

    const expired = monitor.collectExpired(1001);
    expect(expired).toHaveLength(1);
    expect(expired[0].missingUsernames).toEqual(['bob']);
  });

  test('returns no misses when everyone reacted in time', () => {
    const monitor = createReactionMonitor({
      channelId: 'target-channel',
      monitoredUsernames: ['alice', 'bob'],
      timeoutMs: 1000,
    });

    monitor.trackPost({
      postId: 'p1',
      channelId: 'target-channel',
      authorUsername: 'charlie',
      createdAtMs: 0,
    });

    monitor.recordReaction({ postId: 'p1', username: 'alice' });
    monitor.recordReaction({ postId: 'p1', username: 'bob' });

    expect(monitor.collectExpired(1001)).toEqual([]);
  });
});
