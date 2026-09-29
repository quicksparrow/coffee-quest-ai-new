// Keyboard-only input. Tracks held keys and keys pressed this frame.
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyX', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      // macOS doesn't send keyup for keys released while ⌘ is down: clear everything with it.
      if (e.key === 'Meta') this.held.clear();
    });
    window.addEventListener('blur', () => this.held.clear());
  }
  down(...codes) { return codes.some((c) => this.held.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() { this.pressed.clear(); }

  get forward() { return this.down('ArrowUp', 'KeyW'); }
  get left() { return this.down('ArrowLeft', 'KeyA'); }
  get right() { return this.down('ArrowRight', 'KeyD'); }
  get aboutFace() { return this.hit('ArrowDown', 'KeyS'); }
  get forwardPressed() { return this.hit('ArrowUp', 'KeyW'); }
  get hurry() { return this.down('ShiftLeft', 'ShiftRight'); }
  get crouch() { return this.hit('KeyC'); }
  get xray() { return this.down('KeyX'); }
  get action() { return this.hit('Space'); }
  get anyMove() { return this.forward || this.left || this.right; }
}
