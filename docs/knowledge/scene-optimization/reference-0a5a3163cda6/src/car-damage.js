export function impactSeverity(closingSpeed) {
  if (!Number.isFinite(closingSpeed) || closingSpeed <= 3) return 0;
  return Math.max(0, Math.min(1, (closingSpeed - 3) / 17));
}

export function damageFromImpact(closingSpeed) {
  const severity = impactSeverity(closingSpeed);
  // A body impact should leave a clearly visible crease even on a single hit.
  return { severity, amount: severity * 0.28, depth: severity * 0.32, radius: 0.92 };
}

export function wheelCanDetach(closingSpeed, distanceToMount) {
  return Number.isFinite(closingSpeed) && closingSpeed >= 14 && Number.isFinite(distanceToMount) && distanceToMount <= 0.62;
}

export function tractionForDamage(damage) {
  const amount = Math.max(0, Math.min(1, Number.isFinite(damage) ? damage : 0));
  return amount <= 0.5 ? 1 : Math.max(0, 1 - (amount - 0.5) * 2);
}

export function accumulateDamage(current, amount) {
  return Math.max(0, Math.min(1, current + Math.max(0, Number.isFinite(amount) ? amount : 0)));
}

export function damageState(damage) {
  return damage >= 1 ? 'destroyed' : damage >= 0.5 ? 'damaged' : 'healthy';
}
