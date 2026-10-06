import { ROAD_WIDTH, createCityPlan } from './city-generator.js';
import { CarSimulation, STEP } from './vehicle.js';
import { chooseRoadGoal, createRoadGraph, createSeededRandom, findRoadRoute, headingError, laneTarget, nearestRoadNode, turnDirection } from './traffic-ai.js';
import { createTrafficSignals } from './traffic-signals.js';
import { getStopLineLayout } from './signal-layout.js';
import { createTrafficSpawnSlots, isTrafficSpawnSafe } from './traffic-spawn.js';

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const headingOf = q => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const now = () => globalThis.performance?.now?.() ?? Date.now();

const TRAFFIC_PALETTE = ['#496a80', '#b56f4c', '#8a956b', '#82718e', '#b9a76e', '#63928b'];

function createTrafficAssets(THREE) {
  return {
    geometries: [new THREE.BoxGeometry(1.8, 0.62, 3.8), new THREE.BoxGeometry(1.48, 0.63, 1.75),
      new THREE.CylinderGeometry(0.36, 0.36, 0.2, 10), new THREE.BoxGeometry(0.34, 0.14, 0.08)],
    bodyMaterials: TRAFFIC_PALETTE.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.72 })),
    cabinMaterial: new THREE.MeshStandardMaterial({ color: '#495861', roughness: 0.55, metalness: 0.1 }),
    wheelMaterial: new THREE.MeshStandardMaterial({ color: '#202326', roughness: 0.92 }),
    noseMaterials: ['#fff0cc', '#f2d6a0'].map(color => new THREE.MeshStandardMaterial({ color, emissive: '#4d3418' })),
  };
}

function makeTrafficCar(THREE, assets, index) {
  const car = new THREE.Group();
  const [bodyGeometry, cabinGeometry, wheelGeometry, noseGeometry] = assets.geometries;
  const body = new THREE.Mesh(bodyGeometry, assets.bodyMaterials[index % assets.bodyMaterials.length]);
  body.position.y = 0.68; body.castShadow = true; car.add(body);
  const cabin = new THREE.Mesh(cabinGeometry, assets.cabinMaterial);
  cabin.position.set(0, 1.22, -0.12); cabin.castShadow = true; car.add(cabin);
  for (const x of [-0.94, 0.94]) for (const z of [-1.18, 1.18]) {
    const wheel = new THREE.Mesh(wheelGeometry, assets.wheelMaterial);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.38, z); wheel.castShadow = true; car.add(wheel);
  }
  const nose = new THREE.Mesh(noseGeometry, assets.noseMaterials[index % 2]);
  nose.position.set(0, 0.8, 1.92); car.add(nose);
  return car;
}

