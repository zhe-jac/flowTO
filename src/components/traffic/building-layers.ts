import { LayerExtension, type Layer, type LayerContext } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { parse } from "@loaders.gl/core";
import { MVTLoader } from "@loaders.gl/mvt";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { isPointInToronto } from "@/lib/city-boundary";
export type BuildingSource = {
    tiles: string;
    maxZoom: number;
    heightKey: string;
    baseKey: string;
    include?: (properties: Record<string, unknown>) => boolean;
};
type Building = {
    polygon: [
        number,
        number,
        number
    ][][];
    height: number;
    anchor: [
        number,
        number,
        number
    ];
};
export const MAPBOX_BUILDINGS = (token: string): BuildingSource => ({
    tiles: `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${encodeURIComponent(token)}`,
    maxZoom: 16,
    heightKey: "height",
    baseKey: "min_height",
    include: (p) => String(p.extrude) !== "false" && String(p.underground) !== "true",
});
export async function openFreeMapBuildings(): Promise<BuildingSource> {
    const response = await fetch("https://tiles.openfreemap.org/planet");
    if (!response.ok)
        throw new Error(`OpenFreeMap tile index failed (${response.status})`);
    const tilejson = (await response.json()) as {
        tiles: string[];
        maxzoom?: number;
    };
    return {
        tiles: tilejson.tiles[0],
        maxZoom: Math.min(tilejson.maxzoom ?? 14, 14),
        heightKey: "render_height",
        baseKey: "render_min_height",
        include: (p) => p.hide_3d !== true,
    };
}
function toBuildings(features: Feature[], source: BuildingSource): Building[] {
    const buildings: Building[] = [];
    for (const feature of features) {
        const geometry = feature.geometry as Polygon | MultiPolygon | null;
        if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon"))
            continue;
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        if (source.include && !source.include(properties))
            continue;
        const height = Number(properties[source.heightKey]) || 6;
        const base = Number(properties[source.baseKey]) || 0;
        if (height <= base)
            continue;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        for (const rings of polygons) {
            const outer = rings[0];
            if (!outer?.length)
                continue;
            let lng = 0;
            let lat = 0;
            for (const [x, y] of outer) {
                lng += x;
                lat += y;
            }
            lng /= outer.length;
            lat /= outer.length;
            if (!isPointInToronto([lng, lat]))
                continue;
            buildings.push({
                polygon: rings.map((ring) => ring.map(([x, y]): [
                    number,
                    number,
                    number
                ] => [x, y, base])),
                height: height - base,
                anchor: [lng, lat, height],
            });
        }
    }
    return buildings;
}
const BUILDING_COLORS: [
    number,
    [
        number,
        number,
        number
    ]
][] = [
    [0, [228, 241, 250]],
    [25, [208, 231, 246]],
    [80, [189, 220, 240]],
    [200, [166, 204, 229]],
    [350, [139, 183, 212]],
];
function buildingColor(height: number): [
    number,
    number,
    number
] {
    for (let i = 1; i < BUILDING_COLORS.length; i++) {
        const [h1, c1] = BUILDING_COLORS[i];
        if (height <= h1) {
            const [h0, c0] = BUILDING_COLORS[i - 1];
            const t = (height - h0) / (h1 - h0);
            return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [
                number,
                number,
                number
            ];
        }
    }
    return BUILDING_COLORS[BUILDING_COLORS.length - 1][1];
}
const ghostUniforms = `\
layout(std140) uniform ghostUniforms {
  float pass;
  float opacity;
} ghost;
`;
const ghostModule = {
    name: "ghost",
    vs: ghostUniforms,
    fs: ghostUniforms,
    uniformTypes: { pass: "f32", opacity: "f32" },
    inject: {
        "vs:#decl": "in vec3 ghostAnchors;\nout float vGhost;",
        "vs:#main-end": `
vec4 ghostCommon;
vec4 ghostBase = project_position_to_clipspace(vec3(ghostAnchors.xy, 0.0), vec3(0.0), vec3(0.0), ghostCommon);
vec4 ghostTop = project_position_to_clipspace(vec3(ghostAnchors.xy, ghostAnchors.z), vec3(0.0), vec3(0.0), ghostCommon);
if (ghostBase.w <= 0.0 || ghostTop.w <= 0.0) {
  vGhost = 1.0;
} else {
  float baseY = ghostBase.y / ghostBase.w;
  float topY = ghostTop.y / ghostTop.w;
  bool roofOffScreen = topY > 1.0 && baseY < 0.75;
  bool fillsScreen = topY - baseY > 1.3;
  bool risesFromBelow = baseY < -1.0 && topY > -0.7;
  vGhost = (roofOffScreen || fillsScreen || risesFromBelow) ? 1.0 : 0.0;
}
`,
        "fs:#decl": "in float vGhost;",
        "fs:#main-end": `
if (ghost.pass < 0.5) {
  if (vGhost > 0.5) discard;
} else {
  if (vGhost < 0.5) discard;
  fragColor.a *= ghost.opacity;
}
`,
    },
} as const;
type GhostProps = {
    getGhostAnchor?: (d: Building) => [
        number,
        number,
        number
    ];
    ghostPass?: number;
    ghostOpacity?: number;
};
class GhostExtension extends LayerExtension {
    static extensionName = "GhostExtension";
    static defaultProps = {
        getGhostAnchor: { type: "accessor", value: [0, 0, 0] },
        ghostPass: 0,
        ghostOpacity: 0.22,
    };
    getShaders() {
        return { modules: [ghostModule] };
    }
    initializeState(this: Layer<GhostProps>, _context: LayerContext, _extension: this) {
        this.getAttributeManager()?.add({
            ghostAnchors: { size: 3, stepMode: "dynamic", accessor: "getGhostAnchor" },
        });
    }
    draw(this: Layer<GhostProps>, _params: unknown, _extension: this) {
        for (const model of this.getModels()) {
            model.shaderInputs.setProps({ ghost: { pass: this.props.ghostPass ?? 0, opacity: this.props.ghostOpacity ?? 0.16 } });
        }
    }
}
const GHOST_EXTENSION = new GhostExtension();
type DepthParameters = Record<string, unknown>;
export function createBuildingLayers(source: BuildingSource) {
    let depth: DepthParameters = {};
    let depthKey = "";
    const getTileData = async ({ index, signal }: {
        index: {
            x: number;
            y: number;
            z: number;
        };
        signal?: AbortSignal;
    }) => {
        const url = source.tiles.replace("{z}", String(index.z)).replace("{x}", String(index.x)).replace("{y}", String(index.y));
        const response = await fetch(url, { signal });
        if (!response.ok)
            return [];
        const features = (await parse(await response.arrayBuffer(), MVTLoader, {
            mvt: { shape: "geojson", coordinates: "wgs84", tileIndex: index, layers: ["building"] },
        })) as Feature[];
        return toBuildings(features, source);
    };
    const renderPass = (pass: 0 | 1) => (props: {
        id: string;
        data?: Building[] | null;
    }) => new SolidPolygonLayer<Building, GhostProps>({
        id: props.id,
        data: props.data ?? [],
        getPolygon: (building) => building.polygon,
        getElevation: (building) => building.height,
        getFillColor: (building) => buildingColor(building.anchor[2]),
        getGhostAnchor: (building) => building.anchor,
        extruded: true,
        material: { ambient: 0.55, diffuse: 0.55, shininess: 24, specularColor: [40, 50, 60] },
        ghostPass: pass,
        ghostOpacity: 0.22,
        parameters: { ...depth, depthWriteEnabled: pass === 0 },
        extensions: [GHOST_EXTENSION],
    });
    const renderSolid = renderPass(0);
    const renderGhost = renderPass(1);
    return (nextDepth: DepthParameters, visible: boolean) => {
        const key = JSON.stringify(nextDepth);
        if (key !== depthKey) {
            depthKey = key;
            depth = nextDepth;
        }
        const common = {
            data: source.tiles,
            visible,
            minZoom: 14,
            maxZoom: source.maxZoom,
            maxCacheSize: 400,
            getTileData,
            updateTriggers: { renderSubLayers: depthKey },
        };
        return {
            solid: new TileLayer<Building[]>({ ...common, id: "buildings-solid", renderSubLayers: renderSolid }),
            ghost: new TileLayer<Building[]>({ ...common, id: "buildings-ghost", renderSubLayers: renderGhost }),
        };
    };
}
