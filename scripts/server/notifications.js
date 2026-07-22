const { randomUUID } = require('node:crypto');

let transporter;

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[character]));
}

function smtpConfiguration(environment = process.env){
  const host = String(environment.SMTP_HOST || '').trim();
  const user = String(environment.SMTP_USER || '').trim();
  const pass = String(environment.SMTP_PASS || '').trim();
  return {
    ready:Boolean(host && user && pass),
    host,
    port:Number(environment.SMTP_PORT || 465),
    secure:String(environment.SMTP_SECURE || 'true').toLowerCase() !== 'false',
    user,
    pass,
    from:String(environment.EMAIL_FROM || user).trim()
  };
}

function resendConfiguration(environment = process.env){
  const apiKey = String(environment.RESEND_API_KEY || '').trim();
  return {
    ready:Boolean(apiKey),
    apiKey,
    from:String(environment.EMAIL_FROM || 'Auction Split <notifications@mail.split.auction>').trim()
  };
}

function notificationConfiguration(environment = process.env){
  const resend = resendConfiguration(environment);
  if(resend.ready) return { provider:'resend', ...resend };
  const smtp = smtpConfiguration(environment);
  if(smtp.ready) return { provider:'smtp', ...smtp };
  return { provider:'disabled', ready:false, from:String(environment.EMAIL_FROM || '').trim() };
}

function getTransporter(config){
  if(!config?.ready || config.provider !== 'smtp') return null;
  if(!transporter){
    transporter = require('nodemailer').createTransport({
      host:config.host,
      port:config.port,
      secure:config.secure,
      auth:{ user:config.user, pass:config.pass }
    });
  }
  return transporter;
}

async function sendWithResend(config, message){
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{
      authorization:`Bearer ${config.apiKey}`,
      'content-type':'application/json'
    },
    body:JSON.stringify(message)
  });
  const payload = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(payload.message || `Resend returned ${response.status}`);
  return { messageId:payload.id || '' };
}

function htmlEmail({ preheader, title, greeting, body, detail, ctaLabel, ctaUrl }){
  const action = ctaLabel && ctaUrl
    ? `<a href="${escapeHtml(ctaUrl)}" style="background:#118b80;border-radius:6px;color:#ffffff;display:inline-block;font:700 15px Arial,sans-serif;padding:13px 18px;text-decoration:none;">${escapeHtml(ctaLabel)}</a>`
    : '';
  return `<!doctype html><html lang="hr"><body style="background:#f3f7f5;color:#18221f;margin:0;padding:28px 14px;"><span style="display:none!important;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || '')}</span><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #dce5e1;border-radius:10px;max-width:600px;overflow:hidden;width:100%;"><tr><td style="background:#0f8b80;padding:24px 30px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#e44f5c;border-radius:6px;color:#ffffff;font:800 20px Arial,sans-serif;height:36px;text-align:center;width:36px;">A</td><td style="color:#ffffff;font:800 19px Arial,sans-serif;padding-left:11px;">Auction Split</td></tr></table></td></tr><tr><td style="padding:34px 30px 14px;"><p style="color:#148b80;font:800 12px Arial,sans-serif;letter-spacing:1px;margin:0 0 12px;text-transform:uppercase;">OBAVIJEST PLATFORME</p><h1 style="color:#18221f;font:800 28px Arial,sans-serif;line-height:1.18;margin:0 0 18px;">${escapeHtml(title)}</h1><p style="color:#4f625b;font:400 16px Arial,sans-serif;line-height:1.6;margin:0 0 16px;">${escapeHtml(greeting)}</p><p style="color:#4f625b;font:400 16px Arial,sans-serif;line-height:1.6;margin:0 0 22px;">${escapeHtml(body)}</p>${detail ? `<div style="background:#edf8f6;border-left:3px solid #0f8b80;border-radius:4px;color:#21423a;font:600 14px Arial,sans-serif;line-height:1.5;margin:0 0 25px;padding:13px 15px;">${escapeHtml(detail)}</div>` : ''}${action}</td></tr><tr><td style="padding:26px 30px 30px;"><p style="border-top:1px solid #dce5e1;color:#71817b;font:400 12px Arial,sans-serif;line-height:1.5;margin:0;padding-top:18px;">Auction Split · aukcije slobodnog smještaja<br>Ova je poruka vezana uz aktivnost na vašem računu.</p></td></tr></table></td></tr></table></body></html>`;
}

function appUrl(){
  return String(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

async function notify(db, { type, user, subject, title, body, detail = '', ctaLabel = 'Otvori Auction Split', ctaPath = '/account.html' }){
  if(!user?.email) return null;
  db.notifications ||= [];
  const notification = {
    id:randomUUID(),
    type,
    userId:user.id || null,
    to:user.email,
    subject,
    status:'queued',
    createdAt:new Date().toISOString(),
    detail
  };
  db.notifications.unshift(notification);
  db.notifications = db.notifications.slice(0, 1000);
  const config = notificationConfiguration();
  notification.provider = config.provider;
  if(!config.ready) return notification;
  try{
    const message = {
      from:config.from,
      to:user.email,
      subject,
      text:`${title}\n\n${body}${detail ? `\n\n${detail}` : ''}\n\n${appUrl()}${ctaPath}`,
      html:htmlEmail({
        preheader:subject,
        title,
        greeting:`Pozdrav ${user.name || ''},`,
        body,
        detail,
        ctaLabel,
        ctaUrl:`${appUrl()}${ctaPath}`
      })
    };
    const info = config.provider === 'resend'
      ? await sendWithResend(config, message)
      : await getTransporter(config).sendMail(message);
    notification.status = 'sent';
    notification.sentAt = new Date().toISOString();
    notification.messageId = info.messageId || '';
  }catch(error){
    notification.status = 'failed';
    notification.error = String(error.message || 'SMTP delivery failed').slice(0, 240);
  }
  return notification;
}

async function notifyMany(db, users, payload){
  const uniqueUsers = [...new Map(users.filter(Boolean).map(user => [user.id || user.email, user])).values()];
  await Promise.all(uniqueUsers.map(user => notify(db, { ...payload, user })));
}

module.exports = { notify, notifyMany, notificationConfiguration, resendConfiguration, smtpConfiguration };
