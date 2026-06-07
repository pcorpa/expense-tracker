export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY';

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Normalizes a raw date string to ISO YYYY-MM-DD.
 * Returns null for unparseable input — callers should surface this as a review queue item.
 *
 * Handles:
 *   YYYY-MM-DD  (ISO, unambiguous — always preferred)
 *   D/M/YYYY, DD/MM/YYYY, D/M/YY, DD/MM/YY  (and . or - separators)
 *   MM/DD/YYYY variants (when format = 'MM/DD/YYYY')
 *
 * Ambiguity rule: if the first component is > 12 it must be the day regardless of format.
 * For genuinely ambiguous dates (both components ≤ 12) the format preference is applied.
 */
export function normalizeDate(raw: string, format: DateFormat = 'DD/MM/YYYY'): string | null {
  if (!raw || raw.trim() === '' || raw.toLowerCase() === 'unknown') return null;
  raw = raw.trim();

  // ISO YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    return isValidDate(y, m, d) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  // Slash / dot / dash separated: a[sep]b[sep]year
  const parts = raw.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (parts) {
    const a = +parts[1];
    const b = +parts[2];
    const rawYear = parts[3];
    const year = rawYear.length === 2 ? 2000 + +rawYear : +rawYear;

    let day: number, month: number;
    if (a > 12) {
      day = a; month = b;
    } else if (b > 12) {
      month = a; day = b;
    } else {
      if (format === 'DD/MM/YYYY') { day = a; month = b; }
      else { month = a; day = b; }
    }

    if (isValidDate(year, month, day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}
