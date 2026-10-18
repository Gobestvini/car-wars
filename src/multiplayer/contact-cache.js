import { ObjectCollisionMatrix } from 'cannon-es';

// Cannon's default dense matrices clear N*(N-1)/2 entries per physics step,
// including every static house/curb pair. Replay magnifies that quadratic cost.
// Its built-in sparse implementation tracks the actual touching body IDs only.
export function useSparseContacts(world) {
  world.collisionMatrix=new ObjectCollisionMatrix();
  world.collisionMatrixPrevious=new ObjectCollisionMatrix();
}
