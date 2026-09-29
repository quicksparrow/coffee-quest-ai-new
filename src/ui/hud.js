const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), goalTitle: $('goal-title'), goalSub: $('goal-sub'), arrow: $('goal-arrow').querySelector('svg'),
      clock: $('clock'), time: $('clock-time'), clockSub: $('clock-sub'),
      floor: $('item-floor'), badge: $('item-badge'), coffee: $('item-coffee'), sips: $('sips'),
      toasts: $('toasts'), popups: $('popups'),
      prompt: $('prompt'), promptKeys: $('prompt-keys'), promptText: $('prompt-text'), bar: $('prompt-bar'), fill: $('prompt-fill'),
      xray: $('xray-tag'), fade: $('fade'),
    };
    this.lastPrompt = '';
  }

  show(on) { this.el.hud.hidden = !on; }

  // The HUD is refreshed every frame, but the DOM is only touched when something changed:
  // writing unchanged text still costs style and layout work on every frame.
  setGoal(title, sub, angle, dist) {
    const s = dist != null ? `${sub} · ${Math.round(dist)} m` : sub;
    if (title !== this._goalTitle) { this.el.goalTitle.textContent = title; this._goalTitle = title; }
    if (s !== this._goalSub) { this.el.goalSub.textContent = s; this._goalSub = s; }
    const a = Math.round(angle * 100) / 100;
    if (a !== this._angle) { this.el.arrow.style.transform = `rotate(${a}rad)`; this._angle = a; }
  }

  setClock(text, sub, mode) {
    if (text !== this._clockText) { this.el.time.textContent = text; this._clockText = text; }
    if (sub !== this._clockSub) { this.el.clockSub.textContent = sub; this._clockSub = sub; }
    if (mode !== this._clockMode) {
      this.el.clock.classList.toggle('warn', mode === 'warn');
      this.el.clock.classList.toggle('late', mode === 'late');
      this._clockMode = mode;
    }
  }

  setItems({ floor, badge, coffee, sips, size = 3 }) {
    const sig = `${floor}|${badge}|${coffee}|${sips}|${size}`;
    if (sig === this._items) return;
    this._items = sig;
    this.el.floor.textContent = floor;
    this.el.badge.hidden = !badge;
    this.el.coffee.hidden = !coffee;
    this.el.sips.textContent = coffee ? ('●'.repeat(sips) + '○'.repeat(Math.max(0, size - sips))) : '';   // a latte has 3 sips, an espresso 2
  }

  // key: 'Space' etc. or null; progress: 0..1 or null
  setPrompt(text, { key = 'Space', progress = null, tutorial = false } = {}) {
    if (!text) {
      if (this.lastPrompt !== '') { this.el.prompt.hidden = true; this.lastPrompt = ''; }
      return;
    }
    if (this.lastPrompt === '') this.el.prompt.hidden = false;
    if (tutorial !== this._tut) { this.el.prompt.classList.toggle('tutorial', tutorial); this._tut = tutorial; }
    const sig = `${key}|${text}`;
    if (sig !== this.lastPrompt) {
      this.el.promptKeys.hidden = !key;
      this.el.promptKeys.innerHTML = '';
      if (key) key.split(' ').forEach((k) => { const kb = document.createElement('kbd'); kb.textContent = k; this.el.promptKeys.appendChild(kb); });
      this.el.promptText.textContent = text;
      this.lastPrompt = sig;
    }
    const hasBar = progress != null;
    if (hasBar !== this._bar) { this.el.bar.hidden = !hasBar; this._bar = hasBar; }
    if (hasBar) {
      const w = Math.round(progress * 100);
      if (w !== this._fill) { this.el.fill.style.transform = `scaleX(${w / 100})`; this._fill = w; }
    }
  }

  text(from, message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div class="avatar">${from[0]}</div><div><span class="who"></span><p></p></div>`;
    t.querySelector('.who').textContent = from;
    t.querySelector('p').textContent = message;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.lastChild.remove();
    const life = 4200 + message.length * 45;
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, life);
  }

  clearTexts() {
    this.el.toasts.innerHTML = '';
    this.el.popups.innerHTML = '';
    this._goalTitle = this._goalSub = this._angle = this._clockText = this._clockSub = this._clockMode = this._items = undefined;
  }

  pop(text, kind = '') {
    const p = document.createElement('div');
    p.className = `pop ${kind}`;
    p.textContent = text;
    this.el.popups.appendChild(p);
    setTimeout(() => p.remove(), 1450);
  }

  setXray(on) { this.el.xray.hidden = !on; }
  fade(on) { if (on !== this._fade) { this.el.fade.classList.toggle('on', on); this._fade = on; } }
}
