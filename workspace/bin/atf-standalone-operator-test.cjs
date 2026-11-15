'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../../atf-cli.js');

test('standalone bootstrap writes only a new private layout; status is advisory and bounded', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atf-operator-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'isolated project');
  const legacy = path.join(dir, 'fake-legacy');
  const env = { PATH: process.env.PATH, HOME: dir, ATF_ROOT: legacy };
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 5000 });
  const run = (...args) => {
    const result = invoke(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(invoke('standalone', 'status', root).status, 1);
  assert.equal(fs.existsSync(root), false);
  assert.notEqual(invoke('standalone', 'init', 'relative-path').status, 0);
  const openclaw = path.join(dir, '.openclaw');
  fs.mkdirSync(openclaw);
  assert.notEqual(invoke('standalone', 'init', path.join(openclaw, 'pilot')).status, 0);
  assert.deepEqual(fs.readdirSync(openclaw), []);
  const existing = path.join(dir, 'existing');
  fs.mkdirSync(existing, { mode: 0o700 });
  assert.match(invoke('standalone', 'init', existing).stderr, /already exists/);
  assert.deepEqual(fs.readdirSync(existing), []);
  const link = path.join(dir, 'link');
  fs.symlinkSync(existing, link, 'dir');
  assert.match(invoke('standalone', 'init', link).stderr, /already exists/);
  assert.equal(invoke('standalone', 'status', link).status, 1);

  const setup = run('standalone', 'init', root, '--prepare-cue-inbox');
  assert.equal(setup.status, 'layout_ready');
  assert.equal(setup.cue_inbox_ready, true);
  assert.equal(setup.cue_enabled_by_command, false);
  assert.equal(setup.runtime_checked, false);
  assert.equal(setup.relay_checked, false);
  assert.deepEqual(Object.keys(setup.env).sort(), ['ATF_DATA_DIR', 'ATF_ROOT', 'ATF_STANDALONE_ROOT', 'ATF_TASKS_DIR', 'ATF_WORKSPACE_DIR']);
  for (const safe of [root, ...fs.readdirSync(root).map(x => path.join(root,x))])
    assert.equal(fs.lstatSync(safe).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), []);
  assert.deepEqual(run('standalone', 'status', root), setup);
  const created = spawnSync(process.execPath, [cli, 'create', 'Clean operator test'], { env: { ...env, ...setup.env }, encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /task_id: T-001/);
  const noCue = run('standalone', 'init', path.join(dir, 'other'));
  const otherEvents = path.join(noCue.env.ATF_DATA_DIR, 'events');
  fs.symlinkSync(openclaw, otherEvents, 'dir');
  assert.deepEqual(run('standalone', 'status', noCue.root).queue, { checked: false, scanned: 0, snapshot_complete: false, counts: null });
  assert.equal(noCue.cue_inbox_ready, false);
  assert.equal(fs.existsSync(legacy), false);

  const events = path.join(root, 'data', 'events');
  fs.mkdirSync(events, { recursive: true });
  for (const [i, state] of ['pending', 'blocked_review_dispatch', 'awaiting_reconcile', 'dispatched'].entries())
    fs.writeFileSync(path.join(events, `${i}.json`), JSON.stringify({ status: state, fixture_field: 'do-not-print' }));
  const reply = invoke('standalone', 'status', root);
  assert.equal(reply.status, 0, reply.stderr);
  assert.doesNotMatch(reply.stdout, /do-not-print/);
  assert.deepEqual(JSON.parse(reply.stdout).queue, { checked: true, scanned: 4, snapshot_complete: true,
    counts: { pending: 1, blocked_review_dispatch: 1, awaiting_reconcile: 1 } });
  fs.writeFileSync(path.join(events, 'large.json'), 'x'.repeat(8193));
  assert.equal(run('standalone', 'status', root).queue.snapshot_complete, false);
  for (let i = 4; i < 104; i++)
    fs.writeFileSync(path.join(events, `${i}.json`), '{"status":"pending"}');
  const truncated = run('standalone', 'status', root).queue;
  assert.equal(truncated.scanned, 100);
  assert.equal(truncated.snapshot_complete, false);
});
