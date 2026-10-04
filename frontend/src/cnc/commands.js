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
}
