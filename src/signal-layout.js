export function getSignalPosition(node, approach, roadWidth, sidewalkWidth) {
  const along = roadWidth / 2 + Math.min(3, sidewalkWidth * 1.5);
  const lateral = roadWidth / 2 + sidewalkWidth / 2;
  return {
    x: node.x - approach.forwardX * along + approach.rightX * lateral,
    z: node.z - approach.forwardZ * along + approach.rightZ * lateral,
  };
}

export function getStopLineLayout(node, approach, roadWidth) {
  const halfRoad = roadWidth / 2;
  const setback = 1.5;
  const distanceFromNode = halfRoad + setback;
  const lateralOffset = roadWidth / 4;
  return {
    x: node.x - approach.forwardX * distanceFromNode + approach.rightX * lateralOffset,
    z: node.z - approach.forwardZ * distanceFromNode + approach.rightZ * lateralOffset,
    distanceFromNode,
    length: halfRoad - 0.3,
    thickness: 0.4,
    lateralOffset,
    setback,
    yaw: Math.atan2(approach.forwardX, approach.forwardZ),
  };
}
