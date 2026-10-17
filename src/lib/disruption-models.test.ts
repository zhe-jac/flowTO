import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Mesh, ShaderMaterial } from "three";
import { buildDisruptionModel } from "./disruption-models";
import { MODEL_ORIGIN, mercatorPosition, modelDisplayScale, modelOffset, modelViewVisible, roadModelRotation } from "./disruption-model-placement";
import type { Road } from "./types";

test("model coordinates preserve the Toronto origin and east/north directions", () => {
  const origin = modelOffset([-79.3832, 43.6532]);
  assert.equal(origin.x, 0);
  assert.equal(origin.y, 0);
  assert.equal(origin.scale, 1);
  assert.ok(modelOffset([-79.3822, 43.6532]).x > 80);
  assert.ok(modelOffset([-79.3832, 43.6542]).y > 110);
  assert.ok(Math.abs(MODEL_ORIGIN.scale - mercatorPosition([-79.3832, 43.6532]).scale) < 1e-15);
});

test("road scenes align with the nearest part of a curved street", () => {
  const road = { geometry: { coordinates: [[-79.384, 43.653], [-79.383, 43.653], [-79.383, 43.654]] } } as Road;
  assert.ok(Math.abs(roadModelRotation(road, [-79.3837, 43.653]) + Math.PI / 2) < 0.001);
  assert.ok(Math.abs(roadModelRotation(road, [-79.383, 43.6537])) < 0.001);
  assert.equal(roadModelRotation(undefined, [-79.383, 43.653]), 0);
  assert.equal(roadModelRotation({ geometry: { coordinates: [[-79.383, 43.653], [-79.383, 43.653]] } } as Road, [-79.383, 43.653]), 0);
});

test("models only appear at close pitched views with bounded display scale", () => {
  assert.equal(modelViewVisible(16, 0), false);
  assert.equal(modelViewVisible(13, 60), false);
  assert.equal(modelViewVisible(14.5, 20), true);
  assert.equal(modelDisplayScale(10), 3.5);
  assert.equal(modelDisplayScale(20), 1);
});

test("all four scenes have finite geometry above ground and dispose their resources", () => {
  for (const kind of ["closure", "accident", "construction", "event"] as const) {
    const model = buildDisruptionModel(kind);
    model.update(10, false);
    const bounds = new Box3().setFromObject(model.group);
    assert.ok(Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.z));
    assert.ok(bounds.min.z > -0.1);
    assert.ok(bounds.max.z > 2);
    let geometryDisposed = false;
    const mesh = model.group.children.find((node) => node instanceof Mesh) as Mesh;
    mesh.geometry.addEventListener("dispose", () => { geometryDisposed = true; });
    model.dispose();
    assert.equal(geometryDisposed, true);
    assert.equal(model.group.children.length, 0);
  }
});

test("event beams reach into the sky and reduced motion holds their orientation", () => {
  const model = buildDisruptionModel("event");
  const beams: Mesh[] = [];
  model.group.traverse((node) => { if (node instanceof Mesh && node.material instanceof ShaderMaterial) beams.push(node); });
  assert.equal(beams.length, 4);
  assert.ok(new Box3().setFromObject(model.group).max.z > 60);
  model.update(0, true);
  const still = beams.map((beam) => beam.parent!.rotation.toArray());
  model.update(100, true);
  assert.deepEqual(beams.map((beam) => beam.parent!.rotation.toArray()), still);
  model.update(100, false);
  assert.notDeepEqual(beams.map((beam) => beam.parent!.rotation.toArray()), still);
  model.dispose();
});
