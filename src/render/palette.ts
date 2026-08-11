/**
 * The interface's palette: race control.
 *
 * The page is a pit-wall timing system. Near-black ground, square corners,
 * off-white figures, and the colour language every motorsport timing screen
 * already taught people to read: purple is the session best, green is an
 * improvement, white is current, grey is out. That grammar maps onto
 * evolution exactly: the leader runs purple, elites run green because their
 * worth is proven, the rest run white until they die grey.
 *
 * Amber is chrome, not data: buttons, alerts, the thing you can press. It
 * never appears inside a figure except to mark the QD-score, which is
 * neither a car nor a fitness.
 *
 * Every canvas renderer takes its colours from here, so the panels cannot
 * drift into three slightly different blacks.
 */

/** Canvas ground inside figures. The page behind them is a step darker. */
export const SURFACE = '#101013';

export const FG = '#e8e6e1';
export const FG_STRONG = 'rgba(232, 230, 225, 0.87)';
export const FG_DIM = 'rgba(232, 230, 225, 0.6)';
export const FG_FAINT = 'rgba(232, 230, 225, 0.35)';
export const RULE = 'rgba(232, 230, 225, 0.13)';

/** Session best: the leader, the record, the fastest anything has ever been. */
export const PURPLE = '#b04df0';
/** Improvement: elites, personal bests, a niche that just got better. */
export const GREEN = '#00c853';
/** Chrome and alerts. The QD-score line borrows it, being neither car nor fitness. */
export const AMBER = '#ffb000';

/** Signed quantities in figures: throttle green, brake red. */
export const POSITIVE_RGB = [0, 200, 83] as const;
export const NEGATIVE_RGB = [255, 69, 58] as const;
