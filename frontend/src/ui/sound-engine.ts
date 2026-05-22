/**
 * sound-engine.ts — BMM synthesized sound effects via Web Audio API
 * No external audio files needed — all sounds are procedurally generated.
 */

let _ctx: AudioContext | null = null;
let _enabled = true;
let _volume = 0.7; // 0.0–1.0

function ctx(): AudioContext {
    if (!_ctx) _ctx = new AudioContext();
    return _ctx;
}

export function setSoundEnabled(v: boolean): void { _enabled = v; }
export function setSoundVolume(v: number): void { _volume = Math.max(0, Math.min(1, v)); }

/** Futuristic sci-fi startup — clean digital energy, light pulses, smooth activation */
export function playBootSound(): void {
    if (!_enabled) return;
    const ac = ctx();
    const master = ac.createGain();
    master.gain.setValueAtTime(_volume * 0.38, ac.currentTime);
    master.connect(ac.destination);

    // 1. Digital energy sweep (sine, 160→820Hz, soft attack)
    const sweep = ac.createOscillator();
    const sweepGain = ac.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(160, ac.currentTime);
    sweep.frequency.exponentialRampToValueAtTime(820, ac.currentTime + 0.28);
    sweepGain.gain.setValueAtTime(0, ac.currentTime);
    sweepGain.gain.linearRampToValueAtTime(0.28, ac.currentTime + 0.05);
    sweepGain.gain.linearRampToValueAtTime(0.12, ac.currentTime + 0.2);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
    sweep.connect(sweepGain); sweepGain.connect(master);
    sweep.start(ac.currentTime);
    sweep.stop(ac.currentTime + 0.32);

    // 2. Activation pulses — 3 clean sine blips rising in pitch
    const pulseTimes = [0.22, 0.32, 0.42];
    const pulseFreqs = [660, 880, 1320];
    pulseTimes.forEach((pt, i) => {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pulseFreqs[i], ac.currentTime + pt);
        g.gain.setValueAtTime(0, ac.currentTime + pt);
        g.gain.linearRampToValueAtTime(0.45, ac.currentTime + pt + 0.018);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + pt + 0.10);
        osc.connect(g); g.connect(master);
        osc.start(ac.currentTime + pt);
        osc.stop(ac.currentTime + pt + 0.13);
    });

    // 3. Power-on harmonic chord — triangle waves at 440+880+1320Hz fading out
    [440, 880, 1320].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ac.currentTime + 0.50);
        g.gain.setValueAtTime(0, ac.currentTime + 0.50);
        g.gain.linearRampToValueAtTime(0.22 / (i + 1), ac.currentTime + 0.54);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.95);
        osc.connect(g); g.connect(master);
        osc.start(ac.currentTime + 0.50);
        osc.stop(ac.currentTime + 1.0);
    });

    // 4. Soft sub-bass digital texture (very low sawtooth, gives "boot" weight)
    const tex = ac.createOscillator();
    const texGain = ac.createGain();
    tex.type = 'sawtooth';
    tex.frequency.setValueAtTime(42, ac.currentTime);
    tex.frequency.linearRampToValueAtTime(18, ac.currentTime + 0.45);
    texGain.gain.setValueAtTime(0.07, ac.currentTime);
    texGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.45);
    tex.connect(texGain); texGain.connect(master);
    tex.start(ac.currentTime);
    tex.stop(ac.currentTime + 0.5);
}

/** Retro VHS/CRT shutdown — capacitor thump, flyback whine, phosphor collapse, tape hiss */
export function playCloseSound(): void {
    if (!_enabled) return;
    const ac = ctx();
    const t0 = ac.currentTime;
    const master = ac.createGain();
    master.gain.setValueAtTime(_volume * 0.44, t0);
    master.connect(ac.destination);

    // 1. Power-cut click — instant broadband noise snap (0.0–0.03s)
    const clickLen = Math.floor(ac.sampleRate * 0.032);
    const clickBuf = ac.createBuffer(1, clickLen, ac.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickLen; i++) clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickLen * 0.18));
    const click = ac.createBufferSource();
    click.buffer = clickBuf;
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(0.55, t0);
    click.connect(clickGain); clickGain.connect(master);
    click.start(t0);

    // 2. Capacitor discharge thump — deep sine 130→22Hz hits immediately and decays
    const thump = ac.createOscillator();
    const thumpGain = ac.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(130, t0);
    thump.frequency.exponentialRampToValueAtTime(22, t0 + 0.38);
    thumpGain.gain.setValueAtTime(0, t0);
    thumpGain.gain.linearRampToValueAtTime(0.72, t0 + 0.012);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.40);
    thump.connect(thumpGain); thumpGain.connect(master);
    thump.start(t0); thump.stop(t0 + 0.44);

    // 3. CRT flyback transformer whine — high sine 13500→240Hz sweeping down (0.0–0.30s)
    const flyback = ac.createOscillator();
    const flybackGain = ac.createGain();
    flyback.type = 'sine';
    flyback.frequency.setValueAtTime(13500, t0);
    flyback.frequency.exponentialRampToValueAtTime(240, t0 + 0.30);
    flybackGain.gain.setValueAtTime(0.32, t0);
    flybackGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    flyback.connect(flybackGain); flybackGain.connect(master);
    flyback.start(t0); flyback.stop(t0 + 0.34);

    // 4. Phosphor horizontal-line collapse — sawtooth 1800→30Hz (0.03–0.42s)
    const collapse = ac.createOscillator();
    const collapseGain = ac.createGain();
    collapse.type = 'sawtooth';
    collapse.frequency.setValueAtTime(1800, t0 + 0.03);
    collapse.frequency.exponentialRampToValueAtTime(30, t0 + 0.42);
    collapseGain.gain.setValueAtTime(0, t0 + 0.03);
    collapseGain.gain.linearRampToValueAtTime(0.38, t0 + 0.06);
    collapseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.44);
    collapse.connect(collapseGain); collapseGain.connect(master);
    collapse.start(t0 + 0.03); collapse.stop(t0 + 0.48);

    // 5. VHS tape hiss — white noise fading out (0.03–0.28s)
    const hissLen = Math.floor(ac.sampleRate * 0.28);
    const hissBuf = ac.createBuffer(1, hissLen, ac.sampleRate);
    const hissData = hissBuf.getChannelData(0);
    for (let i = 0; i < hissLen; i++) hissData[i] = Math.random() * 2 - 1;
    const hiss = ac.createBufferSource();
    hiss.buffer = hissBuf;
    const hissGain = ac.createGain();
    hissGain.gain.setValueAtTime(0.14, t0 + 0.03);
    hissGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    hiss.connect(hissGain); hissGain.connect(master);
    hiss.start(t0 + 0.03);
}
