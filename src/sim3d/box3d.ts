/**
 * Minimal typings and loader for box3d-wasm.
 *
 * The package ships no TypeScript declarations, so this describes just the
 * surface the simulation uses. Box3D is Erin Catto's 3D engine — the same
 * lineage as the Box2D the original used, two dimensions later.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ShapeFilter {
  categoryBits: number;
  maskBits: number;
  /** Negative values that match never collide, as in Box2D. */
  groupIndex: number;
}

interface ShapeOptions {
  density?: number;
  friction?: number;
  restitution?: number;
  filter?: ShapeFilter;
}

export interface Box3DShape {
  destroy(): void;
}

export interface Box3DBody {
  createBox(options: ShapeOptions & { halfExtents: Vec3 }): Box3DShape;
  createSphere(options: ShapeOptions & { radius: number; center?: Vec3 }): Box3DShape;
  createCapsule(
    options: ShapeOptions & { center1: Vec3; center2: Vec3; radius: number },
  ): Box3DShape;
  createHull(options: ShapeOptions & { points: Vec3[] }): Box3DShape;
  getPosition(): Vec3;
  getRotation(): Quat;
  getLinearVelocity(): Vec3;
  getAngularVelocity(): Vec3;
  getMass(): number;
  isValid(): boolean;
  destroy(): void;
}

export interface RevoluteJointOptions {
  localFrameA?: { position: Vec3; rotation?: Quat };
  localFrameB?: { position: Vec3; rotation?: Quat };
  enableMotor?: boolean;
  motorSpeed?: number;
  maxMotorTorque?: number;
}

export interface Box3DJoint {
  setMotorSpeed(speed: number): void;
  destroy?(): void;
}

export interface Box3DWorld {
  createBody(options: { type: 'static' | 'dynamic' | 'kinematic'; position: Vec3; rotation?: Quat }): Box3DBody;
  createRevoluteJoint(a: Box3DBody, b: Box3DBody, options: RevoluteJointOptions): Box3DJoint;
  step(timeStep: number, subStepCount: number): void;
  destroy(): void;
}

interface Box3DModule {
  World: new (options: { gravity: Vec3 }) => Box3DWorld;
}

type Box3DFactory = () => Promise<Box3DModule>;

let modulePromise: Promise<Box3DModule> | null = null;

/**
 * Load and initialise the WebAssembly module. Safe to call repeatedly — the
 * same instance is shared, since compiling the module is not cheap.
 */
export function loadBox3D(): Promise<Box3DModule> {
  if (!modulePromise) {
    // The default entry auto-detects wasm threads and pulls in a build that
    // uses top-level `await import('worker_threads')`, which cannot be bundled
    // for the browser. The single-threaded build is plenty for one world.
    modulePromise = import('box3d-wasm/standard').then((mod) => {
      const factory = ((mod as { default?: Box3DFactory }).default ??
        mod) as unknown as Box3DFactory;
      return factory();
    });
  }
  return modulePromise;
}
