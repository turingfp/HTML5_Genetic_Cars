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

/**
 * Hard limit on how far a tile may tilt, just under a quarter turn.
 *
 * The formula above reaches 2.25 rad (129 degrees) on late tiles, which tips
 * a tile past vertical so the track doubles back on itself. That makes the
 * surface no longer a function of x — it breaks the terrain fill, the visible
 * range lookup and the distance markers, and an overhang is not something a
 * car can drive along anyway. Clamping keeps the course brutally steep while
 * guaranteeing it always advances.
 */
export const MAX_TILE_TILT = 1.4;

/* ── 3D mode ────────────────────────────────────────────────────────────
 * The 3D car is the 2D silhouette extruded along z, so it needs two extra
 * genes: how wide the body is, and how far the wheels sit outboard of it.
 */

/** Chassis half-width spans [0.15, 0.95). */
export const CHASSIS_HALF_WIDTH_MIN = 0.15;
export const CHASSIS_HALF_WIDTH_RANGE = 0.8;

/** Wheel outboard offset spans [0.02, 0.37). */
export const WHEEL_GAP_MIN = 0.02;
export const WHEEL_GAP_RANGE = 0.35;

/** Half-width of the drivable road surface. */
export const ROAD_HALF_WIDTH = 4;

/**
 * How far the road rolls side to side, growing with distance like the pitch
 * does. This is the 3D mode's own difficulty: cars must resist tipping over.
 */
export const ROAD_BANK_GAIN = 0.5;
export const MAX_ROAD_BANK = 0.45;

/** A car this far to the side, or this far below the road, has fallen off. */
export const FALL_OFF_LATERAL = ROAD_HALF_WIDTH + 2.5;
export const FALL_OFF_DEPTH = 8;

/** Physics sub-steps per step for Box3D's solver. */
export const SUB_STEP_COUNT = 4;

/* ── Car life cycle ─────────────────────────────────────────────────────── */

/** 10 seconds of stalling at 60Hz before a car dies. */
export const MAX_CAR_HEALTH = PHYSICS_HZ * 10;

/**
 * Health restored per metre of new ground gained.
 *
 * Health drains at PHYSICS_HZ per second, so this sets a minimum sustained
 * speed: below PHYSICS_HZ / HEALTH_PER_METRE metres per second a car loses
 * health faster than it earns it, and eventually dies.
 *
 * The original refilled the bar completely for any gain over two centimetres,
 * which meant a car creeping forward at a millimetre a second topped itself up
 * every few seconds and never died — one of them could hold up a whole
 * generation indefinitely.
 */
export const HEALTH_PER_METRE = 240;

/** The speed a car must average to stay alive, implied by the rate above. */
export const MIN_SUSTAINED_SPEED = PHYSICS_HZ / HEALTH_PER_METRE;

/**
 * Hard ceiling on how long one generation may run.
 *
 * The speed rule above stops a car creeping forever, but a slow car that keeps
 * just above the threshold can still hold a generation open for minutes while
 * everything interesting has already finished. Survivors are retired at the
 * cap and scored on what they actually achieved.
 */
export const MAX_GENERATION_SECONDS = 90;
export const MAX_GENERATION_FRAMES = MAX_GENERATION_SECONDS * PHYSICS_HZ;

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
