const DEFAULTS = Object.freeze({
  speedingKmh: 80,
  speedingResetKmh: 75,
  speedingSeconds: 1,
  speedingRepeatSeconds: 5,
  collisionClosingSpeed: 2,
  playerClosingSpeed: 1,
  collisionSeparationSeconds: 0.5,
  collisionCooldownSeconds: 1.5,
  redLineRearmDistance: 2,
  frontOffset: 2.225,
  halfWidth: 0.9,
  laneTolerance: 0.3,
});

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);
const clamp01 = value => Math.max(0, Math.min(1, value));
const dotVelocity = (velocity, x, z) => (velocity?.x || 0) * x + (velocity?.z || 0) * z;
const bodyPosition = body => ({ x: body.position.x, y: body.position.y, z: body.position.z });

function playerSpeedKmh(player) {
  return Math.hypot(player.vx || 0, player.vz || 0) * 3.6;
}

function crossingDistance(player, approach, frontOffset) {
  const dx = player.x - approach.stopX, dz = player.z - approach.stopZ;
  const headingAlignment = Math.sin(player.heading || 0) * approach.forwardX
    + Math.cos(player.heading || 0) * approach.forwardZ;
  return dx * approach.forwardX + dz * approach.forwardZ + frontOffset * headingAlignment;
}

function worldVelocity(body, before, fallback) {
  const velocity = before?.get(body);
  return velocity || fallback || { x: 0, y: 0, z: 0 };
}

export const TRAFFIC_VIOLATION_CONFIG = DEFAULTS;

/**
 * Observe one player's fixed-step motion. `actors` and `contacts` come from the
 * shared traffic runtime; `velocitiesBefore` is captured immediately before its
 * single world.step(), so collision blame uses pre-solver motion.
 */
