import { createVehicleRuntimeCore } from './simulation/vehicle-runtime.js';
import { createTrafficVisualAdapter } from './traffic-visual-adapter.js';
export { TRAFFIC_PHYSICS_ZONE } from './simulation/vehicle-runtime.js';
export function createVehicleRuntime(scene, THREE, count, roadNetwork, roadWidth, obstacles, mapBounds) {
  return createVehicleRuntimeCore({ presentation:createTrafficVisualAdapter(scene,THREE), count,roadNetwork,roadWidth,obstacles,mapBounds });
}
export const createTraffic = createVehicleRuntime;
