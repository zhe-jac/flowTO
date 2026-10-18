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

export function movementLanes(edge, next, count = Math.max(1, Math.round(edge.lanes))) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (!next || count === 1 || !Number.isFinite(edge.exitBearing) || !Number.isFinite(next.entryBearing)) return all;
  const turn = ((next.entryBearing - edge.exitBearing + 540) % 360) - 180;
  if (turn > 35) return [0];
  if (turn < -35) return [count - 1];
  return all;
}

export function createRoutePlanner(edges, nodeCount) {
  const incoming = Array.from({ length: nodeCount }, () => []), outgoing = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, i) => { incoming[edge.to].push(i); outgoing[edge.from].push(i); });
  const cache = new Map();
  let costs = edges.map(edge => edge.length / (edge.speed / 3.6)), scales = edges.map(() => 1), version = 0;
  const tree = destination => {
    if (cache.has(destination)) return cache.get(destination);
    const distances = new Float64Array(nodeCount).fill(Infinity), next = new Int32Array(nodeCount).fill(-1);
    distances[destination] = 0;
    const heap = new Heap();
    heap.push(destination, 0);
    while (heap.values.length) {
      const [at, cost] = heap.pop();
      if (cost !== distances[at]) continue;
      for (const i of incoming[at]) {
        if (scales[i] === 0) continue;
        const candidate = cost + costs[i];
        if (candidate < distances[edges[i].from]) {
          distances[edges[i].from] = candidate;
          next[edges[i].from] = i;
          heap.push(edges[i].from, candidate);
        }
      }
    }
    const result = { distances, next };
    cache.set(destination, result);
    return result;
  };
  const route = (origin, destination, { previous = -1, visited = [], lane = -1 } = {}) => {
    if (origin === destination) return { path: [], cost: 0 };
    const forbidden = new Set(visited);
    forbidden.delete(origin);
    const legal = (i, first) => scales[i] > 0 && !forbidden.has(edges[i].to) && (!first || previous < 0 || edges[i].id !== edges[previous].id && (lane < 0 || movementLanes(edges[previous], edges[i]).includes(lane)));
    const { distances, next } = tree(destination);
    if (!Number.isFinite(distances[origin])) return null;
    const candidates = outgoing[origin].filter(i => legal(i, true) && Number.isFinite(distances[edges[i].to])).sort((a, b) => costs[a] + distances[edges[a].to] - costs[b] - distances[edges[b].to] || a - b);
    for (const first of candidates) {
      const path = [first], seen = new Set([origin, edges[first].to]);
      let at = edges[first].to;
      while (at !== destination) {
        const i = next[at];
        if (i < 0 || !legal(i, false) || seen.has(edges[i].to)) break;
        path.push(i); at = edges[i].to; seen.add(at);
      }
      if (at === destination) return { path, cost: path.reduce((sum, i) => sum + costs[i], 0) };
    }
    const distance = new Float64Array(nodeCount).fill(Infinity), parent = new Int32Array(nodeCount).fill(-1);
    const heap = new Heap();
    distance[origin] = 0; heap.push(origin, 0);
    while (heap.values.length) {
      const [at, cost] = heap.pop();
      if (cost !== distance[at]) continue;
      if (at === destination) break;
      for (const i of outgoing[at]) {
        if (!legal(i, at === origin)) continue;
        const candidate = cost + costs[i];
        if (candidate < distance[edges[i].to]) {
          distance[edges[i].to] = candidate; parent[edges[i].to] = i; heap.push(edges[i].to, candidate);
        }
      }
    }
    if (!Number.isFinite(distance[destination])) return null;
    const path = [];
    for (let at = destination; at !== origin;) { const i = parent[at]; if (i < 0) return null; path.push(i); at = edges[i].from; }
    return { path: path.reverse(), cost: distance[destination] };
  };
  return {
    route,
    get version() { return version; },
    cost(path) { return path.reduce((sum, i) => sum + costs[i], 0); },
    update(values, permissions) {
      const changed = Array.from(permissions).some((scale, i) => scale !== scales[i]);
      costs = Array.from(values, (value, i) => Math.max(0.01, version && !changed ? costs[i] * 0.7 + value * 0.3 : value));
      scales = Array.from(permissions); version++; cache.clear();
    },
  };
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
  const lanes = edges.map(edge => Array.from({ length: Math.max(1, Math.round(edge.lanes)) }, () => ({ entries: [], head: 0, readyHead: 0, occupancy: 0 })));
  const occupancy = new Float64Array(edges.length), pending = trips.map(() => 0);
  const scales = new Float64Array(edges.length).fill(1), costs = new Float64Array(edges.length);
  const exited = new Float64Array(edges.length), occupancySeconds = new Float64Array(edges.length), movingSeconds = new Float64Array(edges.length), readyCounts = new Float64Array(edges.length);
  const planner = createRoutePlanner(edges, nodeCount), eventPending = new Map(), routingQueues = new Float64Array(edges.length);
  const departures = trips.map(trip => ({ ...trip, cursor: -1, visited: [], lastRouted: -Infinity, checkedVersion: -1, revision: 0 }));
  const routing = { reroutes: 0, laneChanges: 0 };
  let generated = 0, completed = 0, delay = 0, maxStorageError = 0, maxBalanceError = 0, epoch = -1, revision = 0, dynamic = false;
  const freeTime = edges.map(edge => edge.length / (edge.speed / 3.6));
  const nextEdge = (packet, at, time, previous = -1, lane = -1) => {
    if (at === packet.destination) return -1;
    const first = packet.path[packet.cursor + 1];
    if (first !== undefined && !dynamic && scales[first] > 0) return first;
    if (first !== undefined && packet.validatedRevision === revision && packet.checkedVersion === planner.version && (previous < 0 || lane < 0 || movementLanes(edges[previous], edges[first]).includes(lane))) return first;
    const remaining = packet.path.slice(packet.cursor + 1);
    const valid = remaining.length && edges[remaining[0]].from === at && remaining.every(i => scales[i] > 0) && (previous < 0 || lane < 0 || movementLanes(edges[previous], edges[remaining[0]]).includes(lane));
    if (valid) packet.validatedRevision = revision;
    if (valid && (!dynamic || time - packet.lastRouted < 60)) return remaining[0];
    if (packet.checkedVersion === planner.version) return valid ? remaining[0] : -1;
    packet.checkedVersion = planner.version;
    if (valid) {
      const extraDelay = remaining.reduce((sum, i) => sum + Math.max(0, readyCounts[i] - (reference?.routingQueues[i] ?? readyCounts[i])) / Math.max(0.001, edges[i].capacity * scales[i] / 3600), 0);
      if (extraDelay < Math.max(15, planner.cost(remaining) * 0.15)) return remaining[0];
    }
    const alternative = planner.route(at, packet.destination, { previous, lane, visited: packet.visited });
    if (!alternative?.path.length) return valid ? remaining[0] : -1;
    if (valid && planner.cost(remaining) - alternative.cost < Math.max(30, planner.cost(remaining) * 0.2)) return remaining[0];
    if (packet.path.length && remaining.join(",") !== alternative.path.join(",")) routing.reroutes++;
    packet.path = alternative.path; packet.cursor = -1; packet.lastRouted = time; packet.validatedRevision = revision;
    return packet.path[0];
  };
  const enter = (packet, index, requested, time) => {
    if (scales[index] === 0) return 0;
    const cursor = packet.cursor + 1;
    if (packet.path[cursor] !== index) throw new Error("A simulated route lost its current edge.");
    const allowed = movementLanes(edges[index], edges[packet.path[cursor + 1]], lanes[index].length);
    const lane = allowed.filter(lane => lanes[index][lane].occupancy < edges[index].storage / lanes[index].length - 1e-8).sort((a, b) => lanes[index][a].occupancy - lanes[index][b].occupancy || a - b)[0];
    if (lane === undefined) return 0;
    const queue = lanes[index][lane], admitted = Math.min(requested, Math.max(0, edges[index].storage / lanes[index].length - queue.occupancy));
    if (admitted < 1e-8) return 0;
    const visited = [...packet.visited, edges[index].from], last = queue.entries.at(-1), ready = time + freeTime[index];
    if (last && last.count > 0 && last.path === packet.path && last.cursor === cursor && last.ready === ready && last.lastRouted === packet.lastRouted) last.count += admitted;
    else queue.entries.push({ ...packet, cursor, visited, count: admitted, ready });
    queue.occupancy += admitted;
    occupancy[index] += admitted;
    return admitted;
  };
  function advance(time) {
    dynamic = !!reference && operations.some(op => time / 60 >= op.start - (op.kind === "event" ? 60 : 0));
    let permissionsChanged = false;
    const previousScales = scales.slice();
    scales.fill(1);
    for (const op of operations) if (op.kind !== "event" && time / 60 >= op.start && time / 60 < op.end) for (const i of op.edges) scales[i] = Math.min(scales[i], op.capacity);
    for (let i = 0; i < edges.length; i++) {
      if (previousScales[i] !== scales[i]) permissionsChanged = true;
      for (const queue of lanes[i]) while (queue.readyHead < queue.entries.length && queue.entries[queue.readyHead].ready <= time) { readyCounts[i] += queue.entries[queue.readyHead].count; queue.readyHead++; }
      costs[i] = freeTime[i] + readyCounts[i] / Math.max(0.001, edges[i].capacity * Math.max(scales[i], 0.01) / 3600);
    }
    routingQueues.set(readyCounts);
    if (permissionsChanged) revision++;
    const nextEpoch = Math.floor(time / 30);
    if (epoch !== nextEpoch || permissionsChanged) { planner.update(costs, scales); epoch = nextEpoch; }
    for (let offset = 0; offset < edges.length; offset++) {
      const i = ((offset + Math.floor(time / step)) % edges.length + edges.length) % edges.length;
      for (let lane = 0; lane < lanes[i].length; lane++) {
        const queue = lanes[i][lane];
        let budget = edges[i].capacity * (scales[i] === 0 ? 1 : scales[i]) * step / 3600 / lanes[i].length;
        while (budget > 1e-8 && queue.head < queue.entries.length) {
          const packet = queue.entries[queue.head];
          if (packet.ready > time) break;
          const arrived = edges[i].to === packet.destination;
          const next = arrived ? -1 : nextEdge(packet, edges[i].to, time, i, lane);
          if (!arrived && next < 0) {
            if (dynamic) {
              const alternative = planner.route(edges[i].to, packet.destination, { previous: i, visited: packet.visited });
              if (alternative?.path.length) {
                const targets = movementLanes(edges[i], edges[alternative.path[0]], lanes[i].length).filter(target => target !== lane);
                const target = targets.sort((a, b) => lanes[i][a].occupancy - lanes[i][b].occupancy)[0];
                const space = target === undefined ? 0 : Math.max(0, edges[i].storage / lanes[i].length - lanes[i][target].occupancy);
                const count = Math.min(packet.count, budget, space);
                if (count > 1e-8) {
                  lanes[i][target].entries.push({ ...packet, path: alternative.path, cursor: -1, count, ready: time + step, lastRouted: time, checkedVersion: planner.version });
                  lanes[i][target].occupancy += count; queue.occupancy = Math.max(0, queue.occupancy - count);
                  readyCounts[i] = Math.max(0, readyCounts[i] - count); packet.count -= count; budget -= count; routing.laneChanges += count;
                  if (packet.count < 1e-8) { queue.head++; continue; }
                }
              }
            }
            break;
          }
          const count = arrived ? Math.min(packet.count, budget) : enter(packet, next, Math.min(packet.count, budget), time);
          if (count < 1e-8) break;
          occupancy[i] = Math.max(0, occupancy[i] - count); queue.occupancy = Math.max(0, queue.occupancy - count);
          exited[i] += count; readyCounts[i] = Math.max(0, readyCounts[i] - count); budget -= count; packet.count -= count;
          if (arrived) completed += count;
          if (packet.count < 1e-8) queue.head++;
        }
        if (queue.head > 100) { queue.entries = queue.entries.slice(queue.head); queue.readyHead -= queue.head; queue.head = 0; }
      }
    }
    if (Math.round(time / step) % 3 === 0) {
      const duration = step * 3, dayOffset = Math.floor(time / 86400), factor = profileFactor(input.dayProfiles?.[dayOffset] ?? input.profile, time / 60);
      for (let i = 0; i < trips.length; i++) {
        const trip = trips[i], initial = edges[trip.path[0]];
        const dayScale = initial.dailyByDay && initial.daily > 0 ? initial.dailyByDay[input.dayTypes?.[dayOffset] ?? 0] / initial.daily : 1;
        const amount = trip.daily / 86400 * dayScale * factor * duration;
        generated += amount; pending[i] += amount;
        if (pending[i] < 0.01) continue;
        const seed = departures[i];
        if (seed.revision !== revision) { seed.path = trip.path; seed.cursor = -1; seed.lastRouted = -Infinity; seed.checkedVersion = -1; seed.revision = revision; }
        const first = nextEdge(seed, trip.origin, time);
        if (first >= 0) pending[i] -= enter(seed, first, pending[i], time);
      }
      for (const op of operations) {
        if (op.kind !== "event" || op.destination === undefined) continue;
        const m = time / 60, arrival = Math.max(0, 1 - Math.abs(m - op.start) / 60), departure = Math.max(0, 1 - Math.abs(m - op.end) / 60);
        const origins = op.origins ?? trips.slice(0, 8).map(t => t.origin).filter(n => n !== op.destination);
        if (!origins.length) continue;
        for (let j = 0; j < origins.length; j++) for (const leaving of [false, true]) {
          const destination = leaving ? origins[j] : op.destination, origin = leaving ? op.destination : origins[j], key = `${op.id}:${j}:${leaving}`;
          const amount = op.vehicles * (leaving ? departure : arrival) / origins.length * duration / 3600;
          generated += amount;
          const entry = eventPending.get(key) ?? { count: 0, packet: { path: [], destination, cursor: -1, visited: [], lastRouted: -Infinity, checkedVersion: -1 } };
          entry.count += amount;
          if (entry.count > 1e-8) {
            if (origin === destination) { completed += entry.count; entry.count = 0; }
            else { const first = nextEdge(entry.packet, origin, time); if (first >= 0) entry.count -= enter(entry.packet, first, entry.count, time); }
          }
          eventPending.set(key, entry);
        }
      }
    }
    let stock = 0;
    for (let i = 0; i < edges.length; i++) {
      stock += occupancy[i]; occupancySeconds[i] += occupancy[i] * step; movingSeconds[i] += Math.max(0, occupancy[i] - readyCounts[i]) * step; delay += readyCounts[i] * step / 60;
      for (const lane of lanes[i]) maxStorageError = Math.max(maxStorageError, lane.occupancy - edges[i].storage / lanes[i].length);
    }
    const waiting = pending.reduce((sum, value) => sum + value, 0) + [...eventPending.values()].reduce((sum, value) => sum + value.count, 0);
    maxBalanceError = Math.max(maxBalanceError, Math.abs(generated - completed - stock - waiting));
  }
  function snapshot(seconds) {
    const values = new Float64Array(edges.length * 4);
    let stock = 0;
    for (let i = 0; i < edges.length; i++) {
      const occupied = occupancySeconds[i], speed = occupied > 0.01 ? Math.min(edges[i].speed, edges[i].speed * movingSeconds[i] / occupied) : edges[i].speed;
      values.set([exited[i] / seconds * 3600, speed, readyCounts[i], occupancy[i]], i * 4); stock += occupancy[i];
    }
    const waiting = pending.reduce((a, b) => a + b, 0) + [...eventPending.values()].reduce((a, value) => a + value.count, 0);
    exited.fill(0); occupancySeconds.fill(0); movingSeconds.fill(0);
    return { values, ledger: { generated, completed, onNetwork: stock, pending: waiting, balanceError: Math.abs(generated - completed - stock - waiting), delayVehicleMinutes: delay }, maxStorageError, maxBalanceError };
  }
  return { advance, snapshot, scales, readyCounts, routingQueues, routing };
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
  return { version: "finite-storage-v2", start: input.start, end: input.end, edges: input.edges, operations: input.operations, frames, warnings: input.warnings, context: "observed-count estimates", diagnostics: { trips: trips.length, elapsedMs: Math.round(performance.now() - began), maxStorageError, maxBalanceError, routing: scenario.routing } };
}