export function createTraffic(scene, THREE, count = 6, roadNetwork = createCityPlan().roadNetwork, roadWidth = ROAD_WIDTH, obstacles = []) {
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
  let visibleCount = 0;
  const visibilityFrustum = new THREE.Frustum();
  const visibilityMatrix = new THREE.Matrix4();
  const visibilitySphere = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const cellSize = 12;
  const cellKey = (x, z) => Math.floor(x / cellSize) * 1024 + Math.floor(z / cellSize);
  const occupancy = new Map();
  const playerOccupancy = { id: 'player', x: 0, z: 0, heading: 0, vx: 0, vz: 0, player: true };

  const rebuildSpawnSlots = () => {
    const eligible = graph.directed.filter(edge => Math.abs((edge.start.x + edge.end.x) / 2) <= 125
      && Math.abs((edge.start.z + edge.end.z) / 2) <= 125);
    spawnSlots = createTrafficSpawnSlots(eligible.length ? eligible : graph.directed);
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

  const nearbyOccupants = (candidate, cells = occupancy) => {
    const bx = Math.floor(candidate.x / cellSize), bz = Math.floor(candidate.z / cellSize), found = [];
    // Include full braking/headway distance for any vehicle at the game's speed cap.
    for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) {
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
    ai.goalId = chooseRoadGoal(graph, at, ai.random, ai.previousGoal);
    ai.route = ai.goalId ? findRoadRoute(graph, at, ai.goalId) : [at];
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
  };

  const releaseReservation = ai => {
    if (ai.reservationNode && reservations.get(ai.reservationNode)?.id === ai.id) reservations.delete(ai.reservationNode);
    ai.reservationNode = null;
  };

  const add = (index, slot) => {
    const { edge, t, x, z, heading } = slot;
    const id = `npc-${String(serial++).padStart(2, '0')}`;
    const simulation = new CarSimulation({ world: physics.world, materials: physics.materials,
      spawn: { x, y: 0.96, z, yaw: heading }, damage: false });
    visualAssets ||= createTrafficAssets(THREE);
    const mesh = makeTrafficCar(THREE, visualAssets, index);
    scene.add(mesh);
    const seed = (0xC4A7 + serial * 0x9E3779B1) >>> 0;
    const ai = { id, seed, random: createSeededRandom(seed), state: 'following', fromNode: edge.from, targetNode: edge.to,
      route: [], routeIndex: 0, goalId: null, previousGoal: null, control: { steer: 0, throttle: 0.5, brake: 0 },
      waitTime: 0, stuckTime: 0, recoveryTime: 0, reservationNode: null, completedGoals: 0, goalHistory: [] };
    startOnEdge(ai, edge);
    const state = { id, x, z, heading, speed: 0, previousX: x, previousZ: z, previousHeading: heading,
      spawnEdge: { from: edge.from, to: edge.to }, spawnFraction: t, simulation, mesh, ai, logical: false,
      occupancyItem: { id, x, z, heading, vx: 0, vz: 0, state: null },
      renderQuaternion: new THREE.Quaternion(), currentQuaternion: new THREE.Quaternion() };
    state.occupancyItem.state = state;
    states.push(state); simulations.push(simulation); cars.push(mesh); syncState(state);
    return state;
  };

  const removeAt = index => {
    const [state] = states.splice(index, 1);
    if (!state) return;
    releaseReservation(state.ai);
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
    while (states.length > value) removeAt(states.length - 1);
    pendingCount = states.length < value ? value : null;
    pendingReason = pendingCount === null ? null : 'Ожидание безопасного размещения';
  };

  const servicePending = (maxAdds = 4, maxChecks = 256) => {
    if (!physics || pendingCount === null) return 0;
    buildOccupancy();
    let added = 0, checked = 0;
    while (states.length < requestedCount && added < maxAdds && checked < maxChecks) {
      const result = findSafeCandidate(slot => nearbyOccupants(slot), maxChecks - checked);
      checked += result.checked;
      spawnSearchCursor = result.next;
      if (!result.slot) {
        if (checked >= maxChecks) break;
        break;
      }
      const state = add(states.length, result.slot);
      insertOccupancyItem(state.occupancyItem);
      added++;
    }
    pendingCount = states.length < requestedCount ? requestedCount : null;
    pendingReason = pendingCount === null ? null
      : added ? 'Машины добавляются по мере освобождения мест' : 'Нет свободного безопасного места';
    return added;
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
    for (const contact of physics.world.contacts) {
      for (const state of states) {
        if (!state.logical && (contact.bi === state.simulation.body || contact.bj === state.simulation.body)) touching.add(state);
      }
    }
    for (const state of states) {
      const distance = Math.hypot(state.x - player.x, state.z - player.z);
      const candidate = { x: state.x, z: state.z, heading: headingOf(state.simulation.body.quaternion),
        vx: state.simulation.body.velocity.x, vz: state.simulation.body.velocity.z };
      const neighbors = nearbyOccupants(candidate).filter(other => other.id !== state.id);
      const nearPhysical = neighbors.some(other => other.state && !other.state.logical);
      const physicallyClear = isTrafficSpawnSafe(candidate, neighbors, spawnObstacles, 0);
      if (!state.logical && distance > 45 && !state.ai.maneuver && !touching.has(state)) setLogical(state, true);
      else if (state.logical && (distance < 30 || nearPhysical) && physicallyClear) setLogical(state, false);
    }
  };

  const stepLogical = dt => {
    for (const state of states) {
      if (!state.logical) continue;
      const body = state.simulation.body, control = state.ai.control;
      body.previousPosition.copy(body.position); body.previousQuaternion.copy(body.quaternion);
      const yaw = headingOf(body.quaternion) + control.steer * 0.9 * dt;
      const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
      let speed = body.velocity.x * forwardX + body.velocity.z * forwardZ;
      speed = Math.max(0, Math.min(8.5, speed + (control.throttle * 3.4 - control.brake * 7 - 0.16) * dt));
      body.velocity.set(forwardX * speed, 0, forwardZ * speed);
      body.position.x += body.velocity.x * dt; body.position.z += body.velocity.z * dt; body.position.y = 0.96;
      body.quaternion.setFromEuler(0, yaw, 0); body.aabbNeedsUpdate = true;
      state.x = body.position.x; state.z = body.position.z;
    }
  };

  const leaderSpeedLimit = (state, cells, forwardX, forwardZ) => {
    let limit = Infinity, blocker = null;
    const body = state.simulation.body;
    const bx = Math.floor(body.position.x / cellSize), bz = Math.floor(body.position.z / cellSize);
    for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) {
      for (const other of cells.get(x * 1024 + z) || []) {
        if (other.id === state.id) continue;
        const dx = other.x - body.position.x, dz = other.z - body.position.z;
        const ahead = dx * forwardX + dz * forwardZ;
        const lateral = Math.abs(dx * forwardZ - dz * forwardX);
        if (ahead <= 0 || ahead > 22 || lateral > 2.2) continue;
        const safeGap = Math.max(0, ahead - 6.2);
        const leadSpeed = Math.max(0, other.vx * forwardX + other.vz * forwardZ);
        const speedLimit = Math.sqrt(leadSpeed ** 2 + 2 * 5.5 * safeGap);
        if (speedLimit < limit) { limit = speedLimit; blocker = other; }
      }
    }
    return { limit, blocker };
  };

  const passingOffset = (state, cells, forwardX, forwardZ, blocker, toNode) => {
    if (!blocker || toNode < 22) return null;
    const body = state.simulation.body;
    const rightX = forwardZ, rightZ = -forwardX;
    const lane = graph.laneOffset, roadEdge = roadWidth / 2 - 1.5;
    const candidates = [Math.min(2.6, roadEdge - lane), -Math.min(2.6, lane - 1.5), -2 * lane];
    for (const offset of candidates) {
      if (Math.abs(offset) < 1.5 || lane + offset > roadEdge || lane + offset < -roadEdge) continue;
      let clear = true;
      for (const bucket of cells.values()) for (const other of bucket) {
        if (other.id === state.id || other === blocker) continue;
        const dx = other.x - body.position.x, dz = other.z - body.position.z;
        const ahead = dx * forwardX + dz * forwardZ;
        if (ahead < -3 || ahead > 22) continue;
        const lateral = dx * rightX + dz * rightZ;
        const transition = Math.max(0, Math.min(1, (ahead + 3) / 7));
        if (Math.abs(lateral - offset * transition) < 2.5) { clear = false; break; }
      }
      if (clear) return { offset, blocker: blocker.id };
    }
    return null;
  };

  const replanAtNearest = (state, previousGoal = state.ai.goalId) => {
    const ai = state.ai;
    releaseReservation(ai);
    const nearest = nearestRoadNode(graph, state.simulation.body.position);
    ai.previousGoal = previousGoal;
    ai.goalId = chooseRoadGoal(graph, nearest, ai.random, ai.previousGoal);
    ai.route = ai.goalId ? findRoadRoute(graph, nearest, ai.goalId) : [nearest];
    ai.routeIndex = ai.route.length > 1 ? 1 : 0; ai.fromNode = nearest;
    ai.targetNode = ai.route.length > 1 ? ai.route[ai.routeIndex] : null;
    ai.state = ai.targetNode ? 'following' : 'arrived-replan';
    ai.stuckTime = 0;
    ai.noProgressTime = 0; ai.maneuver = null; ai.waitReason = null; ai.recoveryTime = 0;
  };

  const updateControllers = dt => {
    aiTime += dt;
    updateLod();
    const occupancy = buildOccupancy();
    for (const state of states) {
      const ai = state.ai, body = state.simulation.body;
      const yaw = headingOf(body.quaternion);
      const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
      const rightX = forwardZ, rightZ = -forwardX;
      const signedSpeed = body.velocity.x * forwardX + body.velocity.z * forwardZ;
      if (!ai.targetNode) chooseRoute(ai, nearestRoadNode(graph, body.position));
      let target = laneTarget(graph, ai.fromNode, ai.targetNode, 1);
      if (!target) { replanAtNearest(state); target = laneTarget(graph, ai.fromNode, ai.targetNode, 1); }
      if (!target) { ai.control = { steer: 0, throttle: 0, brake: 1 }; ai.state = 'arrived-replan'; continue; }

      let dx = target.x - body.position.x, dz = target.z - body.position.z;
      let distance = Math.hypot(dx, dz);
      if (distance < 4) {
        const arrived = ai.targetNode;
        ai.fromNode = arrived;
        ai.routeIndex++;
        releaseReservation(ai);
        if (ai.routeIndex >= ai.route.length - 1) {
          ai.completedGoals++;
          ai.state = 'arrived-replan';
          chooseRoute(ai, arrived);
        } else {
          ai.targetNode = ai.route[ai.routeIndex];
        }
        target = laneTarget(graph, ai.fromNode, ai.targetNode, 1);
        if (!target) { replanAtNearest(state); target = laneTarget(graph, ai.fromNode, ai.targetNode, 1); }
        if (!target) { ai.control = { steer: 0, throttle: 0, brake: 1 }; continue; }
        dx = target.x - body.position.x; dz = target.z - body.position.z; distance = Math.hypot(dx, dz);
      }

      const node = graph.nodes.get(ai.targetNode);
      const toNode = node ? Math.hypot(node.x - body.position.x, node.z - body.position.z) : Infinity;
      let yielding = false;
      const signal = signalController.phase(ai.targetNode, ai.fromNode, aiTime);
      const stopLine = node ? getStopLineLayout(node, { forwardX, forwardZ, rightX, rightZ }, roadWidth) : null;
      const signedStopDistance = stopLine
        ? (node.x - body.position.x) * forwardX + (node.z - body.position.z) * forwardZ - stopLine.distanceFromNode
        : Infinity;
      const halfVehicleLength = 2.08;
      const brakingDistance = signedSpeed > 0 ? signedSpeed * signedSpeed / (2 * 5.5) : 0;
      const frontHasNotPassedLine = signedStopDistance > halfVehicleLength;
      const inRedBrakingZone = signedStopDistance <= Math.max(brakingDistance + halfVehicleLength + 1,
        roadWidth / 2 + 8 - stopLine?.distanceFromNode);
      const yellowStopDistance = brakingDistance + halfVehicleLength + 1;
      const stopForSignal = signal.controlled && frontHasNotPassedLine
        && (signal.color === 'red' && inRedBrakingZone
          || signal.color === 'yellow' && signedStopDistance <= yellowStopDistance);
      ai.waitReason = stopForSignal ? `signal-${signal.color}` : null;
      if (stopForSignal) {
        yielding = true;
        ai.state = 'signal-wait';
      } else if (toNode < roadWidth / 2 + 5) {
        let reservation = reservations.get(ai.targetNode);
        if (reservation && aiTime - reservation.time > 8) { reservations.delete(ai.targetNode); reservation = null; }
        if (!reservation || reservation.id === ai.id) {
          reservations.set(ai.targetNode, { id: ai.id, time: aiTime });
          ai.reservationNode = ai.targetNode;
        } else if (ai.id.localeCompare(reservation.id) < 0 && !reservation.entered) {
          reservations.set(ai.targetNode, { id: ai.id, time: aiTime });
          const displaced = states.find(other => other.id === reservation.id);
          if (displaced) {
            displaced.ai.reservationNode = null; displaced.ai.state = 'yielding';
            displaced.ai.control = { steer: 0, throttle: 0, brake: 1 };
          }
          ai.reservationNode = ai.targetNode;
        } else {
          yielding = true;
          ai.state = 'yielding';
          ai.waitReason = 'intersection-reservation';
          ai.waitTime += dt;
        }
        const owner = reservations.get(ai.targetNode);
        if (owner?.id === ai.id && toNode < 6) owner.entered = true;
      } else if (ai.state === 'yielding' || ai.state === 'signal-wait') ai.state = 'following';
      if (ai.reservationNode && ai.reservationNode !== ai.targetNode) releaseReservation(ai);

      let targetSpeed = 8;
      if (toNode < 13 && ai.routeIndex + 1 < ai.route.length) {
        const turn = turnDirection(graph, ai.fromNode, ai.targetNode, ai.route[ai.routeIndex + 1]);
        if (turn !== 'straight') targetSpeed = 4.4;
        else targetSpeed = 6.2;
      }
      if (yielding) targetSpeed = 0;
      const leader = leaderSpeedLimit(state, occupancy, forwardX, forwardZ);
      const blockedByLeader = leader.limit < targetSpeed - 0.25;
      const progress = ai.progressPosition || { x: body.position.x, z: body.position.z };
      const moved = Math.hypot(body.position.x - progress.x, body.position.z - progress.z);
      if (moved > 0.8) { ai.progressPosition = { x: body.position.x, z: body.position.z }; ai.noProgressTime = 0; }
      else if (leader.blocker && !yielding && Math.abs(signedSpeed) < 2) ai.noProgressTime += dt;
      else { ai.noProgressTime = 0; ai.progressPosition = { x: body.position.x, z: body.position.z }; }
      if (ai.maneuver && (!leader.blocker || leader.blocker.id !== ai.maneuver.blocker)) ai.maneuver = null;
      if (!ai.maneuver && ai.noProgressTime >= 3 && !yielding) {
        ai.maneuver = passingOffset(state, occupancy, forwardX, forwardZ, leader.blocker, toNode);
        if (ai.maneuver) ai.maneuver.startedAt = aiTime;
      }
      if (ai.maneuver && aiTime - ai.maneuver.startedAt > 8) ai.maneuver = null;
      if (ai.maneuver) {
        const shift = ai.maneuver.offset;
        const ahead = 10;
        const aimX = body.position.x + forwardX * ahead + rightX * shift;
        const aimZ = body.position.z + forwardZ * ahead + rightZ * shift;
        dx = aimX - body.position.x; dz = aimZ - body.position.z;
        targetSpeed = Math.min(targetSpeed, 5.2);
      } else targetSpeed = Math.min(targetSpeed, leader.limit);
      const desiredHeading = Math.atan2(dx, dz);
      const error = headingError(desiredHeading, yaw);
      const steer = clamp(error * 1.9, -1, 1);
      const throttle = targetSpeed < 0.4 ? 0 : clamp((targetSpeed - signedSpeed) * 0.42, 0, 0.76);
      const brake = targetSpeed < 0.4 ? 1 : clamp((signedSpeed - targetSpeed - 0.3) * 0.4, 0, 0.8);
      ai.control = { steer, throttle, brake };
      if (!yielding && signedSpeed < 0.55 && ai.noProgressTime > 3) ai.stuckTime = ai.noProgressTime;
      else ai.stuckTime = Math.max(0, ai.stuckTime - dt * 2);
      if (ai.stuckTime > 3 && !ai.maneuver) {
        ai.state = 'stuck-recovery';
        ai.recoveryTime += dt;
        ai.control = { steer: 0, throttle: 0, brake: 1 };
        if (ai.recoveryTime > 1.5 && !leader.blocker) { replanAtNearest(state); ai.recoveryTime = 0; }
      } else if (!yielding && blockedByLeader) ai.state = 'yielding';
      else if (!yielding && ai.state !== 'arrived-replan') ai.state = 'following';
      if (leader.blocker && !yielding && !ai.maneuver) ai.waitReason = ai.noProgressTime >= 3 ? 'no-safe-passing-lane' : 'blocked-by-leader';
      else if (ai.maneuver) ai.waitReason = 'passing';
    }
  };

  return {
    states, cars, simulations, reservations,
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
      spawnObstacles = obstacles; rebuildSpawnSlots();
      signalController = createTrafficSignals(network); reservations.clear();
      for (const state of states) replanAtNearest(state);
    },
    setSpawnObstacles(obstacles = []) { spawnObstacles = obstacles; },
    prepare(dt = STEP) {
      if (pendingCount !== null) applyCount(pendingCount);
      stepLogical(dt);
      thinkTime += dt;
      if (thinkTime >= 0.1) {
        const thinkDt = thinkTime; thinkTime = 0;
        const started = now(); updateControllers(thinkDt); servicePending(); profile.aiMs = now() - started;
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
        ai.control = { steer: 0, throttle: 0.5, brake: 0 }; ai.waitTime = 0; ai.stuckTime = 0; ai.recoveryTime = 0;
        syncState(state);
        reserved.push(state.occupancyItem);
      }
      pendingCount = states.length < requestedCount ? requestedCount : null;
      pendingReason = pendingCount === null ? null : 'Нет свободных безопасных мест';
    },
    dispose() {
      while (states.length) removeAt(states.length - 1);
      reservations.clear(); requestedCount = 0; pendingCount = null;
      if (visualAssets) {
        visualAssets.geometries.forEach(geometry => geometry.dispose());
        [...visualAssets.bodyMaterials, ...visualAssets.noseMaterials, visualAssets.cabinMaterial, visualAssets.wheelMaterial].forEach(material => material.dispose());
        visualAssets = null;
      }
    },
    status() { return { count: states.length, requestedCount, pending: pendingCount !== null, insertionReason: pendingReason,
      bodies: states.filter(state => !state.logical).length, logical: states.filter(state => state.logical).length,
      visible: visibleCount, reservations: reservations.size }; },
    performance() { return { ...profile, totalBodies: physics?.world.bodies.length ?? 0,
      trafficBodies: states.filter(state => !state.logical).length,
      logicalTraffic: states.filter(state => state.logical).length,
      visibleTraffic: visibleCount,
      sleepingTrafficBodies: states.filter(state => !state.logical && state.simulation.body.sleepState === 2).length,
      awakeTrafficBodies: states.filter(state => !state.logical && state.simulation.body.sleepState === 0).length }; },
    debug() { return states.map(state => ({ id: state.id, goal: state.ai.goalId, route: [...state.ai.route], state: state.ai.state,
      segment: [state.ai.fromNode, state.ai.targetNode], seed: state.ai.seed, completedGoals: state.ai.completedGoals,
      goals: [...state.ai.goalHistory], reason: state.ai.maneuver ? 'passing' : state.ai.waitReason || (state.ai.state === 'stuck-recovery' ? 'no-safe-passing-lane' : null),
      waitReason: state.ai.waitReason, noProgressTime: state.ai.noProgressTime || 0,
      reservationNode: state.ai.reservationNode,
      reservationAge: state.ai.reservationNode ? Math.max(0, aiTime - (reservations.get(state.ai.reservationNode)?.time ?? aiTime)) : null,
      signal: state.ai.targetNode ? { ...signalController.phase(state.ai.targetNode, state.ai.fromNode, aiTime) } : null,
      maneuver: state.ai.maneuver ? { ...state.ai.maneuver } : null,
      logical: Boolean(state.logical),
      spawn: { x: state.simulation.spawn.x, z: state.simulation.spawn.z } })); },
  };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
