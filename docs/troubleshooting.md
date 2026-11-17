# Troubleshooting

Field notes for the two failure classes that look like "the app broke" but
live outside it, plus the server-side close hardening this fork carries.

The server fixes below live in the pinned `cncjs/` submodule. Initialize it
with `git submodule update --init --recursive`; see
[development setup](development.md).

## Fresh clone: backend missing or CAM unavailable

`./dev.sh` requires the modified CNCjs submodule, its dependencies
and a production build. Initialize it with
`git submodule update --init --recursive`, then install/build as described in
[development setup](development.md). A missing
launcher or `/api/cam/status` returning 404 can indicate a missing/unmodified
backend, or an older process that has not loaded rebuilt server modules.
Frontend installation and build can still run independently.

**Check engine** distinguishes missing pcb2gcode/capabilities from backend
or authentication errors. A configured-user CNCjs server also requires
authentication support beyond the client's current empty-credentials sign-in;
see [connection and authentication](development.md#connection-and-authentication).

## Serial port cannot be reopened after closing

Symptom: `Error: Resource temporarily unavailable — Cannot lock port` when
opening `/dev/ttyUSB0`, sometimes for many minutes, even though the CNCjs
server holds no file descriptor for the port.

### Cause 1 (the usual one on Ubuntu): ModemManager

Ubuntu runs `ModemManager` to probe USB serial devices as candidate modems.
A cheap USB-serial adapter (this setup uses a ch341, `1a86:7523`) looks like
a modem to it. Whenever the device re-enumerates — USB hiccup, controller
reset, replug — ModemManager opens the new `/dev/ttyUSB0` with an exclusive
kernel flock and probes it. GRBL's startup banner is not a modem response,
so the probe runs to its timeout (minutes) while holding the lock. Every
open attempt in that window fails with EAGAIN.

You can confirm the holder even without root: a fresh
`flock(LOCK_EX | LOCK_NB)` from Python fails while `lsof`/`fuser` show
nothing, because the holder is the root-owned ModemManager daemon.

Fix (choose one, first is best):

```bash
# Permanent: tell udev this device is not a modem —
# create /etc/udev/rules.d/99-pcb-cnc-serial.rules with:
#   ACTION=="add|change", SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", ENV{ID_MM_DEVICE_IGNORE}="1"
sudo systemctl restart udev   # or: sudo udevadm control --reload && sudo udevadm trigger

# Blunt: disable ModemManager entirely (fine on a CNC-dedicated machine)
sudo systemctl disable --now ModemManager
```

The rule can be generalized to all ch341 adapters by dropping the
`idProduct` match. After the next replug, verify with
`udevadm info /dev/ttyUSB0 | grep ID_MM_DEVICE_IGNORE`.

### Cause 2 (fixed in this fork): async close races in the server

Three defects conspired to keep the flock past a close:

1. `SerialConnection.close()` nulled `this.port` synchronously while the
   underlying fd close was still in flight, so `isOpen` lied and a reopen
   could land inside the kernel's close window.
2. The controller's serial `close` event handler re-entered `close()`
   (disconnect handler and explicit close could race), double-closing.
3. `open()` did not wait out an in-flight `close()`.

The fork now keeps the port reference until the fd is actually released,
exposes `whenClosed()`, and `GrblController.close()` is re-entry-guarded
(`closing` flag). Verified with a socket-level open→close→immediate-reopen
burst test (5/5 cycles, previously ~100% failure while the lock was held).

After changing server code, stop the existing development stack with Ctrl+C
while the machine is idle, then rebuild and restart from the outer root:

```bash
./dev.sh --rebuild
```

For a backend started another way, stop it through its owning terminal or
service first. The launcher reports occupied ports instead of stopping
another CNCjs process automatically.
