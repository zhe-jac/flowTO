"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { WorkspaceDockPane } from "./workspace-layout";
import type { Disruption } from "@/lib/disruptions";
import type { ChatTrafficContext, ChatProposal, ChatLocationChoice } from "@/lib/traffic/chat";
import type { LocationPreviewData } from "./location-preview";
import type { WeatherRates } from "@/lib/weather";

type Message = { id: string; role: "user" | "assistant"; content: string; proposals?: ChatProposal[]; applied?: boolean; preview?: LocationPreviewData; locationChoices?: (ChatLocationChoice & { preview?: LocationPreviewData })[]; selectedChoice?: number };
const SUGGESTION_SETS = [
  ["Add a concert at Scotiabank Arena with 15,000 people from 7 PM to 11 PM", "Summarize the traffic changes on the map", "Close Queen Street West from Spadina Avenue to University Avenue from 5 PM to 7 PM"],
  ["Add a game at Rogers Centre with 30,000 people from 1 PM to 4 PM", "Which affected roads have the most diverted traffic?", "Add construction on King Street West from Bathurst Street to Spadina Avenue from 9 AM to 4 PM"],
  ["Add a concert at RBC Amphitheatre with 12,000 people from 7 PM to 10 PM", "Explain the current disruptions and their likely effects", "How is traffic around Yonge–Eglinton?"],
  ["Add a match at BMO Field with 20,000 people from 6 PM to 9 PM", "Compare baseline and scenario speeds on affected roads", "Are any published Blue Jays games affecting the selected date?"],
];
export default function TrafficChat({ context, items, weather, onApply, onPreview, getMapReference }: {
  context: ChatTrafficContext | null;
  items: Disruption[]; weather: WeatherRates; onApply: (items: Disruption[]) => boolean; onPreview?: (data: LocationPreviewData | null) => void; getMapReference?: () => [number, number];
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(SUGGESTION_SETS[0]);
  const suggestionsChosen = useRef(false);
  useEffect(() => {
    if (suggestionsChosen.current) return;
    suggestionsChosen.current = true;
    let previous = -1;
    try { previous = Number(sessionStorage.getItem("traffic-chat-suggestions") ?? -1); } catch { /* Storage may be unavailable. */ }
    const choices = SUGGESTION_SETS.map((_, i) => i).filter(i => i !== previous);
    const next = choices[Math.floor(Math.random() * choices.length)];
    setSuggestions(SUGGESTION_SETS[next]);
    try { sessionStorage.setItem("traffic-chat-suggestions", String(next)); } catch { /* Suggestions still work without storage. */ }
  }, []);
  const request = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  function showConversation() { setOpen(true); }
  useEffect(() => { if (log.current) log.current.scrollTop = history ? log.current.scrollHeight : 0; }, [messages, loading, open, history]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || loading || !context) return;
    const message: Message = { id: crypto.randomUUID(), role: "user", content: input.trim() };
    const next = [...messages, message];
    showConversation();
    onPreview?.(null);
    setMessages(next); setInput(""); setError(""); setLoading(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/traffic/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ messages: next.slice(-11).map(({ role, content }) => ({ role, content: content.slice(0, 2500) })), context, items, weather, mapReference: getMapReference?.() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The assistant is unavailable. Try again.");
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content: result.reply, proposals: result.proposals, preview: result.preview, locationChoices: result.locationChoices }]);
    } catch (cause) {
      setInput(message.content);
      setMessages(current => current.filter(m => m.id !== message.id));
      setError(controller.signal.aborted ? "The request timed out. Try again; your map has not changed." : cause instanceof Error ? cause.message : "The assistant is unavailable.");
    } finally { clearTimeout(timeout); request.current = null; setLoading(false); }
  }
  function apply(message: Message) {
    if (!message.proposals?.length || message.applied) return;
    if (message.proposals.some(p => p.startsAt.slice(0, 10) !== context?.date)) { setError("The selected date changed. Ask for a new proposal for this date."); return; }
    if (!onApply(message.proposals.map(({ locationLabel, ...item }) => item))) { setError("A scenario can contain up to 20 disruptions. Remove some before adding these."); return; }
    setMessages(current => current.map(m => m.id === message.id ? { ...m, applied: true, locationChoices: undefined } : m));
    onPreview?.(null);
    setError("");
  }
  const visibleMessages = history ? messages : messages.slice(-1);
  return <WorkspaceDockPane name="assistant"><section id="traffic-chat-panel" className="traffic-chat traffic-chat-panel" data-expanded={open} aria-label="Traffic assistant" onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    onPreview?.(null);
    toggleRef.current?.focus({ preventScroll: true });
  }}>
      <div className="traffic-chat-toolbar"><button ref={toggleRef} type="button" className="traffic-chat-toggle" aria-expanded={open} aria-controls="traffic-chat-log" onClick={() => { if (open) { setOpen(false); onPreview?.(null); } else showConversation(); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H5l-3 2V11a9 9 0 0 1 18 0Z" /><path d="M7 10h8M7 14h5" /></svg>Assistant<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={open ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} /></svg></button><div className="traffic-chat-actions">{open && messages.length ? <button type="button" className="traffic-chat-history" aria-expanded={history} aria-controls="traffic-chat-log" onClick={() => setHistory(value => !value)}>{history ? "Latest reply" : `History (${messages.length})`}</button> : null}<span className="traffic-chat-date">{context?.date ?? "Loading context…"}</span></div></div>
      <div ref={log} id="traffic-chat-log" className="traffic-chat-log" hidden={!open} role="log" aria-label={history ? "Conversation history" : "Latest message"} aria-live={open ? "polite" : "off"} aria-relevant="additions" tabIndex={0}>
        {!messages.length ? <div className="traffic-chat-examples">{suggestions.map(text => <button key={text} type="button" onClick={() => { setInput(text); inputRef.current?.focus(); }}>{text}</button>)}</div> : null}
        {visibleMessages.map(message => <article key={message.id} className="traffic-chat-message" data-role={message.role}><strong>{message.role === "user" ? "You" : "Assistant"}</strong><p>{message.content}</p>
          {message.locationChoices?.length ? <div className="traffic-chat-proposals">{message.locationChoices.map((choice, i) => <button key={`${choice.label}-${i}`} type="button" className="traffic-chat-location-choice" aria-pressed={message.selectedChoice === i} onClick={() => {
            setMessages(current => current.map(m => m.id === message.id ? { ...m, content: `Review ${choice.label} before applying.`, proposals: choice.proposals, preview: choice.preview, selectedChoice: i } : m));
            onPreview?.(choice.preview ?? null);
          }}><strong>{choice.label}</strong><small>{choice.description}</small></button>)}</div> : null}
          {message.proposals?.length ? <div className="traffic-chat-proposals">{message.proposals.map(p => <div key={p.id}><strong>{p.title}</strong>{p.locationLabel ? <small>{p.locationLabel}</small> : null}<small>{p.startsAt.replace("T", " · ")} → {p.endsAt.replace("T", " · ")} Toronto{p.kind === "event" ? ` · ${p.attendance?.toLocaleString()} attendees` : ` · ${p.restriction.replaceAll("-", " ")}`}</small></div>)}{message.preview?.features.length && !message.applied ? <button type="button" onClick={() => onPreview?.(message.preview!)}>Preview on map</button> : null}<button type="button" disabled={message.applied} onClick={() => apply(message)}>{message.applied ? "Added to map" : "Apply to map"}</button></div> : null}
        </article>)}
        {loading ? <p role="status" className="traffic-chat-note">Thinking about your scenario…</p> : null}
      </div>
      {error ? <p role="alert" className="traffic-chat-error">{error}</p> : null}
      <form onSubmit={send}><label className="closure-announcement" htmlFor="traffic-chat-input">Describe a traffic scenario in Toronto time</label><div className="traffic-chat-composer"><textarea id="traffic-chat-input" ref={inputRef} rows={1} maxLength={2500} value={input} onChange={e => setInput(e.target.value)} placeholder="Close Queen St W from Spadina to University, 5–7 PM…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/><button type="submit" aria-label="Send message" disabled={loading || !context || !input.trim()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19 0-14m-6 6 6-6 6 6" /></svg></button></div><div className="traffic-chat-footer" hidden={!open}><small>Review proposals before applying · Gemini</small><small>Shift + Enter for a new line</small></div></form>
    </section></WorkspaceDockPane>;
}
