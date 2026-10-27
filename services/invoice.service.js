import PDFDocument from 'pdfkit';

/**
 * Converts a numeric amount to Indian currency words
 */
export function numberToWords(num) {
  if (!num || isNaN(num) || num <= 0) return 'Zero Rupees Only';
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ',
    'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ',
    'Seventeen ', 'Eighteen ', 'Nineteen ',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n) => {
    let str = '';
    if (n > 99) {
      str += a[Math.floor(n / 100)] + 'Hundred ';
      n %= 100;
    }
    if (n > 19) {
      str += b[Math.floor(n / 10)] + ' ' + a[n % 10];
    } else {
      str += a[n];
    }
    return str;
  };

  let amount = Math.floor(num);
  let paise = Math.round((num - amount) * 100);

  let crore = Math.floor(amount / 10000000);
  amount %= 10000000;
  let lakh = Math.floor(amount / 100000);
  amount %= 100000;
  let thousand = Math.floor(amount / 1000);
  amount %= 1000;
  let hundred = amount;

  let res = '';
  if (crore) res += inWords(crore) + 'Crore ';
  if (lakh) res += inWords(lakh) + 'Lakh ';
  if (thousand) res += inWords(thousand) + 'Thousand ';
  if (hundred) res += inWords(hundred);

  res = (res.trim() || 'Zero') + ' Rupees';
  if (paise > 0) res += ' and ' + inWords(paise) + 'Paise';
  return res + ' Only';
}

