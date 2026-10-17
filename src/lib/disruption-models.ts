import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import type { DisruptionKind } from "./disruptions";

export type DisruptionModel = { group: Group; animated: boolean; update: (seconds: number, reducedMotion: boolean) => void; dispose: () => void };

export function buildDisruptionModel(kind: DisruptionKind): DisruptionModel {
  const group = new Group();
  group.name = `disruption-${kind}`;
  const materials = new Map<string, MeshLambertMaterial>();
  const material = (color: string) => {
    if (!materials.has(color)) materials.set(color, new MeshLambertMaterial({ color, flatShading: true }));
    return materials.get(color)!;
  };
  const mesh = (parent: Group, geometry: BufferGeometry, surface: Material, x: number, y: number, z: number) => {
    const item = new Mesh(geometry, surface);
    item.position.set(x, y, z);
    parent.add(item);
    return item;
  };
  const box = (parent: Group, size: [number, number, number], position: [number, number, number], color: string) => mesh(parent, new BoxGeometry(...size), material(color), ...position);
  const cylinder = (parent: Group, top: number, bottom: number, height: number, position: [number, number, number], color: string) => {
    const item = mesh(parent, new CylinderGeometry(top, bottom, height, 12), material(color), ...position);
    item.rotation.x = Math.PI / 2;
    return item;
  };
  const link = (parent: Group, start: Vector3, end: Vector3, radius: number, color: string) => {
    const item = mesh(parent, new CylinderGeometry(radius, radius, start.distanceTo(end), 8), material(color), ...start.clone().add(end).multiplyScalar(0.5).toArray() as [number, number, number]);
    item.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
    return item;
  };
  const cone = (parent: Group, x: number, y: number) => {
    box(parent, [0.8, 0.8, 0.14], [x, y, 0.12], "#293746");
    cylinder(parent, 0.08, 0.34, 1.2, [x, y, 0.76], "#f68b36");
    cylinder(parent, 0.17, 0.23, 0.26, [x, y, 0.8], "#fff9eb");
  };
  const barrier = (parent: Group, width: number, y: number, color: string) => {
    for (const x of [-width * 0.36, width * 0.36]) {
      box(parent, [0.32, 0.32, 2.15], [x, y, 1.15], "#526575");
      box(parent, [0.65, 1.65, 0.22], [x, y, 0.15], "#293746");
    }
    for (const z of [1.05, 1.85]) {
      box(parent, [width, 0.3, 0.6], [0, y, z], "#fff8f2");
      const count = Math.round(width / 0.7);
      for (let index = 0; index < count; index++) {
        const stripe = box(parent, [0.34, 0.025, 0.62], [-width / 2 + 0.4 + index * (width - 0.8) / (count - 1), y - 0.166, z], color);
        stripe.rotation.y = -0.35;
        const back = stripe.clone();
        back.position.y = y + 0.166;
        parent.add(back);
      }
    }
  };
  const beacons: { material: MeshBasicMaterial; phase: number; intensity: number }[] = [];
  const beacon = (parent: Group, position: [number, number, number], color: string, phase = 0) => {
    const surface = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    mesh(parent, new SphereGeometry(0.28, 10, 6), surface, ...position);
    const halo = mesh(parent, new SphereGeometry(0.65, 10, 6), new MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }), ...position);
    beacons.push({ material: surface, phase, intensity: 1 }, { material: halo.material as MeshBasicMaterial, phase: phase + 0.2, intensity: 0.2 });
  };
  const car = (x: number, y: number, angle: number, color: string) => {
    const vehicle = new Group();
    vehicle.position.set(x, y, 0);
    vehicle.rotation.z = angle;
    group.add(vehicle);
    box(vehicle, [2.05, 4.4, 0.8], [0, 0, 0.95], color);
    box(vehicle, [1.7, 2.2, 0.75], [0, -0.1, 1.65], "#233c51");
    box(vehicle, [1.8, 1.4, 0.12], [0, -0.15, 2.08], color);
    for (const wheelX of [-1.05, 1.05]) for (const wheelY of [-1.4, 1.4]) {
      const wheel = cylinder(vehicle, 0.48, 0.48, 0.3, [wheelX, wheelY, 0.55], "#202d3a");
      wheel.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    }
    for (const lightX of [-0.65, 0.65]) {
      box(vehicle, [0.45, 0.12, 0.22], [lightX, 2.24, 1.07], "#fff4cb");
      box(vehicle, [0.4, 0.12, 0.22], [lightX, -2.24, 1.07], "#e35e58");
    }
    beacon(vehicle, [-0.5, -0.1, 2.3], "#ffb84b");
    return vehicle;
  };
  const beams: { pivot: Group; phase: number; side: number }[] = [];

  if (kind === "closure") {
    barrier(group, 10, 0, "#dc5a50");
    for (const x of [-4, 4]) beacon(group, [x, 0, 2.5], "#ffc56b", x);
    cone(group, -5.8, 0);
    cone(group, 5.8, 0);
  }

  if (kind === "accident") {
    car(-0.9, 1.7, -0.22, "#db687c");
    car(1.2, -2.6, 0.28, "#8db9d5");
    for (const y of [-6.2, -4, -1.8]) cone(group, -3.2, y);
  }

  if (kind === "construction") {
    box(group, [5.5, 9, 0.12], [0, 0, 0.12], "#697e89");
    for (const x of [-3.3, 3.3]) for (const y of [-4.8, -1.6, 1.6, 4.8]) cone(group, x, y);
    barrier(group, 5, 5.5, "#ef9443");
    box(group, [3.1, 4.5, 0.65], [0, 0, 0.65], "#2f3d47");
    for (const x of [-1.55, 1.55]) box(group, [0.65, 4.6, 0.9], [x, 0, 0.6], "#253440");
    cylinder(group, 1.45, 1.45, 0.65, [0, 0, 1.4], "#f4b641");
    box(group, [1.7, 2.1, 2], [-0.6, -0.35, 2.6], "#f4b641");
    box(group, [1.75, 1.65, 1.25], [-0.6, -0.25, 2.85], "#365b71");
    box(group, [1.95, 2.2, 0.18], [-0.6, -0.35, 3.7], "#ffd16b");
    link(group, new Vector3(0.8, 0, 1.7), new Vector3(0.8, 2.6, 4.9), 0.28, "#f4b641");
    link(group, new Vector3(0.8, 2.6, 4.9), new Vector3(0.8, 4.6, 1.4), 0.23, "#e69a2f");
    box(group, [1.4, 1.1, 0.9], [0.8, 4.6, 0.9], "#46515b");
  }

  if (kind === "event") {
    box(group, [12, 7, 0.9], [0, 0, 0.6], "#34445c");
    box(group, [11.4, 6.4, 0.18], [0, 0, 1.14], "#6e609b");
    box(group, [7, 0.35, 4.5], [0, 3, 3.5], "#29344b");
    box(group, [5.6, 0.08, 2.8], [0, 2.8, 3.7], "#9483d5");
    for (const x of [-5.5, 5.5]) {
      for (const dx of [-0.22, 0.22]) cylinder(group, 0.1, 0.1, 7, [x + dx, 1.8, 4.5], "#c1d4df");
      for (let level = 0; level < 4; level++) link(group, new Vector3(x - 0.22, 1.8, 1.2 + level * 1.7), new Vector3(x + 0.22, 1.8, 2.9 + level * 1.7), 0.055, "#d3e1e9");
      box(group, [1.2, 1.2, 3.7], [x, -2, 3], "#233249");
    }
    link(group, new Vector3(-5.7, 1.8, 8), new Vector3(5.7, 1.8, 8), 0.18, "#c1d4df");
    for (let index = 0; index < 4; index++) {
      const x = -4.5 + index * 3;
      const color = index % 2 ? "#aa8aff" : "#48dcff";
      cylinder(group, 0.4, 0.5, 0.6, [x, 1.8, 8.4], "#29344b");
      const pivot = new Group();
      pivot.position.set(x, 1.8, 8.6);
      group.add(pivot);
      const surface = new ShaderMaterial({
        uniforms: { beamColor: { value: new Color(color) } },
        vertexShader: "varying vec2 beamUv; void main() { beamUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 beamColor; varying vec2 beamUv; void main() { float fade = pow(1.0 - beamUv.y, 1.6); gl_FragColor = vec4(beamColor, fade * 0.28); }",
        transparent: true, depthWrite: false, side: DoubleSide,
      });
      const beam = mesh(pivot, new CylinderGeometry(7, 0.16, 60, 24, 1, true), surface, 0, 0, 30);
      beam.rotation.x = Math.PI / 2;
      beam.renderOrder = 2;
      mesh(pivot, new SphereGeometry(0.35, 10, 6), new MeshBasicMaterial({ color }), 0, 0, 0);
      beams.push({ pivot, phase: index * 1.4, side: index < 2 ? -1 : 1 });
    }
  }

  const update = (seconds: number, reducedMotion: boolean) => {
    for (const { pivot, phase, side } of beams) {
      pivot.rotation.x = -0.16 + (reducedMotion ? 0 : Math.sin(seconds * 0.32 + phase) * 0.18);
      pivot.rotation.y = side * 0.25 + (reducedMotion ? 0 : Math.sin(seconds * 0.24 + phase) * 0.22);
    }
    for (const { material: surface, phase, intensity } of beacons) surface.opacity = intensity * (reducedMotion ? 0.8 : 0.55 + Math.sin(seconds * 2 + phase) * 0.25);
  };
  update(0, true);
  return { group, animated: beams.length > 0 || beacons.length > 0, update, dispose: () => disposeModel(group) };
}

export function disposeModel(group: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  group.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.clear();
}
