// One JSON file holds everything: settings, eggs (ideas), per-project notes
// and the last scan. Writes go to a temp file first so a crash never
// leaves half a file behind.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  version: 1,
  settings: {
    name: '',
    roots: [],
    sleepDays: 14,
    ghostDays: 30,
    editor: 'vscode',
    chatter: 'some',
    look: 'pixel',
    setupDone: false,
  },
  ideas: [],
  meta: {},
  cache: { scannedAt: 0, ms: 0, projects: [] },
};

export async function openStore(dir) {
  const file = path.join(dir, 'brainchildren.json');
  await fs.mkdir(dir, { recursive: true });

  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // keep the unreadable file around instead of overwriting it
      const backup = `${file}.broken-${Date.now()}`;
      await fs.copyFile(file, backup).catch(() => {});
      console.warn(`  couldn't read ${file}, saved a copy as ${path.basename(backup)}`);
    }
  }

  const base = structuredClone(DEFAULTS);
  const data = {
    ...base,
    ...saved,
    settings: { ...base.settings, ...(saved.settings || {}) },
    cache: { ...base.cache, ...(saved.cache || {}) },
  };

  let queue = Promise.resolve();
  async function write() {
    const json = JSON.stringify(data, null, 2);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, json);
    try {
      await fs.rename(tmp, file);
    } catch {
      // Windows can refuse the rename while something else has the file open
      await fs.writeFile(file, json);
      await fs.rm(tmp, { force: true });
    }
  }

  function save() {
    queue = queue.then(write).catch((err) => console.error('  save failed:', err.message));
    return queue;
  }

  return { data, save, file };
}