const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const fmtMoney = (n) => `₹ ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Generates an executive, GST-compliant Tax Invoice PDF
 */
export function generateInvoicePdf({ inv, b, hotel, payments = [], outStream }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Invoice - ${inv.invoiceNumber}`,
      Author: hotel.name || 'GS Hotels',
      Subject: `Tax Invoice for ${b.bookingNumber}`,
    },
  });

  doc.pipe(outStream);

  const left = 40;
  const right = 555;
  const contentWidth = right - left; // 515 pt

  // ==========================================
  // 1. TOP HEADER & HOTEL BRANDING
  // ==========================================
  const brandName = hotel.name || 'GS Hotels';
  
  // Left: Hotel Details
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(22).text(brandName, left, 40);
  doc.fillColor('#475569').font('Helvetica').fontSize(8.5);
  
  let hotelMetaY = doc.y + 2;
  if (hotel.address) {
    doc.text(hotel.address, left, hotelMetaY, { width: 280 });
    hotelMetaY = doc.y + 1;
  }
  
  const contacts = [
    hotel.phone && `Tel: ${hotel.phone}`,
    hotel.email && `Email: ${hotel.email}`,
  ].filter(Boolean).join('  |  ');
  if (contacts) {
    doc.text(contacts, left, hotelMetaY, { width: 280 });
    hotelMetaY = doc.y + 1;
  }
  
  doc.font('Helvetica-Bold').fillColor('#1E293B').text(`GSTIN: ${hotel.gstNumber || '00AAAAA0000A0Z0'}`, left, hotelMetaY);

  // Right: Invoice Meta Box
  const metaBoxX = 330;
  doc.rect(metaBoxX, 40, 225, 80).fillAndStroke('#F8FAFC', '#E2E8F0');

  doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', metaBoxX + 12, 48);
  doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(8).text('ORIGINAL FOR RECIPIENT', metaBoxX + 12, 67);

  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  doc.text(`Invoice No:`, metaBoxX + 12, 82);
  doc.font('Helvetica-Bold').fillColor('#0F172A').text(inv.invoiceNumber, metaBoxX + 75, 82);

  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  doc.text(`Invoice Date:`, metaBoxX + 12, 97);
  doc.font('Helvetica-Bold').fillColor('#0F172A').text(fmtDate(inv.createdAt || new Date()), metaBoxX + 75, 97);

  // Status Badge
  const isPaid = (b.balanceAmount || 0) <= 0;
  const statusColor = isPaid ? '#059669' : '#D97706';
  const statusBg = isPaid ? '#ECFDF5' : '#FFFBEB';
  const statusText = isPaid ? 'PAID IN FULL' : `BALANCE DUE: ${fmtMoney(b.balanceAmount)}`;

  doc.rect(metaBoxX + 12, 125, 225, 18).fillAndStroke(statusBg, statusColor);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(statusColor).text(statusText, metaBoxX + 12, 130, {
    width: 225,
    align: 'center',
  });

  // ==========================================
  // 2. GUEST & RESERVATION DETAILS GRID
  // ==========================================
  const infoY = 152;
  const colWidth = 252;

  // Guest Details Box
  doc.rect(left, infoY, colWidth, 90).fillAndStroke('#FFFFFF', '#E2E8F0');
  doc.rect(left, infoY, colWidth, 20).fill('#F1F5F9');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1E3A8A').text('BILLED TO / GUEST DETAILS', left + 8, infoY + 6);

  let gy = infoY + 26;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text(b.guest?.name || 'Walk-in Guest', left + 8, gy);
  gy += 14;
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
  doc.text(`Phone: ${b.guest?.phone || '—'}`, left + 8, gy);
  gy += 12;
  doc.text(`Email: ${b.guest?.email || '—'}`, left + 8, gy);
  gy += 12;
  doc.text(`ID Proof: ${b.guest?.idType || 'Aadhaar'} (${b.guest?.idNumber || 'Verified'})`, left + 8, gy);

  // Stay Details Box
  const stayX = left + colWidth + 11;
  doc.rect(stayX, infoY, colWidth, 90).fillAndStroke('#FFFFFF', '#E2E8F0');
  doc.rect(stayX, infoY, colWidth, 20).fill('#F1F5F9');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1E3A8A').text('STAY & RESERVATION DETAILS', stayX + 8, infoY + 6);

  let sy = infoY + 26;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0F172A').text(`Booking Ref: ${b.bookingNumber}`, stayX + 8, sy);
  sy += 14;
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
  doc.text(`Room: ${b.room?.roomNumber || '—'} · ${b.roomType?.name || 'Standard'} (${b.bookedAsAC ? 'AC' : 'Non-AC'})`, stayX + 8, sy);
  sy += 12;
  doc.text(`Check-In: ${fmtDate(b.checkInDate)} (12:00 PM)`, stayX + 8, sy);
  sy += 12;
  doc.text(`Check-Out: ${fmtDate(b.checkOutDate)} (11:00 AM)  |  ${b.nights || 1} Night(s)`, stayX + 8, sy);

  // ==========================================
  // 3. ITEMIZED CHARGES TABLE
  // ==========================================
  const tableY = 252;
  
  // Table Header
  doc.rect(left, tableY, contentWidth, 22).fillAndStroke('#1E3A8A', '#1E3A8A');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
  
  doc.text('#', left + 8, tableY + 6, { width: 20, align: 'center' });
  doc.text('DESCRIPTION / PARTICULARS', left + 32, tableY + 6, { width: 220 });
  doc.text('SAC CODE', left + 255, tableY + 6, { width: 55, align: 'center' });
  doc.text('RATE (₹)', left + 315, tableY + 6, { width: 60, align: 'right' });
  doc.text('QTY / NIGHTS', left + 380, tableY + 6, { width: 55, align: 'center' });
  doc.text('AMOUNT (₹)', left + 440, tableY + 6, { width: 68, align: 'right' });

  // Table Body Rows
  const items = [
    {
      desc: `Room Accommodation (${b.roomType?.name || 'Room'} ${b.room?.roomNumber})`,
      sub: `${b.nights} night(s) @ ₹${(b.roomRate || 0).toLocaleString('en-IN')}/night`,
      sac: '996311',
      rate: b.roomRate || 0,
      qty: b.nights || 1,
      amount: (b.roomRate || 0) * (b.nights || 1),
    },
  ];

  if (b.extraBedCharge > 0) {
    items.push({
      desc: 'Extra Bed / Rollaway Mattress',
      sub: 'Standard guest add-on',
      sac: '996311',
      rate: b.extraBedCharge,
      qty: 1,
      amount: b.extraBedCharge,
    });
  }

  if (b.otherCharges > 0) {
    items.push({
      desc: 'Additional Hotel Amenities & Services',
      sub: 'Service charges / incidentals',
      sac: '996311',
      rate: b.otherCharges,
      qty: 1,
      amount: b.otherCharges,
    });
  }

  let rowY = tableY + 22;
  items.forEach((it, idx) => {
    const isEven = idx % 2 === 0;
    const rowHeight = 28;
    
    doc.rect(left, rowY, contentWidth, rowHeight).fillAndStroke(isEven ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
    
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
    doc.text(String(idx + 1), left + 8, rowY + 6, { width: 20, align: 'center' });
    
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0F172A').text(it.desc, left + 32, rowY + 5);
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748B').text(it.sub, left + 32, rowY + 16);
    
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text(it.sac, left + 255, rowY + 8, { width: 55, align: 'center' });
    doc.text(it.rate.toLocaleString('en-IN', { minimumFractionDigits: 2 }), left + 315, rowY + 8, { width: 60, align: 'right' });
    doc.text(String(it.qty), left + 380, rowY + 8, { width: 55, align: 'center' });
    doc.font('Helvetica-Bold').fillColor('#0F172A').text(it.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 }), left + 440, rowY + 8, { width: 68, align: 'right' });
    
    rowY += rowHeight;
  });

  // ==========================================
  // 4. TAX & FINANCIAL SUMMARY SECTION
  // ==========================================
  const sumBoxY = rowY + 10;
  const taxableVal = Math.max(0, (b.subtotal || 0) - (b.discount || 0));
  const cgstVal = (b.tax || 0) / 2;
  const sgstVal = (b.tax || 0) / 2;

  // Left Column: Amount in Words & Payment History
  const wordsBoxWidth = 280;
  doc.rect(left, sumBoxY, wordsBoxWidth, 110).fillAndStroke('#F8FAFC', '#E2E8F0');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text('INVOICE AMOUNT IN WORDS:', left + 8, sumBoxY + 8);
  doc.font('Helvetica-BoldOblique').fontSize(9).fillColor('#1E3A8A').text(numberToWords(b.totalAmount || 0), left + 8, sumBoxY + 20, {
    width: wordsBoxWidth - 16,
  });

  // Payment Breakdown
  doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(left + 8, sumBoxY + 45).lineTo(left + wordsBoxWidth - 8, sumBoxY + 45).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text('PAYMENT SETTLEMENTS:', left + 8, sumBoxY + 52);
  
  if (payments.length > 0) {
    let py = sumBoxY + 65;
    payments.slice(0, 3).forEach((p) => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(`• ${fmtDate(p.paidAt)} · ${(p.method || 'cash').toUpperCase()}: ${fmtMoney(p.amount)} (${p.paymentId || 'Ref: Recv'})`, left + 8, py);
      py += 11;
    });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(
      b.paidAmount > 0 ? `Paid ₹${(b.paidAmount).toLocaleString('en-IN')} towards balance.` : 'No payments processed yet.',
      left + 8,
      sumBoxY + 68
    );
  }

  // Right Column: Financial Calculations Table
  const calcX = left + wordsBoxWidth + 10;
  const calcWidth = contentWidth - wordsBoxWidth - 10; // 225 pt
  
  doc.rect(calcX, sumBoxY, calcWidth, 110).fillAndStroke('#FFFFFF', '#CBD5E1');

  const calcLines = [
    { label: 'Subtotal (Gross Charges):', val: fmtMoney(b.subtotal || 0), bold: false },
    ...(b.discount > 0 ? [{ label: 'Less Discount:', val: `- ${fmtMoney(b.discount)}`, bold: false, color: '#059669' }] : []),
    { label: 'Taxable Value:', val: fmtMoney(taxableVal), bold: true },
    { label: `CGST (${((b.taxPercent || 0) / 2).toFixed(1)}%):`, val: fmtMoney(cgstVal), bold: false },
    { label: `SGST (${((b.taxPercent || 0) / 2).toFixed(1)}%):`, val: fmtMoney(sgstVal), bold: false },
  ];

  let cy = sumBoxY + 6;
  calcLines.forEach((cl) => {
    doc.font(cl.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(cl.color || '#475569').text(cl.label, calcX + 8, cy);
    doc.font(cl.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(cl.color || '#0F172A').text(cl.val, calcX + 110, cy, { width: 105, align: 'right' });
    cy += 13;
  });

  // Grand Total Banner
  const totalBannerY = sumBoxY + 84;
  doc.rect(calcX, totalBannerY, calcWidth, 26).fill('#1E3A8A');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text('GRAND TOTAL:', calcX + 8, totalBannerY + 8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text(fmtMoney(b.totalAmount || 0), calcX + 100, totalBannerY + 7, {
    width: 115,
    align: 'right',
  });

  // ==========================================
  // 5. PAYMENT STATUS BAR & FOOTER
  // ==========================================
  const footY = sumBoxY + 125;

  // Paid / Balance Strip
  doc.rect(left, footY, contentWidth, 24).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#059669').text(`Amount Paid: ${fmtMoney(b.paidAmount || 0)}`, left + 12, footY + 7);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(b.balanceAmount > 0 ? '#DC2626' : '#059669').text(
    b.balanceAmount > 0 ? `Balance Due: ${fmtMoney(b.balanceAmount)}` : 'Balance Due: ₹ 0.00 (Fully Settled)',
    left + 260,
    footY + 7,
    { width: 240, align: 'right' }
  );

  // Terms and Signatory Box
  const termY = footY + 34;

  // Left: Terms & Policies
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#1E293B').text('TERMS & CONDITIONS:', left, termY);
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748B');
  doc.text('1. Standard check-out time is 11:00 AM. Late checkout is subject to availability.', left, termY + 12);
  doc.text('2. Hotel bills and applicable GST taxes once settled are non-refundable.', left, termY + 22);
  doc.text('3. In case of any billing disputes, please contact frontdesk within 24 hours.', left, termY + 32);
  doc.text(hotel.invoice?.footerNote || 'Thank you for choosing GS Hotels! We hope you enjoyed your stay.', left, termY + 44, {
    width: 320,
  });

  // Right: Signature Box
  const sigX = 390;
  doc.rect(sigX, termY, 165, 55).stroke('#CBD5E1');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0F172A').text(`For ${brandName}`, sigX + 8, termY + 6, {
    width: 150,
    align: 'center',
  });
  doc.font('Helvetica').fontSize(7.5).fillColor('#94A3B8').text('Authorized Signatory', sigX + 8, termY + 40, {
    width: 150,
    align: 'center',
  });

  // Bottom Notice
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#94A3B8').text(
    'This is a computer-generated tax invoice generated by GS Hotels PMS and does not require a physical signature.',
    left,
    785,
    { width: contentWidth, align: 'center' }
  );

  doc.end();
}
