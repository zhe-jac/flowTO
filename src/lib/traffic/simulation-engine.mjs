import { performance } from "node:perf_hooks";

class Heap {
  values = [];
  push(node, cost) {
    let i = this.values.length;
    this.values.push([node, cost]);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.values[p][1] <= cost) break;
      this.values[i] = this.values[p];
      i = p;
    }
    this.values[i] = [node, cost];
  }
  pop() {
    const first = this.values[0], last = this.values.pop();
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.values.length && this.values[c + 1][1] < this.values[c][1]) c++;
        if (last[1] <= this.values[c][1]) break;
        this.values[i] = this.values[c];
        i = c;
      }
      this.values[i] = last;
    }
    return first;
  }
}

export function inferTrips(edges, nodeCount) {
  const outgoing = Array.from({ length: nodeCount }, () => []);
  edges.forEach((e, i) => outgoing[e.from].push(i));
  const remaining = edges.map(e => Math.max(0, e.daily));
  const trips = [];
  const order = edges.map((_, i) => i).sort((a, b) => remaining[b] - remaining[a]);
  for (const first of order) {
    while (remaining[first] > 0.001) {
      const path = [first], seen = new Set([edges[first].from, edges[first].to]);
      let at = edges[first].to;
      for (let count = 0; count < 15; count++) {
        const candidates = outgoing[at].filter(i => remaining[i] > 0.001 && edges[i].id !== edges[path.at(-1)].id && !seen.has(edges[i].to));
        if (!candidates.length) break;
        const next = candidates.reduce((a, b) => remaining[a] >= remaining[b] ? a : b);
        path.push(next);
        at = edges[next].to;
        seen.add(at);
      }
      const daily = Math.min(...path.map(i => remaining[i]));
      for (const i of path) remaining[i] = Math.max(0, remaining[i] - daily);
      trips.push({ path, daily, origin: edges[first].from, destination: at });
    }
  }
  return trips;
}

function profileFactor(profile, minute) {
  const p = ((minute / 15 - 0.5) % 96 + 96) % 96;
  const i = Math.floor(p), f = p - i;
  return (profile[i] * (1 - f) + profile[(i + 1) % 96] * f) * 96;
}

