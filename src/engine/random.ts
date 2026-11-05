export function randomFromSeed(seed: string): () => number {
  let state = 2166136261;

  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixedValue = Math.imul(state ^ (state >>> 15), 1 | state);
    mixedValue ^= mixedValue + Math.imul(mixedValue ^ (mixedValue >>> 7), 61 | mixedValue);

    return ((mixedValue ^ (mixedValue >>> 14)) >>> 0) / 4294967296;
  };
}
