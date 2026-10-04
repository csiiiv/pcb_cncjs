// Probe commands. Motion goes through CNCjs autolevel:start so PRB results
// are converted to work coordinates on the server.

const MAX_POINTS = 2000;

export class ProbeCommands {
  constructor(connection) {
    this.connection = connection;
  }

  #command(cmd, ...args) {
    const port = this.connection.connectedPort;
    if (!port) throw new Error('no port connected');
    this.connection.socket.emit('command', port, cmd, ...args);
  }

  #motion(params) {
    return {
      clearanceZ: Number(params.clearanceZ),
      startZ: Number(params.startZ),
      endZ: Number(params.endZ),
      feedrate: Number(params.feedrate),
    };
  }

  /**
   * Single-axis touch probe, matching the CNCjs Probe widget.
   * Relative G38, then G10 L20 so contact reads as the plate thickness, then retract.
   */
  probeAxis({ axis, command, depth, feedrate, plate, retract, wcs = 'G54' }) {
    const toward = command === 'G38.2' || command === 'G38.3';
    const travel = (toward ? -1 : 1) * Math.abs(Number(depth));
    const p = { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }[wcs] || 1;
    const ax = String(axis).toUpperCase();
    this.#command('gcode', [
      'G21',
      'G91',
      `${command} ${ax}${travel.toFixed(3)} F${Number(feedrate).toFixed(0)}`,
      'G90',
      `G10 L20 P${p} ${ax}${Number(plate).toFixed(3)}`,
      'G91',
      `G0 ${ax}${Math.abs(Number(retract)).toFixed(3)}`,
      'G90',
    ]);
  }

  /** Probe an explicit XY list (variable-density map). */
  startPoints(points, params) {
    if (!points?.length) throw new Error('probe map is empty');
    if (points.length > MAX_POINTS) throw new Error(`probe map has ${points.length} points (limit ${MAX_POINTS})`);
    this.#command('autolevel:start', {
      mode: 'points',
      points: points.map((p) => ({ x: p.x, y: p.y })),
      ...this.#motion(params),
    });
  }

  /** Cancel the cycle. CNCjs soft-resets GRBL to abort the probe. */
  stop() {
    this.#command('autolevel:stop');
  }
}
