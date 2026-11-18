'use strict';

/**
 * The utility functions every transformation script sees (epoch, datetime,
 * uppercase, lowercase, trim, formatPhone, get). Pure, with no dependencies, so
 * the stage runtime's child process can offer the very same functions to
 * scripts migrated from transformations and follow-ups.
 */

/**
 * Global utility functions available to all transformation scripts
 */
function getGlobalUtilities() {
  // Define epoch as a standalone function so datetime can reference it directly
  const epochFn = (dateStr) => {
    if (!dateStr) return null;
    try {
      let date;
      if (typeof dateStr === 'number') {
        date = dateStr > 10000000000 ? new Date(dateStr) : new Date(dateStr * 1000);
      } else if (dateStr.includes('/')) {
        // Handle DD/MM/YYYY or DD/MM/YYYY HH:MM AM/PM format
        const parts = dateStr.split(' ');
        const [day, month, year] = parts[0].split('/');

        if (parts.length > 1) {
          // Has time component like "04/02/2026 04:07 PM"
          const timeStr = parts.slice(1).join(' ');
          const isoDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeStr}`;
          date = new Date(isoDateStr);
        } else {
          // Date only like "04/02/2026"
          date = new Date(year, month - 1, day);
        }
      } else if (dateStr.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}/)) {
        const parts = dateStr.split(/[\s-]+/);
        const monthMap = {
          jan: 0,
          feb: 1,
          mar: 2,
          apr: 3,
          may: 4,
          jun: 5,
          jul: 6,
          aug: 7,
          sep: 8,
          oct: 9,
          nov: 10,
          dec: 11,
        };
        date = new Date(parts[2], monthMap[parts[1].toLowerCase().substring(0, 3)], parts[0]);
      } else {
        date = new Date(dateStr);
      }
      return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
    } catch (_e) {
      return null;
    }
  };

  return {
    // Date/Time utilities
    epoch: epochFn,

    datetime: (date, time, timezone) => {
      if (!date) return null;
      const tz = timezone || '+05:30';
      const dateTimeStr = time ? `${date}T${time}${tz}` : `${date}T00:00:00${tz}`;
      return epochFn(dateTimeStr); // Call epochFn directly instead of this.epoch
    },

    // String utilities
    uppercase: (str) => (str ? String(str).toUpperCase() : str),

    lowercase: (str) => (str ? String(str).toLowerCase() : str),

    trim: (str) => (str ? String(str).trim() : str),

    // Phone utilities
    formatPhone: (phone, countryCode) => {
      if (!phone) return phone;
      const cc = countryCode || '91';
      const cleaned = String(phone).replace(/\D/g, '');
      if (cleaned.startsWith(cc)) return `+${cleaned}`;
      return `+${cc}${cleaned}`;
    },

    // Object utilities
    get: (obj, path, defaultValue) => {
      if (!path || !obj) return defaultValue;
      const keys = path.split('.');
      let value = obj;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return defaultValue;
      }
      return value;
    },
  };
}

module.exports = { getGlobalUtilities };
