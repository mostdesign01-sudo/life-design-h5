// Every sound on the planet is synthesised with Web Audio: no files to load, nothing to license.
// The context can only start after a user gesture, so `start()` is called from the landing button.

const MUTE_KEY = "lifeDesignPlanetMuted";
// A major-pentatonic set around C: any two notes sound fine together.
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

export function createSound() {
  let ctx = null;
  let master = null;
  let ambientFilter = null;
  let noiseBuffer = null;
  let muted = readMuted();
  let nextPluck = 0;
  let brightness = 0.5;

  function now() {
    return ctx.currentTime;
  }

  function envGain(start, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    return g;
  }

  // A soft bell: a sine fundamental plus a quieter octave and twelfth, each decaying on its own.
  function bell(freq, { when = 0, gain = 0.12, decay = 1.6 } = {}) {
    if (!ctx) return;
    const t = now() + when;
    [[1, 1], [2, 0.35], [3, 0.12]].forEach(([mult, level]) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      const g = envGain(t, gain * level, 0.008, decay / mult);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.1);
    });
  }

  function noise({ when = 0, gain = 0.08, duration = 0.12, freq = 900, q = 0.8, sweepTo = null } = {}) {
    if (!ctx) return;
    const t = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    filter.Q.value = q;
    const g = envGain(t, gain, Math.min(0.02, duration * 0.3), duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  // Ambient bed: a slow, detuned major-ninth pad behind a lowpass that opens with the play score.
  function startAmbient() {
    ambientFilter = ctx.createBiquadFilter();
    ambientFilter.type = "lowpass";
    ambientFilter.frequency.value = 900;
    ambientFilter.Q.value = 0.4;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.045;
    ambientFilter.connect(padGain).connect(master);
    [130.81, 196.0, 329.63, 587.33].forEach((freq, i) => {
      [-4, 4].forEach(cents => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.value = freq;
        osc.detune.value = cents;
        const voice = ctx.createGain();
        voice.gain.value = i === 0 ? 0.9 : 0.35;
        // Each voice swells on its own slow cycle so the pad breathes.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + i * 0.023;
        const depth = ctx.createGain();
        depth.gain.value = voice.gain.value * 0.45;
        lfo.connect(depth).connect(voice.gain);
        osc.connect(voice).connect(ambientFilter);
        osc.start();
        lfo.start();
      });
    });
  }

  function applyMute() {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.8, now(), 0.2);
  }

  return {
    get muted() {
      return muted;
    },
    start() {
      if (ctx) {
        ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(comp).connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      startAmbient();
      applyMute();
      nextPluck = now() + 3;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      } catch (error) {
        // Preference just won't persist.
      }
      applyMute();
      return muted;
    },
    // Called every frame: occasional high plucks over the pad, and the pad brightens with play.
    tick(play) {
      if (!ctx || muted) return;
      brightness += (play - brightness) * 0.02;
      ambientFilter.frequency.setTargetAtTime(380 + brightness * 1500, now(), 0.5);
      if (now() > nextPluck) {
        const note = PENTA[4 + Math.floor(Math.random() * 6)];
        bell(note, { gain: 0.035 + brightness * 0.03, decay: 2.6 });
        nextPluck = now() + 2.5 + Math.random() * 4;
      }
    },
    step() {
      noise({ gain: 0.035, duration: 0.07, freq: 500 + Math.random() * 200, q: 1.2 });
    },
    open() {
      bell(PENTA[5], { gain: 0.05, decay: 0.6 });
    },
    whoosh() {
      noise({ gain: 0.09, duration: 0.9, freq: 300, q: 0.6, sweepTo: 2400 });
    },
    land() {
      noise({ gain: 0.06, duration: 0.18, freq: 260, q: 0.9 });
      bell(PENTA[2], { when: 0.05, gain: 0.05, decay: 0.8 });
    },
    // A rising arpeggio whose length follows the score: more notes for a fuller planet.
    confirm(score = 5) {
      const count = 2 + Math.round(score / 3);
      for (let i = 0; i < count; i += 1) bell(PENTA[i + 2], { when: i * 0.09, gain: 0.09, decay: 1.4 });
    },
    // One ping per lit bulb, walking up the scale.
    bulbs(lit) {
      for (let i = 0; i < lit; i += 1) bell(PENTA[3 + (i % 7)], { when: 0.15 + i * 0.07, gain: 0.04, decay: 0.7 });
    },
    sparkle() {
      [7, 9, 8].forEach((n, i) => bell(PENTA[n], { when: i * 0.06, gain: 0.05, decay: 1 }));
    },
    puff() {
      noise({ gain: 0.07, duration: 0.5, freq: 700, q: 0.5, sweepTo: 250 });
    }
  };
}
