/**
 * A cheap check that a candidate's caption is really in another language,
 * used to confirm the interviewer's "non_english" ending. Accented English is
 * often captioned as foreign words ("let's end this interview" as "las Andes"),
 * so short turns never count, and a turn with common English words is English.
 */

const MIN_WORDS = 5;
const ENGLISH = new Set(
  `a an the i i'm i've i'd me my we our you your he she it its they them this that these those
   is am are was were be been being do does did have has had will would can could should
   and or but so if because of to in on at for with from by about as into than then there here
   not no yes yeah okay ok what when where why how who which all some any more most very just
   also like work worked working project projects experience team data use used using build built
   let's let end stop finish question questions answer interview skip next please sorry thank thanks`
    .split(/\s+/)
    .filter(Boolean),
);

export function isClearlyNonEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{M}']+/gu) ?? [];
  if (words.length < MIN_WORDS) return false;
  const english = words.filter((w) => ENGLISH.has(w)).length;
  return english / words.length < 0.15;
}
