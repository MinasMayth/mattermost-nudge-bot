'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.resolve('./nudges.json');

/**
 * Load nudge data from disk, returning an empty object if the file does not
 * exist yet.
 *
 * Schema:
 * {
 *   "<YYYY-MM>": {
 *     "<username>": {
 *       count: <number>,
 *       alerted: <boolean>,
 *       entries: [{ by: "<nudger>", at: "<ISO timestamp>" }, ...]
 *     }
 *   }
 * }
 */
function load(filePath) {
  const file = filePath || DEFAULT_FILE;
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persist nudge data to disk.
 */
function save(data, filePath) {
  const file = filePath || DEFAULT_FILE;
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Return the month key (YYYY-MM) for a given Date (defaults to now).
 */
function monthKey(date) {
  const d = date || new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Record a nudge from `nudgerUsername` aimed at `targetUsername`.
 *
 * Returns an object:
 * {
 *   count:   <total nudges for target this month>,
 *   alerted: <true if this nudge caused the threshold to be crossed for the
 *              first time – i.e. the caller should now send an alert>
 * }
 */
function recordNudge(targetUsername, nudgerUsername, options) {
  const opts = options || {};
  const filePath = opts.filePath;
  const threshold = opts.threshold != null ? opts.threshold : 5;
  const now = opts.now || new Date();

  const data = load(filePath);
  const key = monthKey(now);

  if (!data[key]) {
    data[key] = {};
  }
  if (!data[key][targetUsername]) {
    data[key][targetUsername] = { count: 0, alerted: false, entries: [] };
  }

  const record = data[key][targetUsername];
  record.count += 1;
  record.entries.push({ by: nudgerUsername, at: now.toISOString() });

  let shouldAlert = false;
  if (record.count >= threshold && !record.alerted) {
    record.alerted = true;
    shouldAlert = true;
  }

  save(data, filePath);
  return { count: record.count, alerted: shouldAlert };
}

/**
 * Return nudge counts for all users in the given month (defaults to current).
 *
 * Returns an array of { username, count, alerted } sorted by count descending.
 */
function getMonthSummary(options) {
  const opts = options || {};
  const filePath = opts.filePath;
  const now = opts.now || new Date();

  const data = load(filePath);
  const key = monthKey(now);
  const monthData = data[key] || {};

  return Object.entries(monthData)
    .map(([username, record]) => ({
      username,
      count: record.count,
      alerted: record.alerted,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Return the nudge count for a specific user in the current month.
 */
function getUserCount(username, options) {
  const opts = options || {};
  const filePath = opts.filePath;
  const now = opts.now || new Date();

  const data = load(filePath);
  const key = monthKey(now);
  return (data[key] && data[key][username] && data[key][username].count) || 0;
}

module.exports = { load, save, monthKey, recordNudge, getMonthSummary, getUserCount };
