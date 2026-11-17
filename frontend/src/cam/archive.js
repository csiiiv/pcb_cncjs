import { Unzip, UnzipInflate } from 'fflate';

const MB = 1024 * 1024;
const GERBER = /\.(gbr|ger|gerber|gtl|gbl|gko|gm\d+|gts|gbs|gto|gbo)$/i;
const DRILL = /\.(drl|xln|exc|txt)$/i;

export function detectSourceRole(name, content) {
  const base = name.split('/').pop().toLowerCase();
  const attribute = content.match(/(?:TF|#@!\s*TF)\.FileFunction,([^*%\r\n]+)/i)?.[1].toLowerCase();
  if (attribute) {
    if (/^copper,l1,top(?:,|$)/.test(attribute)) return 'front';
    if (/^(profile|outline)(?:,|$)/.test(attribute)) return 'outline';
    if (/^(plated|nonplated|mixed)(?:,|$)/.test(attribute)) return 'drill';
    return null; // An explicit mask, silk or bottom attribute outranks the filename.
  }
  if (/\.(drl|xln|exc)$/.test(base) || (/\.txt$/.test(base) && /(?:^|\n)\s*M48\b/i.test(content))) return 'drill';
  if (/\.(gbl|gts|gbs|gto|gbo)$|(?:^|[_. -])(?:b[_.]cu|[fb][_.](?:mask|paste|silks)|bottom|mask|paste|silk(?:screen)?)(?:[_. -]|$)/.test(base)) return null;
  if (/\.gtl$|(?:^|[_. -])(?:f[_.]cu|top[_. -]?copper|front[_. -]?copper|front|top)(?:[_. -]|$)/.test(base)) return 'front';
  if (/\.(gko|gm1)$|(?:^|[_. -])(?:edge[_.]cuts|outline|profile|boardoutline)(?:[_. -]|$)/.test(base)) return 'outline';
  return null;
}

// Decode in small chunks and bound actual inflated bytes, including archives
// using data descriptors where the local header omits the original size.
export function readCamArchive(bytes) {
  if (bytes.length > 25 * MB) throw new Error('PCB ZIP files must be smaller than 25 MB.');
  const entries = [];
  const names = new Set();
  let count = 0, total = 0;
  const unzip = new Unzip((file) => {
    if (++count > 500) throw new Error('PCB ZIP contains too many entries (maximum 500).');
    const name = file.name.replace(/\\/g, '/');
    if (name.endsWith('/') || /(?:^|\/)__MACOSX\//.test(name) || name.split('/').pop().startsWith('.')) return;
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('PCB ZIP contains an invalid file path.');
    if (!GERBER.test(name) && !DRILL.test(name)) return;
    if (names.has(name)) throw new Error(`PCB ZIP contains duplicate file ${name}.`);
    names.add(name);
    if (file.originalSize > 5 * MB) throw new Error(`${name} exceeds the 5 MB source limit.`);
    const chunks = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length; total += chunk.length;
      if (size > 5 * MB || total > 30 * MB) { file.terminate(); throw new Error('Extracted PCB files exceed the ZIP import limits.'); }
      chunks.push(chunk);
      if (final) {
        const data = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) { data.set(part, offset); offset += part.length; }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
        if (!content.trim() || content.includes('\0')) throw new Error(`${name} is not a non-empty PCB text file.`);
        // Generic TXT files may be readmes or drill maps; only expose Excellon.
        if (/\.txt$/i.test(name) && !/(?:^|\n)\s*M48\b/i.test(content)) return;
        entries.push({ name, content, kind: DRILL.test(name) ? 'drill' : 'gerber', role: detectSourceRole(name, content) });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    }
  } catch (err) { throw new Error(`Cannot import PCB ZIP: ${err.message}`); }
  if (!entries.length) throw new Error('No Gerber or Excellon source files found in the ZIP.');
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = {};
  for (const role of ['front', 'drill', 'outline']) {
    const matches = entries.filter((entry) => entry.role === role);
    if (matches.length === 1) files[role] = { name: matches[0].name, content: matches[0].content };
  }
  return { entries, files };
}
