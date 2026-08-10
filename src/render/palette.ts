/**
 * The interface's palette: ink on paper.
 *
 * The page is a lab journal, not a dashboard. Everything printed sits on warm
 * paper in near-black ink, data is drawn the way a journal draws figures, and
 * exactly two colours are allowed to mean something: vermilion for the thing
 * to watch (the leader, the signal, the action), blue for the proven (elites,
 * the archive's line). The 3D world is the one deliberate exception; it stays
 * a dark photographic plate set into the page, because it is not a figure, it
 * is the specimen.
 *
 * Every canvas renderer takes its colours from here, so the page cannot drift
 * into being three slightly different papers.
 */

export const PAPER = '#f3eee2';
export const PAPER_HIGH = '#faf7ee';

export const INK = '#211d16';
export const INK_STRONG = 'rgba(33, 29, 22, 0.85)';
export const INK_DIM = 'rgba(33, 29, 22, 0.6)';
export const INK_FAINT = 'rgba(33, 29, 22, 0.35)';
export const RULE = 'rgba(33, 29, 22, 0.14)';

/** Vermilion: the leader, the action, the thing that changed. */
export const SIGNAL = '#bf3b1b';
/** Blue: elites, and anything whose worth is already proven. */
export const BLUE = '#1d4ed8';
/** Teal: the QD-score, which is neither a car nor a fitness. */
export const TEAL = '#0f766e';

/** Signed quantities in figures: green pushes, vermilion holds back. */
export const POSITIVE_RGB = [37, 109, 59] as const;
export const NEGATIVE_RGB = [191, 59, 27] as const;
