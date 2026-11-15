const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const core = require('../lib/atf-reliability.cjs');
const dsh = require('../lib/atf-dsh-review.cjs');
const intake = require('../lib/atf-public-research.cjs');
const cli = path.resolve(__dirname, '..', '..', 'atf-cli.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-source-test-'));
  const inbox = path.join(root, 'public-research-inbox');
  const env = { HOME: path.join(root, 'home'), ATF_ROOT: root, ATF_STANDALONE_ROOT: root,
    ATF_TASKS_DIR: path.join(root, 'tasks'), ATF_DATA_DIR: path.join(root, 'data'),
    ATF_WORKSPACE_DIR: path.join(root, 'workspace'), ATF_PUBLIC_RESEARCH_IMPORT: '1' };
  for (const dir of [inbox, env.HOME, env.ATF_TASKS_DIR, env.ATF_DATA_DIR, env.ATF_WORKSPACE_DIR])
    fs.mkdirSync(dir, { mode: 0o700 });
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const config = { dataDir: env.ATF_DATA_DIR, tasksDir: env.ATF_TASKS_DIR };
  function invoke(args, profile = env) {
    return spawnSync(process.execPath, [cli, ...args], { env: profile, encoding: 'utf8', timeout: 10_000 });
  }
  function run(...args) {
    const cp = invoke(args);
    assert.equal(cp.status, 0, cp.stderr);
    return cp.stdout;
  }
  function create(label = 'Synthetic public research') { return /task_id: (T-\d+)/.exec(run('create', label))[1]; }
  run('agent', 'register', 'dsh-intake-reviewer', 'runtime=dsh', 'dsh-session=fixture-intake', 'workspace=' + env.ATF_WORKSPACE_DIR);
  const task = create();
  const names = ['source.json', 'report.md'];
  const original = '# Synthetic complete research report\n\nScope: fixture example\n\nFinding: the symbol is ZZZB.\n\nEnd of synthetic report.\n';
  const manifest = { source_kind: 'synthetic', source_id: 'fixture-report', source_revision: 1,
    source_url: 'https://example.invalid/research/fixture-report', content_kind: 'complete_research',
    artifact_sha256: hash(original), reviewer: 'dsh-intake-reviewer', criterion: 'Confirm the symbol is ZZZB.' };
  const write = (meta = manifest, content = original) => {
    fs.writeFileSync(path.join(inbox, names[0]), JSON.stringify(meta), { mode: 0o600 });
    fs.writeFileSync(path.join(inbox, names[1]), content, { mode: 0o600 });
  };
  write();
  const approveArgs = (target = task) => [target, ...names];
  const invokeImport = (target = task) => invoke(['dsh-review', 'public-import', target, ...names]);
  const imported = (target = task) => JSON.parse(run('dsh-review', 'public-import', target, ...names));
  const current = () => JSON.parse(run('ctx', task));
  return { config, env, inbox, task, names, manifest, original, write, run, invoke, approveArgs, invokeImport, imported, current, create };
}

function operatorFixture(f, { confirm = true, change, task } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  let preview = '';
  let prompted = false;
  output.on('data', bytes => {
    preview += bytes;
    const match = /Type "(APPROVE [a-f0-9]{12})"/.exec(preview);
    if (match && !prompted) {
      prompted = true;
      queueMicrotask(() => {
        if (change) change();
        input.end((confirm ? match[1] : '') + '\n');
      });
    }
  });
  return intake.approve(core, f.config, dsh, f.approveArgs(task), { input, output });
}

function mockReviewer() {
  const sent = [];
  const calls = [];
  const relay = async (endpoint, query, payload) => {
    calls.push(endpoint);
    if (endpoint === '/send') {
      const identity = JSON.parse(payload.text.split('\n').find(x => x.startsWith('{')));
      const row = { taskId: 'fixture-' + (sent.length + 1), requestId: payload.requestId, sessionId: payload.sessionId,
        status: 'completed', attribution: 'rpc-turn-segment',
        result: { empty: false, truncated: false, text: JSON.stringify({ ...identity, verdict: 'pass' }) } };
      sent.push(row);
      return row;
    }
    if (endpoint.startsWith('/tasks/')) return { task: sent.find(row => '/tasks/' + row.taskId === endpoint) };
    const tasks = sent.filter(row => row.sessionId === query.sessionId);
    return { total: tasks.length, tasks };
  };
  return { relay, calls, sent };
}

