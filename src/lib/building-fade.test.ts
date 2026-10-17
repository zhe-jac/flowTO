import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BUILDING_FADE_FOCUS_EVENT, buildingFadeGeometry, buildingFadeStrength, FADE_ORIGIN, getBuildingFadeFocus, invertFadeMatrix, localFadeMatrix, mercatorPosition, setBuildingFadeFocus } from "./building-fade";
import { installBuildingFade } from "./building-fade-layer";
import type { DisruptionMap } from "./disruption-map";

test("building fade is absent in 2D and grows smoothly with pitch", () => {
  assert.equal(buildingFadeStrength(0), 0);
  assert.equal(buildingFadeStrength(8), 0);
  assert.ok(buildingFadeStrength(25) > 0);
  assert.ok(buildingFadeStrength(25) < buildingFadeStrength(45));
  assert.equal(buildingFadeStrength(80), 0.72);
});

test("fade geometry preserves road bends, skips invalid edges and excludes hidden street classes", () => {
  const coords = [[-79.384, 43.65], [-79.383, 43.65], [-79.383, 43.651]];
  const roads = [{ cls: "Major Arterial", coords }, { cls: "Local", coords }, { cls: "Collector", coords }];
  assert.equal(buildingFadeGeometry(roads, 12).length, 12);
  assert.equal(buildingFadeGeometry(roads, 13).length, 24);
  const detailed = buildingFadeGeometry(roads, 16);
  assert.equal(detailed.length, 36);
  assert.equal(detailed[0], Math.fround(mercatorPosition([-79.384, 43.65])[0] - FADE_ORIGIN[0]));
  assert.equal(detailed[2], detailed[6]);
  assert.equal(detailed[3], detailed[7]);
  assert.equal(buildingFadeGeometry([{ cls: "Local", coords: [[NaN, 43.65], [0, 0], [0, 0]] }]).length, 0);
});

test("local camera matrices and inverse projection preserve the ground plane", () => {
  const matrix = [4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 2, 0, -2, -3, 0.5, 1];
  const local = localFadeMatrix(matrix);
  assert.ok(Math.abs(local[12] - (FADE_ORIGIN[0] * 4 - 2)) < 1e-6);
  const inverse = invertFadeMatrix(local)!;
  assert.ok(inverse);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    const value = [0, 1, 2, 3].reduce((sum, k) => sum + local[k * 4 + row] * inverse[column * 4 + k], 0);
    assert.ok(Math.abs(value - Number(row === column)) < 1e-5);
  }
  assert.equal(invertFadeMatrix(new Float32Array(16)), null);
});

test("cursor focus is isolated per map and clears explicitly", () => {
  const a = new EventTarget() as HTMLCanvasElement, b = new EventTarget() as HTMLCanvasElement;
  let updates = 0;
  a.addEventListener(BUILDING_FADE_FOCUS_EVENT, () => updates++);
  setBuildingFadeFocus(a, { x: 120, y: 80 });
  assert.deepEqual(getBuildingFadeFocus(a), { x: 120, y: 80 });
  assert.equal(getBuildingFadeFocus(b), null);
  setBuildingFadeFocus(a, null);
  assert.equal(getBuildingFadeFocus(a), null);
  assert.equal(updates, 2);
});

