import { Rng } from '../simulation/Rng.js';

import type { BurstKind } from './Fireworks.js';

/**
 * The town's sound (SPEC.md 2.12, decisions 40 and 43), synthesised with Web
 * Audio, no audio files. Dawn birds, the street and the sea by day, insects
 * at night; each weather its own colour on top (gulls in the sun, wind under
 * cloud, rain with drips off the awnings); and on Mid-Autumn night a plucked
 * pentatonic tune and the fireworks, heard after they are seen. Crossfaded by
 * the hour the picture shows and the eased weather. Muted until the viewer
 * turns it on, which is also the gesture a browser needs before it plays.
 */

export type Bed = 'birds' | 'street' | 'gulls' | 'wind' | 'rain' | 'insects' | 'festival';

export type BedLevels = Record<Bed, number>;

/** The weather as the picture shows it, eased: how overcast, and how much rain is falling. */
export interface Sky {
  /** 0 for a clear sky; the App uses 0.7 for Cloudy and 1 for Rain. */
  cloud: number;
  rain: number;
}

/** A firework the ambience should play, already placed relative to the listener. */
export interface FireworkCue {
  kind: 'launch' | 'burst';
  big: boolean;
  burst: BurstKind;
  /** Seconds from the launch to the burst. */
  fuse: number;
  /** Metres from the camera, for the delay and the loudness. */
  distance: number;
  /** -1 left to 1 right. */
  pan: number;
}

/** How loud the whole ambience is when it is on. */
const MASTER_LEVEL = 0.55;
/** Seconds a bed takes to follow a change of hour or weather. */
const CROSSFADE_SECONDS = 1.2;
/** How far ahead the scheduled sounds are booked, and how often. */
const LOOKAHEAD_SECONDS = 0.6;
const SCHEDULE_EVERY_MS = 200;
/** The App's cloud amount for Cloudy: this grey or greyer is fully overcast. */
const CLOUDY_AMOUNT = 0.7;

/** Sound travels this many metres a second, so a far burst is heard late. */
const SPEED_OF_SOUND = 343;
/** A firework this close or closer plays at full loudness; further off it fades. */
const FIREWORK_NEAR_METRES = 80;
/** A salvo past this many bursts in a second is seen but not all heard. */
const MAX_BURSTS_PER_SECOND = 6;

/** D major pentatonic over an octave and a half, the tune's notes. */
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880];
/** The degrees a phrase may come to rest on: D and A. */
const RESTING_DEGREES = [0, 3, 5, 8];

/**
 * How loud each bed is at a minute of the day, 0 to 1. The sun brings more
 * birds and the gulls; cloud brings the wind and fewer birds; rain puts its
 * own bed over the street and quiets the birds and the insects. Mid-Autumn
 * night is its own: the tune and the fireworks over a hushed night.
 */
