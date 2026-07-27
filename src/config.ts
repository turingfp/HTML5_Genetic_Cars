/**
 * Every tunable constant, carried over from the original `cawro.js`.
 *
 * The numbers here define how the simulation *feels*, so they are ported
 * verbatim — including the quirks. Where the original name was misleading
 * (e.g. `wheelMaxRadius` was really the width of the random range, not a
 * maximum), the constant is renamed and the true range is documented.
 */

/** Physics steps per second. The simulation always advances in these units. */
export const PHYSICS_HZ = 60;
export const TIME_STEP = 1 / PHYSICS_HZ;

/**
 * Box2D solver iterations. The original used 20/20, which is 2.5-6x more than
 * needed; these are the Box2D defaults and roughly 2.5x faster.
 */
export const VELOCITY_ITERATIONS = 8;
export const POSITION_ITERATIONS = 3;

export const GRAVITY_Y = -9.81;

/* ── Genome ranges ────────────────────────────────────────────────────────
 * Original: `Math.random() * wheelMaxRadius + wheelMinRadius`, so the "max"
 * constants were range widths. Actual ranges are noted below.
 */

/** Wheel radius spans [0.2, 0.7). */
export const WHEEL_RADIUS_MIN = 0.2;
export const WHEEL_RADIUS_RANGE = 0.5;

/** Wheel density spans [40, 140). */
export const WHEEL_DENSITY_MIN = 40;
export const WHEEL_DENSITY_RANGE = 100;

/** Chassis vertex distance along its octant spans [0.1, 1.2). */
export const CHASSIS_AXIS_MIN = 0.1;
export const CHASSIS_AXIS_RANGE = 1.1;

/** Chassis vertices, one per octant. Changing this changes the genome length. */
export const CHASSIS_VERTEX_COUNT = 8;

/** 8 chassis axes + 2 wheel radii + 2 wheel densities + 2 wheel attachments. */
export const GENE_COUNT = 14;

/* ── Body materials ─────────────────────────────────────────────────────── */

export const CHASSIS_DENSITY = 80;
export const CHASSIS_FRICTION = 10;
export const CHASSIS_RESTITUTION = 0.2;

export const WHEEL_FRICTION = 1;
export const WHEEL_RESTITUTION = 0.2;

/** All car fixtures share this negative group, so car parts never collide. */
export const CAR_COLLISION_GROUP = -1;

/** Wheels spin backwards; torque is scaled by total car mass at build time. */
export const MOTOR_SPEED = -20;

export const CAR_SPAWN_X = 0;
export const CAR_SPAWN_Y = 4;

/* ── Track ──────────────────────────────────────────────────────────────── */

export const TRACK_TILE_COUNT = 200;
export const TILE_WIDTH = 1.5;
export const TILE_HEIGHT = 0.15;
export const TILE_FRICTION = 0.5;
export const TRACK_START_X = -5;
export const TRACK_START_Y = 0;

/**
 * Tile tilt grows with distance: `(rand()*3 - 1.5) * TILE_TILT_GAIN * k / count`.
 * This is what makes the terrain progressively harder.
 */
export const TILE_TILT_GAIN = 1.5;

/* ── Car life cycle ─────────────────────────────────────────────────────── */

/** 10 seconds of stalling at 60Hz before a car dies. */
export const MAX_CAR_HEALTH = PHYSICS_HZ * 10;

/** Distance a car must gain on its own record to refill its health. */
export const PROGRESS_EPSILON = 0.02;

/** Extra health drained per step while essentially motionless. */
export const STUCK_HEALTH_PENALTY = 5;
export const STUCK_VELOCITY_THRESHOLD = 0.001;

/* ── Genetic algorithm defaults ─────────────────────────────────────────── */

export const DEFAULT_POPULATION_SIZE = 20;
export const MIN_POPULATION_SIZE = 4;
export const MAX_POPULATION_SIZE = 40;

/** Per-gene mutation probability. */
export const DEFAULT_MUTATION_RATE = 0.05;

/** Width of the mutation window as a fraction of each gene's full range. */
export const DEFAULT_MUTATION_SIZE = 1;

export const DEFAULT_ELITE_COUNT = 1;
export const MAX_ELITE_COUNT = 10;

/* ── Replay ─────────────────────────────────────────────────────────────── */

/** chassis (x, y, angle) + two wheels (x, y, angle) per recorded frame. */
export const REPLAY_FLOATS_PER_FRAME = 9;

/** Ten minutes at 60Hz. Recording stops past this to bound memory. */
export const REPLAY_MAX_FRAMES = PHYSICS_HZ * 60 * 10;

/* ── Presentation ───────────────────────────────────────────────────────── */

/**
 * Pixels per metre. The original hardcoded 70 for a fixed 800px canvas; the
 * view is now fluid, so the starting zoom is chosen to frame a fixed span of
 * track and clamped for very narrow screens.
 */
export const DEFAULT_ZOOM = 45;
export const TARGET_VISIBLE_METRES = 26;
export const MIN_ZOOM = 18;
export const MAX_ZOOM = 160;

/** Camera smoothing, expressed as the original per-frame lerp at 60fps. */
export const CAMERA_SMOOTHING = 0.05;

/** Playback speeds offered by the UI. `'max'` runs inside a time budget. */
export const SPEEDS = [0.5, 1, 2, 4, 'max'] as const;
export type Speed = (typeof SPEEDS)[number];

/** Milliseconds of physics allowed per animation frame in `'max'` mode. */
export const MAX_MODE_BUDGET_MS = 11;

/** Cap on catch-up steps per frame at normal speeds (avoids death spirals). */
export const MAX_STEPS_PER_FRAME = 8;

/** How many entries the leaderboard keeps. */
export const TOP_SCORE_COUNT = 10;
