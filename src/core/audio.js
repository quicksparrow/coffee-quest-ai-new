// Synthesized sound: effects, office ambience and a little lo-fi background music. No audio
// files, so it works on any host and costs nothing to download.

const MUSIC_LEVEL = 0.32;
const BPM = 82;
// Four chords, one bar each (Fmaj7, Em7, Dm7, Cmaj7), as MIDI notes; the bass plays the root.
const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const SCALE = [72, 74, 76, 79, 81, 84];   // C major pentatonic, for the melody
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
export class Sfx {
  constructor() { this.ctx = null; this._enabled = true; this.amb = null; this.music = null; this._musicOn = true; }

  get musicOn() { return this._musicOn; }
  set musicOn(on) {
    this._musicOn = on;
    if (this.music) this.music.bus.gain.setTargetAtTime(on && !this.music.paused ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.3);
  }

  get enabled() { return this._enabled; }
  set enabled(on) {
    this._enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._enabled ? 1 : 0;
        this.master.connect(this.ctx.destination);
        // One second of white noise, reused by every noisy sound.
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // Brown noise (smoother, for air conditioning rumble).
        this.brown = this.ctx.createBuffer(1, len * 2, this.ctx.sampleRate);
        const b = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur = 0.12, type = 'sine', vol = 0.12, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // A filtered noise burst: the building block for steps, clicks and whooshes.
  burst({ dur = 0.08, vol = 0.05, type = 'bandpass', freq = 1200, q = 1, to = null, when = 0, attack = 0.004, dest = this.master }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.02);
  }

  beep() { this.tone(1320, 0.08, 'square', 0.05); this.tone(1760, 0.1, 'square', 0.05, 0.09); }
  deny() { this.tone(220, 0.18, 'square', 0.06); this.tone(180, 0.22, 'square', 0.06, 0.12); }
  ding() { this.tone(1046, 0.6, 'sine', 0.12); this.tone(1318, 0.8, 'sine', 0.1, 0.18); }
  sip() { this.tone(300, 0.15, 'triangle', 0.08, 0, 180); }
  coin() { this.tone(880, 0.08, 'triangle', 0.08); this.tone(1320, 0.14, 'triangle', 0.08, 0.07); }
  buzz() { this.tone(160, 0.12, 'sawtooth', 0.04); this.tone(160, 0.12, 'sawtooth', 0.04, 0.18); }
  spill() { this.tone(500, 0.25, 'sawtooth', 0.04, 0, 120); this.burst({ dur: 0.3, vol: 0.03, type: 'lowpass', freq: 1800, to: 400 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.12)); }

  // Sliding door / turnstile flap, quieter with distance (vol 0..1).
  door(vol = 1) {
    if (vol < 0.05) return;
    this.burst({ dur: 0.45, vol: 0.035 * vol, type: 'lowpass', freq: 300, to: 1600, attack: 0.08 });
    this.tone(90, 0.3, 'sine', 0.02 * vol, 0.05);
  }

