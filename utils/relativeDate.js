// utils/relativeDate.js
export function parseLinkedInRelative(input, now = new Date()) {
  if (!input) return { posted_at: null, posted_iso: null, posted_age_days: null };

  let s = String(input)
    .toLowerCase()
    .replace(/edited/g, "")
    .replace(/[·•]/g, " ")
    .replace(/\bago\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (s === "just now" || s === "now") {
    return { posted_at: now, posted_iso: toISODate(now), posted_age_days: 0 };
    }

  // Try absolute dates if present
  if (/\d{4}-\d{1,2}-\d{1,2}/.test(s) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return { posted_at: d, posted_iso: toISODate(d), posted_age_days: (now - d) / 86400000 };
    }
  }

  const m = s.match(
    /(\d+)\s*(yrs?|years?|y|mos?|months?|mo|wks?|weeks?|w|days?|d|hrs?|hours?|h|mins?|minutes?|m)\b/
  );
  if (!m) return { posted_at: null, posted_iso: null, posted_age_days: null };

  const qty = parseInt(m[1], 10);
  const unit = m[2];

  let d = new Date(now);
  if (/^y(ear|rs)?\b|^yrs?$/.test(unit)) d.setFullYear(d.getFullYear() - qty);
  else if (/^mo(nth|nths|s)?$/.test(unit)) d.setMonth(d.getMonth() - qty);
  else if (/^w(k|ks|eek|eeks)?$/.test(unit)) d.setDate(d.getDate() - qty * 7);
  else if (/^d(ay|ays)?$/.test(unit)) d.setDate(d.getDate() - qty);
  else if (/^h(r|rs|our|ours)?$/.test(unit)) d.setHours(d.getHours() - qty);
  else if (/^m(in|ins|inute|inutes)?$/.test(unit)) d.setMinutes(d.getMinutes() - qty);
  else return { posted_at: null, posted_iso: null, posted_age_days: null };

  return { posted_at: d, posted_iso: toISODate(d), posted_age_days: (now - d) / 86400000 };
}

function toISODate(d) {
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
