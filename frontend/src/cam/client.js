// CAM uses authenticated REST and does not need an open machine port.
export class CamClient {
  constructor(connection) {
    this.connection = connection;
    this.token = null;
  }

  async request(path, body) {
    const serverUrl = this.connection.serverUrl || '';
    let token = this.connection.token || this.token;
    if (!token) {
      const response = await fetch(`${serverUrl}/api/signin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!response.ok) throw new Error(`CNCjs sign-in failed (${response.status})`);
      const credentials = await response.json();
      if (!credentials.token) throw new Error('CNCjs did not provide an authentication token');
      token = credentials.token;
      this.token = token;
    }
    const response = await fetch(`${serverUrl}/api/cam/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    let data;
    try { data = await response.json(); } catch {
      throw new Error(`CAM API returned ${response.status}. Rebuild/restart the CNCjs backend with CAM support.`);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.token = null;
      throw Object.assign(new Error(data.msg || `CAM request failed (${response.status})`), {
        stdout: data.stdout || '', stderr: data.stderr || ''
      });
    }
    return data;
  }

  status() { return this.request('status'); }
  generate(files, settings) { return this.request('generate', { files, settings }); }
}
