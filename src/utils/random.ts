function xmur3Hash(str: any) {
  let i = 0;
  let h = 1779033703 ^ str.length;
  for (; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
  }
  h = (h << 13) | (h >>> 19);
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32RNG(a: any, b: any, c: any, d: any) {
  return function () {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export default function getRandomBoolean(userID: any, testName: any) {
  const userIDSeed = xmur3Hash(userID);
  const testSeed = xmur3Hash(testName);
  const rng = sfc32RNG(userIDSeed(), userIDSeed(), testSeed(), testSeed());
  return rng() > 0.5;
}
