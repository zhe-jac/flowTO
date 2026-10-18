"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import GlassSurface from "./glass-surface";
import DisruptionIcon from "./disruption-icon";
import type { Disruption } from "@/lib/disruptions";
import type { ChatTrafficContext } from "@/lib/traffic/chat";
import type { WeatherRates } from "@/lib/weather";

type Message = { id: string; role: "user" | "assistant"; content: string; proposals?: Disruption[]; applied?: boolean };
const SUGGESTION_SETS = [
  ["Add a concert at Scotiabank Arena with 15,000 people from 7 PM to 11 PM", "Summarize the traffic changes on the map", "How is traffic around the Financial District?"],
  ["Add a game at Rogers Centre with 30,000 people from 1 PM to 4 PM", "Which affected roads have the most diverted traffic?", "How does weekday commuting affect North York Centre?"],
  ["Add a concert at RBC Amphitheatre with 12,000 people from 7 PM to 10 PM", "Explain the current disruptions and their likely effects", "How is traffic around Yonge–Eglinton?"],
  ["Add a match at BMO Field with 20,000 people from 6 PM to 9 PM", "Compare baseline and scenario speeds on affected roads", "Are any published Blue Jays games affecting the selected date?"],
];
export default function TrafficChat({ open, onOpenChange, context, items, weather, onApply }: {
  open: boolean; onOpenChange: (open: boolean) => void; context: ChatTrafficContext | null;
  items: Disruption[]; weather: WeatherRates; onApply: (items: Disruption[]) => boolean;
}) {
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
  const trigger = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { onOpenChange(false); trigger.current?.focus(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onOpenChange]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, loading, open]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || loading || !context) return;
    const message: Message = { id: crypto.randomUUID(), role: "user", content: input.trim() };
    const next = [...messages, message];
    setMessages(next); setInput(""); setError(""); setLoading(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/traffic/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ messages: next.slice(-11).map(({ role, content }) => ({ role, content: content.slice(0, 2500) })), context, items, weather }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The assistant is unavailable. Try again.");
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content: result.reply, proposals: result.proposals }]);
    } catch (cause) {
      setInput(message.content);
      setMessages(current => current.filter(m => m.id !== message.id));
      setError(controller.signal.aborted ? "The request timed out. Try again; your map has not changed." : cause instanceof Error ? cause.message : "The assistant is unavailable.");
    } finally { clearTimeout(timeout); request.current = null; setLoading(false); }
  }
  function apply(message: Message) {
    if (!message.proposals?.length || message.applied) return;
    if (message.proposals.some(p => p.startsAt.slice(0, 10) !== context?.date)) { setError("The selected date changed. Ask for a new proposal for this date."); return; }
    if (!onApply(message.proposals)) { setError("A scenario can contain up to 20 disruptions. Remove some before adding these."); return; }
    setMessages(current => current.map(m => m.id === message.id ? { ...m, applied: true } : m));
    setError("");
  }
  return <div className="traffic-chat" data-map-ui>
    <GlassSurface variant="button"><button ref={trigger} className="toolbox-toggle" type="button" aria-label="Traffic assistant" aria-expanded={open} aria-controls="traffic-chat-panel" onClick={() => onOpenChange(!open)}>
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/></svg>
    </button></GlassSurface>
    {open ? <GlassSurface variant="panel"><section id="traffic-chat-panel" className="traffic-chat-panel" aria-label="Traffic assistant" onKeyDown={e => { if (e.key === "Escape") { onOpenChange(false); trigger.current?.focus(); } }}>
      <header className="toolbox-heading"><div><span className="toolbox-eyebrow">EXPLORE A WHAT-IF</span><h2>Traffic assistant</h2></div><button className="toolbox-close" type="button" aria-label="Close traffic assistant" onClick={() => { onOpenChange(false); trigger.current?.focus(); }}><DisruptionIcon kind="close" /></button></header>
      <p className="traffic-chat-note">Describe an event or ask about the map. Changes are reviewed before applying.</p>
      <div ref={log} className="traffic-chat-log" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {!messages.length ? <div className="traffic-chat-examples"><p>What would you like to explore?</p>{suggestions.map(text => <button key={text} type="button" onClick={() => { setInput(text); inputRef.current?.focus(); }}>{text}</button>)}</div> : null}
        {messages.map(message => <article key={message.id} className="traffic-chat-message" data-role={message.role}><strong>{message.role === "user" ? "You" : "Assistant"}</strong><p>{message.content}</p>
          {message.proposals?.length ? <div className="traffic-chat-proposals">{message.proposals.map(p => <div key={p.id}><strong>{p.title}</strong><small>{p.startsAt.replace("T", " · ")} → {p.endsAt.replace("T", " · ")} Toronto{p.kind === "event" ? ` · ${p.attendance?.toLocaleString()} attendees` : ` · ${p.restriction.replaceAll("-", " ")}`}</small></div>)}<button type="button" disabled={message.applied} onClick={() => apply(message)}>{message.applied ? "Added to map" : "Apply to map"}</button></div> : null}
        </article>)}
        {loading ? <p role="status" className="traffic-chat-note">Thinking about your scenario…</p> : null}
      </div>
      {error ? <p role="alert" className="traffic-chat-error">{error}</p> : null}
      <form onSubmit={send}><label className="traffic-chat-note" htmlFor="traffic-chat-input">{context ? `Selected date: ${context.date} · Toronto time` : "Loading map context…"}</label><textarea id="traffic-chat-input" ref={inputRef} rows={3} maxLength={2500} value={input} onChange={e => setInput(e.target.value)} placeholder="Describe an event, closure, or ask for a summary…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/><div className="traffic-chat-footer"><small>Illustrative estimates · powered by Gemini</small><button type="submit" disabled={loading || !context || !input.trim()}>Send</button></div></form>
    </section></GlassSurface> : null}
  </div>;
}