test('approval and import do not dispatch; one approved source enters existing mailbox and DSH verifier', async t => {
  const f = fixture(t);
  assert.notEqual(f.invokeImport().status, 0);
  const noTty = f.invoke(['dsh-review', 'public-approve', f.task, ...f.names]);
  assert.match(noTty.stderr, /interactive trusted local operator TTY/);
  const noOptIn = f.invoke(['dsh-review', 'public-import', f.task, ...f.names], { ...f.env, ATF_PUBLIC_RESEARCH_IMPORT: '0' });
  assert.match(noOptIn.stderr, /explicit local opt-in/);
  await assert.rejects(operatorFixture(f, { confirm: false }), /did not approve/);
  const result = await operatorFixture(f);
  assert.equal(result.status, 'approved_local_only');
  assert.equal(core.collection(core.paths(f.config).events).length, 0);
  assert.equal(f.current().status, 'created');
  const receipts = path.join(f.env.ATF_DATA_DIR, 'public-research-approvals');
  const receipt = path.join(receipts, result.approval_id + '.json');
  assert.equal(fs.lstatSync(receipt).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(receipt, 'utf8'), /Scope: fixture example/);
  const imported = f.imported();
  assert.equal(imported.source_state, 'imported');
  assert.equal(imported.dispatch_state, 'pending');
  assert.equal(imported.duplicate, false);
  assert.equal(core.collection(core.paths(f.config).dispatches).length, 0);
  assert.equal(f.imported().event_id, imported.event_id);
  assert.equal(f.imported().duplicate, true);
  assert.equal(core.collection(core.paths(f.config).events).length, 1);
  assert.equal(core.collection(core.paths(f.config).obligations).length, 1);
  const current = f.current();
  const source = current.dsh_public_research[0];
  assert.equal(source.source_url, f.manifest.source_url);
  assert.equal(source.source_revision, 1);
  assert.equal(source.artifact_sha256, hash(f.original));
  assert.equal(source.approval_id, result.approval_id);
  assert.equal(current.outputs.review_artifact.text, f.original);
  const mock = mockReviewer();
  assert.deepEqual(await core.dispatchEvents(f.config, { dshRelay: mock.relay }), []);
  assert.deepEqual(mock.calls, []);
  assert.equal((await core.dispatchEvents(f.config, { eventId: imported.event_id, dshRelay: mock.relay }))[0].accepted, true);
  await dsh.settle(core, f.config, imported.event_id, mock.relay);
  assert.equal(f.current().status, 'active');
  assert.equal(core.verifyObligations(f.config, { taskId: f.task }).resolved, 1);
  assert.equal(f.current().status, 'completed');
  assert.equal(f.imported().dispatch_state, 'dispatched'); // Source import may already have moved beyond queued.
  assert.equal(mock.calls.filter(x => x === '/send').length, 1);
});

test('exact import replay recovers mailbox projection; approved source cannot fork another task or reuse revision', async t => {
  const f = fixture(t);
  await operatorFixture(f);
  const one = f.imported();
  const p = core.paths(f.config);
  const eventPath = path.join(p.events, one.event_id + '.json');
  const prior = core.readJson(eventPath);
  fs.unlinkSync(eventPath);
  fs.unlinkSync(path.join(p.dedupe, prior.dedupe_key + '.json'));
  const recovered = f.imported();
  assert.equal(recovered.event_id, one.event_id);
  assert.equal(f.current().dsh_public_research.length, 1);
  assert.equal(core.collection(p.obligations).length, 1);
  const otherTask = f.create('Same source competing task');
  await operatorFixture(f, { task: otherTask });
  assert.match(f.invokeImport(otherTask).stderr, /different canonical task/);
  const altered = f.original + 'Different bytes for the same revision';
  f.write({ ...f.manifest, artifact_sha256: hash(altered) }, altered);
  assert.match(f.invokeImport().stderr, /exact separate trusted operator approval/);
  await operatorFixture(f);
  assert.match(f.invokeImport().stderr, /same source revision conflicts/);
  assert.equal(core.collection(p.events).length, 1);
  assert.equal(f.current().outputs.review_artifact.text, f.original);
});

test('nonlocal, digest-only and mismatching bytes fail without creating receipts or events', async t => {
  const f = fixture(t);
  assert.match(f.invoke(['dsh-review', 'public-import', f.task, '../source.json', f.names[1]]).stderr, /local regular filename/);
  f.write({ ...f.manifest, content_kind: 'mail_digest' });
  await assert.rejects(operatorFixture(f), /complete research artifacts/);
  f.write({ ...f.manifest, source_url: 'https://example.invalid/research/different' });
  await assert.rejects(operatorFixture(f), /source URL is not canonical/);
  f.write({ ...f.manifest, permission_granted: true });
  await assert.rejects(operatorFixture(f), /permission assertions are not accepted/);
  f.write(f.manifest, f.original + 'changed');
  await assert.rejects(operatorFixture(f), /do not match declared SHA-256/);
  const large = 'x'.repeat(10_001);
  f.write({ ...f.manifest, artifact_sha256: hash(large) }, large);
  await assert.rejects(operatorFixture(f), /bounded regular file/);
  fs.unlinkSync(path.join(f.inbox, f.names[1]));
  fs.symlinkSync(f.names[0], path.join(f.inbox, f.names[1]));
  await assert.rejects(operatorFixture(f), /ELOOP/);
  assert.equal(f.current().status, 'created');
  assert.equal(core.collection(core.paths(f.config).events).length, 0);
  assert.equal(fs.existsSync(path.join(f.env.ATF_DATA_DIR, 'public-research-approvals')), false);
});

