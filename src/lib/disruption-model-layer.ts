import { AmbientLight, Camera, DirectionalLight, Matrix4, Scene, Vector3, WebGLRenderer } from "three";
import type { CustomRenderMethodInput } from "maplibre-gl";
import type { DisruptionMap } from "./disruption-map";
import type { Disruption } from "./disruptions";
import type { Road } from "./types";
import { buildDisruptionModel } from "./disruption-models";
import type { DisruptionModel } from "./disruption-models";
import { MODEL_ORIGIN, modelDisplayScale, modelOffset, modelViewVisible, roadModelRotation } from "./disruption-model-placement";

const LAYER_ID = "disruption-3d-scenes";

export function installDisruptionModels(map: DisruptionMap, onReady: (ready: boolean) => void) {
  const camera = new Camera();
  const scene = new Scene();
  const ambient = new AmbientLight("#e7f3ff", 2.1);
  scene.add(ambient);
  const sun = new DirectionalLight("#ffffff", 2.5);
  sun.position.set(-80, -100, 180);
  scene.add(sun);
  const transform = new Matrix4().makeTranslation(MODEL_ORIGIN.x, MODEL_ORIGIN.y, 0).scale(new Vector3(MODEL_ORIGIN.scale, -MODEL_ORIGIN.scale, MODEL_ORIGIN.scale));
  const projection = new Matrix4();
  const entries = new Map<string, { model: DisruptionModel; item: Disruption; latitudeScale: number }>();
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let renderer: WebGLRenderer | undefined;
  let disposed = false;
  let failed = false;
  const repaint = () => { if (!disposed && !document.hidden) map.triggerRepaint(); };
  const updateLighting = () => {
    const stored = Number(document.documentElement.dataset.simDaylight);
    const daylight = Number.isFinite(stored) ? stored : document.documentElement.dataset.simTheme === "night" ? 0 : 1;
    ambient.intensity = 1.2 + 0.9 * daylight;
    sun.intensity = 0.9 + 1.6 * daylight;
    repaint();
  };
  document.addEventListener("simulator-theme-change", updateLighting);
  updateLighting();
  preference.addEventListener("change", repaint);
  document.addEventListener("visibilitychange", repaint);

  const release = () => {
    if (disposed) return;
    disposed = true;
    preference.removeEventListener("change", repaint);
    document.removeEventListener("visibilitychange", repaint);
    document.removeEventListener("simulator-theme-change", updateLighting);
    for (const entry of entries.values()) entry.model.dispose();
    entries.clear();
    scene.clear();
    renderer?.dispose();
  };

  const layer = {
    id: LAYER_ID,
    type: "custom" as const,
    renderingMode: "3d" as const,
    onAdd: (_map: unknown, gl: WebGL2RenderingContext) => {
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      onReady(true);
    },
    render: (_gl: WebGL2RenderingContext, input: number[] | Float32Array | Float64Array | CustomRenderMethodInput) => {
      if (!renderer || disposed || failed || document.hidden || !modelViewVisible(map.getZoom(), map.getPitch())) return;
      const matrix = "defaultProjectionData" in input ? input.defaultProjectionData.mainMatrix : input;
      camera.projectionMatrix.copy(projection.fromArray(matrix).multiply(transform));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      const seconds = performance.now() / 1000;
      const displayScale = modelDisplayScale(map.getZoom());
      const canvas = map.getCanvas();
      let animated = false;
      let visible = false;
      for (const { model, item, latitudeScale } of entries.values()) {
        const point = map.project(item.position);
        model.group.visible = point.x > -160 && point.y > -160 && point.x < canvas.clientWidth + 160 && point.y < canvas.clientHeight + 240;
        if (!model.group.visible) continue;
        visible = true;
        model.group.scale.setScalar(displayScale * latitudeScale);
        model.update(seconds, preference.matches);
        animated ||= model.animated;
      }
      if (!visible) return;
      try {
        renderer.resetState();
        renderer.setViewport(0, 0, _gl.drawingBufferWidth, _gl.drawingBufferHeight);
        renderer.render(scene, camera);
      } catch (error) {
        failed = true;
        onReady(false);
        console.error("Disruption models could not render:", error);
      } finally {
        renderer.resetState();
      }
      if (!failed && animated && !preference.matches) repaint();
    },
    onRemove: release,
  };

  try {
    map.addLayer(layer);
  } catch (error) {
    release();
    throw error;
  }

  return {
    update: (items: Disruption[], roads: ReadonlyMap<string, Road>) => {
      if (disposed) return;
      const ids = new Set(items.map((item) => item.id));
      for (const [id, entry] of entries) if (!ids.has(id)) { scene.remove(entry.model.group); entry.model.dispose(); entries.delete(id); }
      for (const item of items) {
        let entry = entries.get(item.id);
        if (entry && entry.item.kind !== item.kind) { scene.remove(entry.model.group); entry.model.dispose(); entries.delete(item.id); entry = undefined; }
        const offset = modelOffset(item.position);
        if (!entry) {
          entry = { model: buildDisruptionModel(item.kind), item, latitudeScale: offset.scale };
          entries.set(item.id, entry);
          scene.add(entry.model.group);
        }
        entry.item = item;
        entry.latitudeScale = offset.scale;
        entry.model.group.position.set(offset.x, offset.y, 0.35);
        entry.model.group.rotation.z = item.kind === "event" ? 0 : roadModelRotation(roads.get(item.roadId), item.position);
      }
      repaint();
    },
    dispose: () => {
      if (disposed) return;
      if (map.getStyle() && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      release();
    },
  };
}