function graphics() {
  const calls: { name: string; args: unknown[] }[] = [];
  const params = new Map<string, unknown>([
    ["READ_FRAMEBUFFER_BINDING", { name: "original-read" }], ["DRAW_FRAMEBUFFER_BINDING", { name: "original-draw" }],
    ["CURRENT_PROGRAM", { name: "original-program" }], ["VERTEX_ARRAY_BINDING", { name: "original-vao" }], ["ARRAY_BUFFER_BINDING", { name: "original-buffer" }],
    ["ACTIVE_TEXTURE", "TEXTURE3"], ["DEPTH_FUNC", "LEQUAL"], ["DEPTH_WRITEMASK", true], ["DEPTH_RANGE", [0, 0.999]],
    ["BLEND_SRC_RGB", "ONE"], ["BLEND_DST_RGB", "ZERO"], ["BLEND_SRC_ALPHA", "ONE"], ["BLEND_DST_ALPHA", "ZERO"], ["BLEND_EQUATION_RGB", "FUNC_ADD"], ["BLEND_EQUATION_ALPHA", "FUNC_ADD"],
  ]);
  const textures = new Map<unknown, unknown>([["TEXTURE0", { name: "texture-zero" }], ["TEXTURE3", { name: "texture-three" }]]);
  const enabled = new Set<unknown>(["DEPTH_TEST", "STENCIL_TEST", "CULL_FACE", "SCISSOR_TEST"]);
  let id = 0;
  const methods: Record<string, unknown> = {
    drawingBufferWidth: 1600, drawingBufferHeight: 1000,
    isContextLost: () => false,
    getParameter: (key: string) => key === "TEXTURE_BINDING_2D" ? textures.get(params.get("ACTIVE_TEXTURE")) : params.get(key),
    isEnabled: (key: string) => enabled.has(key),
    enable: (key: string) => enabled.add(key), disable: (key: string) => enabled.delete(key),
    bindFramebuffer: (target: string, value: unknown) => params.set(target === "READ_FRAMEBUFFER" ? "READ_FRAMEBUFFER_BINDING" : "DRAW_FRAMEBUFFER_BINDING", value),
    bindTexture: (_target: string, value: unknown) => textures.set(params.get("ACTIVE_TEXTURE"), value),
    activeTexture: (value: unknown) => params.set("ACTIVE_TEXTURE", value),
    bindVertexArray: (value: unknown) => params.set("VERTEX_ARRAY_BINDING", value),
    bindBuffer: (_target: string, value: unknown) => params.set("ARRAY_BUFFER_BINDING", value),
    useProgram: (value: unknown) => params.set("CURRENT_PROGRAM", value),
    depthFunc: (value: unknown) => params.set("DEPTH_FUNC", value), depthMask: (value: unknown) => params.set("DEPTH_WRITEMASK", value),
    blendEquation: (value: unknown) => { params.set("BLEND_EQUATION_RGB", value); params.set("BLEND_EQUATION_ALPHA", value); },
    blendEquationSeparate: (a: unknown, b: unknown) => { params.set("BLEND_EQUATION_RGB", a); params.set("BLEND_EQUATION_ALPHA", b); },
    blendFunc: (a: unknown, b: unknown) => { params.set("BLEND_SRC_RGB", a); params.set("BLEND_SRC_ALPHA", a); params.set("BLEND_DST_RGB", b); params.set("BLEND_DST_ALPHA", b); },
    blendFuncSeparate: (...values: unknown[]) => ["BLEND_SRC_RGB", "BLEND_DST_RGB", "BLEND_SRC_ALPHA", "BLEND_DST_ALPHA"].forEach((key, i) => params.set(key, values[i])),
    getShaderParameter: () => true, getProgramParameter: () => true,
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE", getUniformLocation: (_p: unknown, name: string) => ({ name }),
    getShaderInfoLog: () => "Synthetic shader failure",
  };
  const gl = new Proxy(methods, { get(target, property: string) {
    if (/^[A-Z][A-Z0-9_]*$/.test(property)) return property;
    if (property in target && typeof target[property] !== "function") return target[property];
    return (...args: unknown[]) => {
      calls.push({ name: property, args });
      if (property.startsWith("create")) return { id: ++id };
      const fn = target[property];
      return typeof fn === "function" ? fn(...args) : undefined;
    };
  } }) as unknown as WebGL2RenderingContext;
  return { gl, calls, params, enabled, textures, methods };
}

