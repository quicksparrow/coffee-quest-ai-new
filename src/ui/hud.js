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

  setGoal(title, sub, angle, dist) {
    if (this.el.goalTitle.textContent !== title) this.el.goalTitle.textContent = title;
    const s = dist != null ? `${sub} · ${Math.round(dist)} m` : sub;
    if (this.el.goalSub.textContent !== s) this.el.goalSub.textContent = s;
    this.el.arrow.style.transform = `rotate(${angle}rad)`;
  }

  setClock(text, sub, mode) {
    this.el.time.textContent = text;
    this.el.clockSub.textContent = sub;
    this.el.clock.classList.toggle('warn', mode === 'warn');
    this.el.clock.classList.toggle('late', mode === 'late');
  }

  setItems({ floor, badge, coffee, sips }) {
    this.el.floor.textContent = floor;
    this.el.badge.hidden = !badge;
    this.el.coffee.hidden = !coffee;
    this.el.sips.textContent = coffee ? ('●'.repeat(sips) + '○'.repeat(Math.max(0, 3 - sips))) : '';
  }

  // key: 'Space' etc. or null; progress: 0..1 or null
  setPrompt(text, { key = 'Space', progress = null, tutorial = false } = {}) {
    if (!text) { this.el.prompt.hidden = true; this.lastPrompt = ''; return; }
    this.el.prompt.hidden = false;
    this.el.prompt.classList.toggle('tutorial', tutorial);
    const sig = `${key}|${text}`;
    if (sig !== this.lastPrompt) {
      this.el.promptKeys.hidden = !key;
      this.el.promptKeys.innerHTML = '';
      if (key) key.split(' ').forEach((k) => { const kb = document.createElement('kbd'); kb.textContent = k; this.el.promptKeys.appendChild(kb); });
      this.el.promptText.textContent = text;
      this.lastPrompt = sig;
    }
    this.el.bar.hidden = progress == null;
    if (progress != null) this.el.fill.style.width = `${Math.round(progress * 100)}%`;
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

  clearTexts() { this.el.toasts.innerHTML = ''; this.el.popups.innerHTML = ''; }

  pop(text, kind = '') {
    const p = document.createElement('div');
    p.className = `pop ${kind}`;
    p.textContent = text;
    this.el.popups.appendChild(p);
    setTimeout(() => p.remove(), 1450);
  }

  setXray(on) { this.el.xray.hidden = !on; }
  fade(on) { this.el.fade.classList.toggle('on', on); }
}
