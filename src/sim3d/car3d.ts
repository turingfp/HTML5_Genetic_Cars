/**
 * A 3D car: the silhouette extruded into a convex hull, on mirrored pairs of
 * wheels, so a two wheeled silhouette becomes four and a four wheeled one eight.
 */

import {
  CAR_COLLISION_GROUP,
  CAR_SPAWN_X,
  CAR_SPAWN_Y,
  CHASSIS_FRICTION,
  CHASSIS_RESTITUTION,
  FALL_OFF_DEPTH,
  GRAVITY_Y,
  HEALTH_PER_METRE,
  MAX_CAR_HEALTH,
  MOTOR_SPEED,
  PHYSICS_HZ,
  STUCK_HEALTH_PENALTY,
  STUCK_VELOCITY_THRESHOLD,
  WHEEL_FRICTION,
  WHEEL_RESTITUTION,
} from '../config';
import { BrainRuntime, emptySensors, motorMultiplier } from '../ga/brain';
import { chassisHullPoints, wheelMounts, type Car3DDef } from '../ga/genome3d';
import { SENSOR_SPEED_SCALE, SENSOR_SPIN_SCALE } from '../sim/car';
import type { SlopeProbes } from '../sim/track';
import type { Box3DBody, Box3DJoint, Box3DWorld } from './box3d';

/**
 * Half the width of a wheel, as a fraction of its radius.
 *
 * This has to scale with the radius. A fixed value made a big wheel a capsule
 * whose radius exceeded its length, which is geometrically a sphere. It looked
 * wrong and behaved wrong, rolling freely sideways instead of tracking.
 */
const WHEEL_TREAD_RATIO = 0.3;

/** Sides of the prism used to approximate a wheel. Mass converges by 16. */
const WHEEL_FACETS = 16;

export function wheelHalfTread(radius: number): number {
  return radius * WHEEL_TREAD_RATIO;
}

/**
 * A wheel as a convex hull: a regular prism around the z axis, which is the
 * axle direction. Gives a flat tread that grips and a real contact patch,
 * where a capsule only ever touched the ground at one point.
 */
function wheelHullPoints(radius: number): { x: number; y: number; z: number }[] {
  const halfTread = wheelHalfTread(radius);
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < WHEEL_FACETS; i++) {
    const angle = (i / WHEEL_FACETS) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    points.push({ x, y, z: -halfTread });
    points.push({ x, y, z: halfTread });
  }
  return points;
}

export class Car3D {
  readonly def: Car3DDef;
  readonly index: number;
  readonly isElite: boolean;
  /** Which founding line this car descends from. */
  readonly lineage: number;
  /** Chassis plus wheels, measured once the bodies exist. */
  mass = 0;

  chassis: Box3DBody | null = null;
  wheels: Box3DBody[] = [];
  /** Last forward pass of this car's driver, kept for the visualisation. */
  readonly brain = new BrainRuntime();

  /** One per wheel, in wheel order, so the driver can change their speeds. */
  private motors: Box3DJoint[] = [];
  /** Which of the two outputs drives each wheel. Left and right pairs share. */
  private motorOutput: number[] = [];
  /** Reused every step so driving allocates nothing. */
  private readonly sensors = emptySensors();

  alive = true;
  health = MAX_CAR_HEALTH;
  frames = 0;
  maxX = 0;
  maxY = 0;
  minY = 0;
  score = 0;
  /** Set when the car left the road rather than simply running out of health. */
  fellOff = false;
  /** Where the car ended up, recorded as it is destroyed. */
  deathPosition: { x: number; y: number; z: number } | null = null;
  /** Height of the road where it died, so a marker can sit on the surface. */
  deathRoadY = 0;