export function createTrafficViolationDetector(config = {}) {
  const settings = { ...DEFAULTS, ...config };
  let clock = 0;
  let speedingTime = 0;
  let speedingActive = false;
  let lastSpeedingAt = -Infinity;
  let previousPlayer = null;
  let collisionEpisodes = new Map();
  let approachArmed = new Map();

  const reset = () => {
    clock = 0;
    speedingTime = 0;
    speedingActive = false;
    lastSpeedingAt = -Infinity;
    previousPlayer = null;
    collisionEpisodes = new Map();
    approachArmed = new Map();
  };

  return {
    reset,
    update({ dt, player, actors = [], contacts = [], velocitiesBefore = new Map(),
      approaches = [], phaseAt = () => ({ controlled: false, color: 'priority' }), enabled = true } = {}) {
      if (!Number.isFinite(dt) || dt < 0 || !enabled || !finitePoint(player)) {
        reset();
        return [];
      }
      clock += dt;
      const events = [];
      const speed = playerSpeedKmh(player);

      if (speed > settings.speedingKmh) {
        speedingTime += dt;
        if (speedingTime >= settings.speedingSeconds) speedingActive = true;
        if (speedingActive
          && clock - lastSpeedingAt >= settings.speedingRepeatSeconds) {
          events.push({ type: 'speeding', time: clock, speedKmh: speed });
          lastSpeedingAt = clock;
        }
      } else if (speed <= settings.speedingResetKmh) {
        speedingTime = 0;
        speedingActive = false;
        lastSpeedingAt = -Infinity;
      } else if (!speedingActive) {
        // Before the first offense, any tick at or below the limit interrupts
        // the required continuous speeding interval. Once active, 75–80 is
        // the hysteresis band and does not clear the repeat timer.
        speedingTime = 0;
      }

      const liveActors = actors.filter(actor => actor?.id && actor.body && !actor.logical
        && (actor.role === 'civilian' || actor.role === 'police'));
      const actorsByBody = new Map(liveActors.map(actor => [actor.body, actor]));
      const liveIds = new Set(liveActors.map(actor => actor.id));
      for (const id of collisionEpisodes.keys()) if (!liveIds.has(id)) collisionEpisodes.delete(id);

      const touching = new Set();
      const playerBody = player.body;
      const contactsByActor = new Map();
      if (playerBody) for (const contact of contacts) {
        let actorBody = null;
        if (contact.bi === playerBody) actorBody = contact.bj;
        else if (contact.bj === playerBody) actorBody = contact.bi;
        const actor = actorsByBody.get(actorBody);
        if (!actor) continue;
        const list = contactsByActor.get(actor.id) || [];
        list.push({ contact, actor, actorBody });
        contactsByActor.set(actor.id, list);
      }
      for (const [id, actorContacts] of contactsByActor) {
        const { actor, actorBody } = actorContacts[0];
        touching.add(id);
        let episode = collisionEpisodes.get(id);
        if (!episode) {
          episode = { touching: false, separatedFor: Infinity, lastOffenseAt: -Infinity };
          collisionEpisodes.set(id, episode);
        }
        if (episode.touching) continue;
        const playerPosition = bodyPosition(playerBody);
        const otherPosition = bodyPosition(actorBody);
        const towardActorX = otherPosition.x - playerPosition.x;
        const towardActorZ = otherPosition.z - playerPosition.z;
        const centerDistance = Math.hypot(towardActorX, towardActorZ);
        const playerVelocity = worldVelocity(playerBody, velocitiesBefore, player);
        const actorVelocity = worldVelocity(actorBody, velocitiesBefore, actor);
        let qualifyingContact = null;
        if (centerDistance >= 1e-6) for (const { contact } of actorContacts) {
          const normalLength = Math.hypot(contact.ni?.x || 0, contact.ni?.z || 0);
          if (normalLength < 1e-6) continue;
          let normalX = contact.ni.x / normalLength, normalZ = contact.ni.z / normalLength;
          if (normalX * towardActorX + normalZ * towardActorZ < 0) { normalX *= -1; normalZ *= -1; }
          const playerContribution = dotVelocity(playerVelocity, normalX, normalZ);
          const closingSpeed = playerContribution - dotVelocity(actorVelocity, normalX, normalZ);
          if (playerContribution >= settings.playerClosingSpeed && closingSpeed >= settings.collisionClosingSpeed) {
            qualifyingContact = { playerContribution, closingSpeed }; break;
          }
        }
        const cooldownReady = clock - episode.lastOffenseAt >= settings.collisionCooldownSeconds;
        if (qualifyingContact && cooldownReady
          && (episode.separatedFor >= settings.collisionSeparationSeconds || !Number.isFinite(episode.lastOffenseAt))) {
          events.push({ type: actor.role === 'police' ? 'police-collision' : 'civilian-collision',
            actorId: actor.id, time: clock, ...qualifyingContact });
          episode.lastOffenseAt = clock;
        }
        episode.touching = true;
        episode.separatedFor = 0;
      }

      for (const [id, episode] of collisionEpisodes) if (!touching.has(id)) {
        episode.touching = false;
        episode.separatedFor += dt;
      }

      const approachesSeen = new Set();
      if (previousPlayer) for (const approach of approaches) {
        const id = `${approach.nodeId}|${approach.fromId}`;
        approachesSeen.add(id);
        const previousDistance = crossingDistance(previousPlayer, approach, settings.frontOffset);
        const currentDistance = crossingDistance(player, approach, settings.frontOffset);
        let armed = approachArmed.has(id) ? approachArmed.get(id) : previousDistance <= -settings.redLineRearmDistance;
        if (currentDistance <= -settings.redLineRearmDistance) armed = true;

        const dx = player.x - previousPlayer.x, dz = player.z - previousPlayer.z;
        const forwardMotion = dx * approach.forwardX + dz * approach.forwardZ;
        if (armed && previousDistance <= 0 && currentDistance > 0 && forwardMotion > 0) {
          armed = false;
          const fraction = clamp01(-previousDistance / (currentDistance - previousDistance));
          const crossX = previousPlayer.x + dx * fraction;
          const crossZ = previousPlayer.z + dz * fraction;
          const lateral = (crossX - approach.stopX) * approach.rightX
            + (crossZ - approach.stopZ) * approach.rightZ;
          const laneHalfWidth = approach.stopLineLength / 2 + settings.halfWidth + settings.laneTolerance;
          const headingAlignment = Math.sin(player.heading || 0) * approach.forwardX
            + Math.cos(player.heading || 0) * approach.forwardZ;
          const signal = phaseAt(approach);
          if (Math.abs(lateral) <= laneHalfWidth && headingAlignment >= 0.8
            && signal?.controlled && signal.color === 'red') {
            events.push({ type: 'red-light', approachId: id, time: clock });
          }
        }
        approachArmed.set(id, armed);
      }
      for (const id of approachArmed.keys()) if (!approachesSeen.has(id)) approachArmed.delete(id);

      previousPlayer = { x: player.x, z: player.z, heading: player.heading || 0 };
      return events;
    },
    snapshot() { return { clock, speedingTime, collisionActors: collisionEpisodes.size, approaches: approachArmed.size }; },
  };
}
