'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseMention, handleNudge, handleNudges, dispatch } = require('../src/commands');

function tmpFile() {
  return path.join(os.tmpdir(), `nudges-cmd-test-${Date.now()}-${Math.random()}.json`);
}

function mockClient() {
  const messages = [];
  return {
    messages,
    postMessage: jest.fn(async (text, channelId) => {
      messages.push({ text, channelId });
    }),
  };
}

describe('parseMention', () => {
  test('extracts username from mention', () => {
    expect(parseMention('!nudge @alice')).toBe('alice');
    expect(parseMention('@bob some text')).toBe('bob');
  });

  test('returns null when no mention found', () => {
    expect(parseMention('!nudges')).toBeNull();
    expect(parseMention('hello world')).toBeNull();
  });
});

describe('handleNudge', () => {
  test('always reports that manual nudges are disabled', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudge', channel_id: 'ch1' };

    await handleNudge(msg, 'alice', client, { filePath: file });

    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.messages[0].text).toMatch(/manual nudges are disabled/i);
  });

  test('does not write nudge data when command is used', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudge @alice', channel_id: 'ch1' };

    await handleNudge(msg, 'alice', client, { filePath: file });

    expect(client.messages[0].text).toMatch(/automatic/i);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('handleNudges', () => {
  test('always reports leaderboard is disabled', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudges', channel_id: 'ch1' };

    await handleNudges(msg, client, { filePath: file });

    expect(client.messages[0].text).toMatch(/leaderboard is disabled/i);
  });

  test('does not list user counts', async () => {
    const file = tmpFile();
    const now = new Date('2025-09-01T10:00:00Z');

    // Pre-populate nudges
    const { recordNudge } = require('../src/storage');
    recordNudge('bob', 'x', { filePath: file, now });
    recordNudge('bob', 'x', { filePath: file, now });
    recordNudge('charlie', 'x', { filePath: file, now });

    const client = mockClient();
    const msg = { message: '!nudges', channel_id: 'ch1' };
    await handleNudges(msg, client, { filePath: file, now });

    const reply = client.messages[0].text;
    expect(reply).toMatch(/leaderboard is disabled/i);
    expect(reply).not.toMatch(/bob/);
    expect(reply).not.toMatch(/charlie/);

    fs.unlinkSync(file);
  });
});

describe('dispatch', () => {
  test('routes !nudge to handleNudge', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudge @dave', channel_id: 'ch1' };

    await dispatch(msg, 'alice', client, { filePath: file });

    expect(client.postMessage).toHaveBeenCalled();
    expect(client.messages[0].text).toMatch(/manual nudges are disabled/i);
  });

  test('routes !nudges to handleNudges', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudges', channel_id: 'ch1' };

    await dispatch(msg, 'alice', client, { filePath: file });

    expect(client.postMessage).toHaveBeenCalled();

    if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  test('ignores unrecognised commands', async () => {
    const client = mockClient();
    const msg = { message: 'hello world', channel_id: 'ch1' };

    await dispatch(msg, 'alice', client);

    expect(client.postMessage).not.toHaveBeenCalled();
  });
});
