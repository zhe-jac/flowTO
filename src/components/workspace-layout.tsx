"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import GlassSurface from "./glass-surface";

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

export function WorkspacePanel({ name, children }: { name: WorkspacePanelName; children: ReactNode }) {
  const { panel, setPanel, sideHost } = useWorkspaceLayout();
  return panel === name && sideHost ? createPortal(<div className="workspace-panel-content" onKeyDown={event => {
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

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<WorkspacePanelName | null>(null);
  const [sideHost, setSideHost] = useState<HTMLDivElement | null>(null);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [assistantHost, setAssistantHost] = useState<HTMLDivElement | null>(null);
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const assistantRef = useRef<HTMLElement>(null);
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