function createRun(input, trips, operations, reference) {
  const { edges, nodeCount, step } = input;
  const outgoing = Array.from({ length: nodeCount }, () => []);
  const incoming = Array.from({ length: nodeCount }, () => []);
  edges.forEach((e, i) => { outgoing[e.from].push(i); incoming[e.to].push(i); });
  const queues = edges.map(() => ({ entries: [], head: 0, readyHead: 0 }));
  const occupancy = new Float64Array(edges.length);
  const pending = trips.map(() => 0);
  const scales = new Float64Array(edges.length).fill(1);
  const costs = new Float64Array(edges.length);
  const exited = new Float64Array(edges.length);
  const occupancySeconds = new Float64Array(edges.length);
  const movingSeconds = new Float64Array(edges.length);
  const readyCounts = new Float64Array(edges.length);
  const cache = new Map();
  const eventPending = new Map();
  let generated = 0, completed = 0, delay = 0, maxStorageError = 0, maxBalanceError = 0, epoch = -1, dynamic = false;
  const freeTime = edges.map(e => e.length / (e.speed / 3.6));
  const routeDistance = destination => {
    if (cache.has(destination)) return cache.get(destination);
    const distances = new Float64Array(nodeCount).fill(Infinity);
    distances[destination] = 0;
    const heap = new Heap();
    heap.push(destination, 0);
    while (heap.values.length) {
      const [at, cost] = heap.pop();
      if (cost !== distances[at]) continue;
      for (const i of incoming[at]) {
        if (scales[i] === 0) continue;
        const next = cost + costs[i];
        if (next < distances[edges[i].from]) {
          distances[edges[i].from] = next;
          heap.push(edges[i].from, next);
        }
      }
    }
    cache.set(destination, distances);
    return distances;
  };
  const nextEdge = (packet, at, previous = -1) => {
    const original = packet.cursor >= 0 ? packet.path[packet.cursor + 1] : undefined;
    if (original !== undefined && scales[original] > 0 && (!dynamic || readyCounts[original] < reference.readyCounts[original] + Math.max(5, edges[original].capacity * step / 1800))) return original;
    const distances = routeDistance(packet.destination);
    let best = -1, value = Infinity;
    for (const i of outgoing[at]) {
      if (scales[i] === 0 || (previous >= 0 && edges[i].id === edges[previous].id)) continue;
      const candidate = costs[i] + distances[edges[i].to];
      if (candidate < value) { value = candidate; best = i; }
    }
    if (original !== undefined && scales[original] > 0 && best >= 0 && costs[original] + distances[edges[original].to] <= value + 15) return original;
    return best;
  };
  const enter = (packet, index, count, time) => {
    const cursor = packet.cursor >= -1 && packet.path[packet.cursor + 1] === index ? packet.cursor + 1 : -1;
    queues[index].entries.push({ path: packet.path, destination: packet.destination, cursor, count, ready: time + freeTime[index] });
    occupancy[index] += count;
  };
  function advance(time) {
    dynamic = !!reference && operations.some(op => time / 60 >= op.start - (op.kind === "event" ? 60 : 0));
    scales.fill(1);
    for (const op of operations) if (op.kind !== "event" && time / 60 >= op.start && time / 60 < op.end) for (const i of op.edges) scales[i] = Math.min(scales[i], op.capacity);
    const nextEpoch = Math.floor(time / 60);
    for (let i = 0; i < edges.length; i++) {
      const queue = queues[i];
      while (queue.readyHead < queue.entries.length && queue.entries[queue.readyHead].ready <= time) {
        readyCounts[i] += queue.entries[queue.readyHead].count;
        queue.readyHead++;
      }
      costs[i] = freeTime[i] + readyCounts[i] / Math.max(0.001, edges[i].capacity * Math.max(scales[i], 0.01) / 3600);
    }
    if (epoch !== nextEpoch) { cache.clear(); epoch = nextEpoch; }
    for (let offset = 0; offset < edges.length; offset++) {
      const i = ((offset + Math.floor(time / step)) % edges.length + edges.length) % edges.length;
      const queue = queues[i];
      let budget = edges[i].capacity * (scales[i] === 0 ? 1 : scales[i]) * step / 3600;
      while (budget > 1e-8 && queue.head < queue.entries.length) {
        const packet = queue.entries[queue.head];
        if (packet.ready > time) break;
        const arrived = edges[i].to === packet.destination;
        const next = arrived ? -1 : nextEdge(packet, edges[i].to, i);
        if (!arrived && next < 0) break;
        const space = arrived ? Infinity : Math.max(0, edges[next].storage - occupancy[next]);
        const count = Math.min(packet.count, budget, space);
        if (count < 1e-8) break;
        occupancy[i] = Math.max(0, occupancy[i] - count);
        exited[i] += count;
        readyCounts[i] = Math.max(0, readyCounts[i] - count);
        budget -= count;
        packet.count -= count;
        if (arrived) completed += count;
        else enter(packet, next, count, time);
        if (packet.count < 1e-8) queue.head++;
      }
      if (queue.head > 100) { queue.entries = queue.entries.slice(queue.head); queue.readyHead -= queue.head; queue.head = 0; }
    }
    if (Math.round(time / step) % 3 === 0) {
      const duration = step * 3;
      const dayOffset = Math.floor(time / 86400);
      const factor = profileFactor(input.dayProfiles?.[dayOffset] ?? input.profile, time / 60);
      for (let i = 0; i < trips.length; i++) {
        const trip = trips[i];
        const initial = edges[trip.path[0]];
        const dayScale = initial.dailyByDay && initial.daily > 0 ? initial.dailyByDay[input.dayTypes?.[dayOffset] ?? 0] / initial.daily : 1;
        const amount = trip.daily / 86400 * dayScale * factor * duration;
        generated += amount;
        pending[i] += amount;
        if (pending[i] < 0.01) continue;
        const seed = { ...trip, cursor: -1 };
        const disrupted = trip.path.some(e => scales[e] === 0);
        const first = !disrupted && (!dynamic || readyCounts[trip.path[0]] < reference.readyCounts[trip.path[0]] + Math.max(5, edges[trip.path[0]].capacity * step / 1800)) ? trip.path[0] : nextEdge(seed, trip.origin);
        if (first < 0) continue;
        const count = Math.min(pending[i], Math.max(0, edges[first].storage - occupancy[first]));
        if (count > 1e-8) {
          enter({ ...trip, cursor: first === trip.path[0] ? -1 : -2 }, first, count, time);
          pending[i] -= count;
        }
      }
      for (const op of operations) {
        if (op.kind !== "event" || op.destination === undefined) continue;
        const m = time / 60;
        const arrival = Math.max(0, 1 - Math.abs(m - op.start) / 60);
        const departure = Math.max(0, 1 - Math.abs(m - op.end) / 60);
        const origins = op.origins ?? trips.slice(0, 8).map(t => t.origin).filter(n => n !== op.destination);
        if (!origins.length) continue;
        for (let j = 0; j < origins.length; j++) for (const leaving of [false, true]) {
          const destination = leaving ? origins[j] : op.destination;
          const origin = leaving ? op.destination : origins[j];
          const key = `${op.id}:${j}:${leaving}`;
          const amount = op.vehicles * (leaving ? departure : arrival) / origins.length * duration / 3600;
          generated += amount;
          let waiting = (eventPending.get(key)?.count ?? 0) + amount;
          if (waiting < 1e-8) continue;
          const seed = { path: [], destination, cursor: -1 };
          const first = nextEdge(seed, origin);
          if (first >= 0) {
            const count = Math.min(waiting, Math.max(0, edges[first].storage - occupancy[first]));
            if (count > 1e-8) { enter(seed, first, count, time); waiting -= count; }
          }
          eventPending.set(key, { count: waiting });
        }
      }
    }
    let stock = 0;
    for (let i = 0; i < edges.length; i++) {
      stock += occupancy[i];
      occupancySeconds[i] += occupancy[i] * step;
      movingSeconds[i] += Math.max(0, occupancy[i] - readyCounts[i]) * step;
      delay += readyCounts[i] * step / 60;
      maxStorageError = Math.max(maxStorageError, occupancy[i] - edges[i].storage);
    }
    const waiting = pending.reduce((sum, value) => sum + value, 0) + [...eventPending.values()].reduce((sum, v) => sum + v.count, 0);
    maxBalanceError = Math.max(maxBalanceError, Math.abs(generated - completed - stock - waiting));
  }
  function snapshot(seconds) {
    const values = new Float64Array(edges.length * 4);
    let stock = 0;
    for (let i = 0; i < edges.length; i++) {
      const occupied = occupancySeconds[i];
      const speed = occupied > 0.01 ? Math.min(edges[i].speed, edges[i].speed * movingSeconds[i] / occupied) : edges[i].speed;
      values.set([exited[i] / seconds * 3600, speed, readyCounts[i], occupancy[i]], i * 4);
      stock += occupancy[i];
    }
    const waiting = pending.reduce((a, b) => a + b, 0) + [...eventPending.values()].reduce((a, v) => a + v.count, 0);
    exited.fill(0);
    occupancySeconds.fill(0);
    movingSeconds.fill(0);
    return { values, ledger: { generated, completed, onNetwork: stock, pending: waiting, balanceError: Math.abs(generated - completed - stock - waiting), delayVehicleMinutes: delay }, maxStorageError, maxBalanceError };
  }
  return { advance, snapshot, scales, readyCounts };
}

