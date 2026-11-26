type Vec3 = [number, number, number];
type Gradient = [time: number, ...channels: number[]][];
type CurveKey = [number, number, number | null, number | null];
type KeyedCurve = { scale: number; keys: CurveKey[] };
type Curve = number | [number, number] | [KeyedCurve];

export interface ParticleEmitter {
  delay: number;
  speed: number;
  life: [number, number];
  size: [number, number];
  rate: number;
  limit: number;
  duration: number;
  loop: boolean;
  world: boolean;
  ring: number;
  ringRange: [number, number];
  bursts: [time: number, count: Curve, cycles: number, interval: number, probability: number][];
  startSpeed: Curve;
  gravity: Curve;
  rotation: [Curve, Curve, Curve];
  rgb?: Gradient;
  alpha?: Gradient;
  minColor?: number[];
  sizeOverLife?: Curve[];
  spin?: Curve;
  spinXY?: [Curve, Curve];
  shape?: { kind: number; radius: number; thickness: number; coneAngle: number; arc: number; scale: Vec3;
    position: Vec3; rotation: Vec3; randomDirection: number; sphericalDirection: number };
  velocity?: [Curve, Curve, Curve];
  velocityModifier?: Curve;
  velocityWorld?: boolean;
  velocityLimit?: { axes: [Curve, Curve, Curve] | null; magnitude: Curve; dampen: number; drag: Curve };
  noise?: { strength: Curve; frequency: number; scroll: Curve; position: Curve; rotation: Curve; size: Curve };
  custom?: Curve[];
  tiles?: [columns: number, rows: number, framesFraction: number];
  flipbook?: { frame: Curve; start: Curve; cycles: number; row: number | null; randomRow: boolean };
  trail?: { life: Curve; width: Curve; ratio: number; minDistance: number };
}

export interface ParticleSample {
  color: number[];
  size: Vec3;
  rotation: Vec3;
  position: Vec3;
  velocity: Vec3;
  emittedAt: number;
  uv?: [number, number, number, number];
  custom1?: number[];
}

const tau = Math.PI * 2;

const interpolate = (from: number, to: number, fraction: number) => from + (to - from) * fraction;

function sampleSegment([start, from, , outSlope]: CurveKey, [end, to, inSlope]: CurveKey, at: number): number {
  if (outSlope === null || inSlope === null) return from;
  const t = (at - start) / (end - start);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * (end - start) * outSlope
    + (-2 * t3 + 3 * t2) * to + (t3 - t2) * (end - start) * inSlope;
}

export function evaluateCurve(curve: Curve | undefined, at: number, random = 0, fallback = 0): number {
  if (curve === undefined) return fallback;
  if (typeof curve === 'number') return curve;
  if (typeof curve[0] === 'number') return interpolate(curve[0], curve[1] as number, random);
  const { scale, keys } = curve[0];
  const first = keys[0];
  if (!first) return 0;
  const upper = keys.findIndex(([time]) => time > at);
  if (upper < 0) return keys.at(-1)![1] * scale;
  if (upper === 0) return first[1] * scale;
  return scale * sampleSegment(keys[upper - 1]!, keys[upper]!, at);
}

function integratedCurve({ scale, keys }: KeyedCurve, end: number): number {
  const first = keys[0];
  if (!first) return 0;
  let area = first[1] * Math.max(0, Math.min(end, first[0]));
  for (let index = 1; index < keys.length; index++) {
    const left = keys[index - 1]!, right = keys[index]!;
    const start = Math.max(0, left[0]), stop = Math.min(end, right[0]);
    if (stop <= start) continue;
    // Simpson's rule integrates a Hermite cubic exactly within each knot interval.
    area += (stop - start) / 6 * (sampleSegment(left, right, start) + 4 * sampleSegment(left, right, (start + stop) / 2)
      + sampleSegment(left, right, stop));
  }
  const last = keys.at(-1)!;
  area += last[1] * Math.max(0, end - Math.max(0, last[0]));
  return area * scale;
}

