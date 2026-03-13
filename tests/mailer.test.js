'use strict';

const mailer = require('../src/mailer');

describe('sendAlert', () => {
  test('sends email with correct subject and recipient', async () => {
    const sentMails = [];

    const fakeTransporter = {
      sendMail: async (mail) => {
        sentMails.push(mail);
        return { messageId: 'test-id' };
      },
    };

    const info = await mailer.sendAlert('alice', 5, {
      transporter: fakeTransporter,
      alertEmail: 'ak-crewcare@krakelee.org',
      from: 'nudge-bot@krakelee.org',
    });

    expect(info.messageId).toBe('test-id');
    expect(sentMails).toHaveLength(1);

    const mail = sentMails[0];
    expect(mail.to).toBe('ak-crewcare@krakelee.org');
    expect(mail.from).toBe('nudge-bot@krakelee.org');
    expect(mail.subject).toMatch(/alice/);
    expect(mail.subject).toMatch(/5/);
    expect(mail.text).toMatch(/@alice/);
    expect(mail.text).toMatch(/5/);
  });

  test('uses environment variables as fallback', async () => {
    const sentMails = [];
    const fakeTransporter = {
      sendMail: async (mail) => {
        sentMails.push(mail);
        return {};
      },
    };

    const oldAlertEmail = process.env.ALERT_EMAIL;
    const oldFrom = process.env.SMTP_FROM;
    process.env.ALERT_EMAIL = 'env-recipient@example.com';
    process.env.SMTP_FROM = 'env-sender@example.com';

    await mailer.sendAlert('bob', 7, { transporter: fakeTransporter });

    expect(sentMails[0].to).toBe('env-recipient@example.com');
    expect(sentMails[0].from).toBe('env-sender@example.com');

    process.env.ALERT_EMAIL = oldAlertEmail;
    process.env.SMTP_FROM = oldFrom;
  });
});
