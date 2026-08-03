/**
 * Loose crates on the road.
 *
 * Everything else in this world is either a car or a static slab, which means
 * the physics engine has never had to show what it is actually for. A crate is
 * a real dynamic body: it has mass, it tips, it slides, it gets shouldered out
 * of the way by a heavy car and stops a light one dead, and two of them stack
 * and then do not. None of that is scripted. It is the same solver the cars
 * are already using, given something to solve.
 *
 * They also change the search. Hills and gaps are fixed obstacles that a
 * population memorises; a crate moves when hit, so the useful trait stops being
 * "clears a 2m gap" and starts being "carries enough momentum to shove three
 * kilos aside". That is a different car.
 *
 * Placement is derived from the track seed, so a shared track has the crates in
 * the same places for everybody, and they are rebuilt every generation so the
 * course each car meets is the one the last car met rather than whatever the
 * last car left behind.
 */

import { CRATE_DENSITY, CRATE_FRICTION, CRATE_RESTITUTION } from '../config';
import { rngFromSeed } from '../core/rng';
import type { Box3DBody, Box3DWorld } from './box3d';
import { roadCrossSections, type Track3D } from './track3d';

/** Half extents of a crate, in metres. About the size of a wheel. */
const CRATE_HALF = 0.42;

/** Crates never sit in the first tiles, so a car gets to start. */
const CRATE_SAFE_RUN_UP = 10;

/**
 * How far above the surface a crate is dropped.
 *
 * Small, but not zero: spawning a body exactly touching a slab it overlaps by a
 * float's worth makes the solver push it out on the first step, which looks
 * like the crates twitching as each generation begins.
 */
const CRATE_DROP = 0.05;

/** How far along the surface normal a crate's centre sits. */
const LIFT = CRATE_HALF + CRATE_DROP;

/** How far either side of the crown a crate may sit, as a fraction of the width. */
const CRATE_SPREAD = 0.22;

export interface CratePose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

/** Where the crates go, for a track. Deterministic in the track's seed. */
export function crateSpots(track: Track3D): { x: number; y: number; z: number }[] {
  const chance = track.spec.debris;
  if (chance <= 0) return [];

  // Its own stream, so adding crates does not shift the hills or the banking.
  const rng = rngFromSeed(`${track.spec.seed}-crates`);
  const spots: { x: number; y: number; z: number }[] = [];

  // The same cross-sections the colliders are built from. Placing a crate at
  // the centreline height and then offsetting it sideways put it *under* the
  // road on any cambered track, because a banked surface is not level across
  // its width: the first version of this dropped crates to eighty metres down.
  const sections = roadCrossSections(track);

  for (let tile = 0; tile < track.profile.tiles.length; tile++) {
    // A crate needs a road under it, and a crate you meet before you are
    // moving is not an obstacle, it is a wall.
    if (!track.profile.tiles[tile]?.solid) continue;
    const section = sections[tile];
    if (!section) continue;
    if (section.left[0] < CRATE_SAFE_RUN_UP) continue;
    if (rng() >= chance) continue;

    // Around the crown of the road rather than anywhere across it. A crate
    // near the lip of a cambered road slides off by itself within a few
    // seconds, which is neither an obstacle nor a good look, and one you can
    // simply drive around is not an obstacle either.
    const t = 0.5 + (rng() * 2 - 1) * CRATE_SPREAD;

    spots.push({
      x: section.left[0] + (section.right[0] - section.left[0]) * t + section.up[0] * LIFT,
      y: section.left[1] + (section.right[1] - section.left[1]) * t + section.up[1] * LIFT,
      z: section.left[2] + (section.right[2] - section.left[2]) * t + section.up[2] * LIFT,
    });
  }
  return spots;
}

/**
 * Build the crates for a track. The caller owns the bodies and destroys them.
 *
 * They collide with cars and with the road, and with each other, which is the
 * whole point: the interesting frame is the one where a car hits a crate that
 * then hits another crate.
 */
export function buildCrates(world: Box3DWorld, track: Track3D): Box3DBody[] {
  return crateSpots(track).map((spot) => {
    const body = world.createBody({ type: 'dynamic', position: spot });
    body.createBox({
      halfExtents: { x: CRATE_HALF, y: CRATE_HALF, z: CRATE_HALF },
      density: CRATE_DENSITY,
      friction: CRATE_FRICTION,
      restitution: CRATE_RESTITUTION,
    });
    return body;
  });
}

export { CRATE_HALF };
