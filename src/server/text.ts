/*
 * Text from the sites a link leads to, made safe to show every viewer. The same marks as the
 * temp-share plugin's cleanName, so one file or video can't read as another.
 */

// marks that are invisible or change the reading direction; they are dropped
const INVISIBLE = /[\xad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
// controls, and line and paragraph separators; they become spaces
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
// a surrogate without its partner
const LONE_SURROGATE = /\p{Cs}/gu;

/** A title to show, or null when nothing is left of it. Capped by character, never mid-emoji. */
const cleanTitle = (title: string | undefined, max = 200): string | null => {
  const clean = String(title ?? "")
    .replace(INVISIBLE, "")
    .replace(LONE_SURROGATE, "")
    .replace(CONTROLS, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean ? Array.from(clean).slice(0, max).join("") : null;
};

export { cleanTitle };
