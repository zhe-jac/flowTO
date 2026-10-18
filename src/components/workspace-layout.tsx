"use client";

import { createContext, useEffect, useContext, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import GlassSurface from "./glass-surface";
import { isBlankTarget } from "@/lib/dock-gestures";

export type WorkspacePanelName = "toolbox" | "weather" | "editor" | "road";
type DockPane = "timeline" | "assistant";
type WorkspaceContext = {
  panel: WorkspacePanelName | null;
  setPanel: Dispatch<SetStateAction<WorkspacePanelName | null>>;
  sideHost: HTMLDivElement | null;
  timelineHost: HTMLDivElement | null;
  assistantHost: HTMLDivElement | null;
  noticeHost: HTMLDivElement | null;
};
const Context = createContext<WorkspaceContext | null>(null);

export function useWorkspaceLayout() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace controls need a workspace layout.");
  return value;
}

/**
 * `dismissOnDoubleClick` lets a double-click on the panel's blank space close it, like the dock panels' minimize;
 * `onDismiss` replaces the default close (e.g. to also clear a selection).
 */
export function WorkspacePanel({ name, children, dismissOnDoubleClick = false, onDismiss }: { name: WorkspacePanelName; children: ReactNode; dismissOnDoubleClick?: boolean; onDismiss?: () => void }) {
  const { panel, setPanel, sideHost } = useWorkspaceLayout();
  return panel === name && sideHost ? createPortal(<div className="workspace-panel-content" onDoubleClick={event => {
    if (!dismissOnDoubleClick || !isBlankTarget(event.target)) return;
    window.getSelection()?.removeAllRanges();
    if (onDismiss) onDismiss(); else setPanel(null);
    document.querySelector<HTMLButtonElement>(`[data-panel-trigger="${name}"]`)?.focus({ preventScroll: true });
  }} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    setPanel(null);
    document.querySelector<HTMLButtonElement>(`[data-panel-trigger="${name === "editor" ? "toolbox" : name}"]`)?.focus({ preventScroll: true });
  }}>{children}</div>, sideHost) : null;
}

export function WorkspaceDockPane({ name, children }: { name: DockPane; children: ReactNode }) {
  const { timelineHost, assistantHost } = useWorkspaceLayout();
  const host = name === "timeline" ? timelineHost : assistantHost;
  return host ? createPortal(children, host) : null;
}

export function WorkspaceNotice({ children }: { children: ReactNode }) {
  const { noticeHost } = useWorkspaceLayout();
  return noticeHost ? createPortal(children, noticeHost) : null;
}

/**
 * Animates a dock's height when its content expands or minimizes, so the time controls and assistant slide open and
 * closed instead of jumping. The content wrapper's height is animated from its old to its new size; the newly shown
 * content fades in as it slides.
 */
function useDockSlide(pane: HTMLElement | null) {
  useEffect(() => {
    const content = pane?.parentElement;
    if (!pane || !content) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = pane.getBoundingClientRect().height;
    let animation: Animation | null = null;
    const observer = new ResizeObserver(() => {
      const next = pane.getBoundingClientRect().height;
      const previous = last;
      last = next;
      if (reduce.matches || Math.abs(next - previous) < 24) return;
      // The wrapper's border and padding stay constant, so offset the pane heights by them.
      const extra = content.getBoundingClientRect().height - next;
      const from = animation ? content.getBoundingClientRect().height : previous + extra;
      animation?.cancel();
      animation = content.animate([{ height: `${from}px` }, { height: `${next + extra}px` }], { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      animation.onfinish = () => { animation = null; };
      if (next > previous) pane.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    });
    observer.observe(pane);
    return () => { observer.disconnect(); animation?.cancel(); };
  }, [pane]);
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<WorkspacePanelName | null>(null);
  const [sideHost, setSideHost] = useState<HTMLDivElement | null>(null);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [assistantHost, setAssistantHost] = useState<HTMLDivElement | null>(null);
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const assistantRef = useRef<HTMLElement>(null);
  useDockSlide(timelineHost);
  useDockSlide(assistantHost);
  const value = useMemo(() => ({ panel, setPanel, sideHost, timelineHost, assistantHost, noticeHost }), [panel, sideHost, timelineHost, assistantHost, noticeHost]);

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const assistant = assistantRef.current;
    const root = rootRef.current;
    if (!timeline || !assistant || !root) return;
    const measure = () => {
      root.style.setProperty("--workspace-timeline-bottom", `${Math.ceil(timeline.getBoundingClientRect().bottom - root.getBoundingClientRect().top)}px`);
      root.style.setProperty("--workspace-assistant-height", `${Math.ceil(assistant.getBoundingClientRect().height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(timeline);
    observer.observe(assistant);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  return <Context.Provider value={value}>
    <div ref={rootRef} className="workspace-layout" data-panel={panel ?? "none"}>
      {children}
      <div ref={setSideHost} className="workspace-side-panel" hidden={!panel} data-map-ui />
      <div ref={setNoticeHost} className="workspace-notices" />
      <section ref={timelineRef} className="workspace-dock workspace-timeline" aria-label="Simulation timeline" data-map-ui>
        <GlassSurface variant="panel"><div className="workspace-dock-content"><div ref={setTimelineHost} id="workspace-timeline-pane" className="workspace-dock-pane" /></div></GlassSurface>
      </section>
      <section ref={assistantRef} className="workspace-dock workspace-assistant" aria-label="Traffic assistant" data-map-ui>
        <GlassSurface variant="panel"><div className="workspace-dock-content"><div ref={setAssistantHost} id="workspace-assistant-pane" className="workspace-dock-pane" /></div></GlassSurface>
      </section>
    </div>
  </Context.Provider>;
}
