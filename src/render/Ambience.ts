import { Rng } from '../simulation/Rng.js';

/**
 * The town's ambient sound (SPEC.md 2.12, decision 40): four beds synthesised
 * with Web Audio, no audio files. Dawn birds, the street and the sea by day,
 * rain, and insects at night, crossfaded by the hour the picture shows and by
 * the rain. Muted until the viewer turns it on, which is also the gesture the
 * browser needs before it lets a page make a sound. No event sounds.
 */

export type Bed = 'birds' | 'street' | 'rain' | 'insects';

export type BedLevels = Record<Bed, number>;

/** How loud the whole ambience is when it is on. */
const MASTER_LEVEL = 0.55;
/** Seconds a bed takes to follow a change of hour or weather. */
const CROSSFADE_SECONDS = 1.2;
/** How far ahead the chirps and passing cars are scheduled, and how often. */
const LOOKAHEAD_SECONDS = 0.6;
const SCHEDULE_EVERY_MS = 200;

/**
 * How loud each bed is at a minute of the day, 0 to 1, with `rain` from 0 to
 * 1. Rain thins out the birds and the insects and puts its own bed over the
 * street.
 */
export function bedLevels(minute: number, rain: number): BedLevels {
  const dry = 1 - rain;
  const birds =
    ramp(minute, 4 * 60 + 45, 5 * 60 + 30) * (1 - ramp(minute, 7 * 60 + 30, 9 * 60)) +
    0.25 * ramp(minute, 7 * 60 + 30, 9 * 60) * (1 - ramp(minute, 17 * 60, 19 * 60));
  const street = ramp(minute, 6 * 60 + 30, 8 * 60) * (1 - ramp(minute, 19 * 60, 21 * 60));
  const insects = Math.max(ramp(minute, 19 * 60 + 30, 21 * 60), 1 - ramp(minute, 4 * 60, 5 * 60));
  return {
    birds: birds * (1 - 0.85 * rain),
    street: street * (0.5 + 0.5 * dry),
    rain,
    insects: insects * (1 - 0.75 * rain),
  };
}

/** 0 before `from`, 1 after `to`, a straight line in between. */
function ramp(minute: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (minute - from) / (to - from)));
}

