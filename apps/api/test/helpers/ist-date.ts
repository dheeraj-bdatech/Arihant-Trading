import { todayInKolkata } from '@arihant/shared';

/**
 * Calendar days in IST (the API's business calendar), offset from today. `istDay(0)` is today, `istDay(1)` tomorrow.
 * Tests must not derive "today" from UTC (`new Date().toISOString()`): between 00:00 and 05:30 IST that is yesterday.
 */
export const istDay = (offsetDays = 0) => {
  const [y, m, d] = todayInKolkata().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
};
