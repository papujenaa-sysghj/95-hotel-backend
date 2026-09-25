// All stay dates are stored as UTC midnight so "night" arithmetic is timezone-safe.
export const toDay = (d) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
export const nightsBetween = (a, b) => Math.round((toDay(b) - toDay(a)) / 86400000);
export const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
// Half-open interval overlap: [aStart,aEnd) vs [bStart,bEnd). Check-out day is free.
export const rangesOverlap = (aStart, aEnd, bStart, bEnd) => toDay(aStart) < toDay(bEnd) && toDay(bStart) < toDay(aEnd);