function rotationOffset(curve: Curve | undefined, elapsed: number, life: number, ring: number,
  [loopStart, loopEnd]: [number, number], random: number): number {
  if (curve === undefined) return 0;
  if (typeof curve === 'number') return curve * elapsed;
  if (typeof curve[0] === 'number') return interpolate(curve[0], curve[1] as number, random) * elapsed;
  const phase = elapsed / life;
  if (ring !== 2 || phase <= 1 || loopEnd <= loopStart) return life * integratedCurve(curve[0], phase);
  const span = loopEnd - loopStart;
  const passed = phase - 1;
  const beforeLoop = integratedCurve(curve[0], loopStart);
  const cycle = integratedCurve(curve[0], loopEnd) - beforeLoop;
  const remainder = integratedCurve(curve[0], loopStart + passed % span) - beforeLoop;
  return life * (integratedCurve(curve[0], 1) + Math.floor(passed / span) * cycle + remainder);
}

function gradient(keys: Gradient | undefined, time: number): number[] {
  if (!keys?.length) return [1, 1, 1];
  const upper = keys.findIndex(([at]) => at > time);
  if (upper < 0) return keys.at(-1)!.slice(1);
  if (upper === 0) return keys[0]!.slice(1);
  const [start, ...from] = keys[upper - 1]!;
  const [end, ...to] = keys[upper]!;
  return from.map((value, index) => interpolate(value, to[index]!, (time - start) / (end - start)));
}

// Source prefabs use Unity Auto Random Seed. Local sampling does not advance the battle RNG.
function particleRandom(instance: number, emitter: number, particle: number, property: number): number {
  const seed = Math.imul(instance + 1, 1597334677) ^ Math.imul(emitter + 1, 2246822519)
    ^ Math.imul(particle + 1, 3266489917) ^ Math.imul(property + 1, 668265263);
  const mixed = Math.imul(seed ^ (seed >>> 16), 2146121005);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296;
}

function rotate(v: Vec3, rotation: Vec3): Vec3 {
  const [x, y, z] = rotation;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // Unity Quaternion.Euler applies its Z, X and Y rotations in this order.
  const a = v[0] * cz - v[1] * sz, b = v[0] * sz + v[1] * cz;
  const c = b * sx + v[2] * cx;
  return [a * cy + c * sy, b * cx - v[2] * sx, c * cy - a * sy];
}

export function rotationAxes(rotation: Vec3): [Vec3, Vec3, Vec3] {
  return [rotate([1, 0, 0], rotation), rotate([0, 1, 0], rotation), rotate([0, 0, 1], rotation)];
}

function shapeAt(shape: ParticleEmitter['shape'], random: (property: number) => number): { position: Vec3; direction: Vec3 } {
  if (!shape) return { position: [0, 0, 0], direction: [0, 0, 1] };
  const phi = random(2) * shape.arc * Math.PI / 180;
  const radius = shape.radius * Math.sqrt(interpolate((1 - shape.thickness) ** 2, 1, random(3)));
  const tilt = Math.acos(2 * random(4) - 1);
  const sphere: Vec3 = [Math.cos(phi) * Math.sin(tilt), Math.sin(phi) * Math.sin(tilt), Math.cos(tilt)];
  let position: Vec3, direction: Vec3;
  if (shape.kind === 5) {
    position = [random(2) - .5, random(3) - .5, random(4) - .5];
    direction = [0, 0, 1];
  } else if (shape.kind === 0) {
    const sphereRadius = shape.radius * Math.cbrt(interpolate((1 - shape.thickness) ** 3, 1, random(3)));
    position = [sphereRadius * sphere[0], sphereRadius * sphere[1], sphereRadius * sphere[2]];
    direction = sphere;
  } else {
    const angle = shape.coneAngle * Math.PI / 180 * (shape.radius ? radius / shape.radius : 0);
    position = [Math.cos(phi) * radius, Math.sin(phi) * radius, 0];
    direction = [Math.cos(phi) * Math.sin(angle), Math.sin(phi) * Math.sin(angle), Math.cos(angle)];
  }
  const euler = shape.rotation.map((degrees) => degrees * Math.PI / 180) as Vec3;
  direction = direction.map((value, axis) => interpolate(value, sphere[axis]!, shape.randomDirection)) as Vec3;
  if (shape.sphericalDirection) {
    const length = Math.hypot(...position) || 1;
    direction = direction.map((value, axis) => interpolate(value, position[axis]! / length, shape.sphericalDirection)) as Vec3;
  }
  return { position: rotate(position.map((value, axis) => value * shape.scale[axis]!) as Vec3, euler)
    .map((value, axis) => value + shape.position[axis]!) as Vec3, direction: rotate(direction, euler) };
}

