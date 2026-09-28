// Tiny synthesized sound effects (no audio files needed for the graybox).
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; }
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq, dur = 0.12, type = 'sine', vol = 0.12, when = 0, slideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  beep() { this.tone(1320, 0.08, 'square', 0.05); this.tone(1760, 0.1, 'square', 0.05, 0.09); }
  deny() { this.tone(220, 0.18, 'square', 0.06); this.tone(180, 0.22, 'square', 0.06, 0.12); }
  ding() { this.tone(1046, 0.6, 'sine', 0.12); this.tone(1318, 0.8, 'sine', 0.1, 0.18); }
  sip() { this.tone(300, 0.15, 'triangle', 0.08, 0, 180); }
  coin() { this.tone(880, 0.08, 'triangle', 0.08); this.tone(1320, 0.14, 'triangle', 0.08, 0.07); }
  buzz() { this.tone(160, 0.12, 'sawtooth', 0.04); this.tone(160, 0.12, 'sawtooth', 0.04, 0.18); }
  spill() { this.tone(500, 0.25, 'sawtooth', 0.04, 0, 120); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.12)); }
}
