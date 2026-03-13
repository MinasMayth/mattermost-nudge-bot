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
  test('replies with error when no mention given', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudge', channel_id: 'ch1' };

    await handleNudge(msg, 'alice', client, { filePath: file });

    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.messages[0].text).toMatch(/Usage/i);
  });

  test('prevents self-nudge', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudge @alice', channel_id: 'ch1' };

    await handleNudge(msg, 'alice', client, { filePath: file });

    expect(client.messages[0].text).toMatch(/can't nudge yourself/i);
  });

  test('records nudge and replies with count', async () => {
    const file = tmpFile();
    const client = mockClient();
    const now = new Date('2025-09-01T10:00:00Z');
    const msg = { message: '!nudge @bob', channel_id: 'ch1' };

    await handleNudge(msg, 'alice', client, { filePath: file, now });

    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.messages[0].text).toMatch(/@bob/);
    expect(client.messages[0].text).toMatch(/1 nudge/);

    fs.unlinkSync(file);
  });

  test('triggers alert and calls sendAlert at threshold', async () => {
    const file = tmpFile();
    const now = new Date('2025-09-01T10:00:00Z');
    const sentAlerts = [];

    const fakeAlertOpts = {
      transporter: {
        sendMail: async (mail) => {
          sentAlerts.push(mail);
          return {};
        },
      },
      alertEmail: 'ak-crewcare@krakelee.org',
    };

    for (let i = 1; i <= 4; i++) {
      const client = mockClient();
      const msg = { message: `!nudge @target`, channel_id: 'ch1' };
      await handleNudge(msg, `user${i}`, client, { filePath: file, threshold: 5, now, alertOpts: fakeAlertOpts });
    }

    expect(sentAlerts).toHaveLength(0);

    const client5 = mockClient();
    const msg5 = { message: '!nudge @target', channel_id: 'ch1' };
    await handleNudge(msg5, 'user5', client5, { filePath: file, threshold: 5, now, alertOpts: fakeAlertOpts });

    expect(sentAlerts).toHaveLength(1);
    expect(sentAlerts[0].to).toBe('ak-crewcare@krakelee.org');
    expect(sentAlerts[0].subject).toMatch(/target/);

    fs.unlinkSync(file);
  });
});

describe('handleNudges', () => {
  test('reports no nudges when month is empty', async () => {
    const file = tmpFile();
    const client = mockClient();
    const msg = { message: '!nudges', channel_id: 'ch1' };

    await handleNudges(msg, client, { filePath: file });

    expect(client.messages[0].text).toMatch(/No nudges/i);
  });

  test('lists nudge counts', async () => {
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
    expect(reply).toMatch(/bob/);
    expect(reply).toMatch(/2/);
    expect(reply).toMatch(/charlie/);

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
    expect(client.messages[0].text).toMatch(/@dave/);

    fs.unlinkSync(file);
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
