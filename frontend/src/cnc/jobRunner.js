// Job execution: load G-code into the CNCjs sender and run it (brief §38).
// Uses the established socket command API:
//   command(port, 'gcode:load', name, gcode, {}, ack)
//   command(port, 'gcode:start' | 'gcode:pause' | 'gcode:resume' | 'gcode:stop')
// Progress arrives via 'sender:status' events (sent/received/total/elapsed/remaining).
export class JobRunner {
  constructor(connection) {
    this.connection = connection;
    this.current = null; // { name, total }
  }

  #command(cmd, ...args) {
    const port = this.connection.connectedPort;
    if (!port) throw new Error('no port connected');
    this.connection.socket.emit('command', port, cmd, ...args);
  }

  /** Load a job. Returns the sender status (ack). */
  load(name, gcode) {
    return new Promise((resolve, reject) => {
      const port = this.connection.connectedPort;
      if (!port) return reject(new Error('no port connected'));
      this.connection.socket.emit('command', port, 'gcode:load', name, gcode, {}, (err, status) => {
        if (err) reject(err);
        else {
          this.current = { name, total: status?.total ?? 0 };
          resolve(status);
        }
      });
    });
  }

  unload() {
    this.current = null;
    this.#command('gcode:unload');
  }

  start() { this.#command('gcode:start'); }
  pause() { this.#command('gcode:pause'); }   // feed hold '!'
  resume() { this.#command('gcode:resume'); } // cycle start '~'
  stop() { this.#command('gcode:stop'); }     // workflow stop (no force)
  stopForce() { this.#command('gcode:stop', { force: true }); } // hold + reset
}
