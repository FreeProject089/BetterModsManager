/**
 * audio-synth.mjs — Offline renderer for BMM procedural SFX
 *
 * Ports sound-engine.ts (Web Audio API) to pure Node.js PCM math.
 * No external audio packages needed.
 *
 * Exports:
 *   renderBootSound(durationSec?)  → Float32Array (mono, 44100 Hz)
 *   renderCloseSound(durationSec?) → Float32Array (mono, 44100 Hz)
 *   writeWav(filePath, f32buffer, sampleRate?)
 */

import { writeFileSync } from 'fs';

export const SR = 44100;

// ── AudioParam ────────────────────────────────────────────────────────────────
// Minimal port of Web Audio AudioParam ramp automation.

class AP {
    constructor(initValue = 0) {
        // Each event: { t: seconds, v: value, type: 'step'|'lin'|'exp' }
        this._ev = [{ t: 0, v: initValue, type: 'step' }];
    }

    setValueAtTime(v, t)              { this._ev.push({ t, v, type: 'step' }); return this; }
    linearRampToValueAtTime(v, t)     { this._ev.push({ t, v, type: 'lin'  }); return this; }
    exponentialRampToValueAtTime(v,t) { this._ev.push({ t, v, type: 'exp'  }); return this; }

    /** Get interpolated value at time t (seconds). */
    at(t) {
        // Sort events ascending
        const ev = this._ev.slice().sort((a, b) => a.t - b.t);

        // Find the last event at or before t
        let prevIdx = 0;
        for (let i = 0; i < ev.length; i++) {
            if (ev[i].t <= t) prevIdx = i;
        }
        const prev = ev[prevIdx];

        // Find next event strictly after t
        const nextIdx = ev.findIndex((e, i) => i > prevIdx && e.t > t);
        if (nextIdx < 0) return prev.v; // past all events — hold last value

        const next = ev[nextIdx];

        // Step event: hold prev value until next.t
        if (next.type === 'step') return prev.v;

        const span = next.t - prev.t;
        const frac = span > 0 ? (t - prev.t) / span : 1;

        if (next.type === 'lin') {
            return prev.v + (next.v - prev.v) * frac;
        }
        // exp ramp — clamp to avoid log(0) (Web Audio uses 0.001 as minimum anyway)
        const a = Math.max(1e-10, Math.abs(prev.v));
        const b = Math.max(1e-10, next.v);
        return a * Math.pow(b / a, frac) * Math.sign(prev.v || 1);
    }
}

// ── Waveforms ─────────────────────────────────────────────────────────────────

function sinWave(ph) { return Math.sin(2 * Math.PI * ph); }

