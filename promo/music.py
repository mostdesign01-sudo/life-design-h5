# Score and sound effects for the 15-second promo, plus timing.json.
# Everything is synthesised here; the renderer reads timing.json so pictures land on the beat.
# Usage: python3 promo/music.py <out_dir>   (writes music.wav, sfx.wav, timing.json)
import json
import os
import sys
import wave

import numpy as np

SR = 48000
BPM = 96
BEAT = 60 / BPM            # 0.625 s
LENGTH = 15.0
N = int(SR * LENGTH)
SIXTEENTH = BEAT / 4
rng = np.random.default_rng(612)

out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out_dir, exist_ok=True)


def t_axis(n):
    return np.arange(n) / SR


def env(n, attack, release, curve=1.0):
    """Linear attack, exponential-ish release over n samples."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a)
    if r < n:
        e[-r:] *= np.linspace(1, 0, r) ** curve
    return e


def add(buf, start, sig):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def note(freq, dur, kind="pad", gain=0.1):
    n = int(dur * SR)
    t = t_axis(n)
    if kind == "pad":
        # Soft warm voice: a few odd/even harmonics with gentle detune and slow swell.
        sig = sum((0.6 ** k) * np.sin(2 * np.pi * freq * (k + 1) * t * (1 + 0.0015 * (-1) ** k)) for k in range(4))
        return gain * sig * env(n, 0.45, 0.8, 1.6)
    if kind == "pluck":
        decay = np.exp(-t * 5.5)
        sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 9) + 0.12 * np.sin(2 * np.pi * freq * 3 * t) * np.exp(-t * 14)
        return gain * sig * decay * env(n, 0.004, 0.05)
    if kind == "bell":
        sig = (np.sin(2 * np.pi * freq * t) + 0.45 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-t * 2.5)
               + 0.2 * np.sin(2 * np.pi * freq * 3.98 * t) * np.exp(-t * 5))
        return gain * sig * np.exp(-t * 2.2) * env(n, 0.003, 0.08)
    if kind == "bass":
        sig = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
        return gain * sig * env(n, 0.03, 0.4, 1.5)
    raise ValueError(kind)


def noise(dur, lo, hi, gain, sweep_to=None, attack=0.01, release=0.1):
    """Band-limited noise via FFT masking; the band can sweep linearly to `sweep_to` (lo, hi)."""
    n = int(dur * SR)
    white = rng.standard_normal(n)
    if sweep_to is None:
        spec = np.fft.rfft(white)
        f = np.fft.rfftfreq(n, 1 / SR)
        spec[(f < lo) | (f > hi)] = 0
        sig = np.fft.irfft(spec, n)
    else:
        # Sweep by blending a few fixed bands across the duration.
        steps = 8
        sig = np.zeros(n)
        f = np.fft.rfftfreq(n, 1 / SR)
        spec = np.fft.rfft(white)
        for s in range(steps):
            k = s / (steps - 1)
            blo = lo + (sweep_to[0] - lo) * k
            bhi = hi + (sweep_to[1] - hi) * k
            band = spec.copy()
            band[(f < blo) | (f > bhi)] = 0
            part = np.fft.irfft(band, n)
            w = np.clip(1 - abs(np.linspace(0, steps - 1, n) - s), 0, 1)
            sig += part * w
    sig /= np.max(np.abs(sig)) + 1e-9
    return gain * sig * env(n, attack, release, 1.4)


def hz(name):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    semis = names[pitch[0]] + (1 if pitch.endswith("#") else 0)
    return 440 * 2 ** ((semis + (octave - 4) * 12 - 9) / 12)


# ---------- timeline ----------

seg = [i * 4 * BEAT for i in range(7)]  # 0, 2.5, 5, 7.5, 10, 12.5, 15
beats = [round(i * BEAT, 4) for i in range(24)]

# Each ramp runs in 32nd notes from half a beat into its segment, so the full score holds on screen
# for more than a second before the camera moves on.
THIRTYSECOND = BEAT / 8
work_steps = [round(seg[2] + 0.5 * BEAT + i * THIRTYSECOND, 4) for i in range(7)]       # 2 -> 9
bulb_steps = [round(seg[3] + 0.5 * BEAT + i * THIRTYSECOND, 4) for i in range(10)]      # 0 -> 10
play_steps = [round(seg[4] + 0.5 * BEAT + i * THIRTYSECOND, 4) for i in range(7)]       # 2 -> 9

timing = {
    "fps": 30,
    "bpm": BPM,
    "length": LENGTH,
    "beats": beats,
    "segments": [
        {"id": "hook", "start": seg[0], "end": seg[1]},
        {"id": "dive", "start": seg[1], "end": seg[2]},
        {"id": "workshop", "start": seg[2], "end": seg[3]},
        {"id": "lanterns", "start": seg[3], "end": seg[4]},
        {"id": "sky", "start": seg[4], "end": seg[5]},
        {"id": "postcard", "start": seg[5], "end": seg[6]},
    ],
    "events": {
        "dive": seg[1],
        "land": round(seg[1] + 1.15, 4),
        "work": {"from": 2, "to": 9, "steps": work_steps},
        "bulbs": {"from": 0, "to": 10, "steps": bulb_steps},
        "play": {"from": 2, "to": 9, "steps": play_steps},
        "card_rise": seg[5],
        "card_land": round(seg[5] + BEAT, 4),
        "cta": round(seg[5] + BEAT, 4),
        "final_bell": round(seg[5] + 3 * BEAT, 4),
    },
    "climax": seg[4],
}

# ---------- music ----------

music = np.zeros(N)
chords = [
    ["C3", "G3", "D4", "E4", "B4"],      # Cmaj9
    ["A2", "E3", "C4", "G4", "D5"],      # Am9
    ["F2", "C3", "A3", "E4", "G4"],      # Fmaj9
    ["G2", "D3", "B3", "E4", "A4"],      # G6/9
    ["A2", "E3", "C4", "G4", "B4"],      # Am(add9)
    ["F2", "C3", "A3", "E4", "C5"],      # Fmaj7 -> resolves
]
for i, chord in enumerate(chords):
    start = seg[i]
    dur = 4 * BEAT + 0.9
    for j, n_ in enumerate(chord):
        add(music, start, note(hz(n_), dur, "pad", 0.02 if j else 0.03))
    add(music, start, note(hz(chord[0]) / 2, 4 * BEAT, "bass", 0.06 if i else 0.035))

# Final resolution to C at the call to action, held out to the end.
for j, n_ in enumerate(["C3", "G3", "E4", "G4", "D5"]):
    add(music, timing["events"]["cta"], note(hz(n_), LENGTH - timing["events"]["cta"], "pad", 0.022))

# Plucked pentatonic arpeggio in eighths from the dive, thinning out under the postcard.
penta = ["C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6"]
pattern = [0, 2, 4, 3, 5, 4, 2, 3]
for k in range(int((seg[5] - seg[1]) / (BEAT / 2))):
    t0 = seg[1] + k * BEAT / 2
    level = 0.03 + 0.02 * min(1, (t0 - seg[1]) / (seg[4] - seg[1]))
    add(music, t0, note(hz(penta[pattern[k % len(pattern)]]), 0.9, "pluck", level))

# Soft pulse from the workshop to the climax: low thump on beats 1 and 3, brushed shaker in eighths.
for k in range(int((seg[5] - seg[2]) / BEAT)):
    t0 = seg[2] + k * BEAT
    if k % 2 == 0:
        n = int(0.25 * SR)
        tt = t_axis(n)
        thump = 0.16 * np.sin(2 * np.pi * (90 * np.exp(-tt * 18) + 45) * tt) * np.exp(-tt * 14)
        add(music, t0, thump)
    for h in range(2):
        add(music, t0 + h * BEAT / 2, noise(0.06, 5000, 11000, 0.018 if h else 0.026, release=0.05))

# Hook: a single bell on the first downbeat so the opening frame lands with sound.
add(music, 0.0, note(hz("E5"), 2.0, "bell", 0.06))

# Dynamic shape: quiet hook, build through the stops to the sky climax, ease off for the postcard.
levels = [0.6, 0.72, 0.82, 0.92, 1.0, 0.8, 0.75]
music *= np.interp(t_axis(N), [s_ for s_ in seg], levels)

# ---------- sound effects (each in its own band, a little above the music) ----------

sfx = np.zeros(N)
add(sfx, timing["events"]["dive"], noise(1.15, 250, 900, 0.16, sweep_to=(1200, 4200), attack=0.6, release=0.35))
n = int(0.35 * SR)
tt = t_axis(n)
add(sfx, timing["events"]["land"], 0.22 * np.sin(2 * np.pi * (120 * np.exp(-tt * 12) + 55) * tt) * np.exp(-tt * 10))
add(sfx, timing["events"]["land"], noise(0.25, 300, 1400, 0.05, release=0.2))
add(sfx, seg[2] + 0.1, noise(0.7, 200, 900, 0.07, sweep_to=(150, 500), attack=0.05, release=0.5))     # chimney puff
for i, t0 in enumerate(work_steps):
    add(sfx, t0, noise(0.03, 2500, 6000, 0.05, release=0.02))                                     # slider ticks
for i, t0 in enumerate(bulb_steps):
    add(sfx, t0, note(hz(penta[min(i, len(penta) - 1)]) * (2 if i > 6 else 1), 0.6, "bell", 0.05))  # bulb pings
for i, t0 in enumerate(play_steps):
    add(sfx, t0, noise(0.03, 2500, 6000, 0.04, release=0.02))
    add(sfx, t0, note(hz(["G5", "A5", "C6", "D6", "E6", "G6", "A6"][i]), 0.8, "bell", 0.03))         # sky shimmer
add(sfx, timing["events"]["card_rise"], noise(0.5, 600, 3000, 0.07, sweep_to=(1200, 5000), attack=0.15, release=0.3))
add(sfx, timing["events"]["card_land"], note(hz("C6"), 1.6, "bell", 0.07))
add(sfx, timing["events"]["final_bell"], note(hz("G5"), 1.8, "bell", 0.06))
add(sfx, timing["events"]["final_bell"], note(hz("C6"), 1.8, "bell", 0.05))


sfx *= 2.2


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    stereo = np.stack([x, x], axis=1)
    data = (stereo * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


# Both stems share one scale factor so their relative levels survive; loudness is set at mix time.
peak = max(np.max(np.abs(music + sfx)), 1e-9) / 0.8
write_wav(os.path.join(out_dir, "music.wav"), music / peak)
write_wav(os.path.join(out_dir, "sfx.wav"), sfx / peak)
with open(os.path.join(out_dir, "timing.json"), "w") as f:
    json.dump(timing, f, ensure_ascii=False, indent=2)
print("wrote", out_dir)
