const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const calcPricing = ({ roomRate, nights, extraBedCharge = 0, otherCharges = 0, discount = 0, taxPercent = 0 }) => {
  const subtotal = r2(roomRate * nights + extraBedCharge + otherCharges);
  const taxable = Math.max(0, subtotal - discount);
  const tax = r2((taxable * taxPercent) / 100);
  return { subtotal, tax, totalAmount: r2(taxable + tax) };
};
export const paymentStatusFor = (paid, total) => (paid <= 0 ? 'pending' : paid + 0.005 >= total ? 'paid' : 'partial');
