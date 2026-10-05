import { ROAD_CENTRES, ROAD_WIDTH } from './city-generator.js';

export const TRAFFIC_CORNER_RADIUS = Math.min(7, ROAD_WIDTH * 0.32);
export const TRAFFIC_ROUTE = ROAD_CENTRES.length === 4
  ? [[-25, -25], [25, -25], [25, 25], [-25, 25]]
  : [[-15, -15], [15, -15], [15, 15], [-15, 15]];
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const normalize = (x, z) => { const l = Math.hypot(x, z); return [x / l, z / l]; };

function makeRouteSegments(points, radius) {
  const segments = [];
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i + points.length - 1) % points.length];
    const corner = points[i];
    const next = points[(i + 1) % points.length];
    const incoming = normalize(corner[0] - previous[0], corner[1] - previous[1]);
    const outgoing = normalize(next[0] - corner[0], next[1] - corner[1]);
    const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
    const turn = Math.atan2(cross, incoming[0] * outgoing[0] + incoming[1] * outgoing[1]);
    const safeRadius = Math.min(radius, Math.hypot(corner[0] - previous[0], corner[1] - previous[1]) * .3,
      Math.hypot(next[0] - corner[0], next[1] - corner[1]) * .3);
    const entry = [corner[0] - incoming[0] * safeRadius, corner[1] - incoming[1] * safeRadius];
    const exit = [corner[0] + outgoing[0] * safeRadius, corner[1] + outgoing[1] * safeRadius];
    const center = [entry[0] + outgoing[0] * safeRadius * Math.sign(turn), entry[1] + outgoing[1] * safeRadius * Math.sign(turn)];
    const startAngle = Math.atan2(entry[1] - center[1], entry[0] - center[0]);
    const arcLength = safeRadius * Math.abs(turn);
    segments.push({ type: 'arc', center, radius: safeRadius, startAngle, turn, length: arcLength });
    const following = points[(i + 1) % points.length];
    const followingPrevious = corner;
    const followingNext = points[(i + 2) % points.length];
    const nextOut = normalize(followingNext[0] - following[0], followingNext[1] - following[1]);
    const nextEntry = [following[0] - outgoing[0] * Math.min(radius,
      Math.hypot(following[0] - followingPrevious[0], following[1] - followingPrevious[1]) * .3,
      Math.hypot(followingNext[0] - following[0], followingNext[1] - following[1]) * .3),
    following[1] - outgoing[1] * Math.min(radius,
      Math.hypot(following[0] - followingPrevious[0], following[1] - followingPrevious[1]) * .3,
      Math.hypot(followingNext[0] - following[0], followingNext[1] - following[1]) * .3)];
    const length = Math.hypot(nextEntry[0] - exit[0], nextEntry[1] - exit[1]);
    segments.push({ type: 'line', start: exit, end: nextEntry, length, heading: Math.atan2(nextEntry[0] - exit[0], nextEntry[1] - exit[1]) });
  }
  let distance = 0;
  for (const segment of segments) { segment.startDistance = distance; distance += segment.length; }
  return { segments, length: distance };
}

const path = makeRouteSegments(TRAFFIC_ROUTE, TRAFFIC_CORNER_RADIUS);
export const TRAFFIC_LAP_LENGTH = path.length;

function routeSample(distance) {
  const wrapped = ((distance % path.length) + path.length) % path.length;
  const segment = path.segments.find(item => wrapped <= item.startDistance + item.length + 1e-8) || path.segments[0];
  const t = Math.min(1, Math.max(0, (wrapped - segment.startDistance) / Math.max(segment.length, 1e-8)));
  if (segment.type === 'line') return { x: segment.start[0] + (segment.end[0] - segment.start[0]) * t, z: segment.start[1] + (segment.end[1] - segment.start[1]) * t, heading: segment.heading };
  const angle = segment.startAngle + segment.turn * t;
  return { x: segment.center[0] + Math.cos(angle) * segment.radius, z: segment.center[1] + Math.sin(angle) * segment.radius,
    heading: Math.atan2(-Math.sin(angle) * Math.sign(segment.turn), Math.cos(angle) * Math.sign(segment.turn)) };
}

export function createTrafficStates(count = 4) {
  return Array.from({ length: count }, (_, index) => {
    const distance = path.length * index / count;
    const sample = routeSample(distance);
    return { distance, speed: 6.5 + index * 0.25, ...sample, previousX: sample.x, previousZ: sample.z, previousHeading: sample.heading };
  });
}

export function advanceTraffic(states, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return states;
  for (const state of states) {
    state.previousX = state.x; state.previousZ = state.z; state.previousHeading = state.heading;
    state.distance = (state.distance + state.speed * dt) % path.length;
    const next = routeSample(state.distance);
    const difference = wrap(next.heading - state.heading);
    state.heading = wrap(state.heading + Math.max(-1.15 * dt, Math.min(1.15 * dt, difference)));
    state.x = next.x; state.z = next.z;
  }
  return states;
}

function makeTrafficCar(THREE, color, index) {
  const car = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 3.8), bodyMaterial);
  body.position.y = 0.68; body.castShadow = true; car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.63, 1.75), new THREE.MeshStandardMaterial({ color: '#495861', roughness: 0.55, metalness: 0.1 }));
  cabin.position.set(0, 1.22, -0.12); cabin.castShadow = true; car.add(cabin);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#202326', roughness: 0.92 });
  for (const x of [-0.94, 0.94]) for (const z of [-1.18, 1.18]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 10), wheelMaterial);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.38, z); wheel.castShadow = true; car.add(wheel);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), new THREE.MeshStandardMaterial({ color: index % 2 ? '#f2d6a0' : '#fff0cc', emissive: '#4d3418' }));
  nose.position.set(0, 0.8, 1.92); car.add(nose);
  return car;
}

export function createTraffic(scene, THREE, count = 4) {
  const palette = ['#496a80', '#b56f4c', '#8a956b', '#82718e', '#b9a76e', '#63928b'];
  const states = createTrafficStates(count);
  const cars = states.map((state, index) => {
    const mesh = makeTrafficCar(THREE, palette[index % palette.length], index);
    mesh.position.set(state.x, 0, state.z); mesh.rotation.y = state.heading;
    scene.add(mesh);
    return mesh;
  });
  const apply = alpha => states.forEach((state, i) => {
    const t = Math.max(0, Math.min(1, alpha));
    cars[i].position.set(state.previousX + (state.x - state.previousX) * t, 0, state.previousZ + (state.z - state.previousZ) * t);
    cars[i].rotation.y = state.previousHeading + wrap(state.heading - state.previousHeading) * t;
  });
  return {
    states, cars,
    update(dt) { advanceTraffic(states, dt); },
    render(alpha = 1) { apply(alpha); },
    reset() { const fresh = createTrafficStates(count); states.splice(0, states.length, ...fresh); apply(); },
    dispose() { for (const car of cars) { scene.remove(car); car.traverse(node => { if (node.geometry) node.geometry.dispose(); if (node.material) { for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } }); } },
  };
}