function particleBirths(source: ParticleEmitter, time: number, instance: number, emitter: number) {
  const cycle = source.loop ? Math.floor(time / source.duration) : 0;
  const longest = Math.max(...source.life);
  const firstCycle = Math.max(0, cycle - Math.ceil(2 * longest / source.duration));
  const alive: { index: number; birth: number; life: number }[] = [];
  for (let i = firstCycle; i <= cycle; i++) {
    const start = i * source.duration;
    const emissions: { index: number; birth: number }[] = [];
    for (const [group, [offset, count, repeats, interval, chance]] of source.bursts.entries()) {
      for (let repeat = 0; repeat < repeats; repeat++) {
        const birth = start + offset + interval * repeat;
        const key = i * 1_000_000 + group * 10_000 + repeat * 100;
        const roll = particleRandom(instance, emitter, key, 31);
        const countHere = Math.round(evaluateCurve(count, birth, roll));
        if (birth > time + 1e-6 || roll > chance || (!source.ring && birth + 2 * longest < time)) continue;
        for (let particle = 0; particle < countHere; particle++) emissions.push({ index: key + particle, birth });
      }
    }
    if (source.rate) {
      const through = Math.min(Math.floor((time - start + 1e-6) * source.rate), Math.ceil(source.duration * source.rate) - 1);
      const first = Math.max(1, Math.ceil((time - start - 2 * longest) * source.rate));
      for (let tick = first; tick <= through; tick++) emissions.push({ index: i * 1_000_000 + 500_000 + tick, birth: start + tick / source.rate });
    }
    emissions.sort((a, b) => a.birth - b.birth);
    for (const { index, birth } of emissions) {
      const life = interpolate(...source.life, particleRandom(instance, emitter, index, 0));
      if (!source.ring) {
        for (let j = alive.length - 1; j >= 0; j--) if (alive[j]!.birth + alive[j]!.life <= birth) alive.splice(j, 1);
        if (alive.length === source.limit) continue;
      } else if (alive.length === source.limit) alive.shift();
      alive.push({ index, birth, life });
    }
  }
  return alive.filter(({ birth, life }) => source.ring || birth + life > time);
}