test('approval challenge detects changed bytes, and reviewer revocation blocks approved import', async t => {
  const f = fixture(t);
  const altered = f.original + 'Changed after preview.';
  await assert.rejects(operatorFixture(f, { change: () => f.write({ ...f.manifest, artifact_sha256: hash(altered) }, altered) }),
    /changed after preview/);
  assert.equal(fs.existsSync(path.join(f.env.ATF_DATA_DIR, 'public-research-approvals')), false);
  f.write();
  await operatorFixture(f);
  f.run('agent', 'register', 'dsh-intake-reviewer', 'enabled=false');
  assert.match(f.invokeImport().stderr, /enabled DSH reviewer/);
  assert.equal(f.current().status, 'created');
});

test('imported sources forbid destination handoff or bare submit', async t => {
  const f = fixture(t);
  await operatorFixture(f);
  const first = f.imported();
  f.run('agent', 'register', 'dsh-successor', 'runtime=dsh', 'dsh-session=fixture-successor');
  const handoff = f.invoke(['dsh-review', 'handoff', f.task, first.event_id, 'dsh-successor', 'Synthetic scope check']);
  assert.match(handoff.stderr, /approval is limited to the exact registered reviewer and session/);
  assert.equal(f.current().dsh_review.reviewer, f.manifest.reviewer);
  assert.equal(core.collection(core.paths(f.config).events).length, 1);
  assert.equal(f.imported().duplicate, true);
  const bypass = { reviewer: f.manifest.reviewer, revision: 2, source_event_id: 'generic', artifact: f.original, criterion: f.manifest.criterion };
  assert.match(f.invoke(['dsh-review', 'submit', f.task, JSON.stringify(bypass)]).stderr, /public-import with exact approval/);
});

test('dispatch verifies the original approved destination and exact receipt before any relay call', async t => {
  const f = fixture(t);
  const approval = await operatorFixture(f);
  const first = f.imported();
  const source = f.current().dsh_public_research[0];
  assert.equal(source.reviewer_session_sha256, hash('fixture-intake'));
  const receiver = mockReviewer();
  const receipts = path.join(f.env.ATF_DATA_DIR, 'public-research-approvals');
  const receiptPath = path.join(receipts, approval.approval_id + '.json');
  const receipt = fs.readFileSync(receiptPath);
  // Isolated simulated loss of the approval evidence, not an access to any real approval.
  fs.unlinkSync(receiptPath);
  assert.equal((await core.dispatchEvents(f.config, { eventId: first.event_id, dshRelay: receiver.relay }))[0].dsh_state,
    'blocked_review_dispatch');
  assert.deepEqual(receiver.calls, []);
  fs.writeFileSync(receiptPath, receipt, { mode: 0o600 });
  assert.equal((await core.dispatchEvents(f.config, { eventId: first.event_id, dshRelay: receiver.relay }))[0].accepted, true);
  assert.equal(receiver.sent[0].sessionId, 'fixture-intake');
});


test('later approval can import a new source version only while this original task is unresolved', async t => {
  const f = fixture(t);
  const rogue = { reviewer: f.manifest.reviewer, revision: 1,
    source_event_id: 'public-research:unapproved-fixture', artifact: f.original, criterion: f.manifest.criterion };
  assert.match(f.invoke(['dsh-review', 'submit', f.task, JSON.stringify(rogue)]).stderr, /public-import with exact approval/);
  await operatorFixture(f);
  const first = f.imported();
  const updated = f.original + 'Version 2 complete text.';
  f.write({ ...f.manifest, source_revision: 2, artifact_sha256: hash(updated) }, updated);
  await operatorFixture(f);
  const second = f.imported();
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(first.task_id, second.task_id);
  assert.equal(second.revision, 2);
  assert.deepEqual(f.current().dsh_public_research.map(r => r.source_revision), [1, 2]);
  const receiver = mockReviewer();
  assert.equal((await core.dispatchEvents(f.config, { eventId: first.event_id, dshRelay: receiver.relay }))[0].dsh_state, 'stale');
  assert.deepEqual(receiver.calls, []);
  assert.equal((await core.dispatchEvents(f.config, { eventId: second.event_id, dshRelay: receiver.relay }))[0].accepted, true);
  assert.equal((await dsh.settle(core, f.config, second.event_id, receiver.relay)).decision, 'pass');
  assert.equal(core.verifyObligations(f.config, { taskId: f.task }).resolved, 1);
  f.write({ ...f.manifest, source_revision: 3 });
  await operatorFixture(f);
  assert.match(f.invokeImport().stderr, /task cannot be reviewed/);
  assert.equal(f.current().status, 'completed');
});