export class Ambience {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private beds: Record<Bed, GainNode> | undefined;
  private timer: number | undefined;
  private muted = true;
  private hidden = false;
  private levels: BedLevels = { birds: 0, street: 0, rain: 0, insects: 0 };
  private nextBirdPhrase = 0;
  private nextCar = 0;
  /** Each cricket's gate, and when its next chirp is due. */
  private readonly crickets: Array<{ gate: GainNode; next: number }> = [];
  private readonly rng = new Rng('ambience');

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Turns the sound on or off. The first time on builds the audio graph; it
   * has to come from a click or a tap, or the browser keeps it silent.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted && !this.context) {
      this.build();
    }
    this.applyRunning();
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER_LEVEL,
        this.context.currentTime,
        muted ? 0.08 : 0.5,
      );
    }
  }

  /** Silent while the page is hidden (SPEC.md 2.12), back on when it returns. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyRunning();
  }

  /** Follows the hour the picture shows and the rain, once a frame. */
  update(minute: number, rain: number): void {
    this.levels = bedLevels(minute, rain);
    if (!this.context || !this.beds || this.muted) {
      return;
    }
    const now = this.context.currentTime;
    for (const bed of Object.keys(this.beds) as Bed[]) {
      this.beds[bed].gain.setTargetAtTime(this.levels[bed], now, CROSSFADE_SECONDS);
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    void this.context?.close();
    this.context = undefined;
  }

  private applyRunning(): void {
    if (!this.context) {
      return;
    }
    if (this.muted || this.hidden) {
      void this.context.suspend();
    } else {
      void this.context.resume();
    }
  }

  // --- The audio graph --------------------------------------------------------

  private build(): void {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    const context = new AudioContextClass();
    this.context = context;
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;

    const bed = (): GainNode => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      return gain;
    };
    this.beds = { birds: bed(), street: bed(), rain: bed(), insects: bed() };

    const white = noiseBuffer(context, 'white', this.rng);
    const brown = noiseBuffer(context, 'brown', this.rng);
    this.buildRain(context, this.beds.rain, white, brown);
    this.buildStreet(context, this.beds.street, brown);
    this.buildInsects(context, this.beds.insects, brown);

    this.timer = window.setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
  }

  /** Rain: a broad hiss over a low rumble, with a slow swell. */
  private buildRain(
    context: AudioContext,
    out: GainNode,
    white: AudioBuffer,
    brown: AudioBuffer,
  ): void {
    const hiss = loop(context, white);
    const high = filter(context, 'highpass', 450);
    const low = filter(context, 'lowpass', 6500);
    const hissGain = context.createGain();
    hissGain.gain.value = 0.32;
    hiss.connect(high).connect(low).connect(hissGain).connect(out);

    const rumble = loop(context, brown);
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.5;
    rumble
      .connect(filter(context, 'lowpass', 380))
      .connect(rumbleGain)
      .connect(out);
    swell(context, hissGain.gain, 0.32, 0.06, 0.13);
  }

  /** By day: distant traffic, and the sea breaking on the beach below the town. */
  private buildStreet(context: AudioContext, out: GainNode, brown: AudioBuffer): void {
    const traffic = loop(context, brown);
    const trafficGain = context.createGain();
    trafficGain.gain.value = 0.28;
    traffic
      .connect(filter(context, 'lowpass', 320))
      .connect(trafficGain)
      .connect(out);
    this.addSea(context, out, brown, 0.34);
  }

  /** At night: a quieter sea under the crickets, which are scheduled chirps. */
  private buildInsects(context: AudioContext, out: GainNode, brown: AudioBuffer): void {
    this.addSea(context, out, brown, 0.18);
    // Three crickets, each a steady tone gated into chirps by schedule().
    for (const [pitch, pan] of [
      [4300, -0.6],
      [4650, 0.5],
      [4950, 0.05],
    ] as const) {
      const tone = context.createOscillator();
      tone.frequency.value = pitch;
      const gate = context.createGain();
      gate.gain.value = 0;
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      tone.connect(gate).connect(panner).connect(out);
      tone.start();
      this.crickets.push({ gate, next: 0 });
    }
  }

  /** Waves: filtered brown noise whose loudness rises and falls every dozen seconds. */
  private addSea(context: AudioContext, out: GainNode, brown: AudioBuffer, level: number): void {
    const sea = loop(context, brown);
    const gain = context.createGain();
    gain.gain.value = level;
    sea
      .connect(filter(context, 'lowpass', 900))
      .connect(gain)
      .connect(out);
    swell(context, gain.gain, level, level * 0.7, 0.085);
  }

  /** Books the next half second of chirps, crickets and passing cars. */
  private schedule(): void {
    const context = this.context;
    const beds = this.beds;
    if (!context || !beds || context.state !== 'running') {
      return;
    }
    const until = context.currentTime + LOOKAHEAD_SECONDS;
    const { rng } = this;

    // Birds sing more often the louder their bed is.
    if (this.levels.birds > 0.05) {
      if (this.nextBirdPhrase < context.currentTime) {
        this.nextBirdPhrase = context.currentTime + rng.nextFloat(0, 0.3);
      }
      while (this.nextBirdPhrase < until) {
        this.birdPhrase(context, beds.birds, this.nextBirdPhrase);
        this.nextBirdPhrase += rng.nextFloat(0.5, 2.6) / Math.max(0.35, this.levels.birds);
      }
    }

    if (this.levels.insects > 0.05) {
      for (const cricket of this.crickets) {
        if (cricket.next < context.currentTime) {
          cricket.next = context.currentTime + rng.nextFloat(0, 0.5);
        }
        while (cricket.next < until) {
          // Three quick pulses make one chirp.
          for (let pulse = 0; pulse < 3; pulse += 1) {
            const at = cricket.next + pulse * 0.045;
            cricket.gate.gain.setValueAtTime(0, at);
            cricket.gate.gain.linearRampToValueAtTime(0.05, at + 0.008);
            cricket.gate.gain.linearRampToValueAtTime(0, at + 0.024);
          }
          cricket.next += rng.nextFloat(0.55, 0.95);
        }
      }
    }

    if (this.levels.street > 0.05) {
      if (this.nextCar < context.currentTime) {
        this.nextCar = context.currentTime + rng.nextFloat(1, 6);
      }
      while (this.nextCar < until) {
        this.passingCar(context, beds.street, this.nextCar);
        this.nextCar += rng.nextFloat(6, 15);
      }
    }
  }

  /** A few quick falling or rising whistles from one bird, somewhere to one side. */
  private birdPhrase(context: AudioContext, out: GainNode, start: number): void {
    const { rng } = this;
    const panner = context.createStereoPanner();
    panner.pan.value = rng.nextFloat(-0.8, 0.8);
    panner.connect(out);
    const base = rng.nextFloat(2400, 4200);
    const notes = Math.floor(rng.nextFloat(2, 6));
    const falling = rng.chance(0.5);
    let at = start;
    for (let i = 0; i < notes; i += 1) {
      const length = rng.nextFloat(0.05, 0.12);
      const tone = context.createOscillator();
      const from = base * rng.nextFloat(0.9, 1.15);
      tone.frequency.setValueAtTime(falling ? from * 1.3 : from * 0.8, at);
      tone.frequency.exponentialRampToValueAtTime(falling ? from * 0.8 : from * 1.3, at + length);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.07, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0005, at + length);
      tone.connect(gain).connect(panner);
      tone.start(at);
      tone.stop(at + length + 0.02);
      at += length + rng.nextFloat(0.03, 0.12);
    }
  }

  /** A car going by a street away: a swell of rumble that crosses from one side. */
  private passingCar(context: AudioContext, out: GainNode, start: number): void {
    const { rng } = this;
    const length = rng.nextFloat(2.5, 4);
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context, 'brown', rng);
    const band = filter(context, 'bandpass', 260);
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(220, start);
    band.frequency.linearRampToValueAtTime(420, start + length / 2);
    band.frequency.linearRampToValueAtTime(240, start + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.5, start + length / 2);
    gain.gain.linearRampToValueAtTime(0, start + length);
    const panner = context.createStereoPanner();
    const side = rng.chance(0.5) ? 1 : -1;
    panner.pan.setValueAtTime(-0.7 * side, start);
    panner.pan.linearRampToValueAtTime(0.7 * side, start + length);
    source.connect(band).connect(gain).connect(panner).connect(out);
    source.start(start);
    source.stop(start + length);
  }
}

const buffers = new WeakMap<AudioContext, Partial<Record<'white' | 'brown', AudioBuffer>>>();

/** Two seconds of noise, made once per context and looped. */
function noiseBuffer(context: AudioContext, kind: 'white' | 'brown', rng: Rng): AudioBuffer {
  const known = buffers.get(context) ?? {};
  const cached = known[kind];
  if (cached) {
    return cached;
  }
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = rng.nextFloat(-1, 1);
    if (kind === 'white') {
      data[i] = white;
    } else {
      // Brown noise: a random walk, leaking back towards zero.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  known[kind] = buffer;
  buffers.set(context, known);
  return buffer;
}

function loop(context: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

function filter(
  context: AudioContext,
  type: BiquadFilterType,
  frequency: number,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}

/** A slow rise and fall on a gain, `depth` either side of `centre`, `rate` times a second. */
function swell(
  context: AudioContext,
  param: AudioParam,
  centre: number,
  depth: number,
  rate: number,
): void {
  param.value = centre;
  const lfo = context.createOscillator();
  lfo.frequency.value = rate;
  const amount = context.createGain();
  amount.gain.value = depth;
  lfo.connect(amount).connect(param);
  lfo.start();
}
