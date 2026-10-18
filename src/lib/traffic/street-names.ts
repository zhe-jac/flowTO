export type StreetName = { base: string; type: string; suffix: string; ramp: boolean };
const abbreviations: Record<string, string> = { street: "st", avenue: "ave", av: "ave", road: "rd", boulevard: "blvd", drive: "dr", crescent: "cres", court: "crt", place: "pl", terrace: "ter", lane: "ln", parkway: "pkwy", highway: "hwy", expressway: "expy", expwy: "expy", xway: "expy", xy: "expy", streetcar: "streetcar", north: "n", south: "s", east: "e", west: "w" };
const types = new Set(["st", "ave", "rd", "blvd", "dr", "cres", "crt", "pl", "ter", "ln", "pkwy", "hwy", "expy"]);
export function streetName(value: string): StreetName {
  const clean = value.normalize("NFKD").replace(/[\u0300-\u036f'’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\blakeshore\b/g, "lake shore").replace(/\b(?:f g|frederick g|frederick) gardiner\b/g, "gardiner").replace(/\bdvp\b/g, "don valley pkwy");
  const words = clean.split(/\s+/).map(word => abbreviations[word] ?? word);
  const suffix = ["n", "s", "e", "w"].includes(words.at(-1)!) ? words.pop()! : "";
  const type = types.has(words.at(-1)!) ? words.pop()! : "";
  return { base: words.join(" "), type, suffix, ramp: words.includes("ramp") };
}
export function nameScore(query: StreetName, candidate: StreetName) {
  if (query.ramp !== candidate.ramp || query.type && candidate.type && query.type !== candidate.type || query.suffix && query.suffix !== candidate.suffix) return 0;
  if (query.base === candidate.base) return 100;
  if (Math.min(query.base.length, candidate.base.length) < 4 || Math.abs(query.base.length - candidate.base.length) > 2) return 0;
  const rows = Array.from({ length: query.base.length + 1 }, (_, i) => [i, ...new Array(candidate.base.length).fill(0)]);
  for (let j = 0; j <= candidate.base.length; j++) rows[0][j] = j;
  for (let i = 1; i <= query.base.length; i++) for (let j = 1; j <= candidate.base.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (query.base[i - 1] === candidate.base[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && query.base[i - 1] === candidate.base[j - 2] && query.base[i - 2] === candidate.base[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  const distance = rows[query.base.length][candidate.base.length];
  return distance <= (query.base.length >= 8 ? 2 : 1) ? 80 - distance * 10 : 0;
}
export function streetFamily(name: StreetName) { return `${name.base}|${name.type}|${name.ramp}`; }
export function familyLabel(name: StreetName) {
  const type: Record<string, string> = { st: "Street", ave: "Avenue", rd: "Road", blvd: "Boulevard", dr: "Drive", pkwy: "Parkway", expy: "Expressway" };
  return `${name.base.replace(/\b\w/g, c => c.toUpperCase())}${name.type ? ` ${type[name.type] ?? name.type}` : ""}`;
}
