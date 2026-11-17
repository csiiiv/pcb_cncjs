// Phase 2 machine commands — routed through CNCjs's socket 'command' API.
// Every function here causes real machine motion or state change.
// All zeroing uses G10 L20 (set current position as work-coordinate zero),
// matching the project brief's work-coordinate-first philosophy.

export class MachineCommands {
  constructor(connection) {
    this.connection = connection;
  }

  #command(cmd, ...args) {
    const port = this.connection.connectedPort;
    if (!port) throw new Error('no port connected');
    this.connection.socket.emit('command', port, cmd, ...args);
  }

  /** GRBL state change (not motion). */
  unlock() {
    this.#command('unlock'); // $X
  }

  /** Soft-reset GRBL (^x). */
  reset() {
    this.#command('reset');
  }

  /** Cancel an in-flight jog (\x85). Safe: only affects jog motions. */
  jogCancel() {
    this.#command('jogCancel');
  }

  /** Explicit spindle commands; editing an RPM field never sends a command. */
  spindleStart(direction, rpm) {
    if (!['M3', 'M4'].includes(direction)) throw new Error('Invalid spindle direction');
    this.#validateSpindleSpeed(rpm);
    this.#command('gcode', [`${direction} S${rpm}`]);
  }

  spindleStop() {
    this.#command('gcode', ['M5']);
  }

  /** Send a short G-code program (park, recovery). Lines are already cleaned. */
  runGcode(lines) {
    const program = (Array.isArray(lines) ? lines : []).map((line) => String(line).trim()).filter(Boolean);
    if (!program.length) throw new Error('empty program');
    this.#command('gcode', program);
  }

  spindleSpeed(rpm) {
    this.#validateSpindleSpeed(rpm);
    this.#command('gcode', [`S${rpm}`]);
  }

  #validateSpindleSpeed(rpm) {
    if (!Number.isSafeInteger(rpm) || rpm < 0) {
      throw new Error('RPM must be a non-negative whole number');
    }
  }

  /**
   * Jog using GRBL 1.1 native jog mode ($J=...).
   * @param {object} params { axis: 'X'|'Y'|'Z', direction: 1|-1, distance: mm, feed: mm/min }
   */
  jog({ axis, direction = 1, distance, feed = 500 }) {
    const dist = Number(distance) * (direction === -1 ? -1 : 1);
    this.#command('gcode', [
      `$J=G91 G21 ${axis}${dist.toFixed(3)} F${Number(feed).toFixed(0)}`
    ]);
  }

  /** Jog multiple axes at once (diagonals). axes = { X: ±mm, Y: ±mm, ... } */
  jogVector(axes, { feed = 500 } = {}) {
    const parts = Object.entries(axes)
      .filter(([axis, d]) => Number.isFinite(d) && d !== 0)
      .map(([axis, d]) => `${axis}${Number(d).toFixed(3)}`);
    if (!parts.length) return;
    this.#command('gcode', [`$J=G91 G21 ${parts.join(' ')} F${Number(feed).toFixed(0)}`]);
  }

  // --- Work zeroing (G10 L20 P1 = set G54 so current position becomes the given value) ---

  zeroAxis(axis) {
    this.#command('gcode', [`G10 L20 P1 ${axis}0`]);
  }

  zeroXY() {
    this.#command('gcode', ['G10 L20 P1 X0 Y0']);
  }

  zeroAll() {
    this.#command('gcode', ['G10 L20 P1 X0 Y0 Z0']);
  }

  // --- Realtime overrides (GRBL 1.1; relative steps, controller clamps) ---

  /** Feed override step in percent: +10/-10/+1/-1, 0 = reset to 100%. */
  feedOverride(step) {
    this.#command('feedOverride', step);
  }

  /** Spindle override step in percent: +10/-10/+1/-1, 0 = reset to 100%. */
  spindleOverride(step) {
    this.#command('spindleOverride', step);
  }

  /** Rapid override: 25/50/100 (percent), 0 = reset to 100%. */
  rapidOverride(percent) {
    this.#command('rapidOverride', percent);
  }

  /** Send a raw line to the controller (console command input). */
  write(line) {
    const text = String(line);
    if (!text.trim()) throw new Error('empty command');
    const port = this.connection.connectedPort;
    if (!port) throw new Error('no port connected');
    // socket-level 'writeln' (adds LF for line commands; realtime chars pass raw)
    this.connection.socket.emit('writeln', port, text);
  }
}