function triWave(ph) {
    const p = ((ph % 1) + 1) % 1; // normalize 0..1
    return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

function sawWave(ph) {
    return 2 * (((ph % 1) + 1) % 1) - 1;
}

// ── Render helpers ────────────────────────────────────────────────────────────

/**
 * Accumulate an oscillator (with frequency & gain automation) into `buf`.
 * Phase is integrated sample-by-sample for accurate frequency sweeps.
 */
function addOsc(buf, waveType, freqAP, gainAP, startT, stopT) {
    const waveFn = waveType === 'sine' ? sinWave : waveType === 'triangle' ? triWave : sawWave;
    const s0 = Math.max(0,          Math.floor(startT * SR));
    const s1 = Math.min(buf.length, Math.ceil (stopT  * SR));
    let ph = 0;
    for (let i = s0; i < s1; i++) {
        const t = i / SR;
        ph += freqAP.at(t) / SR;           // phase accumulator (cycles)
        buf[i] += waveFn(ph) * gainAP.at(t);
    }
}

/**
 * Accumulate a pre-generated noise buffer (Float32Array) into `buf` with gain automation.
 */
function addNoise(buf, noiseData, gainAP, startT) {
    const s0 = Math.max(0,          Math.floor(startT * SR));
    const s1 = Math.min(buf.length, s0 + noiseData.length);
    for (let i = s0; i < s1; i++) {
        const t = i / SR;
        buf[i] += noiseData[i - s0] * gainAP.at(t);
    }
}

// ── Sounds ────────────────────────────────────────────────────────────────────

/**
 * Futuristic sci-fi startup — mirrors playBootSound() from sound-engine.ts.
 * Returns mono Float32Array at SR = 44100 Hz.
 */
export function renderBootSound(durationSec = 1.1) {
    const N   = Math.ceil(durationSec * SR);
    const buf = new Float32Array(N);
    const MASTER = 0.38;

    // 1. Digital energy sweep  (sine 160→820 Hz, 0–0.32 s)
    {
        const f = new AP(160);
        f.exponentialRampToValueAtTime(820, 0.28);

        const g = new AP(0);
        g.setValueAtTime(0,    0);
        g.linearRampToValueAtTime(0.28, 0.05);
        g.linearRampToValueAtTime(0.12, 0.2);
        g.exponentialRampToValueAtTime(0.001, 0.28);

        addOsc(buf, 'sine', f, g, 0, 0.32);
    }

    // 2. Activation pulses  (3 sine blips rising in pitch)
    [[0.22, 660], [0.32, 880], [0.42, 1320]].forEach(([pt, freq]) => {
        const f = new AP(freq);
        const g = new AP(0);
        g.setValueAtTime(0, pt);
        g.linearRampToValueAtTime(0.45, pt + 0.018);
        g.exponentialRampToValueAtTime(0.001, pt + 0.10);
        addOsc(buf, 'sine', f, g, pt, pt + 0.13);
    });

    // 3. Power-on harmonic chord  (triangle 440 / 880 / 1320 Hz)
    [440, 880, 1320].forEach((freq, i) => {
        const f = new AP(freq);
        const g = new AP(0);
        g.setValueAtTime(0, 0.50);
        g.linearRampToValueAtTime(0.22 / (i + 1), 0.54);
        g.exponentialRampToValueAtTime(0.001, 0.95);
        addOsc(buf, 'triangle', f, g, 0.50, 1.0);
    });

    // 4. Sub-bass digital texture  (sawtooth 42→18 Hz)
    {
        const f = new AP(42);
        f.linearRampToValueAtTime(18, 0.45);
        const g = new AP(0.07);
        g.setValueAtTime(0.07, 0);
        g.exponentialRampToValueAtTime(0.001, 0.45);
        addOsc(buf, 'sawtooth', f, g, 0, 0.5);
    }

    // Apply master gain + soft clip
    for (let i = 0; i < N; i++) {
        const v = buf[i] * MASTER;
        buf[i] = Math.max(-1, Math.min(1, v)); // hard clip safety
    }
    return buf;
}

/**
 * Retro VHS/CRT shutdown — mirrors playCloseSound() from sound-engine.ts.
 * Returns mono Float32Array at SR = 44100 Hz.
 */
export function renderCloseSound(durationSec = 0.55) {
    const N   = Math.ceil(durationSec * SR);
    const buf = new Float32Array(N);
    const MASTER = 0.44;

    // 1. Power-cut click  (broadband noise snap, 0–0.032 s)
    {
        const clickLen = Math.floor(SR * 0.032);
        const data = new Float32Array(clickLen);
        for (let i = 0; i < clickLen; i++)
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickLen * 0.18));
        const g = new AP(0.55);
        addNoise(buf, data, g, 0);
    }

    // 2. Capacitor discharge thump  (sine 130→22 Hz)
    {
        const f = new AP(130);
        f.exponentialRampToValueAtTime(22, 0.38);
        const g = new AP(0);
        g.setValueAtTime(0, 0);
        g.linearRampToValueAtTime(0.72, 0.012);
        g.exponentialRampToValueAtTime(0.001, 0.40);
        addOsc(buf, 'sine', f, g, 0, 0.44);
    }

    // 3. CRT flyback transformer whine  (sine 13500→240 Hz)
    {
        const f = new AP(13500);
        f.exponentialRampToValueAtTime(240, 0.30);
        const g = new AP(0.32);
        g.setValueAtTime(0.32, 0);
        g.exponentialRampToValueAtTime(0.001, 0.30);
        addOsc(buf, 'sine', f, g, 0, 0.34);
    }

    // 4. Phosphor horizontal-line collapse  (sawtooth 1800→30 Hz, 0.03–0.48 s)
    {
        // freq param starts at 0.03 s — so we init from that point
        const f = new AP(1800);
        f.exponentialRampToValueAtTime(30, 0.42); // 0.42 - 0.03 span inside addOsc start
        const g = new AP(0);
        g.setValueAtTime(0, 0.03);
        g.linearRampToValueAtTime(0.38, 0.06);
        g.exponentialRampToValueAtTime(0.001, 0.44);
        addOsc(buf, 'sawtooth', f, g, 0.03, 0.48);
    }

    // 5. VHS tape hiss  (white noise, 0.03–0.28 s)
    {
        const hissLen = Math.floor(SR * 0.28);
        const data = new Float32Array(hissLen);
        for (let i = 0; i < hissLen; i++) data[i] = Math.random() * 2 - 1;
        const g = new AP(0.14);
        g.setValueAtTime(0.14, 0.03);
        g.exponentialRampToValueAtTime(0.001, 0.28);
        addNoise(buf, data, g, 0.03);
    }

    // Apply master gain + soft clip
    for (let i = 0; i < N; i++) {
        const v = buf[i] * MASTER;
        buf[i] = Math.max(-1, Math.min(1, v));
    }
    return buf;
}

// ── WAV writer ────────────────────────────────────────────────────────────────

/**
 * Write a mono 16-bit PCM WAV file from a Float32Array (values in −1..1).
 */
export function writeWav(filePath, f32, sampleRate = SR) {
    const numSamples   = f32.length;
    const numChannels  = 1;
    const bitsPerSample = 16;
    const byteRate     = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign   = numChannels * bitsPerSample / 8;
    const dataSize     = numSamples * blockAlign;
    const fileSize     = 36 + dataSize;

    const ab  = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    const write4  = (off, str) => { for (let i = 0; i < 4; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    const writeU16 = (off, v) => view.setUint16(off, v, true);
    const writeU32 = (off, v) => view.setUint32(off, v, true);

    // RIFF header
    write4(0,  'RIFF');
    writeU32(4,  fileSize);
    write4(8,  'WAVE');
    // fmt chunk
    write4(12, 'fmt ');
    writeU32(16, 16);            // chunk size
    writeU16(20, 1);             // PCM
    writeU16(22, numChannels);
    writeU32(24, sampleRate);
    writeU32(28, byteRate);
    writeU16(32, blockAlign);
    writeU16(34, bitsPerSample);
    // data chunk
    write4(36, 'data');
    writeU32(40, dataSize);

    // Write 16-bit samples
    let off = 44;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
    }

    writeFileSync(filePath, Buffer.from(ab));
}
