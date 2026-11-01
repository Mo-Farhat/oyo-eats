import { formatLkr } from '@oyo/shared';
import PDFDocument from 'pdfkit';

export interface ReceiptData {
  reference: string;
  restaurantName: string;
  restaurantAddress: string;
  placedAt: Date;
  deliveredAt: Date | null;
  paymentMethod: string;
  lines: { quantity: number; name: string; modifiers: string[]; lineTotalCents: number }[];
  itemsCents: number;
  deliveryFeeCents: number;
  restaurantFeeCents: number;
  totalCents: number;
}

const colombo = (d: Date) =>
  d.toLocaleString('en-LK', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });

const METHOD: Record<string, string> = {
  cod: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
  card: 'Card',
};

/**
 * A plain A5 receipt (CUS-17). Not a tax invoice: VAT treatment waits for the accountant
 * (PRD section 18, decision 8).
 */
export function renderReceipt(r: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 36,
      info: { Title: `Oyo Eats receipt ${r.reference}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const right = (text: string, y: number) =>
      doc.text(text, 36, y, { width: doc.page.width - 72, align: 'right' });
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 36, y, { width: 240 });
      const after = doc.y;
      right(value, y);
      doc.y = Math.max(after, doc.y) + 4;
    };

    doc.font('Helvetica-Bold').fontSize(18).text('Oyo Eats');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555')
      .text('Receipt · not a tax invoice')
      .fillColor('#000');
    doc.moveDown();
    doc.fontSize(10);
    row('Order', `#${r.reference}`, true);
    row('Placed', colombo(r.placedAt));
    if (r.deliveredAt) row('Delivered', colombo(r.deliveredAt));
    row('Restaurant', r.restaurantName);
    row('Payment', METHOD[r.paymentMethod] ?? r.paymentMethod);
    doc.moveDown(0.5);
    doc
      .moveTo(36, doc.y)
      .lineTo(doc.page.width - 36, doc.y)
      .strokeColor('#ccc')
      .stroke();
    doc.moveDown(0.5);
    for (const l of r.lines) {
      row(
        `${l.quantity} × ${l.name}${l.modifiers.length ? ` (${l.modifiers.join(', ')})` : ''}`,
        formatLkr(l.lineTotalCents),
      );
    }
    doc.moveDown(0.5);
    row('Items', formatLkr(r.itemsCents));
    row('Delivery', formatLkr(r.deliveryFeeCents));
    if (r.restaurantFeeCents) row('Restaurant fee', formatLkr(r.restaurantFeeCents));
    row('Total', formatLkr(r.totalCents), true);
    doc.moveDown();
    doc.fontSize(8).fillColor('#555').text(`${r.restaurantName}, ${r.restaurantAddress}`);
    doc.end();
  });
}
