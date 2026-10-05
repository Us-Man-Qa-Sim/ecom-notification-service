const BRAND = 'ecom';
const SUPPORT = 'support@ecom.local';

export interface TemplateContext {
  firstName: string;
  orderId?: string | null;
  reason?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:32px 0">
  <table width="600" align="center" cellpadding="0" cellspacing="0"
         style="background:#ffffff;border-radius:8px;padding:40px;max-width:600px">
    <tr><td>
      <p style="font-size:22px;font-weight:bold;color:#111;margin:0 0 24px">${BRAND}</p>
      ${body}
      <hr style="border:none;border-top:1px solid #eeeeee;margin:32px 0">
      <p style="color:#999;font-size:12px;margin:0">
        You received this email because you have an account with ${BRAND}.<br>
        Questions? Contact <a href="mailto:${SUPPORT}" style="color:#555">${SUPPORT}</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function orderTable(orderId: string | null | undefined): string {
  const id = orderId ?? 'N/A';
  return `<table style="background:#f9f9f9;border-radius:4px;padding:16px 20px;margin:16px 0;width:100%;box-sizing:border-box">
      <tr><td style="color:#999;font-size:12px;padding-bottom:4px">Order ID</td></tr>
      <tr><td style="font-family:monospace;font-size:13px;color:#333;word-break:break-all">${id}</td></tr>
    </table>`;
}

function shortRef(orderId: string | null | undefined): string {
  if (!orderId) return 'N/A';
  return orderId.slice(0, 8).toUpperCase();
}

function greet(ctx: TemplateContext): string {
  return `<p style="font-size:16px;color:#333;margin:0 0 12px">Hi ${ctx.firstName || 'there'},</p>`;
}

function welcomeEmail(ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Welcome to ${BRAND}!`,
    html: layout(`Welcome to ${BRAND}`, `
      ${greet(ctx)}
      <p style="color:#555;margin:0 0 16px">Welcome to <strong>${BRAND}</strong>! Your account is all set up.</p>
      <p style="color:#555;margin:0">Start browsing our products and place your first order.</p>
    `),
  };
}

function orderConfirmedEmail(ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Your order is confirmed — #${shortRef(ctx.orderId)}`,
    html: layout('Order Confirmed', `
      ${greet(ctx)}
      <p style="color:#555;margin:0 0 8px">Your order has been <strong>confirmed</strong>.</p>
      ${orderTable(ctx.orderId)}
      <p style="color:#555;margin:0">We will notify you once your order has shipped.</p>
    `),
  };
}

function orderCancelledEmail(ctx: TemplateContext): RenderedEmail {
  const reasonRow = ctx.reason
    ? `<p style="color:#555;margin:8px 0 0"><strong>Reason:</strong> ${ctx.reason}</p>`
    : '';
  return {
    subject: `Your order has been cancelled — #${shortRef(ctx.orderId)}`,
    html: layout('Order Cancelled', `
      ${greet(ctx)}
      <p style="color:#555;margin:0 0 8px">Your order has been <strong>cancelled</strong>.</p>
      ${orderTable(ctx.orderId)}
      ${reasonRow}
      <p style="color:#555;margin:8px 0 0">If you have questions, please contact our support team.</p>
    `),
  };
}

function orderShippedEmail(ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Your order has shipped — #${shortRef(ctx.orderId)}`,
    html: layout('Order Shipped', `
      ${greet(ctx)}
      <p style="color:#555;margin:0 0 8px">Your order is on its way!</p>
      ${orderTable(ctx.orderId)}
      <p style="color:#555;margin:0">We will let you know once it has been delivered.</p>
    `),
  };
}

function orderDeliveredEmail(ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Your order has been delivered — #${shortRef(ctx.orderId)}`,
    html: layout('Order Delivered', `
      ${greet(ctx)}
      <p style="color:#555;margin:0 0 8px">Your order has been <strong>delivered</strong>. We hope you enjoy it!</p>
      ${orderTable(ctx.orderId)}
    `),
  };
}

export function renderTemplate(type: string, ctx: TemplateContext): RenderedEmail {
  switch (type) {
    case 'user.registered':  return welcomeEmail(ctx);
    case 'order.confirmed':  return orderConfirmedEmail(ctx);
    case 'order.cancelled':  return orderCancelledEmail(ctx);
    case 'order.shipped':    return orderShippedEmail(ctx);
    case 'order.delivered':  return orderDeliveredEmail(ctx);
    default:
      return {
        subject: `${BRAND} — notification`,
        html: layout('Notification', `
          ${greet(ctx)}
          <p style="color:#555">You have a new notification.</p>
        `),
      };
  }
}
