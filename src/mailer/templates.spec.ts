import { NotificationType } from '../notifications/notification.schema';
import { escapeHtml, renderTemplate } from './templates';

const ORDER_ID = '0b9e4c1a-7d2f-4f5e-9a51-3c6d8e2b1f00';

describe('renderTemplate', () => {
  it.each(Object.values(NotificationType))('renders a subject and HTML body for %s', (type) => {
    const { subject, html } = renderTemplate(type, { firstName: 'Alice', orderId: ORDER_ID });

    expect(subject).not.toHaveLength(0);
    expect(html).toContain('Hi Alice,');
  });

  it('includes the order id and a short reference for order emails', () => {
    const { subject, html } = renderTemplate(NotificationType.ORDER_SHIPPED, {
      firstName: 'Alice',
      orderId: ORDER_ID,
    });

    expect(subject).toContain('#0B9E4C1A');
    expect(html).toContain(ORDER_ID);
  });

  it('falls back to "there" when the first name is empty', () => {
    const { html } = renderTemplate(NotificationType.WELCOME, { firstName: '' });

    expect(html).toContain('Hi there,');
  });

  it('shows the cancellation reason only when one is given', () => {
    const withReason = renderTemplate(NotificationType.ORDER_CANCELLED, {
      firstName: 'Alice',
      orderId: ORDER_ID,
      reason: 'Out of stock',
    });
    const without = renderTemplate(NotificationType.ORDER_CANCELLED, {
      firstName: 'Alice',
      orderId: ORDER_ID,
    });

    expect(withReason.html).toContain('<strong>Reason:</strong> Out of stock');
    expect(without.html).not.toContain('Reason:');
  });

  it('escapes user-controlled values so they cannot inject markup', () => {
    const { html } = renderTemplate(NotificationType.ORDER_CANCELLED, {
      firstName: '<a href="https://evil.example">Claim prize</a>',
      orderId: ORDER_ID,
      reason: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
