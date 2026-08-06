/**
 * What the machine in front of us can reasonably be asked to do.
 *
 * The 3D mode is the default now, and it is a WebAssembly physics world plus a
 * shadowed three.js scene. That is fine on a laptop and a lot to ask of a
 * phone, so the renderer reads a quality tier from here rather than assuming
 * everyone has a GPU and a fan.
 */

/** Rendering settings scaled to what the device can carry. */
export interface Quality {
  /** True on phones and tablets, where we trade fidelity for frame rate. */
  lowPower: boolean;
  /** Multisampling. Cheap on desktop, not on a mobile GPU. */
  antialias: boolean;
  /** Ceiling on the backing-store scale factor. */
  maxPixelRatio: number;
  /** Shadow map edge, or 0 for no shadows at all. */
  shadowMapSize: number;
}

function matches(query: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * Whether this looks like a phone or tablet.
 *
 * Coarse pointer plus no hover is the honest question ("is this a finger?")
 * and catches iPads, which lie about everything else. The narrow-viewport
 * check is a second chance for browsers that report pointer capabilities
 * badly.
 */
export function isLowPowerDevice(): boolean {
  return (matches('(pointer: coarse)') && matches('(hover: none)')) || matches('(max-width: 820px)');
}

export function detectQuality(): Quality {
  const lowPower = isLowPowerDevice();
  return {
    lowPower,
    antialias: !lowPower,
    // A phone's device pixel ratio is 3 on most recent iPhones. Rendering a
    // shadowed scene at 3x costs nine times the fill rate of 1x for a
    // difference nobody can see at arm's length.
    maxPixelRatio: lowPower ? 1.5 : 2,
    // Shadows stay on: they are what makes the cars sit on the road rather
    // than float above it. A quarter of the map area is the compromise.
    shadowMapSize: lowPower ? 1024 : 2048,
  };
}

/**
 * Whether a WebGL context can actually be created.
 *
 * Worth asking before loading three.js at all: on a device that has run out of
 * graphics contexts the failure otherwise happens deep inside the renderer,
 * after we have already fetched half a megabyte of it.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Hand the context back rather than waiting for garbage collection; the
    // budget for live contexts is small and we are about to want one.
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