export function bedLevels(minute: number, sky: Sky, festival = false): BedLevels {
  const night = Math.max(ramp(minute, 19 * 60 + 30, 21 * 60), 1 - ramp(minute, 4 * 60, 5 * 60));
  if (festival) {
    return { birds: 0, street: 0, gulls: 0, wind: 0, rain: 0, insects: 0.45, festival: 1 };
  }
  const { rain } = sky;
  const overcast = Math.min(1, sky.cloud / CLOUDY_AMOUNT);
  const sunny = 1 - overcast;
  const dawn = ramp(minute, 4 * 60 + 45, 5 * 60 + 30) * (1 - ramp(minute, 7 * 60 + 30, 9 * 60));
  const daytime = ramp(minute, 7 * 60 + 30, 9 * 60) * (1 - ramp(minute, 17 * 60, 19 * 60));
  const street = ramp(minute, 6 * 60 + 30, 8 * 60) * (1 - ramp(minute, 19 * 60, 21 * 60));
  return {
    birds: (dawn * (1 - 0.4 * overcast) + daytime * (0.12 + 0.33 * sunny)) * (1 - 0.85 * rain),
    street: street * (1 - 0.45 * rain),
    gulls: street * sunny,
    wind: overcast * (1 - 0.5 * rain),
    rain,
    insects: night * (1 - 0.3 * overcast) * (1 - 0.75 * rain),
    festival: 0,
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
  private levels: BedLevels = bedLevels(0, { cloud: 0, rain: 0 });
  /** Each cricket's gate, and when its next chirp is due. */
  private readonly crickets: Array<{ gate: GainNode; next: number }> = [];
  /** The wind's gusts: how loud it blows and where its whistle sits. */
  private gust: { gain: GainNode; band: BiquadFilterNode } | undefined;
  private nextBirdPhrase = 0;
  private nextCar = 0;
  private nextGull = 0;
  private nextGust = 0;
  private nextDrip = 0;
  private nextNote = 0;
  private phraseLeft = 0;
  private degree = 0;
  private recentBursts: number[] = [];
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

  /** Follows the hour the picture shows, the weather and Mid-Autumn night, once a frame. */
  update(minute: number, sky: Sky, festival: boolean): void {
    this.levels = bedLevels(minute, sky, festival);
    if (!this.context || !this.beds || this.muted) {
      return;
    }
    const now = this.context.currentTime;
    for (const bed of Object.keys(this.beds) as Bed[]) {
      this.beds[bed].gain.setTargetAtTime(this.levels[bed], now, CROSSFADE_SECONDS);
    }
  }

  /**
   * A firework on Mid-Autumn night (decision 43): heard as far behind the
   * flash as the distance says, and fainter the further off it is.
   */
  firework(cue: FireworkCue): void {
    const context = this.context;
    const beds = this.beds;
    if (!context || !beds || this.muted || this.hidden || this.levels.festival < 0.05) {
      return;
    }
    const now = context.currentTime;
    if (cue.kind === 'burst') {
      this.recentBursts = this.recentBursts.filter((at) => at > now - 1);
      if (this.recentBursts.length >= MAX_BURSTS_PER_SECOND) {
        return;
      }
      this.recentBursts.push(now);
    }
    const at = now + cue.distance / SPEED_OF_SOUND;
    const loudness = Math.min(1, Math.max(0.12, FIREWORK_NEAR_METRES / Math.max(1, cue.distance)));
    const panner = context.createStereoPanner();
    panner.pan.value = cue.pan;
    panner.connect(beds.festival);
    if (cue.kind === 'launch') {
      this.launchSound(context, panner, at, cue, loudness);
    } else {
      this.burstSound(context, panner, at, cue, loudness);
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
    this.beds = {
      birds: bed(),
      street: bed(),
      gulls: bed(),
      wind: bed(),
      rain: bed(),
      insects: bed(),
      festival: bed(),
    };

    const white = noiseBuffer(context, 'white', this.rng);
    const brown = noiseBuffer(context, 'brown', this.rng);
    this.buildRain(context, this.beds.rain, white, brown);
    this.buildStreet(context, this.beds.street, brown);
    this.buildWind(context, this.beds.wind, white);
    this.buildInsects(context, this.beds.insects, brown);

    this.timer = window.setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
  }

  /** Rain: a broad hiss over a low rumble, with a slow swell; the drips are scheduled. */
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

  /** Under cloud: wind, a band of noise whose loudness and pitch the gusts move. */
  private buildWind(context: AudioContext, out: GainNode, white: AudioBuffer): void {
    const air = loop(context, white);
    const band = filter(context, 'bandpass', 480);
    band.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.value = 0.5;
    air
      .connect(band)
      .connect(filter(context, 'lowpass', 1400))
      .connect(gain)
      .connect(out);
    this.gust = { gain, band };
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

  // --- Scheduled sounds -------------------------------------------------------

  /** Books the next half second of everything that comes and goes. */
  private schedule(): void {
    const context = this.context;
    const beds = this.beds;
    if (!context || !beds || context.state !== 'running') {
      return;
    }
    const now = context.currentTime;
    const until = now + LOOKAHEAD_SECONDS;
    const { rng, levels } = this;

    // Birds sing more often the louder their bed is.
    if (levels.birds > 0.05) {
      if (this.nextBirdPhrase < now) {
        this.nextBirdPhrase = now + rng.nextFloat(0, 0.3);
      }
      while (this.nextBirdPhrase < until) {
        this.birdPhrase(context, beds.birds, this.nextBirdPhrase);
        this.nextBirdPhrase += rng.nextFloat(0.5, 2.6) / Math.max(0.35, levels.birds);
      }
    }

    if (levels.insects > 0.05) {
      for (const cricket of this.crickets) {
        if (cricket.next < now) {
          cricket.next = now + rng.nextFloat(0, 0.5);
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

    if (levels.street > 0.05) {
      if (this.nextCar < now) {
        this.nextCar = now + rng.nextFloat(1, 6);
      }
      while (this.nextCar < until) {
        this.passingCar(context, beds.street, this.nextCar);
        this.nextCar += rng.nextFloat(6, 15);
      }
    }

    if (levels.gulls > 0.15) {
      if (this.nextGull < now) {
        this.nextGull = now + rng.nextFloat(2, 8);
      }
      while (this.nextGull < until) {
        this.gullCall(context, beds.gulls, this.nextGull);
        this.nextGull += rng.nextFloat(7, 18) / levels.gulls;
      }
    }

    if (levels.wind > 0.05 && this.gust && this.nextGust < until) {
      // A new gust every couple of seconds: louder or softer, higher or lower.
      const at = Math.max(this.nextGust, now);
      this.gust.gain.gain.setTargetAtTime(rng.nextFloat(0.2, 1), at, rng.nextFloat(0.6, 1.6));
      this.gust.band.frequency.setTargetAtTime(rng.nextFloat(280, 720), at, 1.5);
      this.nextGust = at + rng.nextFloat(1.2, 3.5);
    }

    if (levels.rain > 0.05) {
      this.nextDrip = Math.max(this.nextDrip, now);
      while (this.nextDrip < until) {
        this.drip(context, beds.rain, this.nextDrip);
        this.nextDrip += rng.nextFloat(0.04, 0.22) / Math.max(0.3, levels.rain);
      }
    }

    if (levels.festival > 0.05) {
      this.nextNote = Math.max(this.nextNote, now + 0.2);
      while (this.nextNote < until) {
        this.nextNote += this.tuneNote(context, beds.festival, this.nextNote);
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

  /** A gull over the beach: two or three nasal cries that rise and fall away. */
  private gullCall(context: AudioContext, out: GainNode, start: number): void {
    const { rng } = this;
    const panner = context.createStereoPanner();
    panner.pan.value = rng.nextFloat(-0.9, 0.9);
    panner.connect(out);
    const pitch = rng.nextFloat(0.9, 1.15);
    const cries = Math.floor(rng.nextFloat(2, 4));
    let at = start;
    for (let i = 0; i < cries; i += 1) {
      const length = rng.nextFloat(0.28, 0.45);
      const voice = context.createOscillator();
      voice.type = 'sawtooth';
      voice.frequency.setValueAtTime(1050 * pitch, at);
      voice.frequency.linearRampToValueAtTime(1450 * pitch, at + 0.07);
      voice.frequency.exponentialRampToValueAtTime(820 * pitch, at + length);
      const band = filter(context, 'bandpass', 1700);
      band.Q.value = 2.5;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.05, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0005, at + length);
      voice.connect(band).connect(gain).connect(panner);
      voice.start(at);
      voice.stop(at + length + 0.02);
      at += length + rng.nextFloat(0.08, 0.2);
    }
  }

  /** One drop off an awning or a gutter: a tiny bright tick. */
  private drip(context: AudioContext, out: GainNode, at: number): void {
    const { rng } = this;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context, 'white', rng);
    const band = filter(context, 'bandpass', rng.nextFloat(1800, 5000));
    band.Q.value = 6;
    const gain = context.createGain();
    const peak = rng.nextFloat(0.1, 0.35);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + rng.nextFloat(0.02, 0.05));
    const panner = context.createStereoPanner();
    panner.pan.value = rng.nextFloat(-0.9, 0.9);
    source.connect(band).connect(gain).connect(panner).connect(out);
    source.start(at, rng.nextFloat(0, 1.5));
    source.stop(at + 0.08);
  }

  /**
   * The Mid-Autumn tune: short phrases wandering the pentatonic scale a step
   * at a time, each opened by a low note and brought to rest on D or A, with
   * a few seconds of quiet between. Returns the seconds to the next note.
   */
  private tuneNote(context: AudioContext, out: GainNode, at: number): number {
    const { rng } = this;
    if (this.phraseLeft === 0) {
      this.phraseLeft = Math.floor(rng.nextFloat(4, 8));
      this.degree = rng.pick([2, 3, 4, 5]);
      this.pluck(context, out, rng.pick([SCALE[0], SCALE[3]]) / 2, at, 0.55);
    }
    const last = this.phraseLeft === 1;
    this.degree = Math.min(
      SCALE.length - 1,
      Math.max(0, this.degree + rng.pick([-2, -1, -1, 1, 1, 2])),
    );
    if (last) {
      this.degree = RESTING_DEGREES.reduce((best, degree) =>
        Math.abs(degree - this.degree) < Math.abs(best - this.degree) ? degree : best,
      );
    }
    this.pluck(context, out, SCALE[this.degree], at, last ? 1 : 0.8);
    this.phraseLeft -= 1;
    if (last) {
      return rng.nextFloat(3, 6);
    }
    // Now and then a quick grace note before the next.
    return rng.chance(0.15) ? 0.16 : rng.nextFloat(0.45, 0.9);
  }

  /**
   * A plucked string, in the manner of a guzheng: a few harmonics that die
   * away, the upper ones sooner, and the pitch pressed up into place.
   */
  private pluck(
    context: AudioContext,
    out: GainNode,
    frequency: number,
    at: number,
    strength: number,
  ): void {
    const ring = 2.4;
    for (const [ratio, amplitude, decay] of [
      [1, 1, 1],
      [2, 0.45, 0.6],
      [3, 0.22, 0.4],
      [4.1, 0.1, 0.25],
    ] as const) {
      const tone = context.createOscillator();
      tone.frequency.setValueAtTime(frequency * ratio * 0.985, at);
      tone.frequency.exponentialRampToValueAtTime(frequency * ratio, at + 0.06);
      const gain = context.createGain();
      const end = at + ring * decay;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.06 * amplitude * strength, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      tone.connect(gain).connect(out);
      tone.start(at);
      tone.stop(end + 0.05);
    }
  }

  /** A shell leaving: a mortar thump, and for the big beach shells a rising whistle. */
  private launchSound(
    context: AudioContext,
    out: AudioNode,
    at: number,
    cue: FireworkCue,
    loudness: number,
  ): void {
    const thump = context.createOscillator();
    thump.frequency.setValueAtTime(130, at);
    thump.frequency.exponentialRampToValueAtTime(55, at + 0.12);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0, at);
    thumpGain.gain.linearRampToValueAtTime(0.14 * loudness, at + 0.005);
    thumpGain.gain.exponentialRampToValueAtTime(0.0005, at + 0.18);
    thump.connect(thumpGain).connect(out);
    thump.start(at);
    thump.stop(at + 0.2);

    if (!cue.big) {
      return;
    }
    const climb = Math.min(cue.fuse, 1.8) * 0.9;
    const whistle = context.createOscillator();
    whistle.frequency.setValueAtTime(600, at);
    whistle.frequency.exponentialRampToValueAtTime(1750, at + climb);
    const whistleGain = context.createGain();
    whistleGain.gain.setValueAtTime(0, at);
    whistleGain.gain.linearRampToValueAtTime(0.022 * loudness, at + 0.12);
    whistleGain.gain.linearRampToValueAtTime(0, at + climb);
    whistle.connect(whistleGain).connect(out);
    whistle.start(at);
    whistle.stop(at + climb + 0.02);
  }

  /** A burst: a low boom with a puff of air; crackles and sizzles for the kinds that have them. */
  private burstSound(
    context: AudioContext,
    out: AudioNode,
    at: number,
    cue: FireworkCue,
    loudness: number,
  ): void {
    const { rng } = this;
    const boom = context.createOscillator();
    boom.frequency.setValueAtTime(cue.big ? 95 : 140, at);
    boom.frequency.exponentialRampToValueAtTime(cue.big ? 38 : 60, at + 0.5);
    const boomGain = context.createGain();
    const boomLength = cue.big ? 1.4 : 0.7;
    boomGain.gain.setValueAtTime(0, at);
    boomGain.gain.linearRampToValueAtTime((cue.big ? 0.55 : 0.3) * loudness, at + 0.01);
    boomGain.gain.exponentialRampToValueAtTime(0.0005, at + boomLength);
    boom.connect(boomGain).connect(out);
    boom.start(at);
    boom.stop(at + boomLength + 0.02);

    const air = context.createBufferSource();
    air.buffer = noiseBuffer(context, 'brown', rng);
    const airGain = context.createGain();
    airGain.gain.setValueAtTime(0, at);
    airGain.gain.linearRampToValueAtTime(0.5 * loudness, at + 0.01);
    airGain.gain.exponentialRampToValueAtTime(0.0005, at + 0.9);
    air
      .connect(filter(context, 'lowpass', cue.big ? 700 : 1200))
      .connect(airGain)
      .connect(out);
    air.start(at, rng.nextFloat(0, 1));
    air.stop(at + 1);

    if (cue.burst === 'crackle') {
      const pops = Math.floor(rng.nextFloat(14, 26));
      for (let i = 0; i < pops; i += 1) {
        this.crackle(context, out, at + 0.25 + rng.nextFloat(0, 1.1), loudness);
      }
    } else if (cue.burst === 'willow') {
      // The long gold tails fizz as they fall.
      const fizz = context.createBufferSource();
      fizz.buffer = noiseBuffer(context, 'white', rng);
      const fizzGain = context.createGain();
      fizzGain.gain.setValueAtTime(0, at);
      fizzGain.gain.linearRampToValueAtTime(0.05 * loudness, at + 0.15);
      fizzGain.gain.linearRampToValueAtTime(0, at + 2);
      fizz
        .connect(filter(context, 'highpass', 3500))
        .connect(fizzGain)
        .connect(out);
      fizz.start(at, rng.nextFloat(0, 1));
      fizz.stop(at + 2);
    }
  }

  private crackle(context: AudioContext, out: AudioNode, at: number, loudness: number): void {
    const { rng } = this;
    const pop = context.createBufferSource();
    pop.buffer = noiseBuffer(context, 'white', rng);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12 * loudness, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.014);
    pop
      .connect(filter(context, 'highpass', 2500))
      .connect(gain)
      .connect(out);
    pop.start(at, rng.nextFloat(0, 1.5));
    pop.stop(at + 0.03);
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
