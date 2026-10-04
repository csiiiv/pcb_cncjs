// CNCjs server connection: signin (JWT) + Socket.IO 2 client.
// Same-origin via the Vite dev proxy — no CORS, no backend changes.
import io from 'socket.io-client';

export const ConnectionState = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected'
});

export class CNCConnection {
  constructor({ serverUrl = '' } = {}) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.token = null;
    this.eventHandlers = {};
    this._connectedPort = null;
  }

  // The currently open machine port, mirrored from serialport:open/close events.
  // MachineCommands reads this to route 'command' emits to the right port.
  get connectedPort() {
    return this._connectedPort;
  }

  on(event, handler) {
    (this.eventHandlers[event] ||= []).push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const list = this.eventHandlers[event] || [];
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }

  #emitLocal(event, ...args) {
    (this.eventHandlers[event] || []).forEach((h) => h(...args));
  }

  #setConnectedPort(port) {
    this._connectedPort = port;
  }

  async #signin() {
    // Session-disabled mode (no users in ~/.cncrc): empty credentials get a token.
    // If users are configured, this fails and the UI should collect credentials.
    const res = await fetch(this.serverUrl + '/api/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      throw new Error(`signin failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('signin failed: no token');
    }
    this.token = data.token;
    return data;
  }

  async connect() {
    if (this.socket?.connected) return;

    this.#emitLocal('state', ConnectionState.CONNECTING);

    await this.#signin();

    this.socket = io(this.serverUrl || undefined, {
      query: `token=${this.token}`,
      transports: ['websocket']
    });

    this.socket.on('connect', () => {
      this.#setConnectedPort(null); // fresh socket: port linkage must be re-established
      this.#emitLocal('state', ConnectionState.CONNECTED);
    });
    this.socket.on('disconnect', () => this.#emitLocal('state', ConnectionState.DISCONNECTED));
    this.socket.on('connect_error', (err) => this.#emitLocal('error', err));

    // Server -> client events we care about (Phase 1: read-only)
    const relay = (event) => (...args) => this.#emitLocal(event, ...args);
    ['startup', 'error'].forEach((e) => this.socket.on(e, relay(e)));
    ['serialport:list', 'serialport:open', 'serialport:close', 'serialport:error',
      'serialport:read', 'serialport:write', 'controller:state', 'controller:settings', 'workflow:state',
      'sender:status', 'feeder:status', 'autolevel:update', 'autolevel:complete'].forEach((e) =>
      this.socket.on(e, relay(e))
    );
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.token = null;
    this.#setConnectedPort(null);
    this.#emitLocal('state', ConnectionState.DISCONNECTED);
  }

  // --- socket commands ---

  listPorts() {
    this.socket?.emit('list');
  }

  // Server uses an ack callback for 'open'/'close' (unlike 'list' which emits serialport:list).
  openPort(port, { baudrate = 115200, controllerType = 'Grbl' } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('not connected'));
      this.socket.emit('open', port, { baudrate, controllerType }, (err) => {
        if (err) reject(err);
        else {
          this.#setConnectedPort(port);
          resolve();
        }
      });
    });
  }

  closePort(port) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('not connected'));
      this.socket.emit('close', port, (err) => {
        if (err) reject(err);
        else {
          if (this._connectedPort === port) this.#setConnectedPort(null);
          resolve();
        }
      });
    });
  }
}