function environment(t: TestContext, renderer: "mapbox" | "maplibre") {
  const previous = ["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  t.after(() => { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  const canvas = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 500 }) as HTMLCanvasElement;
  const layers = new Map<string, { id: string; render: (...args: unknown[]) => void; slot?: string }>();
  const order: { id: string; before?: string; slot?: string }[] = [];
  let pitch = 55, zoom = 16;
  const map = {
    getCanvas: () => canvas, getPitch: () => pitch, getZoom: () => zoom, triggerRepaint: () => {},
    getStyle: () => ({ layers: [{ id: renderer === "mapbox" ? "toronto-road-labels" : "labels", type: "symbol" }] }),
    addLayer: (layer: { id: string; render: (...args: unknown[]) => void; slot?: string }, before?: string) => { layers.set(layer.id, layer); order.push({ id: layer.id, before, slot: layer.slot }); },
    getLayer: (id: string) => layers.get(id), removeLayer: (id: string) => layers.delete(id),
  } as unknown as DisruptionMap;
  return { canvas, map, layers, order, setPitch: (value: number) => { pitch = value; }, setZoom: (value: number) => { zoom = value; } };
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test("native building passes capture below buildings, restore graphics state and release resources", t => {
  for (const renderer of ["mapbox", "maplibre"] as const) {
    const env = environment(t, renderer), gpu = graphics();
    const baseline = new Map(gpu.params), enabled = new Set(gpu.enabled), textures = new Map(gpu.textures);
    const fade = installBuildingFade(env.map, renderer);
    fade.setRoads([{ cls: "Major Arterial", coords: [[-79.384, 43.65], [-79.383, 43.65]] }]);
    assert.equal(env.order[0].slot, renderer === "mapbox" ? "middle" : undefined);
    assert.equal(env.order[0].before, renderer === "maplibre" ? "toronto-3d-buildings" : undefined);
    assert.equal(env.order[1].before, renderer === "mapbox" ? "toronto-road-labels" : "labels");
    setBuildingFadeFocus(env.canvas, { x: 200, y: 100 });
    env.layers.get("building-fade-underlay")!.render(gpu.gl);
    env.layers.get("building-fade-composite")!.render(gpu.gl, identity);
    assert.ok(gpu.calls.some(call => call.name === "drawArraysInstanced"));
    assert.ok(gpu.calls.some(call => call.name === "drawArrays"));
    assert.ok(gpu.calls.some(call => call.name === "depthFunc" && call.args[0] === "GREATER"));
    assert.deepEqual(gpu.params, baseline);
    assert.deepEqual(gpu.enabled, enabled);
    assert.deepEqual(gpu.textures, textures);
    const allocations = gpu.calls.filter(call => call.name === "texImage2D").length;
    env.layers.get("building-fade-underlay")!.render(gpu.gl);
    assert.equal(gpu.calls.filter(call => call.name === "texImage2D").length, allocations);
    fade.dispose();
    assert.equal(env.layers.size, 0);
    assert.ok(gpu.calls.some(call => call.name === "deleteTexture"));
  }
});

test("flat views skip framebuffer work and shader failure leaves the basemap available", t => {
  const env = environment(t, "mapbox"), gpu = graphics();
  const fade = installBuildingFade(env.map, "mapbox");
  env.setPitch(0);
  env.layers.get("building-fade-underlay")!.render(gpu.gl);
  env.layers.get("building-fade-composite")!.render(gpu.gl, identity);
  assert.equal(gpu.calls.length, 0);
  env.setPitch(55);
  gpu.methods.getShaderParameter = () => false;
  t.mock.method(console, "warn", () => {});
  env.layers.get("building-fade-underlay")!.render(gpu.gl);
  env.layers.get("building-fade-composite")!.render(gpu.gl, identity);
  assert.equal(gpu.calls.filter(call => call.name === "drawArraysInstanced").length, 0);
  assert.equal(env.layers.size, 2);
  fade.dispose();
});
