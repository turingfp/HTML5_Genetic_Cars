/**
 * The rule that decides when a car has given up.
 *
 * A crawling car used to be immortal: any gain over two centimetres refilled
 * the bar completely, so one car creeping forward at a millimetre a second
 * could hold a generation open indefinitely.
 */

import { describe, expect, it } from 'vitest';

import {
  HEALTH_PER_METRE,
  MAX_CAR_HEALTH,
  MIN_SUSTAINED_SPEED,
  PHYSICS_HZ,
  STUCK_HEALTH_PENALTY,
  STUCK_VELOCITY_THRESHOLD,
} from '../src/config';

/**
 * The health rule on its own, mirroring `Car.update`. Driving it directly lets
 * us test the policy across speeds without running physics for real minutes.
 */
function simulate(speed: number, seconds: number): { alive: boolean; diedAfter: number } {
  let health = MAX_CAR_HEALTH;
  let maxX = 0;
  let x = 0;
  const steps = Math.round(seconds * PHYSICS_HZ);

  for (let i = 0; i < steps; i++) {
    x += speed / PHYSICS_HZ;
    if (x > maxX) {
      health = Math.min(MAX_CAR_HEALTH, health + (x - maxX) * HEALTH_PER_METRE);
      maxX = x;
    }
    health--;
    if (Math.abs(speed) < STUCK_VELOCITY_THRESHOLD) health -= STUCK_HEALTH_PENALTY;
    if (health <= 0) return { alive: false, diedAfter: i / PHYSICS_HZ };
  }
  return { alive: true, diedAfter: Infinity };
}

describe('health', () => {
  it('kills a car that crawls forward without ever stopping', () => {
    // The exact case reported: moving, but only just.
    const result = simulate(0.001, 120);
    expect(result.alive).toBe(false);
    // It should go within roughly its starting bar, not linger for minutes.
    expect(result.diedAfter).toBeLessThan(MAX_CAR_HEALTH / PHYSICS_HZ + 1);
  });

  it('kills a car stopped dead, faster still', () => {
    const crawling = simulate(0.001, 120);
    const stopped = simulate(0, 120);
    expect(stopped.alive).toBe(false);
    expect(stopped.diedAfter).toBeLessThan(crawling.diedAfter);
  });

  it('keeps a car alive once it holds the minimum speed', () => {
    expect(simulate(MIN_SUSTAINED_SPEED * 1.2, 600).alive).toBe(true);
    expect(simulate(1, 600).alive).toBe(true);
    expect(simulate(8, 600).alive).toBe(true);
  });

  it('kills a car just under the minimum speed', () => {
    expect(simulate(MIN_SUSTAINED_SPEED * 0.5, 300).alive).toBe(false);
  });

  it('never banks more than a full bar of health', () => {
    // A fast car must not accumulate a reserve that outlives getting stuck.
    let health = MAX_CAR_HEALTH;
    let maxX = 0;
    for (let i = 0; i < 600; i++) {
      const x = (i + 1) * 0.5;
      health = Math.min(MAX_CAR_HEALTH, health + (x - maxX) * HEALTH_PER_METRE);
      maxX = x;
      health--;
      expect(health).toBeLessThanOrEqual(MAX_CAR_HEALTH);
    }
  });
});
