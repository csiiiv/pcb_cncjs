// One-click / opt-in machine connection: CNCjs server + serial port.
// Connection only — never sends motion commands.
export const USB_RE = /^\/dev\/tty(USB|ACM)/;

function waitForPorts(connection, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('timed out waiting for the serial port list')); }, timeoutMs);
    const onList = (ports) => { clearTimeout(timer); off(); resolve(Array.isArray(ports) ? ports : []); };
    const off = () => connection.off('serialport:list', onList);
    connection.on('serialport:list', onList);
    connection.listPorts();
  });
}

/**
 * Connect the server (if needed), wait for the port list, open the preferred
 * or first USB serial port. Resolves with the opened port name.
 */
export async function connectMachine(connection, { preferredPort = '', baudrate = 115200 } = {}, timeoutMs = 4000) {
  if (!connection.socket?.connected) await connection.connect();
  const ports = await waitForPorts(connection, timeoutMs);
  const pick = ports.find((p) => p.port === preferredPort)
    || ports.find((p) => USB_RE.test(p.port))
    || ports[0];
  if (!pick) throw new Error('no serial ports found on the server');
  await connection.openPort(pick.port, { baudrate, controllerType: 'Grbl' });
  return pick.port;
}