export function particleSamples(source: ParticleEmitter, baseColor: number[], seconds: number, instance: number, emitter: number): ParticleSample[] {
  const time = seconds * source.speed - source.delay;
  if (time < -1e-6 || !source.limit) return [];
  return particleBirths(source, Math.max(0, time), instance, emitter).map(({ index, birth, life }) => {
    const random = (property: number) => particleRandom(instance, emitter, index, property);
    const elapsed = Math.max(0, time - birth);
    const [loopStart, loopEnd] = source.ringRange;
    const loopSpan = Math.max(0.00001, (loopEnd - loopStart) * life);
    const age = source.ring === 2 && elapsed >= life
      ? loopStart * life + (elapsed - life) % loopSpan : Math.min(elapsed, life);
    const normalized = age / life;
    const tint = gradient(source.rgb, normalized);
    const alpha = gradient(source.alpha, normalized)[0]!;
    const startingSize = interpolate(...source.size, random(1));
    const shape = shapeAt(source.shape, random);
    const spawnSpeed = evaluateCurve(source.startSpeed, 0, random(5));
    const gravity = evaluateCurve(source.gravity, normalized, random(6)) * -9.81;
    const velocity = shape.direction.map((dir, axis) => dir * spawnSpeed +
      evaluateCurve(source.velocity?.[axis], normalized, random(axis + 7))) as Vec3;
    const speedModifier = evaluateCurve(source.velocityModifier, normalized, 0, 1);
    for (let axis = 0; axis < 3; axis++) velocity[axis] = velocity[axis]! * speedModifier;
    const limiter = source.velocityLimit;
    if (limiter) {
      const magnitude = Math.hypot(...velocity);
      const limit = evaluateCurve(limiter.magnitude, normalized);
      const dampen = (v: number, max: number) => Math.abs(v) <= max ? v : Math.sign(v) * interpolate(Math.abs(v), max, limiter.dampen);
      if (limiter.axes) {
        for (let axis = 0; axis < 3; axis++) velocity[axis] = dampen(velocity[axis]!, evaluateCurve(limiter.axes[axis], normalized));
      } else if (magnitude > limit && magnitude > 0) {
        for (let axis = 0; axis < 3; axis++) velocity[axis] = velocity[axis]! * dampen(magnitude, limit) / magnitude;
      }
    }
    const drag = Math.max(0, evaluateCurve(limiter?.drag, normalized));
    const travel = drag ? (1 - Math.exp(-drag * age)) / drag : age;
    const noise = source.noise;
    const jitter = noise ? Math.sin((time * evaluateCurve(noise.scroll, normalized) + random(9)) * tau * noise.frequency)
      * evaluateCurve(noise.strength, normalized) : 0;
    const position = shape.position.map((value, axis) => value + velocity[axis]! * travel
      + (axis === 1 ? gravity * age * age / 2 : 0)
      + (axis < 2 && noise ? jitter * evaluateCurve(noise.position, normalized) : 0)) as Vec3;
    // Ring retention still governs position, tint and UV. Keep advancing the rendered rotation
    // while the original model owns the particle, with the source angular-velocity curve.
    const spin = (curve: Curve | undefined, property: number) =>
      rotationOffset(curve, elapsed, life, source.ring, source.ringRange, random(property));
    const rotation: Vec3 = [
      evaluateCurve(source.rotation[0], normalized, random(11)) + spin(source.spinXY?.[0], 17),
      evaluateCurve(source.rotation[1], normalized, random(12)) + spin(source.spinXY?.[1], 18),
      evaluateCurve(source.rotation[2], normalized, random(13)) + spin(source.spin, 19)
        + (noise ? jitter * evaluateCurve(noise.rotation, normalized) : 0),
    ];
    const size = [0, 1, 2].map((axis) => startingSize * Math.max(0,
      evaluateCurve(source.sizeOverLife?.[axis] ?? source.sizeOverLife?.[0], normalized, 0, 1)
      + (noise ? jitter * evaluateCurve(noise.size, normalized) : 0))) as Vec3;
    const sample: ParticleSample = {
      color: baseColor.map((value, i) => (source.minColor ? interpolate(source.minColor[i]!, value, random(14)) : value) *
        (i === 3 ? alpha : tint[i]!)),
      size, rotation, position, velocity, emittedAt: (birth + source.delay) / source.speed,
    };
    if (source.custom) sample.custom1 = source.custom.map((component) => evaluateCurve(component, normalized));
    if (source.tiles && source.flipbook) {
      const [columns, rows] = source.tiles;
      const { frame, start, cycles, row, randomRow } = source.flipbook;
      const playhead = evaluateCurve(frame, normalized, random(15)) * cycles + evaluateCurve(start, normalized);
      const phase = playhead - Math.floor(playhead);
      const frameCount = row !== null || randomRow ? columns : rows * columns;
      const sheetIndex = Math.floor(phase * frameCount);
      const rowIndex = row ?? (randomRow ? Math.floor(random(16) * rows) : Math.floor(sheetIndex / columns));
      sample.uv = [1 / columns, 1 / rows, (sheetIndex % columns) / columns, (rows - 1 - rowIndex) / rows];
    }
    return sample;
  });
}
