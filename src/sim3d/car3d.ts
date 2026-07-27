/**
 * A 3D car: the silhouette extruded into a convex hull, on four wheels.
 */

import {
  CAR_COLLISION_GROUP,
  CAR_SPAWN_X,
  CAR_SPAWN_Y,
  CHASSIS_DENSITY,
  CHASSIS_FRICTION,
  CHASSIS_RESTITUTION,
  FALL_OFF_DEPTH,
  FALL_OFF_LATERAL,
  GRAVITY_Y,
  MAX_CAR_HEALTH,
  MOTOR_SPEED,
  PHYSICS_HZ,
  PROGRESS_EPSILON,
  STUCK_HEALTH_PENALTY,
  STUCK_VELOCITY_THRESHOLD,
  WHEEL_FRICTION,
  WHEEL_RESTITUTION,
} from '../config';
import { chassisHullPoints, wheelMounts, type Car3DDef } from '../ga/genome3d';
import type { Box3DBody, Box3DWorld } from './box3d';

/** Wheels are capsules laid along z, which rolls like a rounded tyre. */
const WHEEL_HALF_TREAD = 0.12;

export class Car3D {
  readonly def: Car3DDef;
  readonly index: number;
  readonly isElite: boolean;

  chassis: Box3DBody | null = null;
  wheels: Box3DBody[] = [];

  alive = true;
  health = MAX_CAR_HEALTH;
  frames = 0;
  maxX = 0;
  maxY = 0;
  minY = 0;
  score = 0;
  /** Set when the car left the road rather than simply running out of health. */
  fellOff = false;

  constructor(world: Box3DWorld, def: Car3DDef, index: number, isElite: boolean) {
    this.def = def;
    this.index = index;
    this.isElite = isElite;

    const filter = { categoryBits: 1, maskBits: 0xffff, groupIndex: CAR_COLLISION_GROUP };

    const chassis = world.createBody({
      type: 'dynamic',
      position: { x: CAR_SPAWN_X, y: CAR_SPAWN_Y, z: 0 },
    });
    chassis.createHull({
      points: chassisHullPoints(def),
      density: CHASSIS_DENSITY,
      friction: CHASSIS_FRICTION,
      restitution: CHASSIS_RESTITUTION,
      filter,
    });

    for (const mount of wheelMounts(def)) {
      const radius = def.base.wheelRadius[mount.wheel]!;
      const wheel = world.createBody({
        type: 'dynamic',
        position: {
          x: CAR_SPAWN_X + mount.x,
          y: CAR_SPAWN_Y + mount.y,
          z: mount.z,
        },
      });
      wheel.createCapsule({
        center1: { x: 0, y: 0, z: -WHEEL_HALF_TREAD },
        center2: { x: 0, y: 0, z: WHEEL_HALF_TREAD },
        radius,
        density: def.base.wheelDensity[mount.wheel]!,
        friction: WHEEL_FRICTION,
        restitution: WHEEL_RESTITUTION,
        filter,
      });
      this.wheels.push(wheel);
    }

    const totalMass =
      chassis.getMass() + this.wheels.reduce((sum, wheel) => sum + wheel.getMass(), 0);

    wheelMounts(def).forEach((mount, i) => {
      const radius = def.base.wheelRadius[mount.wheel]!;
      world.createRevoluteJoint(chassis, this.wheels[i]!, {
        // The revolute hinge turns about its frame's z axis, which is exactly
        // the axle direction for a car facing along +x.
        localFrameA: { position: { x: mount.x, y: mount.y, z: mount.z } },
        localFrameB: { position: { x: 0, y: 0, z: 0 } },
        enableMotor: true,
        motorSpeed: MOTOR_SPEED,
        // Four wheels share the load, so each gets a quarter of the torque a
        // two-wheeled car would need.
        maxMotorTorque: (totalMass * -GRAVITY_Y) / radius / 2,
      });
    });

    this.chassis = chassis;
  }

  /**
   * Advance bookkeeping one step. Returns true if the car died.
   *
   * `roadY` is the height of the road beneath the car; the course descends as
   * it goes, so falling has to be measured against the local surface rather
   * than against the height the car started at.
   */
  update(roadY: number): boolean {
    const chassis = this.chassis;
    if (!chassis || !this.alive) return false;

    this.frames++;
    const p = chassis.getPosition();

    if (p.y > this.maxY) this.maxY = p.y;
    if (p.y < this.minY) this.minY = p.y;

    // Leaving the road is instant death — there is nothing to drive on.
    if (Math.abs(p.z) > FALL_OFF_LATERAL || p.y < roadY - FALL_OFF_DEPTH) {
      this.fellOff = true;
      return true;
    }

    if (p.x > this.maxX + PROGRESS_EPSILON) {
      this.health = MAX_CAR_HEALTH;
      this.maxX = p.x;
    } else {
      this.health--;
      if (Math.abs(chassis.getLinearVelocity().x) < STUCK_VELOCITY_THRESHOLD) {
        this.health -= STUCK_HEALTH_PENALTY;
      }
    }

    return this.health <= 0;
  }

  get avgSpeed(): number {
    return this.frames > 0 ? (this.maxX / this.frames) * PHYSICS_HZ : 0;
  }

  computeScore(): number {
    return this.maxX + this.avgSpeed;
  }

  destroy(): void {
    this.score = this.computeScore();
    this.alive = false;
    // Box3D destroys a body's joints and shapes along with it.
    this.chassis?.destroy();
    for (const wheel of this.wheels) wheel.destroy();
    this.chassis = null;
    this.wheels = [];
  }
}