export function simulateNetwork(input) {
  const began = performance.now();
  const trips = inferTrips(input.edges, input.nodeCount);
  const baseline = createRun(input, trips, []);
  const scenario = createRun(input, trips, input.operations, baseline);
  const frames = [];
  const first = (input.start - input.warmup) * 60;
  const start = input.start * 60, end = input.end * 60, interval = input.interval * 60;
  let maxStorageError = 0, maxBalanceError = 0;
  for (let time = first; time <= end; time += input.step) {
    baseline.advance(time);
    scenario.advance(time);
    if ((time - first + input.step) % interval !== 0) continue;
    const before = baseline.snapshot(interval), after = scenario.snapshot(interval);
    maxStorageError = Math.max(maxStorageError, before.maxStorageError, after.maxStorageError);
    maxBalanceError = Math.max(maxBalanceError, before.maxBalanceError, after.maxBalanceError);
    if (time + input.step < start) continue;
    const values = new Uint16Array(input.edges.length * 8);
    for (let i = 0; i < input.edges.length; i++) {
      for (let k = 0; k < 4; k++) {
        const scale = k === 0 ? 1 : k === 1 ? 100 : 10;
        values[i * 8 + k] = Math.min(65535, Math.round(before.values[i * 4 + k] * scale));
        values[i * 8 + 4 + k] = Math.min(65535, Math.round(after.values[i * 4 + k] * scale));
      }
    }
    const closed = new Set(), capacityScales = {};
    for (let i = 0; i < input.edges.length; i++) if (scenario.scales[i] < 1) {
      if (scenario.scales[i] === 0) closed.add(input.edges[i].id);
      capacityScales[input.edges[i].id] = scenario.scales[i];
    }
    frames.push({ minute: (time + input.step) / 60, values: Buffer.from(values.buffer).toString("base64"), baseline: before.ledger, scenario: after.ledger, closed: [...closed], capacityScales });
  }
  return { version: "finite-storage-v1", start: input.start, end: input.end, edges: input.edges, operations: input.operations, frames, warnings: input.warnings, context: "observed-count estimates", diagnostics: { trips: trips.length, elapsedMs: Math.round(performance.now() - began), maxStorageError, maxBalanceError } };
}
