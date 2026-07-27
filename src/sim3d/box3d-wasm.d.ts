/**
 * box3d-wasm ships no TypeScript declarations. The shapes this project relies
 * on are described in `box3d.ts`; this only tells the compiler the modules
 * exist and hand back an initialiser.
 */
declare module 'box3d-wasm' {
  const factory: () => Promise<unknown>;
  export default factory;
}

declare module 'box3d-wasm/standard' {
  const factory: () => Promise<unknown>;
  export default factory;
}
