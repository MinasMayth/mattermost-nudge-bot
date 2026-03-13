'use strict';

const nodemailer = require('nodemailer');

/**
 * Build a nodemailer transporter from environment variables (or explicit opts).
 */
function createTransporter(opts) {
  const o = opts || {};
  return nodemailer.createTransport({
    host: o.host || process.env.SMTP_HOST,
    port: parseInt(o.port || process.env.SMTP_PORT || '587', 10),
    secure: (o.port || process.env.SMTP_PORT) === '465',
    auth: {
      user: o.user || process.env.SMTP_USER,
      pass: o.pass || process.env.SMTP_PASS,
    },
  });
}

/**
 * Send an alert email to ak-crewcare@krakelee.org (or the configured address)
 * when a user has reached the nudge threshold.
 *
 * @param {string} targetUsername   – The Mattermost username who was nudged
 * @param {number} count            – Current nudge count this month
 * @param {object} [opts]           – Optional overrides (for testing)
 * @param {object} [opts.transporter] – Pre-built nodemailer transporter
 * @param {string} [opts.alertEmail]  – Override recipient address
 * @param {string} [opts.from]        – Override sender address
 * @returns {Promise<object>}         – nodemailer info object
 */
async function sendAlert(targetUsername, count, opts) {
  const o = opts || {};
  const transporter = o.transporter || createTransporter();
  const to = o.alertEmail || process.env.ALERT_EMAIL || 'ak-crewcare@krakelee.org';
  const from = o.from || process.env.SMTP_FROM || 'nudge-bot@krakelee.org';

  const subject = `Nudge alert: @${targetUsername} has reached ${count} nudges this month`;
  const text = [
    `Hello Crew Care Team,`,
    ``,
    `This is an automated notification from the Mattermost Nudge Bot.`,
    ``,
    `User @${targetUsername} has received ${count} nudge(s) in the current calendar`,
    `month, which has reached or exceeded the alert threshold.`,
    ``,
    `Please review their workload and reach out if support is needed.`,
    ``,
    `– Nudge Bot`,
  ].join('\n');

  return transporter.sendMail({ from, to, subject, text });
}

module.exports = { createTransporter, sendAlert };
