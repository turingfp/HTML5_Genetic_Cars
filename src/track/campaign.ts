/**
 * A handful of tracks worth driving, so the first thing you see is a choice
 * rather than a blank slider.
 *
 * Each one isolates a problem. That is the point of designing tracks at all:
 * on a single kind of terrain you can never ask whether a car that climbs also
 * jumps, because there is nothing to ask it with. Here you can put the same
 * population on The Long Haul and on Leap Of Faith and watch two completely
 * different body plans win.
 *
 * These are ordinary specs, so anything here can be opened in the editor,
 * changed, and shared as a code like any other.
 */

import { normaliseSpec, type TrackSpec } from './spec';

export interface CampaignTrack {
  name: string;
  /** One line on what the track is asking of a car. */
  brief: string;
  spec: TrackSpec;
}

/** The built-in tracks, easiest first. */
export const CAMPAIGN: CampaignTrack[] = [
  {
    name: 'First Light',
    brief: 'Gentle and short. Almost anything with two wheels finishes.',
    spec: normaliseSpec({ seed: 'firstlight', tiles: 90, hills: 0.45, bank: 0.3, width: 1.4 }),
  },
  {
    name: 'The Climb',
    brief: 'The classic course: no tricks, just ground that keeps getting worse.',
    spec: normaliseSpec({ seed: 'classic', tiles: 200, hills: 1, bank: 1, width: 1 }),
  },
  {
    name: 'Leap Of Faith',
    brief: 'Holes everywhere. Speed and a long wheelbase, or nothing.',
    spec: normaliseSpec({ seed: 'leap', tiles: 160, hills: 0.7, gaps: 0.16, width: 1.2 }),
  },
  {
    name: 'Launch Pad',
    brief: 'Ramp after ramp. Cars that survive the landings win.',
    spec: normaliseSpec({ seed: 'launchpad', tiles: 160, hills: 0.6, ramps: 0.2, width: 1.3 }),
  },
  {
    name: 'Tightrope',
    brief: 'A narrow, heavily cambered road. Wide and low, or over the edge.',
    // Brutal but drivable: measured at 30.6m against 50.5m for a gentler
    // version of the same track, so it is about twice as hard and not a wall.
    spec: normaliseSpec({ seed: 'tightrope', tiles: 150, hills: 0.8, bank: 1.9, width: 0.4 }),
  },
  {
    name: 'The Long Haul',
    brief: 'Six hundred tiles. Nothing here is hard; finishing it is.',
    spec: normaliseSpec({ seed: 'longhaul', tiles: 600, hills: 0.8, bank: 0.8, width: 1.1 }),
  },
  {
    name: 'Everything At Once',
    brief: 'Steep, gapped, ramped, narrow and banked. Probably unfinishable.',
    spec: normaliseSpec({
      seed: 'everything',
      tiles: 300,
      hills: 1.7,
      ramps: 0.12,
      gaps: 0.1,
      bank: 1.6,
      width: 0.7,
    }),
  },
];