  constructor(world: Box3DWorld, def: Car3DDef, index: number, isElite: boolean, lineage = 0) {
    this.def = def;
    this.index = index;
    this.isElite = isElite;
    this.lineage = lineage;

    const filter = { categoryBits: 1, maskBits: 0xffff, groupIndex: CAR_COLLISION_GROUP };

    const chassis = world.createBody({
      type: 'dynamic',
      position: { x: CAR_SPAWN_X, y: CAR_SPAWN_Y, z: 0 },
    });
    chassis.createHull({
      points: chassisHullPoints(def),
      density: def.base.chassisDensity,
      friction: CHASSIS_FRICTION,
      restitution: CHASSIS_RESTITUTION,
      filter,
    });

    for (const mount of wheelMounts(def)) {
      const radius = def.base.wheels[mount.wheel]!.radius;
      const wheel = world.createBody({
        type: 'dynamic',
        position: {
          x: CAR_SPAWN_X + mount.x,
          y: CAR_SPAWN_Y + mount.y,
          z: mount.z,
        },
      });
      wheel.createHull({
        points: wheelHullPoints(radius),
        density: def.base.wheels[mount.wheel]!.density,
        friction: WHEEL_FRICTION,
        restitution: WHEEL_RESTITUTION,
        filter,
      });
      this.wheels.push(wheel);
    }

    const totalMass =
      chassis.getMass() + this.wheels.reduce((sum, wheel) => sum + wheel.getMass(), 0);

    wheelMounts(def).forEach((mount, i) => {
      const radius = def.base.wheels[mount.wheel]!.radius;
      const joint = world.createRevoluteJoint(chassis, this.wheels[i]!, {
        // The revolute hinge turns about its frame's z axis, which is exactly
        // the axle direction for a car facing along +x.
        localFrameA: { position: { x: mount.x, y: mount.y, z: mount.z } },
        localFrameB: { position: { x: 0, y: 0, z: 0 } },
        enableMotor: true,
        motorSpeed: MOTOR_SPEED,
        // The wheels share the load, so a car with more of them gets grip
        // rather than free power.
        maxMotorTorque: ((totalMass * -GRAVITY_Y) / radius) * (2 / this.wheels.length),
      });
      this.motors.push(joint);
      // A mount belongs to one wheel of the silhouette, and both sides of a
      // pair take the same output, so the car cannot steer by accident.
      this.motorOutput.push(mount.wheel);
    });

    this.chassis = chassis;
    this.mass = totalMass;
  }

  /** Let the driver set the wheel speeds. See `Car.drive` in the flat mode. */
  drive(probes: SlopeProbes): void {
    const chassis = this.chassis;
    if (!chassis || !this.alive) return;

    const velocity = chassis.getLinearVelocity();
    const spin = chassis.getAngularVelocity();
    const q = chassis.getRotation();
    // The body's own up vector, which is the quickest way to ask a quaternion
    // how the car is sitting: leaning back tips it along -x, rolling tips it
    // along z.
    const upX = 2 * (q.x * q.y - q.z * q.w);
    const upZ = 2 * (q.x * q.w + q.y * q.z);

    const sensors = this.sensors;
    sensors.pitch = -upX;
    sensors.roll = upZ;
    sensors.speed = velocity.x / SENSOR_SPEED_SCALE;
    sensors.drop = velocity.y / SENSOR_SPEED_SCALE;
    sensors.spin = spin.z / SENSOR_SPIN_SCALE;
    sensors.near = probes.near;
    sensors.mid = probes.mid;
    sensors.far = probes.far;

    this.brain.evaluate(this.def.base.brain, sensors);
    for (let i = 0; i < this.motors.length; i++) {
      const out = this.brain.output(this.motorOutput[i] ?? 0);
      this.motors[i]!.setMotorSpeed(MOTOR_SPEED * motorMultiplier(out));
    }
  }

  /**
   * Advance bookkeeping one step. Returns true if the car died.
   *
   * `roadY` is the height of the road beneath the car; the course descends as
   * it goes, so falling has to be measured against the local surface rather
   * than against the height the car started at.
   */
  update(roadY: number, lateralLimit: number): boolean {
    const chassis = this.chassis;
    if (!chassis || !this.alive) return false;

    this.frames++;
    const p = chassis.getPosition();

    if (p.y > this.maxY) this.maxY = p.y;
    if (p.y < this.minY) this.minY = p.y;

    // Leaving the road is instant death, since there is nothing to drive on.
    if (Math.abs(p.z) > lateralLimit || p.y < roadY - FALL_OFF_DEPTH) {
      this.fellOff = true;
      return true;
    }

    // As in the flat mode: health is earned per metre, so inching forward is
    // not enough to stay alive.
    if (p.x > this.maxX) {
      this.health = Math.min(MAX_CAR_HEALTH, this.health + (p.x - this.maxX) * HEALTH_PER_METRE);
      this.maxX = p.x;
    }

    this.health--;
    if (Math.abs(chassis.getLinearVelocity().x) < STUCK_VELOCITY_THRESHOLD) {
      this.health -= STUCK_HEALTH_PENALTY;
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
    // Where it came to rest, captured before the body goes away. The renderer
    // keeps these as a record of where the population keeps failing.
    const resting = this.chassis?.getPosition();
    if (resting) this.deathPosition = { x: resting.x, y: resting.y, z: resting.z };
    // Box3D destroys a body's joints and shapes along with it.
    this.chassis?.destroy();
    for (const wheel of this.wheels) wheel.destroy();
    this.chassis = null;
    this.wheels = [];
    this.motors = [];
    this.motorOutput = [];
  }
}
