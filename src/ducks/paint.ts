/**
 * The ducks' paint, before light: what colour each part is at each point of
 * its own frame (vLocal, x toward the bill, y up). Gouache-flat fields with
 * soft internal gradients and a little pigment grain, no gloss.
 *
 * uLook: x = how dark a duckling's cap of fluff is, y = warmth, z = wetness.
 */
export const DUCK_ALBEDO_GLSL = /* glsl */ `
vec3 grain(vec3 c, float scale) { return c * (0.95 + 0.08 * vnoise3(vLocal * scale + uSeed)); }

vec3 eyePaint(inout float keep, vec3 toward) {
  float cl = smoothstep(0.84, 0.94, dot(vNormalL, normalize(toward)));
  keep = 0.7;
  return mix(srgb(vec3(0.07, 0.06, 0.06)), vec3(1.0), cl);
}

// --- mother -------------------------------------------------------------------
vec3 motherAlbedo(inout float alpha, inout float softness, inout float keep, vec3 N) {
  vec3 p = vLocal;
  vec3 cream = srgb(vec3(0.96, 0.92, 0.84));
  vec3 buff = srgb(vec3(0.82, 0.66, 0.48));
  vec3 brown = srgb(vec3(0.64, 0.46, 0.31));
  if (uPart < 10.5) {
    // cream chest and sides; folded wings painted on as warm brown teardrops
    // with cream-edged tips and a small teal mirror; a buff saddle between them
    vec3 c = cream * (1.0 - 0.04 * smoothstep(0.0, 0.2, p.y));
    float wx = clamp((0.14 - p.x) / 0.5, 0.0, 1.0);
    float wHalf = 0.078 * sin(3.1416 * pow(wx, 0.7)) + 0.01;
    float wCentre = 0.125 - 0.04 * wx;
    float wing = smoothstep(0.012, -0.01, abs(abs(p.z) - wCentre) - wHalf) * smoothstep(0.06, 0.12, p.y) * step(p.x, 0.15);
    vec3 wingCol = mix(brown, mix(brown, cream, 0.3), wx * 0.6) * (0.94 + 0.1 * vnoise(p.xz * 28.0));
    float tips = smoothstep(0.75, 0.95, sin(p.x * 46.0 + abs(p.z) * 16.0)) * smoothstep(0.45, 0.8, wx);
    wingCol = mix(wingCol, cream, tips * 0.4);
    float mirror = smoothstep(0.03, 0.0, length(vec2((p.x + 0.12) * 0.8, abs(p.z) - wCentre - wHalf * 0.4)));
    wingCol = mix(wingCol, srgb(vec3(0.33, 0.56, 0.64)), mirror * 0.7);
    c = mix(c, wingCol, wing);
    float saddle = smoothstep(0.17, 0.24, p.y) * smoothstep(0.12, -0.15, p.x) * (1.0 - wing);
    c = mix(c, buff, saddle * 0.8);
    float scal = smoothstep(0.7, 0.95, sin(p.x * 60.0 + abs(p.z) * 30.0) * sin(p.z * 50.0));
    c *= 1.0 - scal * 0.04 * smoothstep(0.1, 0.2, p.y);
    c = mix(c, c * 1.04, uFluff);
    softness = 0.45;
    keep = 0.3;
    return grain(c, 50.0);
  }
  if (uPart < 11.5) {
    // warm brown head, darker crown, paler throat and cheek, a soft eye stripe
    vec3 c = mix(brown, buff, 0.25);
    c = mix(c, brown * 0.82, smoothstep(0.06, 0.13, p.y));
    c = mix(c, mix(buff, cream, 0.5), smoothstep(-0.08, -0.16, p.y) * smoothstep(-0.02, 0.06, p.x));
    c = mix(c, c * 0.74, smoothstep(0.016, 0.0, abs(p.y - 0.02 - (p.x - 0.05) * 0.2)) * step(-0.08, p.x) * 0.6);
    softness = 0.3;
    return grain(c, 70.0);
  }
  if (uPart < 12.5) {
    vec3 c = srgb(vec3(0.96, 0.62, 0.32));
    c = mix(c, srgb(vec3(0.6, 0.4, 0.28)), smoothstep(0.13, 0.15, p.x) * 0.6);
    softness = 0.3;
    keep = 0.2;
    return c;
  }
  if (uPart < 13.5) {
    vec3 c = mix(brown, mix(brown, cream, 0.35), smoothstep(0.0, -0.3, p.x)) * (0.95 + 0.08 * vnoise(p.xz * 30.0));
    float tips = smoothstep(0.7, 0.95, sin(p.x * 48.0 + abs(p.z) * 18.0));
    c = mix(c, cream, tips * smoothstep(-0.16, -0.3, p.x) * 0.35);
    float mirror = smoothstep(0.035, 0.0, length(vec2(p.x + 0.17, (abs(p.z) - 0.06) * 0.7)));
    c = mix(c, srgb(vec3(0.33, 0.56, 0.64)), mirror * 0.7);
    softness = 0.3;
    return grain(c, 60.0);
  }
  if (uPart < 14.5) return eyePaint(keep, vec3(0.4, 0.85, 0.0));
  softness = 0.4;
  keep = 0.25;
  return srgb(vec3(0.96, 0.6, 0.31));
}

// --- duckling -----------------------------------------------------------------
vec3 ducklingAlbedo(inout float alpha, inout float softness, inout float keep, vec3 N) {
  vec3 p = vLocal;
  vec3 yellow = mix(srgb(vec3(1.0, 0.9, 0.55)), srgb(vec3(1.0, 0.87, 0.48)), uLook.y);
  vec3 pale = srgb(vec3(1.0, 0.95, 0.74));
  vec3 cap = mix(srgb(vec3(0.9, 0.76, 0.42)), srgb(vec3(0.74, 0.62, 0.38)), uLook.x);
  float capAmt = 0.25 + 0.45 * uLook.x;
  vec3 c;
  if (uPart < 20.5) {
    // body: yellow, a darker cap of fluff along the back, a pale tummy
    c = yellow;
    float back = smoothstep(0.08, 0.14, p.y + (vnoise(p.xz * 30.0) - 0.5) * 0.03) * smoothstep(0.08, -0.06, p.x);
    c = mix(c, cap, back * capAmt);
    c = mix(c, pale, smoothstep(0.0, -0.05, p.y) * 0.7);
    c *= 0.94 + 0.1 * vnoise3(p * 60.0 + uSeed);
    softness = 0.5;
    keep = 0.35;
  } else if (uPart < 21.5) {
    // head: a darker crown, pale cheeks, the faintest eye stripe
    c = yellow;
    float crown = smoothstep(0.035, 0.07, p.y + (vnoise(p.xz * 40.0) - 0.5) * 0.02) * smoothstep(0.07, -0.02, p.x);
    c = mix(c, cap, crown * capAmt);
    float cheek = smoothstep(0.035, 0.0, length(vec2(p.x - 0.03, p.y + 0.02))) * smoothstep(0.03, 0.07, abs(p.z));
    c = mix(c, pale, smoothstep(-0.01, -0.06, p.y) * 0.6 + cheek * 0.3);
    float stripe = smoothstep(0.008, 0.0, abs(p.y - 0.006 + (p.x - 0.02) * 0.15)) * smoothstep(0.03, -0.03, p.x) * step(0.04, abs(p.z));
    c = mix(c, cap * 0.9, stripe * 0.35 * capAmt);
    c *= 0.95 + 0.08 * vnoise3(p * 70.0 + uSeed);
    softness = 0.5;
    keep = 0.35;
  } else if (uPart < 22.5) {
    c = mix(srgb(vec3(0.95, 0.63, 0.34)), srgb(vec3(0.84, 0.52, 0.30)), smoothstep(0.06, 0.085, p.x) * 0.6);
    softness = 0.35;
    keep = 0.25;
    return c;
  } else if (uPart < 23.5) {
    c = mix(yellow, cap, capAmt * 0.6) * (0.95 + 0.08 * vnoise(p.xz * 60.0));
    softness = 0.45;
    keep = 0.3;
  } else if (uPart < 24.5) {
    return eyePaint(keep, vec3(0.45, 0.8, 0.0));
  } else if (uPart < 25.5) {
    softness = 0.4;
    keep = 0.25;
    return srgb(vec3(0.97, 0.62, 0.33));
  } else {
    c = mix(yellow, cap, 0.55 * capAmt + 0.2);
    softness = 0.5;
    keep = 0.3;
  }
  // wet fluff after a swim: a little darker and more saturated
  c = mix(c, c * vec3(0.9, 0.86, 0.72), uLook.z * 0.6);
  return c;
}

vec3 duckAlbedo(inout float alpha, inout float softness, inout float keep, vec3 N) {
  if (uPart < 19.5) return motherAlbedo(alpha, softness, keep, N);
  return ducklingAlbedo(alpha, softness, keep, N);
}
`;
