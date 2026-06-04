'use strict';

const { Resend } = require('resend');

let _client = null;
const FROM     = process.env.EMAIL_FROM || 'noreply@kravon.in';
const BASE_URL = process.env.KRAVON_FRONTEND_URL || 'https://kravon.in';

function _getClient() {
  if (_client) return _client;
  if (!process.env.RESEND_API_KEY) return null;
  _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

async function sendPasswordReset({ to, name, token, slug }) {
  const resetUrl = `${BASE_URL}/dashboard/?reset=${token}&slug=${encodeURIComponent(slug)}`;

  const client = _getClient();
  if (!client) {
    console.log(`[email:dev] password_reset TO=${to} SLUG=${slug}`);
    return;
  }

  await client.emails.send({
    from:    `Kravon <${FROM}>`,
    to:      [to],
    subject: 'Reset your Kravon password',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:40px;border:1px solid #e5e7eb">
        <tr><td style="padding-bottom:24px">
          <div style="display:inline-flex;align-items:center;gap:8px">
            <div style="width:28px;height:28px;background:#2563EB;border-radius:6px;display:inline-block"></div>
            <span style="font-size:18px;font-weight:700;color:#111827">Kravon</span>
          </div>
        </td></tr>
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">Reset your password</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#6b7280">Hi ${name || 'there'},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6">
            We received a request to reset the password for your Kravon dashboard account.
            Click the button below to choose a new password.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;
                    font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px">
            Reset password
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
            This link expires in <strong>1 hour</strong>. If you didn't request a password reset,
            you can safely ignore this email — your password won't change.
          </p>
          <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0">
          <p style="margin:0;font-size:12px;color:#d1d5db">
            Or copy this URL into your browser:<br>
            <span style="color:#6b7280;word-break:break-all">${resetUrl}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

module.exports = { sendPasswordReset };
