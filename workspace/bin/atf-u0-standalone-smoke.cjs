// U0: verify the same isolated ATF store survives independent CLI processes.
// No OpenClaw backend, local workspace, session access, listener, or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.join(__dirname, '..', '..', 'atf-cli.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-u0-standalone-'));
try {
  const env = {
    HOME: path.join(root, 'home'),
    ATF_STANDALONE_ROOT: root,
    ATF_ROOT: root,
    ATF_WORKSPACE_DIR: path.join(root, 'workspace'),
    ATF_TASKS_DIR: path.join(root, 'tasks'),
    ATF_DATA_DIR: path.join(root, 'data'),
  };
  for (const dir of [env.HOME, env.ATF_WORKSPACE_DIR, env.ATF_TASKS_DIR, env.ATF_DATA_DIR])
    fs.mkdirSync(dir, { mode: 0o700 });
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, 'isolated ATF CLI command failed: ' + args[0]);
    return result.stdout;
  };
  const json = (...args) => JSON.parse(run(...args));
  const reviewer = 'isolated-u0';
  run('agent', 'register', reviewer, 'runtime=stub', 'workspace=' + env.ATF_WORKSPACE_DIR);
  const taskId = /task_id: (T-\d+)/.exec(run('create', 'U0 synthetic durability', 'type=pilot'))?.[1];
  assert.ok(taskId);
  run('assign', taskId, reviewer);
  const args = ['event', 'emit', 'assign', reviewer, taskId, 'source_ref=u0-replayed-event', 'runtime=stub'];
  const original = json(...args);
  const replay = json(...args);
  assert.equal(replay.event_id, original.event_id);
  assert.equal(replay.duplicate, true);
  const event = () => json('event', 'list').find(row => row.event_id === original.event_id);
  assert.equal(event().status, 'pending');
  assert.equal(json('event', 'dispatch', original.event_id)[0]?.accepted, true);
  assert.deepEqual(json('event', 'dispatch', original.event_id), []);
  run('update', taskId, 'active', 'by=' + reviewer);
  assert.ok(json('verify', taskId).resolved >= 1);
  const ctx = json('ctx', taskId);
  assert.equal(ctx.task_id, taskId);
  assert.equal(ctx.status, 'active');
  assert.equal(event().status, 'dispatched');
  assert.match(event().runtime_session_ref, /^stub:/);
  assert.equal(event().duplicate_count, 1);
  console.log(JSON.stringify({ status: 'passed', runtime: 'stub', exact_deduplication: true,
    separate_cli_processes: true, original_task_readback: true, obligation_verified: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
