// Socket.IO errors may be strings, Error objects or CNCjs { port, err } events.
export function connectionErrorMessage(error, fallback = 'Connection failed') {
  if (typeof error === 'string' && error.trim()) return error;
  if (error?.err != null) return connectionErrorMessage(error.err, fallback);
  if (typeof error?.message === 'string' && error.message) return error.message;
  if (typeof error?.code === 'string' && error.code) return error.code;
  return fallback;
}
