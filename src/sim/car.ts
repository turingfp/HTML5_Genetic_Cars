/**
 * Turning a genome into a physical car, and tracking how it does.
 *
 * This is the only module besides `simulation.ts` that knows planck exists.
 */

import { Circle, Polygon, Vec2, World, RevoluteJoint, type Body } from 'planck';

import {
  CAR_COLLISION_GROUP,
  CAR_SPAWN_X,
  CAR_SPAWN_Y,
  CHASSIS_DENSITY,
  CHASSIS_FRICTION,
  CHASSIS_RESTITUTION,
  CHASSIS_VERTEX_COUNT,
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
import type { CarDef } from '../ga/genome';

export class Car {
  readonly def: CarDef;
  readonly index: number;
  readonly isElite: boolean;

  chassis: Body | null = null;
  wheels: [Body, Body] | null = null;

  alive = true;
  health = MAX_CAR_HEALTH;
  frames = 0;
  /** Furthest x reached, which is also the distance component of fitness. */
  maxX = 0;
  maxY = 0;
  minY = 0;
  /** Set once the car dies. */
  score = 0;

  constructor(world: World, def: CarDef, index: number, isElite: boolean) {
    this.def = def;
    this.index = index;
    this.isElite = isElite;

    const chassis = world.createBody({
      type: 'dynamic',
      position: new Vec2(CAR_SPAWN_X, CAR_SPAWN_Y),
    });

    // The chassis is a fan of triangles from the origin out to each pair of
    // neighbouring vertices, which keeps every piece convex however spiky the
    // genome is.
    for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
      const a = def.vertices[i]!;
      const b = def.vertices[(i + 1) % CHASSIS_VERTEX_COUNT]!;
      chassis.createFixture({
        shape: new Polygon([new Vec2(a.x, a.y), new Vec2(b.x, b.y), new Vec2(0, 0)]),
        density: CHASSIS_DENSITY,
        friction: CHASSIS_FRICTION,
        restitution: CHASSIS_RESTITUTION,
        filterGroupIndex: CAR_COLLISION_GROUP,
      });
    }

    const wheels: Body[] = [];
    for (let i = 0; i < 2; i++) {
      const anchor = def.vertices[def.wheelVertex[i]!]!;
      // Spawn each wheel already at its mounting point. The original dropped
      // them at the origin and let the joint yank them into place, which threw
      // the whole car sideways on the first few steps.
      const wheel = world.createBody({
        type: 'dynamic',
        position: new Vec2(CAR_SPAWN_X + anchor.x, CAR_SPAWN_Y + anchor.y),
      });
      wheel.createFixture({
        shape: new Circle(def.wheelRadius[i]!),
        density: def.wheelDensity[i]!,
        friction: WHEEL_FRICTION,
        restitution: WHEEL_RESTITUTION,
        filterGroupIndex: CAR_COLLISION_GROUP,
      });
      wheels.push(wheel);
    }

    const totalMass = chassis.getMass() + wheels[0]!.getMass() + wheels[1]!.getMass();

    for (let i = 0; i < 2; i++) {
      const anchor = def.vertices[def.wheelVertex[i]!]!;
      world.createJoint(
        new RevoluteJoint(
          {
            // Torque scales with the car's own weight, so heavy cars are not
            // automatically hopeless.
            maxMotorTorque: (totalMass * -GRAVITY_Y) / def.wheelRadius[i]!,
            motorSpeed: MOTOR_SPEED,
            enableMotor: true,
          },
          chassis,
          wheels[i]!,
          // The wheel already sits on its mounting point, so the world anchor
          // resolves to the chassis vertex and the wheel's own centre.
          new Vec2(CAR_SPAWN_X + anchor.x, CAR_SPAWN_Y + anchor.y),
        ),
      );
    }

    this.chassis = chassis;
    this.wheels = [wheels[0]!, wheels[1]!];
  }

  /** Advance this car's bookkeeping by one physics step. Returns true if it died. */
  update(): boolean {
    const chassis = this.chassis;
    if (!chassis || !this.alive) return false;

    this.frames++;
    const position = chassis.getPosition();

    if (position.y > this.maxY) this.maxY = position.y;
    if (position.y < this.minY) this.minY = position.y;

    if (position.x > this.maxX + PROGRESS_EPSILON) {
      // Making real progress buys a full tank of health back.
      this.health = MAX_CAR_HEALTH;
      this.maxX = position.x;
    } else {
      this.health--;
      if (Math.abs(chassis.getLinearVelocity().x) < STUCK_VELOCITY_THRESHOLD) {
        this.health -= STUCK_HEALTH_PENALTY;
      }
    }

    return this.health <= 0;
  }

  /** Fitness: how far it got, plus how quickly it got there. */
  computeScore(): number {
    const avgSpeed = this.frames > 0 ? (this.maxX / this.frames) * PHYSICS_HZ : 0;
    return this.maxX + avgSpeed;
  }

  get avgSpeed(): number {
    return this.frames > 0 ? (this.maxX / this.frames) * PHYSICS_HZ : 0;
  }

  /** Remove the car from the world, keeping its final numbers. */
  destroy(world: World): void {
    this.score = this.computeScore();
    this.alive = false;
    if (this.chassis) world.destroyBody(this.chassis);
    if (this.wheels) {
      world.destroyBody(this.wheels[0]);
      world.destroyBody(this.wheels[1]);
    }
    this.chassis = null;
    this.wheels = null;
  }
}
