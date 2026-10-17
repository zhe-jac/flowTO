import { LayerExtension, type Layer } from "@deck.gl/core";
import { BUILDING_FADE_PASSIVE_WEIGHT, BUILDING_FADE_RADIUS, BUILDING_FADE_SCREEN_GLSL } from "@/lib/building-fade";

const fadeModule = {
  name: "buildingFade",
  fs: `
layout(std140) uniform buildingFadeUniforms {
  vec2 viewport;
  vec2 framebuffer;
  vec3 focus;
} buildingFade;
${BUILDING_FADE_SCREEN_GLSL}
`,
  uniformTypes: { viewport: "vec2<f32>", framebuffer: "vec2<f32>", focus: "vec3<f32>" },
  inject: {
    "fs:#main-end": `
vec2 fadeScreen = vec2(gl_FragCoord.x/buildingFade.framebuffer.x,1.-gl_FragCoord.y/buildingFade.framebuffer.y)*buildingFade.viewport;
float passiveMask = buildingFadeScreenMask(fadeScreen,buildingFade.viewport)*${BUILDING_FADE_PASSIVE_WEIGHT};
float cursorMask = (1.-smoothstep(${BUILDING_FADE_RADIUS * 0.35},${BUILDING_FADE_RADIUS}.,distance(fadeScreen,buildingFade.focus.xy)))*buildingFade.focus.z*1.25;
float fadeMask = max(passiveMask,cursorMask);
if (fadeMask < .002) discard;
fragColor.a *= fadeMask;
`,
  },
} as const;

type Options = { canvas: HTMLCanvasElement; getFocus: () => [number, number, number] };

export class BuildingFadeExtension extends LayerExtension<Options> {
  static extensionName = "BuildingFadeExtension";

  getShaders() {
    return { modules: [fadeModule] };
  }

  draw(this: Layer, _params: unknown, extension: this) {
    const { canvas, getFocus } = extension.opts;
    for (const model of this.getModels()) {
      model.shaderInputs.setProps({ buildingFade: { viewport: [canvas.clientWidth, canvas.clientHeight], framebuffer: [canvas.width, canvas.height], focus: getFocus() } });
    }
  }
}
