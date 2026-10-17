import type { CustomRenderMethodInput } from "maplibre-gl";
import type { DisruptionMap } from "./disruption-map";
import { BUILDING_FADE_FOCUS_EVENT, BUILDING_FADE_RADIUS, buildingFadeGeometry, buildingFadeStrength, getBuildingFadeFocus, invertFadeMatrix, localFadeMatrix } from "./building-fade";
import type { FadePoint, FadeRoad } from "./building-fade";

const CAPTURE_ID = "building-fade-underlay";
const COMPOSITE_ID = "building-fade-composite";
const ROAD_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_segment;
layout(location=1) in vec2 a_style;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_zoom;
out float v_across;
out float v_visibility;
void main() {
  vec2 corners[6] = vec2[6](vec2(0.,-1.),vec2(1.,-1.),vec2(0.,1.),vec2(0.,1.),vec2(1.,-1.),vec2(1.,1.));
  vec2 corner = corners[gl_VertexID];
  vec4 a = u_matrix * vec4(a_segment.xy,0.,1.);
  vec4 b = u_matrix * vec4(a_segment.zw,0.,1.);
  v_across = corner.y;
  v_visibility = smoothstep(a_style.y,a_style.y+1.,u_zoom);
  if (a.w <= 0. || b.w <= 0.) { gl_Position = vec4(2.,2.,2.,1.); return; }
  vec2 delta = (b.xy/b.w-a.xy/a.w)*u_viewport;
  vec2 direction = delta/max(length(delta),.0001);
  vec2 normal = vec2(-direction.y,direction.x);
  vec4 position = mix(a,b,corner.x);
  position.xy += (normal*corner.y*a_style.x+direction*(corner.x*2.-1.)*2.)/u_viewport*position.w;
  gl_Position = position;
}`;
const ROAD_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_underlay;
uniform vec2 u_framebuffer;
uniform float u_strength;
in float v_across;
in float v_visibility;
out vec4 color;
void main() {
  float alpha = u_strength*v_visibility*(1.-smoothstep(.25,1.,abs(v_across)));
  if (alpha < .002) discard;
  vec3 base = texture(u_underlay,gl_FragCoord.xy/u_framebuffer).rgb;
  color = vec4(base*alpha,alpha);
}`;
const FOCUS_VERTEX = `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 positions[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
  v_ndc = positions[gl_VertexID];
  gl_Position = vec4(v_ndc,0.,1.);
}`;
const FOCUS_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_underlay;
uniform mat4 u_matrix;
uniform mat4 u_inverse;
uniform vec2 u_framebuffer;
uniform vec2 u_viewport;
uniform vec2 u_focus;
uniform vec2 u_depthRange;
uniform float u_radius;
uniform float u_strength;
in vec2 v_ndc;
out vec4 color;
void main() {
  vec2 screen = vec2((v_ndc.x+1.)*.5,(1.-v_ndc.y)*.5)*u_viewport;
  float alpha = (1.-smoothstep(u_radius*.35,u_radius,distance(screen,u_focus)))*u_strength;
  if (alpha < .002) discard;
  vec4 nearPoint = u_inverse*vec4(v_ndc,-1.,1.);
  vec4 farPoint = u_inverse*vec4(v_ndc,1.,1.);
  vec3 a = nearPoint.xyz/nearPoint.w;
  vec3 b = farPoint.xyz/farPoint.w;
  vec3 ray = b-a;
  if (abs(ray.z) < .0000001) discard;
  float t = -a.z/ray.z;
  if (t < 0. || t > 1.) discard;
  vec4 ground = u_matrix*vec4(a+ray*t,1.);
  if (ground.w <= 0.) discard;
  float depth = ground.z/ground.w*.5+.5;
  if (depth < 0. || depth > 1.) discard;
  gl_FragDepth = mix(u_depthRange.x,u_depthRange.y,depth);
  vec3 base = texture(u_underlay,gl_FragCoord.xy/u_framebuffer).rgb;
  color = vec4(base*alpha,alpha);
}`;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const result = gl.createProgram();
  if (!result) throw new Error("Could not allocate building fade shader");
  const shaders: WebGLShader[] = [];
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("Could not allocate building fade shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Building fade shader failed");
      gl.attachShader(result, shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "Building fade shader failed");
    return result;
  } catch (error) {
    gl.deleteProgram(result);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

export function installBuildingFade(map: DisruptionMap, renderer: "mapbox" | "maplibre") {
  const canvas = map.getCanvas();
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let focus: FadePoint | null = getBuildingFadeFocus(canvas);
  let lastFocus: FadePoint = focus ?? { x: 0, y: 0 };
  let focusOpacity = 0;
  let lastFrame = performance.now();
  let geometry = new Float32Array();
  let roads: readonly FadeRoad[] = [];
  let geometryTier = -1;
  let uploaded: Float32Array | null = null;
  let captured = false;
  let disposed = false;
  let failed = false;
  let context: WebGL2RenderingContext | null = null;
  let width = 0, height = 0;
  let roadProgram: WebGLProgram | null = null, focusProgram: WebGLProgram | null = null;
  let texture: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null;
  let buffer: WebGLBuffer | null = null, roadVao: WebGLVertexArrayObject | null = null, focusVao: WebGLVertexArrayObject | null = null;
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const updateGeometry = () => {
    const zoom = map.getZoom();
    geometryTier = zoom >= 14.2 ? 2 : zoom >= 12.8 ? 1 : 0;
    geometry = buildingFadeGeometry(roads, zoom);
  };
  const uniform = (gl: WebGL2RenderingContext, p: WebGLProgram, name: string) => {
    let cache = locations.get(p);
    if (!cache) { cache = new Map(); locations.set(p, cache); }
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name)!;
  };

  const release = () => {
    if (context && !context.isContextLost()) {
      context.deleteProgram(roadProgram);
      context.deleteProgram(focusProgram);
      context.deleteTexture(texture);
      context.deleteFramebuffer(framebuffer);
      context.deleteBuffer(buffer);
      context.deleteVertexArray(roadVao);
      context.deleteVertexArray(focusVao);
    }
    roadProgram = focusProgram = null;
    texture = null;
    framebuffer = null;
    buffer = null;
    roadVao = focusVao = null;
    uploaded = null;
    locations.clear();
    width = height = 0;
    captured = false;
  };
  const fail = (error: unknown) => {
    if (!failed) console.warn("Building transparency unavailable:", error);
    failed = true;
    release();
  };
  const prepare = (gl: WebGL2RenderingContext) => {
    if (roadProgram) return;
    context = gl;
    const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    try {
      roadProgram = program(gl, ROAD_VERTEX, ROAD_FRAGMENT);
      focusProgram = program(gl, FOCUS_VERTEX, FOCUS_FRAGMENT);
      texture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      buffer = gl.createBuffer();
      roadVao = gl.createVertexArray();
      focusVao = gl.createVertexArray();
      if (!texture || !framebuffer || !buffer || !roadVao || !focusVao) throw new Error("Could not allocate building fade buffers");
      gl.bindVertexArray(roadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
      gl.vertexAttribDivisor(1, 1);
    } finally {
      gl.bindVertexArray(oldVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer);
    }
  };

  const capture = {
    id: CAPTURE_ID,
    type: "custom" as const,
    renderingMode: "3d" as const,
    ...(renderer === "mapbox" ? { slot: "middle" } : {}),
    render: (gl: WebGL2RenderingContext) => {
      captured = false;
      if (disposed || failed || document.hidden || buildingFadeStrength(map.getPitch()) === 0 || gl.isContextLost()) return;
      const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const binding = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      const scissor = gl.isEnabled(gl.SCISSOR_TEST);
      try {
        prepare(gl);
        const zoom = map.getZoom();
        const tier = zoom >= 14.2 ? 2 : zoom >= 12.8 ? 1 : 0;
        if (tier !== geometryTier) updateGeometry();
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        if (!w || !h) return;
        if (width !== w || height !== h) {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
          if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Building fade framebuffer is incomplete");
          width = w;
          height = h;
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, draw);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
        gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        captured = true;
      } catch (error) { fail(error); }
      finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
        gl.bindTexture(gl.TEXTURE_2D, binding);
        if (scissor) gl.enable(gl.SCISSOR_TEST);
      }
    },
  };

  const composite = {
    id: COMPOSITE_ID,
    type: "custom" as const,
    renderingMode: "3d" as const,
    ...(renderer === "mapbox" ? { slot: "top" } : {}),
    render: (gl: WebGL2RenderingContext, input: number[] | CustomRenderMethodInput) => {
      if (!captured || disposed || failed || !roadProgram || !focusProgram || document.hidden) return;
      captured = false;
      const matrix = localFadeMatrix("defaultProjectionData" in input ? input.defaultProjectionData.mainMatrix : input);
      const now = performance.now();
      const elapsed = Math.min(100, now - lastFrame);
      lastFrame = now;
      const target = focus ? 1 : 0;
      focusOpacity = preference.matches ? target : focusOpacity + (target - focusOpacity) * (1 - Math.exp(-elapsed / 90));
      if (Math.abs(focusOpacity - target) < 0.005) focusOpacity = target;
      if (focus) lastFocus = focus;
      const strength = buildingFadeStrength(map.getPitch());
      const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
      const oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      const oldActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
      gl.activeTexture(gl.TEXTURE0);
      const oldTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      const depth = gl.isEnabled(gl.DEPTH_TEST), stencil = gl.isEnabled(gl.STENCIL_TEST), blend = gl.isEnabled(gl.BLEND), cull = gl.isEnabled(gl.CULL_FACE);
      const depthFunc = gl.getParameter(gl.DEPTH_FUNC) as number;
      const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
      const depthRange = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
      const blendParams = [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA, gl.BLEND_EQUATION_RGB, gl.BLEND_EQUATION_ALPHA].map(key => gl.getParameter(key) as number);
      const common = (p: WebGLProgram, opacity: number) => {
        gl.useProgram(p);
        gl.uniform1i(uniform(gl, p, "u_underlay"), 0);
        gl.uniformMatrix4fv(uniform(gl, p, "u_matrix"), false, matrix);
        gl.uniform2f(uniform(gl, p, "u_framebuffer"), width, height);
        gl.uniform2f(uniform(gl, p, "u_viewport"), canvas.clientWidth, canvas.clientHeight);
        gl.uniform1f(uniform(gl, p, "u_strength"), opacity);
      };
      try {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GREATER);
        gl.depthMask(false);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.bindVertexArray(roadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (uploaded !== geometry) { gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW); uploaded = geometry; }
        if (geometry.length) {
          common(roadProgram, strength);
          gl.uniform1f(uniform(gl, roadProgram, "u_zoom"), map.getZoom());
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, geometry.length / 6);
        }
        if (focusOpacity > 0) {
          const inverse = invertFadeMatrix(matrix);
          if (inverse) {
            common(focusProgram, Math.min(0.9, strength * 1.3) * focusOpacity);
            gl.uniformMatrix4fv(uniform(gl, focusProgram, "u_inverse"), false, inverse);
            gl.uniform2f(uniform(gl, focusProgram, "u_focus"), lastFocus.x, lastFocus.y);
            gl.uniform2f(uniform(gl, focusProgram, "u_depthRange"), depthRange[0], depthRange[1]);
            gl.uniform1f(uniform(gl, focusProgram, "u_radius"), BUILDING_FADE_RADIUS);
            gl.bindVertexArray(focusVao);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
        }
      } catch (error) { fail(error); }
      finally {
        gl.useProgram(oldProgram);
        gl.bindVertexArray(oldVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer);
        gl.bindTexture(gl.TEXTURE_2D, oldTexture);
        gl.activeTexture(oldActive);
        gl.depthFunc(depthFunc);
        gl.depthMask(depthMask);
        gl.blendFuncSeparate(blendParams[0], blendParams[1], blendParams[2], blendParams[3]);
        gl.blendEquationSeparate(blendParams[4], blendParams[5]);
        for (const [capability, enabled] of [[gl.DEPTH_TEST, depth], [gl.STENCIL_TEST, stencil], [gl.BLEND, blend], [gl.CULL_FACE, cull]] as const) enabled ? gl.enable(capability) : gl.disable(capability);
      }
      if (focusOpacity !== target) map.triggerRepaint();
    },
  };

  const updateFocus = () => { focus = getBuildingFadeFocus(canvas); map.triggerRepaint(); };
  const clearFocus = () => { focus = null; map.triggerRepaint(); };
  const lost = () => { release(); failed = false; };
  const restored = () => { failed = false; map.triggerRepaint(); };
  canvas.addEventListener(BUILDING_FADE_FOCUS_EVENT, updateFocus);
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  window.addEventListener("blur", clearFocus);
  try {
    map.addLayer(capture, renderer === "maplibre" ? "toronto-3d-buildings" : undefined);
    const label = renderer === "mapbox" ? "toronto-road-labels" : map.getStyle()?.layers?.find(layer => layer.type === "symbol")?.id;
    map.addLayer(composite, label);
  } catch (error) { fail(error); }

  return {
    setRoads: (next: readonly FadeRoad[]) => { if (disposed) return; roads = next; updateGeometry(); map.triggerRepaint(); },
    dispose: () => {
      disposed = true;
      canvas.removeEventListener(BUILDING_FADE_FOCUS_EVENT, updateFocus);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      window.removeEventListener("blur", clearFocus);
      if (map.getStyle()) for (const id of [COMPOSITE_ID, CAPTURE_ID]) if (map.getLayer(id)) map.removeLayer(id);
      release();
    },
  };
}

export type BuildingFadeController = ReturnType<typeof installBuildingFade>;
