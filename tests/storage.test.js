'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../src/storage');

function tmpFile() {
  return path.join(os.tmpdir(), `nudges-test-${Date.now()}-${Math.random()}.json`);
}

describe('monthKey', () => {
  test('formats date correctly', () => {
    expect(storage.monthKey(new Date('2025-03-15T10:00:00Z'))).toBe('2025-03');
    expect(storage.monthKey(new Date('2025-12-01T00:00:00Z'))).toBe('2025-12');
  });
});

describe('load / save round-trip', () => {
  test('returns empty object when file does not exist', () => {
    expect(storage.load('/tmp/does-not-exist-ever.json')).toEqual({});
  });

  test('returns empty object when file contains invalid JSON', () => {
    const file = tmpFile();
    fs.writeFileSync(file, 'NOT JSON', 'utf8');
    expect(storage.load(file)).toEqual({});
    fs.unlinkSync(file);
  });

  test('saves and loads data correctly', () => {
    const file = tmpFile();
    const data = { '2025-03': { alice: { count: 2, alerted: false, entries: [] } } };
    storage.save(data, file);
    expect(storage.load(file)).toEqual(data);
    fs.unlinkSync(file);
  });
});

describe('recordNudge', () => {
  test('increments nudge count for a user', () => {
    const file = tmpFile();
    const now = new Date('2025-04-10T12:00:00Z');
    const r1 = storage.recordNudge('bob', 'alice', { filePath: file, now });
    expect(r1.count).toBe(1);
    expect(r1.alerted).toBe(false);

    const r2 = storage.recordNudge('bob', 'charlie', { filePath: file, now });
    expect(r2.count).toBe(2);
    expect(r2.alerted).toBe(false);

    fs.unlinkSync(file);
  });

  test('triggers alert exactly once at threshold', () => {
    const file = tmpFile();
    const now = new Date('2025-04-10T12:00:00Z');
    const opts = { filePath: file, threshold: 5, now };

    for (let i = 1; i <= 4; i++) {
      const r = storage.recordNudge('dave', 'user' + i, opts);
      expect(r.alerted).toBe(false);
    }

    const r5 = storage.recordNudge('dave', 'user5', opts);
    expect(r5.count).toBe(5);
    expect(r5.alerted).toBe(true);

    // 6th nudge must NOT trigger another alert
    const r6 = storage.recordNudge('dave', 'user6', opts);
    expect(r6.count).toBe(6);
    expect(r6.alerted).toBe(false);

    fs.unlinkSync(file);
  });

  test('different users tracked independently', () => {
    const file = tmpFile();
    const now = new Date('2025-04-10T12:00:00Z');
    storage.recordNudge('alice', 'x', { filePath: file, now });
    storage.recordNudge('bob', 'x', { filePath: file, now });
    storage.recordNudge('alice', 'x', { filePath: file, now });

    expect(storage.getUserCount('alice', { filePath: file, now })).toBe(2);
    expect(storage.getUserCount('bob', { filePath: file, now })).toBe(1);

    fs.unlinkSync(file);
  });

  test('nudges in different months are counted separately', () => {
    const file = tmpFile();
    const april = new Date('2025-04-10T12:00:00Z');
    const may = new Date('2025-05-10T12:00:00Z');

    for (let i = 0; i < 4; i++) {
      storage.recordNudge('eve', 'sender', { filePath: file, threshold: 5, now: april });
    }

    // Crossing threshold in May should still trigger alert
    for (let i = 0; i < 4; i++) {
      const r = storage.recordNudge('eve', 'sender', { filePath: file, threshold: 5, now: may });
      expect(r.alerted).toBe(false);
    }
    const r5 = storage.recordNudge('eve', 'sender', { filePath: file, threshold: 5, now: may });
    expect(r5.alerted).toBe(true);

    fs.unlinkSync(file);
  });
});

describe('getMonthSummary', () => {
  test('returns empty array when no nudges', () => {
    const file = tmpFile();
    expect(storage.getMonthSummary({ filePath: file })).toEqual([]);
  });

  test('returns entries sorted by count descending', () => {
    const file = tmpFile();
    const now = new Date('2025-06-01T00:00:00Z');
    storage.recordNudge('alpha', 'x', { filePath: file, now });
    storage.recordNudge('beta', 'x', { filePath: file, now });
    storage.recordNudge('beta', 'y', { filePath: file, now });

    const summary = storage.getMonthSummary({ filePath: file, now });
    expect(summary[0].username).toBe('beta');
    expect(summary[0].count).toBe(2);
    expect(summary[1].username).toBe('alpha');
    expect(summary[1].count).toBe(1);

    fs.unlinkSync(file);
  });
});

describe('getUserCount', () => {
  test('returns 0 for unknown user', () => {
    const file = tmpFile();
    expect(storage.getUserCount('nobody', { filePath: file })).toBe(0);
  });
});
