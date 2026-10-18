import { requestedTravelDirection } from "./road-travel";
import { nameScore, streetName } from "./street-names";
import type { ChatAction } from "./chat";

export function groundLocationAction(action: ChatAction, text: string, index = 0): ChatAction {
  if (action.kind === "event") return action;
  const expression = /\b(?:(?:add|place|create)\s+(?:an?\s+)?(?:road\s+)?)?(?:close|block|shut(?:\s+down)?|(?:construction|closure|roadblock)\s+(?:on|along)|accident\s+(?:on|along)|collision\s+(?:on|along))\s+(.+?)\s+(?:from|between)\b/gi;
  const matches = [...text.matchAll(expression)];
  const cleanDirection = (value: string) => value.replace(/\b(?:in\s+)?both\s+(?:ways|directions)\b/gi, "").replace(/\b(?:east|west|north|south)[\s-]*bound\b/gi, "").trim();
  const hints = matches.map(match => cleanDirection(match[1]).replace(/^\s*(?:(?:both|all)\s+(?:ways|directions|lanes)\s*|lanes?\s+|of\s+|on\s+|the\s+)+/gi, "").trim());
  const proposed = action.roadName ? streetName(action.roadName) : null;
  const matchingHints = hints.map((hint, i) => ({ index: i, score: proposed ? nameScore({ ...streetName(hint), suffix: "" }, { ...proposed, suffix: "" }) : 0 })).filter(hint => hint.score > 0).sort((a, b) => b.score - a.score);
  const selected = matchingHints.length && matchingHints[0].score > (matchingHints[1]?.score ?? 0) ? matchingHints[0].index : index;
  const hint = hints[selected];
  let roadName = hint || action.roadName;
  if (!hint && roadName && proposed?.suffix) {
    const normalizedText = ` ${[streetName(text).base, streetName(text).type, streetName(text).suffix].filter(Boolean).join(" ")} `;
    const family = proposed.base;
    if (normalizedText.includes(` ${family} `) && !new RegExp(`\\b${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:(?:st|ave|rd|blvd|dr|pkwy|expy)\\s+)?${proposed.suffix}\\b`).test(normalizedText)) roadName = `${proposed.base} ${proposed.type}`.trim();
  }
  const segment = matches.length > 1 && matches[selected] ? text.slice(matches[selected].index, matches[selected + 1]?.index).replace(/(?:\s+(?:and|then|also)|\s*[&,;])+\s*$/i, "") : text;
  const limits = segment.match(/\b(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?=\s+(?:from|starting|at|for|until|between)\b|[,;?!]|$)/i);
  const cleanLimit = (value: string) => cleanDirection(value).replace(/\s+\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, "").trim();
  const direction = requestedTravelDirection(segment);
  return { ...action, roadName, ...(limits ? { fromStreet: cleanLimit(limits[1]), toStreet: cleanLimit(limits[2]) } : {}), travelDirection: direction ?? (text ? "both" : action.travelDirection ?? "both") };
}
