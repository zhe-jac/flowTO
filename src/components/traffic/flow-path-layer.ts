import type { Accessor, DefaultProps } from "@deck.gl/core";
import { PathLayer, type PathLayerProps } from "@deck.gl/layers";
type FlowProps<D> = {
    getFlowParams?: Accessor<D, [
        number,
        number
    ]>;
    time?: number;
    arrowSpacing?: number;
    getOffset?: Accessor<D, number>;
};
const uniformBlock = `\
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
    arrowSpacing: 4,
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
  float across = clamp(vPathPosition.x, -1.0, 1.0);
  float facing = sqrt(max(1.0 - across * across, 0.0));
  float rim = pow(1.0 - facing, 1.4);
  float sheen = pow(max(1.0 - abs(across + 0.35) * 1.8, 0.0), 3.0);
  vec3 tint = fragColor.rgb;
  float along = vPathPosition.y;
  float travelled = along - flow.time * vFlowParams.x;
  float streaks = 0.0;
  for (int k = 0; k < 2; k++) {
    float strand = float(k);
    float angle = along * 6.2831853 / (flow.spacing * 2.5) + strand * 3.1415927;
    float lane = sin(angle) * 0.62;
    float onFront = cos(angle) > 0.0 ? 1.0 : 0.5;
    float line = 1.0 - smoothstep(0.16, 0.42, abs(across - lane));
    float cycle = fract(travelled / (flow.spacing * 1.8) + strand * 0.5 + vFlowParams.y);
    float tail = smoothstep(0.2, 0.9, cycle) * (1.0 - smoothstep(0.9, 0.98, cycle));
    streaks = max(streaks, line * tail * onFront);
  }

  vec3 body = tint * (0.78 + 0.22 * facing) + vec3(0.25 * sheen) + tint * rim * 0.3;
  vec3 color = mix(body, vec3(1.0), streaks * 0.95);
  float alpha = clamp(0.62 + 0.3 * rim + streaks, 0.0, 1.0);
  fragColor = vec4(color, fragColor.a * alpha);
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
            model.shaderInputs.setProps({ flow: { time: this.props.time ?? 0, spacing: this.props.arrowSpacing ?? 4 } });
        }
        super.draw(options);
    }
}
export type FlowPathLayerProps<D> = PathLayerProps<D> & FlowProps<D>;
