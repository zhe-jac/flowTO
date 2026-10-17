import type { Accessor, DefaultProps } from "@deck.gl/core";
import { PathLayer, type PathLayerProps } from "@deck.gl/layers";
import { PULSE_SPACING } from "@/lib/traffic/flow-motion";

type FlowProps<D> = {
  getFlowParams?: Accessor<D, [number, number]>;
  time?: number;
  pulseSpacing?: number;
  getOffset?: Accessor<D, number>;
};

const uniformBlock = `
layout(std140) uniform flowUniforms {
  float time;
  float spacing;
} flow;
`;

const flowModule = {
  name: "flow",
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { time: "f32", spacing: "f32" },
} as const;

const defaultProps: DefaultProps<FlowPathLayerProps<unknown>> = {
  ...PathLayer.defaultProps,
  getFlowParams: { type: "accessor", value: [1, 0] },
  time: 0,
  pulseSpacing: PULSE_SPACING,
};

export class FlowPathLayer<D = unknown> extends PathLayer<D, FlowProps<D>> {
  static layerName = "FlowPathLayer";
  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [...shaders.modules, flowModule],
      inject: {
        "vs:#decl": "in vec2 instanceFlowParams;\nout vec2 vFlowParams;",
        "vs:#main-end": "vFlowParams = instanceFlowParams;",
        "fs:#decl": "in vec2 vFlowParams;",
        "fs:#main-end": `
if (!bool(picking.isActive)) {
  float across = abs(vPathPosition.x);
  float center = 1.0 - smoothstep(0.05, 0.8, across);
  float edge = 1.0 - 0.3 * smoothstep(0.45, 1.0, across);
  float cycle = fract((vPathPosition.y - flow.time * vFlowParams.x - vFlowParams.y) / flow.spacing);
  float trail = smoothstep(0.05, 0.48, cycle);
  float head = 1.0 - smoothstep(0.55, 0.68, cycle);
  float pulse = trail * head * center;
  float sheen = exp(-pow((vPathPosition.x + 0.32) * 4.5, 2.0));
  vec3 highlight = vec3(0.98, 0.99, 1.0);
  vec3 color = mix(fragColor.rgb, highlight, 0.06 * sheen + 0.55 * pulse);
  fragColor = vec4(color, fragColor.a * edge * (0.82 + 0.12 * pulse));
}
`,
      },
    };
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager()?.addInstanced({
      instanceFlowParams: { size: 2, accessor: "getFlowParams" },
    });
  }

  draw(options: Parameters<PathLayer<D, FlowProps<D>>["draw"]>[0]) {
    for (const model of this.getModels()) {
      model.shaderInputs.setProps({ flow: { time: this.props.time ?? 0, spacing: this.props.pulseSpacing ?? PULSE_SPACING } });
    }
    super.draw(options);
  }
}

export type FlowPathLayerProps<D> = PathLayerProps<D> & FlowProps<D>;
