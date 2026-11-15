const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../lib/atf-reliability.cjs');
const dsh = require('../lib/atf-dsh-review.cjs');
const { atomicWriteJson, acquireFileLock } = require('../lib/atf-storage.cjs');
const cli = path.resolve(__dirname, '..', '..', 'atf-cli.js');

function invoke(env, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 10_000 });
}
function rootFor(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-dsh-hardening-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function fixture(t) {
  const root = rootFor(t);
  const env = {
    HOME: path.join(root, 'home'), ATF_STANDALONE_ROOT: root, ATF_ROOT: root,
    ATF_WORKSPACE_DIR: path.join(root, 'workspace'), ATF_TASKS_DIR: path.join(root, 'tasks'),
    ATF_DATA_DIR: path.join(root, 'data'),
  };
  for (const name of ['home', 'workspace', 'tasks', 'data']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const config = { tasksDir: env.ATF_TASKS_DIR, dataDir: env.ATF_DATA_DIR };
  const run = (...args) => {
    const r = invoke(env, ...args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  run('agent', 'register', 'dsh-fixture', 'runtime=dsh', 'dsh-session=fixture-only', 'workspace=' + env.ATF_WORKSPACE_DIR);
  const taskId = /task_id: (T-\d+)/.exec(run('create', 'Synthetic hardening fixture'))[1];
  const d = core.taskDir(config, taskId);
  const input = { reviewer: 'dsh-fixture', source_event_id: 'synthetic-source',
    revision: 1, artifact: 'symbol,ZZZB', criterion: 'Use ZZZB.' };
  const submit = (next = input) => JSON.parse(run('dsh-review', 'submit', taskId, JSON.stringify(next)));
  return { config, run, submit, input, taskId, d, env };
}
function fakeRelay({ discard = false, verdict = 'pass' } = {}) {
  const rows = [];
  const calls = [];
  async function relay(p, q, body) {
    calls.push(p);
    if (p === '/send') {
      const identity = JSON.parse(body.text.split('\n').find(x => x.startsWith('{')));
      const row = { taskId: 'mock-task-' + (rows.length + 1), sessionId: body.sessionId, requestId: body.requestId,
        status: 'completed', attribution: 'rpc-turn-segment',
        result: { empty: false, truncated: false, text: JSON.stringify({ ...identity, verdict }) } };
      rows.push(row);
      if (discard) throw new Error('test dispatch response not captured');
      return row;
    }
    if (p === '/tasks') return { total: rows.length, tasks: rows.filter(x => x.sessionId === q.sessionId) };
    if (p.startsWith('/tasks/')) return { task: rows.find(x => x.taskId === p.split('/')[2]) };
    throw new Error('unexpected fake call');
  }
  return { calls, rows, relay };
}

test('partial standalone env fails before mkdir in safe decoy directories', t => {
  const dir = rootFor(t);
  const decoy = path.join(dir, 'not-standalone');
  const result = invoke({ HOME: dir, ATF_STANDALONE_ROOT: dir, ATF_ROOT: decoy, ATF_WORKSPACE_DIR: path.join(decoy, 'workspace') }, 'list');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /all standalone ATF paths must be set explicitly/);
  assert.equal(fs.existsSync(decoy), false);
});

test('repeat exact input repairs interrupted submission and dedupe gap on the original ATF task', t => {
  const { config, submit, taskId, d } = fixture(t);
  const staged = submit();
  const p = core.paths(config);
  const oldObligation = core.readJson(path.join(p.obligations, staged.obligation_id + '.json'));
  const eventFile = path.join(p.events, staged.event_id + '.json');
  const key = core.readJson(eventFile).dedupe_key;
  const indexFile = path.join(p.dedupe, key + '.json');
  const latest = path.join(d, 'latest.json');
  // Checkpoint: canonical write happened; its projection and enqueue writes did not finish.
  fs.unlinkSync(latest);
  fs.unlinkSync(eventFile);
  fs.unlinkSync(indexFile);
  assert.equal(submit().event_id, staged.event_id);
  assert.deepEqual(core.readJson(path.join(p.obligations, staged.obligation_id + '.json')), oldObligation);
  assert.deepEqual(core.readJson(latest), core.taskContext(config, taskId));
  fs.unlinkSync(indexFile); // Event finished but dedupe index did not.
  const replay = submit();
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event_id, staged.event_id);
  assert.equal(core.collection(p.events).length, 1);
  assert.equal(core.collection(p.obligations).length, 1);
  assert.equal(core.readJson(indexFile).event_id, staged.event_id);
});

test('ambiguous transport stays open, then previously posted exact RPC receipt and partial verifier state recover', async t => {
  const { config, submit, taskId, d, input, run, env } = fixture(t);
  const staged = submit();
  const fake = fakeRelay({ discard: true });
  const [initial] = await core.dispatchEvents(config, { dshRelay: fake.relay });
  assert.equal(initial.dsh_state, 'unknown');
  assert.deepEqual(await core.dispatchEvents(config, { dshRelay: fake.relay }), []);
  const held = await dsh.settle(core, config, staged.event_id, async () => ({ total: 0, tasks: [] }));
  assert.equal(held.state, 'pending_reconcile');
  assert.equal(core.verifyObligations(config, { taskId }).pending, 1);
  assert.equal(core.taskContext(config, taskId).status, 'active');
  assert.equal((await dsh.settle(core, config, staged.event_id, fake.relay)).decision, 'pass');
  assert.equal(fake.calls.filter(x => x === '/send').length, 1);
  const obligation = path.join(core.paths(config).obligations, staged.obligation_id + '.json');
  const before = core.readJson(obligation);
  assert.equal(core.verifyObligations(config, { taskId }).resolved, 1);
  const canonical = core.taskContext(config, taskId);
  assert.equal(canonical.status, 'completed');
  assert.equal(canonical.dsh_review.receipt.request_id, initial.request_id);
  // Checkpoint: canonical accepted state was persisted, obligation and projection writes did not finish.
  fs.unlinkSync(path.join(d, 'latest.json'));
  atomicWriteJson(obligation, before);
  assert.equal(core.verifyObligations(config, { taskId }).resolved, 1);
  assert.deepEqual(core.taskContext(config, taskId), canonical);
  assert.deepEqual(core.readJson(path.join(d, 'latest.json')), canonical);
  assert.equal(submit(input).duplicate, true);
  assert.equal(core.collection(core.paths(config).events).length, 1);
  assert.match(run('delivered', taskId), /delivered/);
  const reopening = invoke(env, 'update', taskId, 'active');
  assert.notEqual(reopening.status, 0);
  assert.match(reopening.stderr, /cannot reopen through a generic status update/);
  assert.equal(core.taskContext(config, taskId).status, 'delivered');
});

test('generic DSH assign fails before task mutation and an unsupported event cannot starve valid queued reviews', async t => {
  const { config, submit, taskId, env } = fixture(t);
  const manual = invoke(env, 'assign', taskId, 'dsh-fixture');
  assert.notEqual(manual.status, 0);
  assert.equal(core.taskContext(config, taskId).status, 'created');
  const unsupported = core.emitEvent(config, { task_id: taskId, agent: 'dsh-fixture', runtime: 'dsh', event_type: 'message' });
  const staged = submit();
  const fake = fakeRelay();
  const events = await core.dispatchEvents(config, { dshRelay: fake.relay });
  assert.equal(events.find(x => x.event_ids[0] === unsupported.event_id).dsh_state, 'unsupported_event');
  assert.equal(events.find(x => x.event_ids[0] === staged.event_id).accepted, true);
  assert.equal(fake.calls.filter(x => x === '/send').length, 1);
});

test('reviewer disabled before verify cannot close the canonical task', async t => {
  const { config, run, submit, taskId, env } = fixture(t);
  const staged = submit();
  const fake = fakeRelay();
  await core.dispatchEvents(config, { dshRelay: fake.relay });
  await dsh.settle(core, config, staged.event_id, fake.relay);
  run('agent', 'register', 'dsh-fixture', 'runtime=dsh', 'enabled=false');
  assert.equal(core.verifyObligations(config, { taskId }).escalated, 1);
  assert.equal(core.taskContext(config, taskId).status, 'active');
  assert.notEqual(invoke(env, 'update', taskId, 'completed').status, 0);
  assert.equal(core.taskContext(config, taskId).status, 'active');
});


test('standalone task creation and same-task writes share the review lock and do not mutate on contention', t => {
  const { config, submit, taskId, env } = fixture(t);
  submit();
  const before = core.taskContext(config, taskId);
  const release = acquireFileLock(path.join(config.dataDir, 'runtime-dispatch.lock'));
  try {
    for (const args of [['create', 'Unscheduled second task'], ['update', taskId, 'blocked']]) {
      const r = invoke(env, ...args);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /already running/);
    }
    assert.equal(fs.readdirSync(config.tasksDir).length, 1);
    assert.deepEqual(core.taskContext(config, taskId), before);
  } finally { release(); }
});

test('reviewer enrollment pins one session and submission cannot choose another', async t => {
  const { config, run, submit, taskId, input, env } = fixture(t);
  for (const args of [
    ['agent', 'register', 'unenrolled', 'runtime=dsh'],
    ['agent', 'register', 'other-reviewer', 'runtime=dsh', 'dsh-session=fixture-only'],
    ['agent', 'register', 'dsh-fixture', 'runtime=dsh', 'dsh-session=another-session'],
    ['agent', 'register', 'dsh-fixture', 'runtime=stub'],
    ['dsh-review', 'submit', taskId, JSON.stringify({ ...input, session_id: 'not-enrolled' })],
  ]) {
    const result = invoke(env, ...args);
    assert.notEqual(result.status, 0);
  }
  assert.equal(core.taskContext(config, taskId).status, 'created');
  assert.equal(core.collection(core.paths(config).events).length, 0);
  const staged = submit(); // No caller session; canonical enrollment is authoritative.
  const fake = fakeRelay();
  assert.equal((await core.dispatchEvents(config, { dshRelay: fake.relay }))[0].accepted, true);
  assert.equal(fake.rows[0].sessionId, 'fixture-only');
  run('agent', 'register', 'dsh-fixture', 'enabled=false');
  const before = fake.calls.slice();
  assert.equal((await dsh.settle(core, config, staged.event_id, fake.relay)).state, 'reviewer_not_authorized');
  assert.deepEqual(fake.calls, before);
  assert.equal(core.verifyObligations(config, { taskId }).escalated, 1);
  assert.equal(core.taskContext(config, taskId).status, 'active');
});

test('revoked reviewer is blocked again at dispatch before any relay POST', async t => {
  const { config, run, submit, taskId } = fixture(t);
  submit();
  run('agent', 'register', 'dsh-fixture', 'enabled=false');
  const fake = fakeRelay();
  assert.equal((await core.dispatchEvents(config, { dshRelay: fake.relay }))[0].dsh_state, 'blocked_review_dispatch');
  assert.deepEqual(fake.calls, []);
  assert.equal(core.taskContext(config, taskId).status, 'active');
});

test('legacy control-plane refuses standalone before opening any lock', t => {
  const root = rootFor(t);
  const target = path.join(root, 'legacy-data');
  const legacy = path.join(__dirname, 'atf-control-plane.cjs');
  const result = spawnSync(process.execPath, [legacy, '--once'], {
    env: { HOME: root, ATF_STANDALONE_ROOT: root, ATF_DATA_DIR: target }, encoding: 'utf8', timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disabled in standalone mode/);
  assert.equal(fs.existsSync(target), false);
});

test('A-B-A identical artifact bytes do not let the earlier version close the current one', async t => {
  const { config, taskId, input, submit, run } = fixture(t);
  const first = submit();
  const fake = fakeRelay();
  await core.dispatchEvents(config, { eventId: first.event_id, dshRelay: fake.relay });
  const second = submit({ ...input, source_event_id: 'synthetic-v2', revision: 2, artifact: 'symbol,ZZZA' });
  const third = submit({ ...input, source_event_id: 'synthetic-v3', revision: 3 });
  assert.equal(first.sha256, third.sha256);
  assert.notEqual(first.sha256, second.sha256);
  assert.equal((await dsh.settle(core, config, first.event_id, fake.relay)).decision, 'stale');
  core.verifyObligations(config, { taskId });
  assert.equal(JSON.parse(run('obligation', 'show', first.obligation_id)).status, 'superseded');
  assert.equal(core.taskContext(config, taskId).status, 'active');
  await core.dispatchEvents(config, { eventId: third.event_id, dshRelay: fake.relay });
  assert.equal((await dsh.settle(core, config, third.event_id, fake.relay)).decision, 'pass');
  assert.equal(core.verifyObligations(config, { taskId }).resolved, 1);
  assert.equal(core.taskContext(config, taskId).dsh_review.receipt.revision, 3);
  assert.equal(core.taskContext(config, taskId).status, 'completed');
});
