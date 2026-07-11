#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('../lib/atf-reliability.cjs');
const { acquireFileLock, ensureDir } = require('../lib/atf-storage.cjs');

const workspace = process.env.ATF_WORKSPACE_DIR || path.join(process.env.ATF_ROOT || '/root/.openclaw', 'workspace');
const config = {
  dataDir: process.env.ATF_DATA_DIR || path.join(workspace, 'agent-taskflow', 'data'),
  tasksDir: process.env.ATF_TASKS_DIR || path.join(process.env.ATF_ROOT || '/root/.openclaw', 'atf-tasks'),
};

async function dispatch() {
  const results = await core.dispatchEvents(config);
  if (results.length) console.log(JSON.stringify({ dispatched_at: new Date().toISOString(), results }));
  return results;
}

async function main() {
  const once = process.argv.includes('--once');
  if (once) {
    await dispatch();
    return;
  }
  const eventDir = core.paths(config).events;
  ensureDir(eventDir);
  const release = acquireFileLock(path.join(config.dataDir, 'event-dispatcher.lock'));
  let timer = null;
  let running = false;
  let queued = false;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) { queued = true; return; }
      running = true;
      try { await dispatch(); } finally {
        running = false;
        if (queued) { queued = false; schedule(); }
      }
    }, 250);
  };
  const watcher = fs.watch(eventDir, schedule);
  const stop = () => {
    watcher.close();
    clearTimeout(timer);
    release();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await dispatch();
  console.log(`ATF event dispatcher watching ${eventDir}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
