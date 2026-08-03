/**
 * Every tunable constant, carried over from the original `cawro.js`.
 *
 * The numbers here define how the simulation *feels*, so they are ported
 * verbatim, including the quirks. Where the original name was misleading
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

/**
 * How hard the population is pushed to stay varied, from 0 to 1.
 *
 * Off by default, so the search behaves as it always has until someone reaches
 * for the slider and watches the gene pool stop collapsing.
 */
export const DEFAULT_DIVERSITY_PRESSURE = 0;
export const MAX_DIVERSITY_PRESSURE = 1;

/** Fresh random cars per generation. Off by default. */
export const DEFAULT_IMMIGRANTS = 0;
export const MAX_IMMIGRANTS = 8;

/**
 * Cars per generation taken from other people in the room.
 *
 * Two by default, which only does anything once you have joined a room: with
 * nobody to take from, the slot breeds a child as usual. Two out of twenty is
 * enough for a foreign lineage to get a foothold and not so many that your own
 * search stops being yours.
 */
export const DEFAULT_MIGRANTS = 2;
export const MAX_MIGRANTS = 8;

/**
 * How far a chassis corner may swing inside its own sector, as a fraction of
 * half a sector.
 *
 * The original pinned all eight corners to fixed compass directions and evolved
 * only their distance from the centre, and four of the eight were pinned to an
 * axis so they had one free number rather than two. Every car was therefore the
 * same octagon with different radii. Letting a corner rotate within its sector
 * keeps the corners in order, so the fan of triangles stays convex, while
 * opening up wedges, slivers and long snouts that the old scheme could not
 * describe. Kept below 1 so two neighbours can never cross over.
 */
export const SPOKE_ANGLE_JITTER = 0.8;

/** Wheels per car. The original had exactly two. */
export const MIN_WHEEL_COUNT = 2;
export const MAX_WHEEL_COUNT = 4;

/** 8 chassis axes + 2 wheel radii + 2 wheel densities + 2 wheel attachments. */
export const GENE_COUNT = 14;

/* ── Body materials ─────────────────────────────────────────────────────── */

/**
 * Chassis density. Was a constant shared by every car; it is now a gene, so
 * where the mass sits relative to the wheels is something evolution can choose.
 * The old constant of 80 sits inside the range.
 */
export const CHASSIS_DENSITY_MIN = 25;
export const CHASSIS_DENSITY_RANGE = 115;
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
 * surface no longer a function of x. That breaks the terrain fill, the visible
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

/**
 * How far past the edge a car may stray before it counts as gone.
 *
 * Measured from the road's own edge, not from a fixed distance from the
 * centre. Road width is a track knob now, and a constant tied to the default
 * width was wrong at both ends: on a wide road it killed cars that were still
 * comfortably on the tarmac, and on a narrow one it let a car wander several
 * road widths into space before noticing.
 */
export const FALL_OFF_MARGIN = 2.5;
export const FALL_OFF_DEPTH = 8;

/** The limit for a road of a given half-width. */
export function fallOffLateral(halfWidth: number): number {
  return halfWidth + FALL_OFF_MARGIN;
}

/**
 * Physics sub-steps per step for Box3D's solver.
 *
 * Eight rather than four, because at four the wheel joints came apart. Box3D's
 * revolute joint is a soft constraint, and a hard landing generates a contact
 * impulse it cannot hold: measured over 20 generations on three seeds, a wheel
 * reached 28.7 metres from its chassis and stayed past any legitimate reach for
 * up to half a second. On screen that is a car exploding and reassembling,
 * which is what it looked like.
 *
 * Doubling the sub-steps cuts the broken frames by five to nine times (1.26% of
 * wheel-frames to 0.14% on the worst seed) and roughly halves the peak stretch.
 * It costs about 1.7x the physics time, which is the honest price: max mode
 * covers less ground per second than it did.
 */
export const SUB_STEP_COUNT = 8;

/**
 * Torque budget per wheel, as a multiple of what it takes to push the car's
 * own weight along at that wheel's radius.
 *
 * The force a wheel puts down is torque over radius, so a torque budget has to
 * scale *with* radius to mean the same thing on a small wheel as a large one.
 * The first version divided by radius instead, which handed a 0.2m wheel five
 * thousand newton-metres: far more than its contact patch could ever transmit,
 * and enough to tear its own hinge open. Wheels were ending up 28 metres from
 * the chassis and taking half a second to snap back, which on screen is a car
 * exploding and reassembling.
 *
 * Five, because that is roughly what the old formula gave a mid-sized wheel,
 * so ordinary cars drive as they did and only the absurd end is cut off.
 */
export const MOTOR_TORQUE_LIMIT = 5;

/**
 * How far above the road a car may be and still be worth pointing the camera
 * at.
 *
 * Generous enough to keep following a real jump, which measures up to about
 * seven metres for the car in front, and short of the height a car reaches
 * once it has gone over an edge and is on its way down.
 */
export const LEADER_AIR_LIMIT = 8;

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
 * every few seconds and never died, so one of them could hold up a whole
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

/**
 * End a generation once the population as a whole stops getting anywhere.
 *
 * The per-car speed rule only asks that each car keeps gaining its *own* new
 * ground, which a pack of slow cars can satisfy indefinitely while the furthest
 * point reached never moves. Measured on one track, a 3D generation ran the
 * full 90 second cap with its last real progress at 9 seconds, so eighty seconds
 * of watching nothing happen. This ends the round shortly after the frontier
 * stops advancing, which is the moment the round stopped being interesting.
 */
export const STALL_SECONDS = 6;
export const STALL_FRAMES = STALL_SECONDS * PHYSICS_HZ;

/** Progress smaller than this does not count as the frontier advancing. */
export const PROGRESS_EPSILON = 0.05;

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

/** Thickness of the road slab colliders, below the drawn surface. */
export const ROAD_THICKNESS = 0.6;
