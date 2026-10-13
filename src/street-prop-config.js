// Authored in metres, kilograms and km/h. Local origin is the sidewalk surface.
const box = (x, y, z, px, py, pz = 0) => ({ half: [x, y, z], center: [px, py, pz] });
export const PROP_PHYSICS = Object.freeze({
  bin: { threshold: 15, mass: 25, height: .84, boxes: [box(.26,.36,.26,0,.36),box(.3,.06,.3,0,.78)] },
  bench: { threshold: 25, mass: 70, height: .95, boxes: [
    box(.9,.04,.325,0,.45), box(.9,.23,.04,0,.72,-.285),
    box(.055,.205,.27,-.65,.205), box(.055,.205,.27,.65,.205),
  ] },
  lamp: { threshold: 35, mass: 100, height: 3.9, boxes: [
    box(.18,.09,.18,0,.09), box(.08,1.75,.08,0,1.93),
    box(.07,.07,.35,0,3.65,.35), box(.21,.12,.25,0,3.7,.67),
  ] },
  signal: { threshold: 40, mass: 120, height: 3.8, boxes: [
    box(.1,1.5,.1,0,1.5), box(.29,.75,.19,0,3.05),
    ...[3.5,3.05,2.6].map(y => box(.15,.15,.15,0,y,.22)),
  ] },
});
export const PROP_LIFETIME = 5;
export const PROP_FADE_SECONDS = .5;
export const PROP_DEBRIS_LIMIT = 24;
export const PROP_CRIME_KMH = 2;
