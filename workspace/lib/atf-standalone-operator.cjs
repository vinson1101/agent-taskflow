'use strict';

const fs = require('node:fs');
const path = require('node:path');

const required = ['workspace', 'tasks', 'data'];

function canonicalTarget(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || /[\x00-\x1f\x7f]/.test(input))
    throw new Error('provide an absolute standalone root path');
  const normalized = path.resolve(input);
  if (normalized === path.parse(normalized).root) throw new Error('choose a new directory, not the volume root');
  const parent = fs.realpathSync(path.dirname(normalized));
  const target = path.join(parent, path.basename(normalized));
  if (/(?:^|[\\/])\.openclaw(?:[\\/]|$)/i.test(normalized) || /(?:^|[\\/])\.openclaw(?:[\\/]|$)/i.test(target))
    throw new Error('standalone root must be outside OpenClaw');
  return target;
}

function privateDir(dir) {
  try {
    const st = fs.lstatSync(dir);
    return st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o777) === 0o700 &&
      (typeof process.getuid !== 'function' || st.uid === process.getuid());
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function queueSummary(root) {
  const counts = { pending: 0, blocked_review_dispatch: 0, awaiting_reconcile: 0 };
  const limit = 100;
  const byteLimit = 8192;
  let scanned = 0;
  let complete = true;
  let dir;
  try {
    const events = path.join(root, 'data', 'events');
    const st = fs.lstatSync(events);
    if (!st.isDirectory() || st.isSymbolicLink()) return { checked: false, scanned, snapshot_complete: false, counts: null };
    dir = fs.opendirSync(events);
    let entry;
    while ((entry = dir.readSync())) {
      if (scanned >= limit) { complete = false; break; }
      scanned++;
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile() || !fs.constants.O_NOFOLLOW) { complete = false; continue; }
      let fd;
      try {
        fd = fs.openSync(path.join(events, entry.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const item = fs.fstatSync(fd);
        if (!item.isFile() || item.size > byteLimit) { complete = false; continue; }
        const bytes = Buffer.alloc(item.size + 1);
        const n = fs.readSync(fd, bytes, 0, bytes.length, 0);
        if (n !== item.size) { complete = false; continue; }
        const event = JSON.parse(bytes.subarray(0, n).toString('utf8'));
        if (!event || typeof event.status !== 'string') { complete = false; continue; }
        if (Object.hasOwn(counts, event.status)) counts[event.status]++;
      } catch { complete = false; }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') complete = false;
  } finally { if (dir) dir.closeSync(); }
  return { checked: true, scanned, snapshot_complete: complete, counts };
}

function inspect(root) {
  const rootSafe = privateDir(root);
  const ready = rootSafe && required.every(name => privateDir(path.join(root, name)));
  const cueInbox = ready && privateDir(path.join(root, 'public-research-inbox'));
  const env = ready ? { ATF_STANDALONE_ROOT: root, ATF_ROOT: root,
    ATF_WORKSPACE_DIR: path.join(root, 'workspace'), ATF_TASKS_DIR: path.join(root, 'tasks'),
    ATF_DATA_DIR: path.join(root, 'data') } : null;
  return { status: ready ? 'layout_ready' : 'layout_not_ready', root, env,
    cue_inbox_ready: cueInbox, runtime_checked: false, relay_checked: false, cue_enabled_by_command: false,
    queue: ready ? queueSummary(root) : null };
}

function run(argv) {
  const [action, input, flag] = argv;
  if (!['init', 'status'].includes(action) || !input || argv.length > 3 ||
      (flag !== undefined && (action !== 'init' || flag !== '--prepare-cue-inbox')))
    throw new Error('usage: atf standalone init <absolute-new-root> [--prepare-cue-inbox] | atf standalone status <absolute-root>');
  const root = canonicalTarget(input);
  if (action === 'init') {
    try { fs.mkdirSync(root, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('standalone root already exists; use status or choose a new root');
      throw error;
    }
    if (!privateDir(root)) throw new Error('could not create a private standalone root; inspect before retrying');
    for (const name of [...required, ...(flag ? ['public-research-inbox'] : [])])
      fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const result = inspect(root);
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'layout_ready' ? 0 : 1;
}

module.exports = { run };