  // ---------- Ambience: air conditioning, distant chatter, keyboards, the elevator ----------
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
    out.connect(this.master);
    const loop = (buffer) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.start(0, Math.random()); return s; };
    // HVAC rumble
    const hvac = loop(this.brown);
    const hvacF = ctx.createBiquadFilter(); hvacF.type = 'lowpass'; hvacF.frequency.value = 320;
    const hvacG = ctx.createGain(); hvacG.gain.value = 0.05;
    hvac.connect(hvacF).connect(hvacG).connect(out);
    // Murmur: band-limited noise whose loudness drifts like far-off conversation.
    const mur = loop(this.noise);
    const murF = ctx.createBiquadFilter(); murF.type = 'bandpass'; murF.frequency.value = 650; murF.Q.value = 1.4;
    const murG = ctx.createGain(); murG.gain.value = 0.01;
    mur.connect(murF).connect(murG).connect(out);
    // Elevator hum (silent until a ride)
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 58;
    const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 180;
    const humG = ctx.createGain(); humG.gain.value = 0;
    hum.connect(humF).connect(humG).connect(out);
    hum.start();
    this.amb = { out, sources: [hvac, mur, hum], murG, murF, humG, level: 0.01, t: 0, keysT: 2, floor: 0 };
  }

  stopAmbience() {
    const a = this.amb;
    if (!a) return;
    this.amb = null;
    const t = this.ctx.currentTime;
    a.out.gain.setTargetAtTime(0.0001, t, 0.25);
    a.sources.forEach((s) => s.stop(t + 1.5));
  }

  // Per frame while playing: floor 0/1, riding = elevator moving with you in it.
  updateAmbience(dt, { floor, riding }) {
    const a = this.amb;
    if (!a) return;
    const t = this.ctx.currentTime;
    a.t -= dt;
    if (a.t <= 0) {
      // A new swell of chatter every second or two; the office upstairs is busier.
      a.t = 0.8 + Math.random() * 1.6;
      const base = floor === 1 ? 0.022 : 0.012;
      a.murG.gain.setTargetAtTime(base * (0.4 + Math.random() * 0.9), t, 0.5);
      a.murF.frequency.setTargetAtTime(500 + Math.random() * 400, t, 0.6);
    }
    a.humG.gain.setTargetAtTime(riding ? 0.03 : 0, t, 0.3);
    // Someone typing somewhere upstairs.
    if (floor === 1) {
      a.keysT -= dt;
      if (a.keysT <= 0) {
        a.keysT = 1.5 + Math.random() * 3.5;
        const n = 4 + Math.floor(Math.random() * 10);
        for (let i = 0; i < n; i++) this.burst({ dur: 0.02, vol: 0.006 + Math.random() * 0.006, type: 'highpass', freq: 3000, when: i * (0.07 + Math.random() * 0.1) });
      }
    }
  }

  // ---------- Background music ----------
  // A mellow four-chord loop: electric piano, bass, soft drums with a lazy swing, and a sparse
  // melody that changes every time round. Scheduled a little ahead with the audio clock.
  startMusic() {
    if (!this.ctx) return;
    if (this.music) { this.pauseMusic(false); return; }
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(this._musicOn ? MUSIC_LEVEL : 0, ctx.currentTime + 2.5);
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 3200;
    bus.connect(warm).connect(this.master);
    const m = { bus, next: ctx.currentTime + 0.1, step: 0, paused: false };
    this.music = m;
    m.timer = setInterval(() => this.scheduleMusic(), 50);
  }

  pauseMusic(paused) {
    const m = this.music;
    if (!m) return;
    m.paused = paused;
    m.bus.gain.setTargetAtTime(!paused && this._musicOn ? MUSIC_LEVEL : 0, this.ctx.currentTime, paused ? 0.15 : 0.6);
    if (!paused) m.next = Math.max(m.next, this.ctx.currentTime + 0.05);
  }

  scheduleMusic() {
    const m = this.music, ctx = this.ctx;
    if (!m || m.paused) return;
    const eighth = 60 / BPM / 2;
    while (m.next < ctx.currentTime + 0.25) {
      const i = m.step % 32;                     // 8 eighths per bar, 4 bars
      const bar = Math.floor(i / 8), e = i % 8;
      const swing = e % 2 ? eighth * 0.18 : 0;
      const t = m.next + swing;
      const chord = CHORDS[bar];
      if (e === 0 || e === 3) chord.forEach((n, k) => this.keys(hz(n), t + k * 0.012, e === 0 ? 0.05 : 0.03, eighth * (e === 0 ? 5 : 3)));
      if (e === 0 || e === 4) this.bass(hz(chord[0] - 12), t, eighth * 3.5);
      if (e === 6 && Math.random() < 0.5) this.bass(hz(chord[0] - 12 + 7), t, eighth * 1.5);
      if (e === 0 || e === 4) this.kick(t);
      if (e === 2 || e === 6) this.burst({ dur: 0.12, vol: 0.018, type: 'bandpass', freq: 1800, q: 0.8, when: t - ctx.currentTime, dest: m.bus });
      this.burst({ dur: 0.03, vol: e % 2 ? 0.006 : 0.01, type: 'highpass', freq: 7000, when: t - ctx.currentTime, dest: m.bus });
      if (e % 2 === 0 && Math.random() < 0.3) this.lead(hz(SCALE[Math.floor(Math.random() * SCALE.length)]), t, eighth * 2);
      m.next += eighth;
      m.step += 1;
    }
  }

  voice(freq, t, dur, vol, type, dest = this.music.bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Electric-piano-ish: a sine with a quieter bell partial that fades faster.
  keys(freq, t, vol, dur) { this.voice(freq, t, dur, vol, 'sine'); this.voice(freq * 2, t, dur * 0.4, vol * 0.25, 'sine'); }
  bass(freq, t, dur) { this.voice(freq, t, dur, 0.09, 'triangle'); }
  lead(freq, t, dur) { this.voice(freq, t, dur, 0.022, 'triangle'); }
  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.music.bus); o.start(t); o.stop(t + 0.3);
  }
}
