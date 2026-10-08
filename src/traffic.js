import { ROAD_WIDTH, createCityPlan } from './city-generator.js';
import { CarSimulation, STEP } from './vehicle.js';
import { chooseRoadGoal, createRoadGraph, createSeededRandom, findRoadRoute, laneTarget } from './traffic-ai.js';
import { createTrafficSignals } from './traffic-signals.js';
import { getStopLineLayout } from './signal-layout.js';
import { createTrafficSpawnSlots, distributeTrafficSpawnSlots, isTrafficSpawnSafe, footprintsOverlap } from './traffic-spawn.js';
import { corridorFootprints, driveControl, edgeProgress, followingLimit, occupiesJunction, planPassing, projectedExtent, sweptPathIsSafe, trackProgress } from './traffic-planner.js';
import { escapeRoute, hiddenFromPlayer, TRAFFIC_EVASION } from './traffic-evasion.js';
import { junctionMovement, movementsConflict, pathProgress, pathTarget, turnStagingTarget, yieldsToOncoming } from './traffic-junction.js';
import { findSafeSpawnPose } from './vehicle-spawn.js';
import { createPolicePursuit } from './police-pursuit.js';
import { createTrafficAssets, makeTrafficCar } from './vehicle-visuals.js';

const headingOf = q => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function createVehicleRuntime(scene, THREE, count = 6, roadNetwork = createCityPlan().roadNetwork,
  roadWidth = ROAD_WIDTH, obstacles = [], mapBounds = null) {
  const states = [], cars = [], simulations = [];
  let requestedCount = 0, pendingCount = null, pendingReason = null, physics = null, serial = 0;
  let visualAssets = null;
  const getLaneOffset = width => Math.min(5.2, width * 0.25);
  let graph = createRoadGraph(roadNetwork, getLaneOffset(roadWidth));
  let spawnObstacles = obstacles, spawnSlots = [], spawnSearchCursor = 0;
  let thinkTime = 0, aiTime = 0, signalController = createTrafficSignals(roadNetwork);
  const profile = { aiMs: 0, playerPrepareMs: 0, npcPrepareMs: 0, prepareMs: 0,
    worldStepMs: 0, postMs: 0, aiTicks: 0, aiDecisions: 0 };
  const reservations = new Map();
  const roleRegistry = new Map([['civilian', { maxCount: 300, physicalOnly: false }]]);
  const spawnRequests = new Map();
  const spawnResults = new Map();
  let spawnSerial = 0;
  const roleStates = role => states.filter(state => state.role === role);
  let spawnBounds = mapBounds && Number.isFinite(mapBounds) ? { minX: -mapBounds, maxX: mapBounds, minZ: -mapBounds, maxZ: mapBounds }
    : mapBounds;
  const movementCache = new Map();
  const reservationFor = ai => {
    const first = reservations.get(ai.reservationNode);
    return first?.id === ai.id ? first : reservations.get(`${ai.reservationNode}|${ai.id}`);
  };
  const movementFor = (edge, next) => {
    const outgoing = graph.adjacency.get(edge.to)?.find(item => item.to === next);
    if (!outgoing) return null;
    const key = `${edge.from}>${edge.to}>${next}`;
    if (!movementCache.has(key)) movementCache.set(key, junctionMovement(edge, outgoing, graph.nodes.get(edge.to), roadWidth));
    return movementCache.get(key);
  };
  let visibleCount = 0;
  const visibilityFrustum = new THREE.Frustum();
  const visibilityMatrix = new THREE.Matrix4();
  const visibilitySphere = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const cellSize = 12;
  const cellKey = (x, z) => Math.floor(x / cellSize) * 1024 + Math.floor(z / cellSize);
  const occupancy = new Map();
  const playerOccupancy = { id: 'player', x: 0, z: 0, heading: 0, vx: 0, vz: 0, player: true };

  const rebuildSpawnSlots = () => {
    const nodes = [...graph.nodes.values()];
    const bounds = nodes.length ? { minX: Math.min(...nodes.map(node => node.x)), maxX: Math.max(...nodes.map(node => node.x)),
      minZ: Math.min(...nodes.map(node => node.z)), maxZ: Math.max(...nodes.map(node => node.z)) } : null;
    if (!spawnBounds) spawnBounds = bounds;
    spawnSlots = distributeTrafficSpawnSlots(createTrafficSpawnSlots(graph.directed), bounds);
    spawnSearchCursor = 0;
  };
  rebuildSpawnSlots();

  const updatePlayerOccupancy = () => {
    const player = physics.body;
    playerOccupancy.x = player.position.x; playerOccupancy.z = player.position.z;
    playerOccupancy.heading = headingOf(player.quaternion);
    playerOccupancy.vx = player.velocity.x; playerOccupancy.vz = player.velocity.z;
    return playerOccupancy;
  };

  const nearbyOccupants = (candidate, cells = occupancy, radius = 2) => {
    const bx = Math.floor(candidate.x / cellSize), bz = Math.floor(candidate.z / cellSize), found = [];
    // Include full braking/headway distance for any vehicle at the game's speed cap.
    for (let x = bx - radius; x <= bx + radius; x++) for (let z = bz - radius; z <= bz + radius; z++) {
      for (const item of cells.get(x * 1024 + z) || []) found.push(item);
    }
    return found;
  };

  const findSafeCandidate = (getOccupants, budget, start = spawnSearchCursor) => {
    if (!spawnSlots.length) return { slot: null, next: start, checked: 0 };
    const limit = Math.min(budget, spawnSlots.length);
    let checked = 0;
    for (; checked < limit; checked++) {
      const index = (start + checked) % spawnSlots.length;
      const slot = spawnSlots[index];
      if (isTrafficSpawnSafe(slot, getOccupants(slot), spawnObstacles)) {
        return { slot, next: (index + 1) % spawnSlots.length, checked: checked + 1 };
      }
    }
    return { slot: null, next: (start + checked) % spawnSlots.length, checked };
  };

  const syncState = (state, alpha = 1) => {
    const body = state.simulation.body;
    state.previousX = body.previousPosition.x; state.previousZ = body.previousPosition.z;
    state.x = body.position.x; state.z = body.position.z;
    state.heading = headingOf(body.quaternion); state.previousHeading = headingOf(body.previousQuaternion);
    state.speed = Math.hypot(body.velocity.x, body.velocity.z);
    const t = clamp(alpha, 0, 1);
    state.mesh.position.set(body.previousPosition.x + (body.position.x - body.previousPosition.x) * t,
      body.previousPosition.y + (body.position.y - body.previousPosition.y) * t - 0.96,
      body.previousPosition.z + (body.position.z - body.previousPosition.z) * t);
    state.renderQuaternion.set(body.previousQuaternion.x, body.previousQuaternion.y, body.previousQuaternion.z, body.previousQuaternion.w)
      .slerp(state.currentQuaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w), t);
    state.mesh.quaternion.copy(state.renderQuaternion);
  };

  const chooseRoute = (ai, at) => {
    ai.previousGoal = ai.goalId;
    const continuation = ai.continuation?.at === at ? ai.continuation : null;
    ai.goalId = continuation?.goal || chooseRoadGoal(graph, at, ai.random, ai.previousGoal);
    ai.route = continuation?.route || (ai.goalId ? findRoadRoute(graph, at, ai.goalId) : [at]);
    ai.continuation = null;
    if (ai.goalId) ai.goalHistory.push(ai.goalId);
    if (ai.goalHistory.length > 16) ai.goalHistory.shift();
    ai.routeIndex = ai.route.length > 1 ? 1 : 0;
    ai.targetNode = ai.route.length > 1 ? ai.route[ai.routeIndex] : null;
    ai.fromNode = at;
    ai.state = ai.targetNode ? 'following' : 'arrived-replan';
  };

  const startOnEdge = (ai, edge) => {
    ai.previousGoal = null;
    ai.goalId = chooseRoadGoal(graph, edge.to, ai.random);
    ai.route = ai.goalId ? findRoadRoute(graph, edge.to, ai.goalId) : [edge.to];
    if (ai.goalId) ai.goalHistory.push(ai.goalId);
    if (ai.goalHistory.length > 16) ai.goalHistory.shift();
    ai.routeIndex = 0; ai.fromNode = edge.from; ai.targetNode = edge.to;
    ai.state = 'following'; ai.reservationNode = null; ai.maneuver = null; ai.noProgressTime = 0; ai.waitReason = null;
    ai.progressEdge = null; ai.progressElapsed = 0; ai.requestNode = null; ai.requestedAt = null;
    ai.cooldownUntil = 0; ai.nextCorridorCheck = 0; ai.reevaluations = 0;
    ai.continuation = null;
    ai.targetSpeed = null;
    ai.nextExitReplan = 0; ai.exitReplans = 0;
    ai.staging = null;
  };

  const releaseReservation = ai => {
    if (ai.reservationNode && reservations.get(ai.reservationNode)?.id === ai.id) reservations.delete(ai.reservationNode);
    reservations.delete(`${ai.reservationNode}|${ai.id}`);
    ai.reservationNode = null;
  };

  const add = (index, slot, role = 'civilian', options = {}) => {
    const { edge, t, x, z, heading } = slot;
    const id = `${role === 'civilian' ? 'npc' : role}-${String(serial++).padStart(2, '0')}`;
    const simulation = new CarSimulation({ world: physics.world, materials: physics.materials,
      spawn: { x, y: Number.isFinite(slot.y) ? slot.y + 0.96 : 0.96, z, yaw: heading }, damage: false });
    if (role !== 'civilian') Object.assign(simulation.tuning, physics.tuning);
    visualAssets ||= createTrafficAssets(THREE);
    const mesh = makeTrafficCar(THREE, visualAssets, index, role);
    scene.add(mesh);
    const seed = (0xC4A7 + serial * 0x9E3779B1) >>> 0;
    const ai = { id, seed, random: createSeededRandom(seed), state: 'following', fromNode: edge.from, targetNode: edge.to,
      role, roleState: null, route: [], routeIndex: 0, goalId: null, previousGoal: null, control: { steer: 0, throttle: 0.5, brake: 0 },
      waitTime: 0, stuckTime: 0, recoveryTime: 0, reservationNode: null, completedGoals: 0, goalHistory: [] };
    if (role === 'civilian') startOnEdge(ai, edge);
    else {
      const roleDefinition = roleRegistry.get(role);
      ai.state = role === 'police' ? 'pursue' : 'active';
      ai.targetId = options.targetId || null;
      ai.roleState = roleDefinition.create?.({ id, targetId: ai.targetId, spawn: { x, y: slot.y ?? 0, z, yaw: heading } }) || {};
      ai.control = { steer: 0, throttle: 1, brake: 0 };
    }
    const state = { id, role, x, z, heading, speed: 0, previousX: x, previousZ: z, previousHeading: heading,
      spawnPose: { x, y: slot.y ?? 0, z, yaw: heading },
      spawnEdge: { from: edge.from, to: edge.to }, spawnFraction: t, simulation, mesh, ai, logical: false,
      occupancyItem: { id, x, z, heading, vx: 0, vz: 0, state: null },
      renderQuaternion: new THREE.Quaternion(), currentQuaternion: new THREE.Quaternion() };
    const collide = event => {
      if (role === 'civilian' && event.body === physics.body
        && Math.abs(event.contact.getImpactVelocityAlongNormal()) >= TRAFFIC_EVASION.impactSpeed) {
        ai.playerImpactPending = true;
      }
      if (role !== 'civilian' && event.body === physics.body) roleRegistry.get(role)?.onContact?.(ai.roleState, aiTime, event);
    };
    state.collideListener = collide;
    simulation.body.addEventListener('collide', collide);
    state.occupancyItem.state = state;
    states.push(state); simulations.push(simulation); cars.push(mesh); syncState(state);
    return state;
  };

  const removeAt = index => {
    const [state] = states.splice(index, 1);
    if (!state) return;
    releaseReservation(state.ai);
    state.simulation.body.removeEventListener('collide', state.collideListener);
    roleRegistry.get(state.role)?.dispose?.(state.ai.roleState);
    physics.world.removeBody(state.simulation.body);
    simulations.splice(simulations.indexOf(state.simulation), 1);
    cars.splice(cars.indexOf(state.mesh), 1);
    scene.remove(state.mesh);
  };

  const insertOccupancyItem = item => {
    const key = cellKey(item.x, item.z);
    let bucket = occupancy.get(key);
    if (!bucket) { bucket = []; occupancy.set(key, bucket); }
    bucket.push(item);
  };

  const applyCount = value => {
    requestedCount = value;
    while (roleStates('civilian').length > value) removeAt(states.findLastIndex(state => state.role === 'civilian'));
    pendingCount = roleStates('civilian').length < value ? value : null;
    pendingReason = pendingCount === null ? null : 'Ожидание безопасного размещения';
  };

  const servicePending = (maxAdds = 4, maxChecks = 256) => {
    if (!physics || pendingCount === null) return 0;
    buildOccupancy();
    let added = 0, checked = 0;
    while (roleStates('civilian').length < requestedCount && added < maxAdds && checked < maxChecks) {
      const result = findSafeCandidate(slot => nearbyOccupants(slot), maxChecks - checked);
      checked += result.checked;
      spawnSearchCursor = result.next;
      if (!result.slot) {
        if (checked >= maxChecks) break;
        break;
      }
      const state = add(states.length, result.slot, 'civilian');
      insertOccupancyItem(state.occupancyItem);
      added++;
    }
    pendingCount = roleStates('civilian').length < requestedCount ? requestedCount : null;
    pendingReason = pendingCount === null ? null
      : added ? 'Машины добавляются по мере освобождения мест' : 'Нет свободного безопасного места';
    return added;
  };

  const nearestDirectedSlot = pose => {
    let best = null, bestCost = Infinity;
    for (const edge of graph.directed) {
      const along = clamp(edgeProgress({ x: pose.x, z: pose.z }, edge), 0, edge.length);
      const x = edge.start.x + Math.sin(edge.heading) * along;
      const z = edge.start.z + Math.cos(edge.heading) * along;
      const headingCost = 1 - Math.cos(edge.heading - pose.yaw);
      const cost = Math.hypot(pose.x - x, pose.z - z) + headingCost * 8;
      if (cost < bestCost) { bestCost = cost; best = { edge, t: along / edge.length }; }
    }
    if (!best) return null;
    return { edge: best.edge, t: best.t, x: pose.x, y: pose.y, z: pose.z, heading: pose.yaw };
  };
  const createRoleActor = (role, pose, options = {}) => {
    const slot = nearestDirectedSlot({ ...pose, yaw: options.yaw ?? 0 });
    if (!slot) return { status: 'rejected', reason: 'no-road-graph' };
    const state = add(states.length, slot, role, options);
    insertOccupancyItem(state.occupancyItem);
    return { status: 'created', id: state.id, pose: { x: pose.x, y: pose.y, z: pose.z, yaw: options.yaw ?? 0 } };
  };
  const serviceRoleSpawnRequests = (budget = 2) => {
    if (!physics || !spawnRequests.size) return;
    for (const [requestId, record] of spawnRequests) {
      if (budget <= 0) break;
      const definition = roleRegistry.get(record.input.role);
      if (!definition) { record.result = { status: 'rejected', requestId, reason: 'unknown-role' }; spawnResults.set(requestId, record.result); spawnRequests.delete(requestId); continue; }
      const targetExists = record.input.targetId === 'player' || states.some(state => state.id === record.input.targetId);
      if (record.input.targetId && !targetExists) { record.result = { status: 'rejected', requestId, reason: 'missing-target' }; spawnResults.set(requestId, record.result); spawnRequests.delete(requestId); continue; }
      const result = findSafeSpawnPose(record.input, { bounds: spawnBounds, obstacles: spawnObstacles,
        occupants: [...roleStates('civilian').map(state => state.occupancyItem), ...states.filter(state => state.role !== 'civilian').map(state => state.occupancyItem), updatePlayerOccupancy()],
        surfaceHeight: definition.surfaceHeight || (() => 0), maxDistance: record.input.options?.maxDistance ?? 40 });
      if (result.status === 'rejected') { record.result = { ...result, requestId }; spawnResults.set(requestId, record.result); spawnRequests.delete(requestId); continue; }
      if (result.status === 'pending') { record.result = { status: 'pending', requestId, reason: result.reason }; continue; }
      const created = createRoleActor(record.input.role, result.pose, { targetId: record.input.targetId, yaw: result.pose.yaw });
      record.result = { ...created, requestId, pose: result.pose, distance: result.distance };
      spawnResults.set(requestId, record.result);
      spawnRequests.delete(requestId); budget--;
    }
  };

  const buildOccupancy = () => {
    const insert = item => {
      const key = cellKey(item.x, item.z);
      let bucket = occupancy.get(key);
      if (!bucket) { bucket = []; occupancy.set(key, bucket); }
      bucket.push(item);
    };
    for (const bucket of occupancy.values()) bucket.length = 0;
    for (const state of states) {
      const body = state.simulation.body, item = state.occupancyItem;
      item.x = body.position.x; item.z = body.position.z; item.heading = headingOf(body.quaternion);
      item.vx = body.velocity.x; item.vz = body.velocity.z;
      insert(item);
    }
    insert(updatePlayerOccupancy());
    return occupancy;
  };

  const setLogical = (state, logical) => {
    if (state.logical === logical) return;
    const body = state.simulation.body;
    state.logical = logical;
    if (logical) physics.world.removeBody(body);
    else {
      body.position.set(state.x, 0.96, state.z);
      body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion); body.interpolatedQuaternion.copy(body.quaternion);
      body.aabbNeedsUpdate = true;
      physics.world.addBody(body);
    }
  };

  const updateLod = () => {
    const player = physics.body.position;
    buildOccupancy();
    const touching = new Set();
    const physicalBodies = new Map(states.filter(state => !state.logical).map(state => [state.simulation.body, state]));
    for (const contact of physics.world.contacts) {
      if (contact.bi === physics.ground || contact.bj === physics.ground
        || contact.bi.wheelSupport || contact.bj.wheelSupport) continue;
      const a = physicalBodies.get(contact.bi), b = physicalBodies.get(contact.bj);
      if (a) touching.add(a);
      if (b) touching.add(b);
    }
    for (const state of states) {
      if (roleRegistry.get(state.role)?.physicalOnly) {
        if (state.logical) setLogical(state, false);
        continue;
      }
      const distance = Math.hypot(state.x - player.x, state.z - player.z);
      const candidate = { x: state.x, z: state.z, heading: headingOf(state.simulation.body.quaternion),
        vx: state.simulation.body.velocity.x, vz: state.simulation.body.velocity.z };
      const neighbors = nearbyOccupants(candidate).filter(other => other.id !== state.id);
      const nearPhysical = neighbors.some(other => other.state && physicalBodies.has(other.state.simulation.body)
        && Math.hypot(other.x - player.x, other.z - player.z) < 45
        && Math.hypot(other.x - candidate.x, other.z - candidate.z) < 10);
      if (!state.logical && distance > 45 && !nearPhysical && !state.ai.maneuver && !touching.has(state)) setLogical(state, true);
      else if (state.logical && (distance < 30 || nearPhysical)
        && isTrafficSpawnSafe(candidate, neighbors, spawnObstacles, 0)) setLogical(state, false);
    }
  };

  const stepLogical = dt => {
    for (const state of states) {
      if (state.role !== 'civilian') continue;
      if (!state.logical) continue;
      const body = state.simulation.body, control = state.ai.control;
      body.previousPosition.copy(body.position); body.previousQuaternion.copy(body.quaternion);
      const currentSpeed = body.velocity.x * Math.sin(headingOf(body.quaternion)) + body.velocity.z * Math.cos(headingOf(body.quaternion));
      const lock = 0.95 / (1 + Math.abs(currentSpeed) * 0.016);
      const yawRate = reservationFor(state.ai)?.movement && !state.ai.maneuver
        ? currentSpeed * Math.tan(control.steer * lock) / 2.3
        : control.steer * 1.6 * Math.sign(currentSpeed);
      const yaw = headingOf(body.quaternion) + yawRate * dt;
      const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
      let speed = body.velocity.x * forwardX + body.velocity.z * forwardZ;
      const acceleration = control.throttle * (state.ai.evasion ? 4.8 : 3.4) - Math.sign(speed) * (control.brake * 7 + 0.16);
      const nextSpeed = clamp(speed + acceleration * dt, -2.5, state.ai.evasion ? TRAFFIC_EVASION.speed + 0.5 : 8.5);
      speed = control.brake && Math.sign(nextSpeed) !== Math.sign(speed) ? 0 : nextSpeed;
      body.velocity.set(forwardX * speed, 0, forwardZ * speed);
      body.position.x += body.velocity.x * dt; body.position.z += body.velocity.z * dt; body.position.y = 0.96;
      body.quaternion.setFromEuler(0, yaw, 0); body.aabbNeedsUpdate = true;
      state.x = body.position.x; state.z = body.position.z;
    }
  };

  const routeEdge = ai => graph.adjacency.get(ai.fromNode)?.find(edge => edge.to === ai.targetNode);

  const replanAtNearest = state => {
    const ai = state.ai, body = state.simulation.body;
    let nearest = null, best = Infinity;
    for (const edge of graph.directed) {
      const along = clamp(edgeProgress(body.position, edge), 0, edge.length);
      const x = edge.start.x + Math.sin(edge.heading) * along, z = edge.start.z + Math.cos(edge.heading) * along;
      const cost = Math.hypot(body.position.x - x, body.position.z - z)
        + 4 * (1 - Math.cos(edge.heading - headingOf(body.quaternion)));
      if (cost < best) { best = cost; nearest = edge; }
    }
    if (!nearest) { ai.targetNode = null; ai.state = 'no-path'; ai.waitReason = 'no-path'; return; }
    const held = ai.reservationNode, reserve = reservationFor(ai);
    if (!reserve?.entered) releaseReservation(ai);
    const reevaluations = (ai.reevaluations || 0) + 1;
    startOnEdge(ai, nearest);
    if (reserve?.entered) ai.reservationNode = held;
    ai.reevaluations = reevaluations;
  };

  const updateControllers = dt => {
    aiTime += dt;
    updateLod();
    const cells = buildOccupancy();
    const plans = [], byId = new Map();
    // Route changes do not move bodies. Every hazard uses this tick's occupancy snapshot.
    for (const state of states) {
      if (state.role !== 'civilian') continue;
      const ai = state.ai, car = state.occupancyItem;
      if (!ai.targetNode) replanAtNearest(state);
      let edge = routeEdge(ai);
      if (!edge) { replanAtNearest(state); edge = routeEdge(ai); }
      if (ai.playerImpactPending) {
        ai.playerImpactPending = false;
        ai.evasion = { startedAt: aiTime, lastImpactAt: aiTime, nextReplanAt: aiTime };
      }
      if (ai.evasion && edge) {
        const evasion = ai.evasion, distance = Math.hypot(car.x - playerOccupancy.x, car.z - playerOccupancy.z);
        const elapsed = aiTime - evasion.lastImpactAt;
        if (elapsed >= TRAFFIC_EVASION.maximumDuration || elapsed >= TRAFFIC_EVASION.minimumDuration
          && (distance > 120 || distance > TRAFFIC_EVASION.safeDistance && hiddenFromPlayer(car, playerOccupancy, spawnObstacles))) {
          ai.evasion = null;
        } else if (aiTime >= evasion.nextReplanAt && !reservationFor(ai)) {
          const route = escapeRoute(graph, edge, playerOccupancy, spawnObstacles);
          if (route) { ai.route = route; ai.routeIndex = 0; ai.goalId = route.at(-1); ai.continuation = null; }
          evasion.nextReplanAt = aiTime + TRAFFIC_EVASION.replanInterval;
        }
      }
      if (edge && ai.routeIndex === ai.route.length - 1 && !ai.continuation
        && edge.length - edgeProgress(car, edge) < roadWidth / 2 + 14) {
        const goal = chooseRoadGoal(graph, edge.to, ai.random, ai.goalId);
        if (goal) ai.continuation = { at: edge.to, goal, route: findRoadRoute(graph, edge.to, goal) };
      }
      const crossing = reservationFor(ai)?.movement;
      const onExit = crossing?.nodeId === ai.targetNode && pathProgress(car, crossing) >= crossing.points.at(-1).distance / 2;
      if (edge && (onExit || Math.hypot(car.x - edge.end.x, car.z - edge.end.z) < 4 || edgeProgress(car, edge) > edge.length + 3)) {
        ai.fromNode = ai.targetNode; ai.routeIndex++;
        ai.progressEdge = null;
        if (ai.routeIndex >= ai.route.length) {
          ai.completedGoals++; chooseRoute(ai, ai.fromNode);
        } else ai.targetNode = ai.route[ai.routeIndex];
        edge = routeEdge(ai);
      }
      const plan = { state, ai, car, edge, node: graph.nodes.get(ai.targetNode), waitReason: null };
      if (edge) plan.movement = movementFor(edge, ai.route[ai.routeIndex + 1] ?? ai.continuation?.route[1]);
      plans.push(plan); byId.set(state.id, plan);
    }

    for (const [key, reservation] of reservations) {
      const nodeId = reservation.nodeId || key;
      const owner = byId.get(reservation.id), node = graph.nodes.get(nodeId);
      if (!owner || !node) { reservations.delete(key); continue; }
      if (occupiesJunction(owner.car, node, roadWidth)) reservation.entered = true;
      const cleared = reservation.entered && !occupiesJunction(owner.car, node, roadWidth);
      const invalid = !reservation.entered && owner.ai.targetNode !== nodeId;
      if (cleared || invalid) { reservations.delete(key); owner.ai.reservationNode = null; }
    }

    const exitBlocked = (plan, exit, movement) => {
      const distance = roadWidth / 2 + 2.08 + 2;
      const probe = { x: exit.start.x + Math.sin(exit.heading) * distance,
        z: exit.start.z + Math.cos(exit.heading) * distance, heading: exit.heading };
      return nearbyOccupants(probe, cells).some(other => {
        if (other.id === plan.car.id || !footprintsOverlap(probe, other, 2)) return false;
        const leader = other.state && reservationFor(other.state.ai);
        // Moving leaders on the same path clear the exit continuously; following controls the gap.
        return !(leader?.movement && movement?.key === leader.movement.key && leader.nodeId === plan.ai.targetNode
          && other.vx * Math.sin(other.heading) + other.vz * Math.cos(other.heading) > 0.5);
      });
    };
    const rerouteExit = plan => {
      const { ai, edge } = plan;
      if (aiTime < ai.nextExitReplan || ai.maneuver || occupiesJunction(plan.car, plan.node, roadWidth)) return false;
      ai.nextExitReplan = aiTime + 1.5;
      const next = ai.route[ai.routeIndex + 1] ?? ai.continuation?.route[1];
      const goal = ai.continuation?.goal ?? ai.goalId;
      // Do not undo the detour by routing immediately back through this junction.
      const excluded = new Set([ai.targetNode]);
      const options = (graph.adjacency.get(ai.targetNode) || []).filter(exit => exit.to !== next)
        .map(exit => ({ exit, movement: movementFor(edge, exit.to) }))
        .filter(option => !exitBlocked(plan, option.exit, option.movement))
        .map(option => ({ ...option, route: goal ? findRoadRoute(graph, option.exit.to, goal, excluded) : null }));
      options.sort((a, b) => Number(a.movement.turn === 'u-turn') - Number(b.movement.turn === 'u-turn')
        || Number(!a.route) - Number(!b.route)
        || (a.route?.length ?? Infinity) - (b.route?.length ?? Infinity)
        || a.exit.to.localeCompare(b.exit.to));
      const choice = options[0];
      if (!choice) return false;
      releaseReservation(ai);
      ai.route = [ai.targetNode, ...(choice.route || [choice.exit.to])];
      ai.routeIndex = 0; ai.goalId = ai.route.at(-1); ai.continuation = null;
      ai.progressEdge = null; ai.exitReplans++;
      plan.movement = choice.movement;
      return true;
    };
    const requests = [];
    for (const plan of plans) {
      const { ai, car, edge, node } = plan;
      if (!edge || !node) { plan.waitReason = 'no-path'; continue; }
      const fx = Math.sin(edge.heading), fz = Math.cos(edge.heading);
      const remaining = edge.length - edgeProgress(car, edge);
      plan.remaining = remaining;
      plan.signal = signalController.phase(ai.targetNode, ai.fromNode, aiTime);
      const stopLine = getStopLineLayout(node, { forwardX: fx, forwardZ: fz, rightX: -fz, rightZ: fx }, roadWidth);
      const stop = remaining - stopLine.distanceFromNode - projectedExtent(car, fx, fz);
      const speed = Math.max(0, car.vx * fx + car.vz * fz);
      const brakingDistance = speed * speed / (2 * 5.5) + 1;
      const stopForSignal = !ai.evasion && stop > 0 && plan.signal.controlled
        && (plan.signal.color === 'red' && stop < Math.max(brakingDistance, 6.5)
          || plan.signal.color === 'yellow' && stop < brakingDistance);
      if (stopForSignal) plan.waitReason = `signal-${plan.signal.color}`;
      if (remaining > roadWidth / 2 + 8 || remaining < -roadWidth / 2) {
        ai.requestNode = null; ai.requestedAt = null; continue;
      }
      if (ai.requestNode !== ai.targetNode) { ai.requestNode = ai.targetNode; ai.requestedAt = aiTime; }
      const held = reservationFor(ai);
      if (!held?.entered && !stopForSignal) {
        const nextId = ai.route[ai.routeIndex + 1] ?? ai.continuation?.route[1];
        const exit = graph.adjacency.get(ai.targetNode)?.find(item => item.to === nextId);
        if (exit && exitBlocked(plan, exit, plan.movement) && !rerouteExit(plan)) plan.waitReason = 'blocked-junction-exit';
      }
      if (!plan.waitReason) requests.push(plan);
    }

    for (const plan of plans) {
      const reservation = reservationFor(plan.ai);
      if (plan.waitReason && reservation && !reservation.entered) releaseReservation(plan.ai);
    }
    const priority = plan => plan.ai.evasion ? 2 : plan.movement?.turn === 'right' ? 1 : 0;
    const canStopBeforeEntry = plan => {
      const held = reservationFor(plan.ai), speed = Math.hypot(plan.car.vx, plan.car.vz);
      const room = plan.remaining - roadWidth / 2
        - projectedExtent(plan.car, Math.sin(plan.edge.heading), Math.cos(plan.edge.heading));
      return !held || !held.entered && room > speed * speed / (2 * 5.5) + speed * 0.1 + 0.3;
    };
    requests.sort((a, b) => priority(b) - priority(a)
      || a.ai.requestedAt - b.ai.requestedAt || a.state.id.localeCompare(b.state.id));
    // Priority can replace a pending permit, never a vehicle already crossing or unable to stop.
    for (const plan of requests) if (priority(plan)) {
      for (const [key, held] of [...reservations]) {
        const other = byId.get(held.id);
        if ((held.nodeId || key) === plan.ai.targetNode && other && priority(other) < priority(plan)
          && movementsConflict(plan.movement, held.movement) && canStopBeforeEntry(other)) {
          releaseReservation(other.ai); other.waitReason = 'junction-priority';
        }
      }
    }
    const requestSet = new Set(requests);
    // A stopped upstream queue is not approaching traffic; yielding to it can lock both exits.
    const oncomingPriority = new Set(requests.filter(plan => !plan.ai.evasion && plans.some(other => other !== plan
      && other.ai.targetNode === plan.ai.targetNode && !other.waitReason && (other.signal?.canEnter || other.ai.evasion)
      && other.remaining >= 0 && other.remaining <= 30
      && (requestSet.has(other) || other.car.vx * Math.sin(other.edge.heading) + other.car.vz * Math.cos(other.edge.heading) > 0.5)
      && yieldsToOncoming(plan.movement, other.movement))));
    for (const plan of requests) {
      if (plan.waitReason) continue;
      const nodeId = plan.ai.targetNode, owned = reservationFor(plan.ai);
      if (oncomingPriority.has(plan) && canStopBeforeEntry(plan)) {
        if (owned) releaseReservation(plan.ai);
        plan.waitReason = 'oncoming-priority'; continue;
      }
      if (owned) continue;
      const conflicts = [...reservations.entries()].some(([key, reservation]) => (reservation.nodeId || key) === nodeId
        && movementsConflict(plan.movement, reservation.movement));
      if (!conflicts) {
        const key = reservations.has(nodeId) ? `${nodeId}|${plan.state.id}` : nodeId;
        reservations.set(key, { id: plan.state.id, nodeId, time: aiTime, movement: plan.movement,
          entered: occupiesJunction(plan.car, plan.node, roadWidth) });
        plan.ai.reservationNode = nodeId;
      } else plan.waitReason = 'intersection-reservation';
    }

    const pathObstacles = [];
    for (const plan of plans) if (plan.ai.maneuver) {
      pathObstacles.push(...corridorFootprints(plan.car, [{ x: plan.car.x, z: plan.car.z },
        ...plan.ai.maneuver.points.slice(plan.ai.maneuver.index)], plan.state.id));
    }
    for (const plan of plans) {
      plan.neighbors = nearbyOccupants(plan.car, cells).filter(other => other.id !== plan.car.id);
      plan.leaderLimit = Infinity;
      const fx = Math.sin(plan.edge?.heading ?? plan.car.heading), fz = Math.cos(plan.edge?.heading ?? plan.car.heading);
      // A turning chassis must follow its outgoing lane, not the opposite queue under its nose.
      const laneCar = plan.edge ? { ...plan.car,
        x: plan.edge.start.x + fx * edgeProgress(plan.car, plan.edge),
        z: plan.edge.start.z + fz * edgeProgress(plan.car, plan.edge) } : plan.car;
      for (const other of plan.neighbors) {
        let limit = followingLimit(laneCar, other, fx, fz);
        const own = reservationFor(plan.ai), leader = other.state && reservationFor(other.state.ai);
        if (own?.movement && leader?.movement && own.nodeId === leader.nodeId && own.movement.key === leader.movement.key) {
          const speed = item => Math.max(0, item.vx * Math.sin(item.heading) + item.vz * Math.cos(item.heading));
          limit = followingLimit({ x: pathProgress(plan.car, own.movement), z: 0, heading: Math.PI / 2, vx: speed(plan.car), vz: 0 },
            { x: pathProgress(other, own.movement), z: 0, heading: Math.PI / 2, vx: speed(other), vz: 0 }, 1, 0);
        }
        if (limit < plan.leaderLimit) { plan.leaderLimit = limit; plan.blocker = other; }
      }
    }
    const queueReason = (plan, seen = new Set()) => {
      if (!plan || seen.has(plan.state.id)) return null;
      if (plan.waitReason) return plan.waitReason;
      seen.add(plan.state.id);
      return queueReason(byId.get(plan.blocker?.id), seen);
    };
    // Oldest stalled vehicle chooses first; all new maneuvers are checked against accepted corridors.
    plans.sort((a, b) => (b.ai.noProgressTime || 0) - (a.ai.noProgressTime || 0) || a.state.id.localeCompare(b.state.id));
    for (const plan of plans) {
      const { state, ai, car, edge } = plan;
      if (!edge) { ai.control = { steer: 0, throttle: 0, brake: 1 }; ai.state = 'no-path'; ai.waitReason = 'no-path'; continue; }
      const node = graph.nodes.get(ai.targetNode);
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const speed = car.vx * fx + car.vz * fz;
      const { neighbors, leaderLimit, blocker } = plan;
      ai.leaderLimit = leaderLimit;
      const contact = neighbors.find(other => footprintsOverlap(car, other, 0.12));
      const leaderWait = blocker && queueReason(byId.get(blocker.id));
      const legalWait = Boolean(plan.waitReason || leaderWait && leaderLimit < 0.4);
      const crossingPath = reservationFor(ai)?.movement;
      if (crossingPath) {
        const length = crossingPath.points.at(-1).distance;
        trackProgress(ai, { x: pathProgress(car, crossingPath), z: 0 },
          { from: crossingPath.key, to: crossingPath.nodeId, start: { x: 0, z: 0 }, end: { x: length, z: 0 }, length }, dt, legalWait);
      } else trackProgress(ai, car, edge, dt, legalWait);
      ai.blocker = blocker?.id || contact?.id || null;
      const obstacles = [...spawnObstacles, ...pathObstacles.filter(item => item.owner !== state.id)];
      const canRetry = aiTime >= (ai.nextCorridorCheck || 0) && aiTime >= (ai.cooldownUntil || 0);
      // Recovery needs the return path plus 3s of oncoming motion, not only leader range.
      const recoveryNeighbors = ai.maneuver || canRetry && (contact || ai.noProgressTime >= 3)
        ? nearbyOccupants(car, cells, 6).filter(other => other.id !== car.id) : neighbors;
      if (!recoveryNeighbors.includes(playerOccupancy)) recoveryNeighbors.push(playerOccupancy);

      if (!ai.maneuver && contact && canRetry) {
        const ahead = (contact.x - car.x) * fx + (contact.z - car.z) * fz;
        const sameDirection = Math.cos(contact.heading - car.heading) > 0.5;
        const shouldRetreat = sameDirection ? ahead > 0 : car.id.localeCompare(contact.id) > 0;
        if (contact.player && ai.evasion) {
          for (const direction of ahead > 0 ? [-1, 1] : [1, -1]) {
            const points = [{ x: car.x, z: car.z }, { x: car.x + fx * 4 * direction,
              z: car.z + fz * 4 * direction, reverse: direction < 0 }];
            if (sweptPathIsSafe(car, points, recoveryNeighbors, obstacles, 2)) {
              ai.maneuver = { points, index: 1, blocker: contact.id, startedAt: aiTime, kind: 'player-escape' };
              break;
            }
          }
        } else if (shouldRetreat) {
          const points = [{ x: car.x, z: car.z }, { x: car.x - fx * 4, z: car.z - fz * 4, reverse: true }];
          if (sweptPathIsSafe(car, points, recoveryNeighbors, obstacles, 2)) {
            ai.maneuver = { points, index: 1, blocker: contact.id, startedAt: aiTime, kind: 'contact-retreat' };
          }
        }
        ai.nextCorridorCheck = aiTime + 0.5;
      }
      if (!ai.maneuver && ai.noProgressTime >= 3 && !legalWait && canRetry) {
        ai.reevaluations = (ai.reevaluations || 0) + 1;
        ai.nextCorridorCheck = aiTime + 0.5;
        const held = reservationFor(ai);
        if (blocker && !held?.entered) {
          ai.maneuver = planPassing(car, blocker, edge, roadWidth, recoveryNeighbors, obstacles);
          if (ai.maneuver) { ai.maneuver.startedAt = aiTime; ai.maneuver.kind = 'passing'; }
        } else if (!blocker && !held?.entered) replanAtNearest(state);
      }

      const turning = Math.cos(edge.heading - car.heading) < 0.9;
      const junction = reservationFor(ai)?.movement;
      const stageRequested = !junction && !reservationFor(ai)?.entered && plan.signal?.color !== 'red'
        && ['left', 'u-turn'].includes(plan.movement?.turn)
        && ['oncoming-priority', 'intersection-reservation'].includes(plan.waitReason);
      if (stageRequested) {
        const target = turnStagingTarget(node, edge.heading, roadWidth);
        const stagePath = [{ x: car.x, z: car.z }, target];
        const room = (target.x - car.x) * Math.sin(edge.heading) + (target.z - car.z) * Math.cos(edge.heading);
        const stoppingDistance = Math.max(0, speed) ** 2 / (2 * 5.5) + Math.max(0, speed) * 0.1;
        // A nearby point cannot be reached by steering a moving chassis around it.
        // If braking would carry us past it, hold the lane until the crossing is free.
        const canApproach = ai.staging?.nodeId === ai.targetNode || room > stoppingDistance + 0.65;
        if (canApproach && sweptPathIsSafe(car, stagePath, recoveryNeighbors, obstacles, Math.max(2.5, Math.abs(speed)))) {
          ai.staging = { nodeId: ai.targetNode, target };
        } else ai.staging = null;
      } else ai.staging = null;
      const stagingRoom = ai.staging ? (ai.staging.target.x - car.x) * Math.sin(edge.heading)
        + (ai.staging.target.z - car.z) * Math.cos(edge.heading) : 0;
      const aim = ai.staging && stagingRoom > 0.65 ? ai.staging.target
        : junction ? pathTarget(car, junction) : laneTarget(graph, edge.from, edge.to,
        (edgeProgress(car, edge) + (turning ? 2.5 : Math.max(4, Math.abs(speed) * 0.7))) / edge.length);
      let dx = aim.x - car.x, dz = aim.z - car.z, reverse = false;
      let targetSpeed = ai.evasion ? TRAFFIC_EVASION.speed : 8;
      // Recover an off-route chassis gently; ordinary junction turns keep the cruise target.
      if (!junction && turning) targetSpeed = Math.min(targetSpeed, 3.8);
      let reason = ai.staging && stagingRoom > 0.65 ? 'turn-staging'
        : plan.waitReason || (leaderWait && leaderLimit < 0.4 ? 'queue-wait' : null);
      if (ai.maneuver) {
        const maneuver = ai.maneuver;
        let waypoint = maneuver.points[maneuver.index];
        const previous = maneuver.points[maneuver.index - 1];
        const distance = Math.hypot(waypoint.x - previous.x, waypoint.z - previous.z) || 1;
        const along = ((car.x - previous.x) * (waypoint.x - previous.x) + (car.z - previous.z) * (waypoint.z - previous.z)) / distance;
        if (Math.hypot(car.x - waypoint.x, car.z - waypoint.z) < 1 || along > distance) {
          maneuver.index++;
          if (maneuver.index >= maneuver.points.length) {
            ai.maneuver = null; ai.cooldownUntil = aiTime + 2; ai.progressEdge = null; ai.noProgressTime = 0;
          } else waypoint = maneuver.points[maneuver.index];
        }
        if (ai.maneuver) {
          dx = waypoint.x - car.x; dz = waypoint.z - car.z; reverse = Boolean(waypoint.reverse);
          targetSpeed = reverse ? -2.2 : 4.4;
          reason = maneuver.kind;
          if (aiTime >= (maneuver.nextSafetyCheck || 0)) {
            maneuver.safe = sweptPathIsSafe(car, [{ x: car.x, z: car.z }, ...maneuver.points.slice(maneuver.index)],
              recoveryNeighbors, obstacles, Math.abs(targetSpeed));
            maneuver.nextSafetyCheck = aiTime + 0.1;
          }
          if (!maneuver.safe) { targetSpeed = 0; reason = 'maneuver-blocked'; }
          pathObstacles.push(...corridorFootprints(car, [{ x: car.x, z: car.z }, ...maneuver.points.slice(maneuver.index)], state.id));
        }
      }
      if (!ai.maneuver) targetSpeed = ai.staging && stagingRoom > 0.65
        ? Math.min(2.4, Math.sqrt(2 * 5.5 * (stagingRoom - 0.65)), leaderLimit)
        : plan.waitReason ? 0 : Math.min(targetSpeed, leaderLimit);
      if (!ai.maneuver && contact && (Math.cos(contact.heading - car.heading) < 0.5
        || (contact.x - car.x) * fx + (contact.z - car.z) * fz > 0)) targetSpeed = 0;
      if (!reason && contact) reason = 'collision-jam';
      if (!reason && blocker && targetSpeed < 0.4) reason = ai.noProgressTime >= 3 ? 'no-safe-passing-lane' : 'blocked-by-leader';
      if (!reason && Math.abs(speed) < 0.3 && ai.noProgressTime >= 1) {
        // Keep a physical queue as the reported cause while its leader still limits
        // the stopped car. Reserve controller-stall for an empty usable corridor.
        reason = blocker && leaderLimit < 8 ? 'blocked-by-leader' : 'controller-stall';
      }
      ai.control = driveControl(dx, dz, car.heading, speed, targetSpeed, reverse);
      if (!ai.maneuver && junction) {
        const error = Math.atan2(Math.sin(Math.atan2(dx, dz) - car.heading), Math.cos(Math.atan2(dx, dz) - car.heading));
        const curvature = 2 * Math.sin(error) / Math.max(2, Math.hypot(dx, dz));
        const lock = 0.95 / (1 + Math.abs(speed) * 0.016);
        ai.control.steer = clamp(Math.atan(2.3 * curvature) / lock, -1, 1);
      }
      ai.targetSpeed = targetSpeed;
      ai.waitReason = reason;
      ai.state = ai.maneuver ? 'maneuver' : reason?.startsWith('signal-') ? 'signal-wait'
        : reason === 'no-safe-passing-lane' || reason === 'controller-stall' ? 'stuck-recovery'
        : reason ? 'yielding' : ai.evasion ? 'fleeing' : 'following';
      ai.waitTime = reason ? (ai.waitTime || 0) + dt : 0;
    }
    for (const state of states) {
      if (state.role === 'civilian') continue;
      const role = roleRegistry.get(state.role);
      if (!role?.update) continue;
      const result = role.update(state.ai.roleState, { car: state.occupancyItem, target: playerOccupancy,
        graph, obstacles: spawnObstacles, occupants: [...states.map(actor => actor.occupancyItem), playerOccupancy],
        time: aiTime, dt, world: physics.world });
      if (result?.control) state.ai.control = result.control;
      if (result?.state) state.ai.state = result.state;
      state.ai.waitReason = result?.reason || null;
      state.ai.targetSpeed = result?.targetSpeed ?? null;
      state.ai.targetId = result?.targetId || state.ai.targetId;
      state.ai.lastRoleUpdate = result;
    }
  };
  return {
    states, cars, simulations, reservations,
    registerRole(name, definition) {
      if (typeof name !== 'string' || !name || name === 'civilian' || !definition || typeof definition.update !== 'function') {
        throw new TypeError('A non-civilian role needs a name and update hook.');
      }
      roleRegistry.set(name, { maxCount: 2, physicalOnly: true, ...definition });
    },
    requestSpawn(input) {
      const definition = roleRegistry.get(input?.role);
      if (!definition) return { status: 'rejected', reason: 'unknown-role' };
      if (input.targetId && input.targetId !== 'player' && !states.some(state => state.id === input.targetId)) {
        return { status: 'rejected', reason: 'missing-target' };
      }
      const active = roleStates(input.role).length;
      const pending = [...spawnRequests.values()].filter(item => item.input.role === input.role).length;
      if (active + pending >= definition.maxCount) return { status: 'rejected', reason: 'capacity' };
      const request = { ...input, options: { placement: 'exact', ...(input.options || {}) } };
      const result = findSafeSpawnPose(request, { bounds: spawnBounds, obstacles: spawnObstacles,
        occupants: [...states.map(state => state.occupancyItem), ...(physics ? [updatePlayerOccupancy()] : [])],
        surfaceHeight: definition.surfaceHeight || (() => 0), maxDistance: request.options.maxDistance ?? 40 });
      if (result.status === 'rejected') return result;
      if (result.status === 'created' && physics) return createRoleActor(input.role, result.pose, { targetId: input.targetId, yaw: result.pose.yaw });
      const requestId = `spawn-${String(++spawnSerial).padStart(4, '0')}`;
      const record = { input: request, result: { status: 'pending', requestId, reason: result.reason || 'physics-not-attached' } };
      spawnRequests.set(requestId, record);
      return record.result;
    },
    spawnRequest(requestId) { return spawnRequests.get(requestId)?.result || spawnResults.get(requestId) || { status: 'rejected', requestId, reason: 'unknown-request' }; },
    cancelSpawn(requestId) {
      if (!spawnRequests.delete(requestId)) return false;
      spawnResults.set(requestId, { status: 'rejected', requestId, reason: 'cancelled' });
      return true;
    },
    remove(id) { const index = states.findIndex(state => state.id === id); if (index < 0) return false; removeAt(index); return true; },
    roleCount(name) { return roleStates(name).length; },
    setRoleTuning(name, tuning) {
      for (const state of roleStates(name)) Object.assign(state.simulation.tuning, tuning);
    },
    setRoleCount(name, count, spawnList = []) {
      const definition = roleRegistry.get(name);
      if (!definition || name === 'civilian') throw new RangeError(`Unknown configurable role: ${name}`);
      if (!Number.isInteger(count) || count < 0 || count > definition.maxCount) throw new RangeError(`Invalid ${name} count.`);
      const active = roleStates(name);
      const rolePending = [...spawnRequests].filter(([, record]) => record.input.role === name);
      while (active.length + rolePending.length > count && rolePending.length) {
        const [requestId] = rolePending.pop(); this.cancelSpawn(requestId);
      }
      while (roleStates(name).length > count) removeAt(states.findLastIndex(state => state.role === name));
      const need = count - roleStates(name).length - [...spawnRequests.values()].filter(record => record.input.role === name).length;
      const results = [];
      for (let index = 0; index < need; index++) {
        const spec = spawnList[index];
        if (!spec) { results.push({ status: 'rejected', reason: 'missing-pose' }); continue; }
        results.push(this.requestSpawn({ role: name, ...spec }));
      }
      return results;
    },
    attachPhysics(simulation) {
      physics = simulation; graph = createRoadGraph(roadNetwork, getLaneOffset(roadWidth)); rebuildSpawnSlots();
      requestedCount = count; pendingCount = count; pendingReason = 'Поиск безопасных мест';
      servicePending(8, 512);
    },
    setSignalController(controller) { signalController = controller || createTrafficSignals(roadNetwork); },
    signalPhase(nodeId, fromId, time = aiTime) { return signalController.phase(nodeId, fromId, time); },
    simulationTime() { return aiTime; },
    setCount(value) {
      if (!Number.isInteger(value) || value < 0 || value > 300) throw new RangeError('Traffic count must be an integer from 0 to 300.');
      requestedCount = value; pendingCount = value; pendingReason = 'Запрос применяется';
    },
    setRoadNetwork(network, width = roadWidth, obstacles = spawnObstacles) {
      roadNetwork = network; roadWidth = width; graph = createRoadGraph(network, getLaneOffset(width));
      movementCache.clear();
      spawnObstacles = obstacles; rebuildSpawnSlots();
      signalController = createTrafficSignals(network); reservations.clear();
      for (const state of states) {
        if (state.role === 'civilian') replanAtNearest(state);
        else roleRegistry.get(state.role)?.mapChanged?.(state.ai.roleState, graph, spawnObstacles);
      }
    },
    setSpawnObstacles(obstacles = []) { spawnObstacles = obstacles; },
    prepare(dt = STEP) {
      if (pendingCount !== null) applyCount(pendingCount);
      stepLogical(dt);
      thinkTime += dt;
      if (thinkTime >= 0.1) {
        const thinkDt = thinkTime; thinkTime = 0;
        const started = now(); updateControllers(thinkDt); servicePending(); serviceRoleSpawnRequests(); profile.aiMs = now() - started;
        profile.aiTicks++; profile.aiDecisions += states.length;
      }
      const prepareStarted = now();
      for (const state of states) if (!state.logical) state.simulation.prepare(state.ai.control, dt);
      profile.npcPrepareMs = now() - prepareStarted;
    },
    postStep(dt = STEP) {
      for (const state of states) {
        const body = state.simulation.body;
        if (!state.logical) state.simulation.postStep(dt);
        state.x = body.position.x; state.z = body.position.z;
        state.heading = headingOf(body.quaternion); state.speed = Math.hypot(body.velocity.x, body.velocity.z);
      }
    },
    stepWorld(input = {}, dt = STEP) {
      let started = now();
      physics.prepare(input, dt); profile.playerPrepareMs = now() - started;
      this.prepare(dt); profile.prepareMs = profile.playerPrepareMs + profile.npcPrepareMs + profile.aiMs;
      started = now(); physics.world.step(dt); profile.worldStepMs = now() - started;
      started = now(); physics.postStep(dt); this.postStep(dt); profile.postMs = now() - started;
    },
    render(alpha = 1, camera = null) {
      visualAssets?.animate(thinkTime);
      let frustum = null;
      if (camera) {
        frustum = visibilityFrustum.setFromProjectionMatrix(
          visibilityMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      }
      visibleCount = 0;
      for (const state of states) {
        visibilitySphere.center.set(state.x, 1, state.z);
        const visible = !frustum || frustum.intersectsSphere(visibilitySphere);
        state.mesh.visible = visible;
        if (visible) { visibleCount++; syncState(state, alpha); }
      }
    },
    reset() {
      if (pendingCount !== null) applyCount(pendingCount);
      reservations.clear(); thinkTime = 0; aiTime = 0;
      const reserved = [updatePlayerOccupancy()];
      let resetCursor = 0;
      for (const state of [...states]) {
        if (state.role !== 'civilian') {
          const occupants = reserved;
          const spawn = findSafeSpawnPose({ position: state.spawnPose, yaw: state.spawnPose.yaw,
            options: { placement: 'nearest-safe', maxDistance: 40 } },
          { bounds: spawnBounds, obstacles: spawnObstacles, occupants, surfaceHeight: roleRegistry.get(state.role)?.surfaceHeight || (() => 0), ownerId: state.id });
          if (spawn.status === 'pending') { removeAt(states.indexOf(state)); continue; }
          if (spawn.status !== 'created') { removeAt(states.indexOf(state)); continue; }
          const pose = spawn.pose;
          state.spawnPose = pose;
          state.simulation.spawn = { x: pose.x, y: pose.y + 0.96, z: pose.z, yaw: pose.yaw };
          state.simulation.reset();
          state.x = state.previousX = pose.x; state.z = state.previousZ = pose.z;
          state.heading = state.previousHeading = pose.yaw; state.speed = 0;
          Object.assign(state.occupancyItem, { x: pose.x, z: pose.z, heading: pose.yaw, vx: 0, vz: 0 });
          roleRegistry.get(state.role)?.reset?.(state.ai.roleState);
          syncState(state); reserved.push(state.occupancyItem); continue;
        }
        const result = findSafeCandidate(() => reserved, spawnSlots.length, resetCursor);
        resetCursor = result.next;
        if (!result.slot) { removeAt(states.indexOf(state)); continue; }
        const { edge, t, x, z, heading } = result.slot;
        const ai = state.ai;
        ai.random = createSeededRandom(ai.seed);
        state.spawnEdge = { from: edge.from, to: edge.to }; state.spawnFraction = t;
        state.simulation.spawn = { x, y: 0.96, z, yaw: heading };
        state.simulation.reset();
        if (state.logical) physics.world.removeBody(state.simulation.body);
        state.x = state.previousX = x; state.z = state.previousZ = z;
        state.heading = state.previousHeading = heading; state.speed = 0;
        Object.assign(state.occupancyItem, { x, z, heading, vx: 0, vz: 0 });
        startOnEdge(ai, edge);
        ai.evasion = null; ai.playerImpactPending = false;
        ai.control = { steer: 0, throttle: 0.5, brake: 0 }; ai.waitTime = 0; ai.stuckTime = 0; ai.recoveryTime = 0;
        syncState(state);
        reserved.push(state.occupancyItem);
      }
      pendingCount = roleStates('civilian').length < requestedCount ? requestedCount : null;
      pendingReason = pendingCount === null ? null : 'Нет свободных безопасных мест';
    },
    dispose() {
      while (states.length) removeAt(states.length - 1);
      reservations.clear(); spawnRequests.clear(); spawnResults.clear(); requestedCount = 0; pendingCount = null;
      if (visualAssets) {
        visualAssets.dispose();
        visualAssets = null;
      }
    },
    status() { return { count: roleStates('civilian').length, requestedCount, pending: pendingCount !== null,
      totalCount: states.length, roleCounts: Object.fromEntries([...roleRegistry.keys()].map(role => [role, roleStates(role).length])),
      pendingSpawns: spawnRequests.size, insertionReason: pendingReason,
      bodies: states.filter(state => !state.logical).length, logical: states.filter(state => state.logical).length,
      visible: visibleCount, reservations: reservations.size }; },
    physicalActors() { return states.filter(state => !state.logical).map(state => ({
      id: state.id, role: state.role, body: state.simulation.body, logical: state.logical,
      targetId: state.ai.targetId || null,
      x: state.x, z: state.z, heading: state.heading, vx: state.simulation.body.velocity.x,
      vz: state.simulation.body.velocity.z,
    })); },
    performance() { return { ...profile, totalBodies: physics?.world.bodies.length ?? 0,
      trafficBodies: states.filter(state => !state.logical).length,
      logicalTraffic: states.filter(state => state.logical).length,
      visibleTraffic: visibleCount,
      sleepingTrafficBodies: states.filter(state => !state.logical && state.simulation.body.sleepState === 2).length,
      awakeTrafficBodies: states.filter(state => !state.logical && state.simulation.body.sleepState === 0).length }; },
    debug() { return states.map(state => {
      const blocker = states.find(other => other.id === state.ai.blocker);
      const blockerLimit = blocker ? followingLimit(state.occupancyItem, blocker.occupancyItem,
        Math.sin(state.heading), Math.cos(state.heading)) : null;
      return { id: state.id, role: state.role, targetId: state.ai.targetId || null,
      goal: state.ai.goalId, route: [...state.ai.route], state: state.ai.state,
      segment: [state.ai.fromNode, state.ai.targetNode], seed: state.ai.seed, completedGoals: state.ai.completedGoals,
      goals: [...state.ai.goalHistory], reason: state.ai.waitReason,
      waitReason: state.ai.waitReason, noProgressTime: state.ai.noProgressTime || 0,
      waitTime: state.ai.waitTime || 0, leaderLimit: state.ai.leaderLimit ?? null,
      blocker: state.ai.blocker || null,
      blockerEvidence: blocker ? { id: blocker.id, x: blocker.x, z: blocker.z, heading: blocker.heading,
        speed: blocker.speed, followingLimit: blockerLimit, overlapping: footprintsOverlap(state, blocker, 0.12) } : null,
      progressAlong: state.ai.progressAlong ?? null, reevaluations: state.ai.reevaluations || 0,
      reservationNode: state.ai.reservationNode,
      reservationAge: state.ai.reservationNode ? Math.max(0, aiTime - (reservationFor(state.ai)?.time ?? aiTime)) : null,
      junctionTurn: reservationFor(state.ai)?.movement?.turn || null,
      signal: state.ai.targetNode ? { ...signalController.phase(state.ai.targetNode, state.ai.fromNode, aiTime) } : null,
      maneuver: state.ai.maneuver ? { ...state.ai.maneuver } : null,
      logical: Boolean(state.logical),
      evasion: state.ai.evasion ? { ...state.ai.evasion } : null,
      pursuit: state.ai.roleState?.diagnostics?.() || null,
      targetSpeed: state.ai.targetSpeed ?? null,
      exitReplans: state.ai.exitReplans || 0,
      spawn: { x: state.simulation.spawn.x, z: state.simulation.spawn.z } };
    }); },
  };
}

// Existing callers retain the civic traffic API while the manager now hosts registered vehicle roles.
export const createTraffic = createVehicleRuntime;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
