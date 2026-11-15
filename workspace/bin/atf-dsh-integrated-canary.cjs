#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const adapter = require('../lib/atf-dsh-review.cjs');
const cli = path.join(__dirname, '..', '..', 'atf-cli.js');

async function run() {
  const root = process.env.ATF_STANDALONE_ROOT;
  const session = process.env.ATF_DSH_TEST_SESSION_ID;
  if (process.env.ATF_DSH_LIVE_PILOT !== 'dedicated-test-session' || !session || !root ||
      !path.isAbsolute(root) || !fs.existsSync(root) || fs.readdirSync(root).length !== 0)
    throw new Error('dedicated test opt-in, session ID and new private root required');
  const env = {
    HOME: path.join(root, 'home'), ATF_STANDALONE_ROOT: root, ATF_ROOT: root,
    ATF_WORKSPACE_DIR: path.join(root, 'workspace'), ATF_TASKS_DIR: path.join(root, 'tasks'),
    ATF_DATA_DIR: path.join(root, 'data'), ATF_DSH_RELAY_TOKEN: process.env.ATF_DSH_RELAY_TOKEN,
    ...(process.env.ATF_DSH_RELAY_URL ? { ATF_DSH_RELAY_URL: process.env.ATF_DSH_RELAY_URL } : {}),
  };
  for (const d of [env.HOME, env.ATF_WORKSPACE_DIR, env.ATF_TASKS_DIR, env.ATF_DATA_DIR]) fs.mkdirSync(d, { mode: 0o700 });
  const config = { dataDir: env.ATF_DATA_DIR, tasksDir: env.ATF_TASKS_DIR };
  const relay = adapter.runtimeRelay();
  const health = await relay('/health');
  if (health.name !== 'dsh-task-dispatch' || health.version !== '0.6.3' || health.auth !== 'token')
    throw new Error('requires known authenticated local relay 0.6.3');
  const limit = Number(process.env.ATF_DSH_PILOT_TIMEOUT_MS || 120_000);
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > 300_000) throw new Error('invalid time limit');
  const read = (args, more = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args], { env: { ...env, ...more }, encoding: 'utf8', timeout: 10_000 });
    if (r.status !== 0 || r.stderr) throw new Error('ATF command failed: ' + args.slice(0, 2).filter(x => !x.startsWith('EVT')).join(' '));
    return r.stdout;
  };
  const json = (args, more) => JSON.parse(read(args, more));
  const reviewer = 'dsh-integrated-reviewer';
  read(['agent', 'register', reviewer, 'runtime=dsh', 'dsh-session=' + session, 'workspace=' + env.ATF_WORKSPACE_DIR]);
  const created = read(['create', 'Synthetic ATF cross runtime review', 'type=pilot']);
  const taskId = /task_id: (T-\d+)/.exec(created)?.[1];
  assert.ok(taskId);
  const current = () => json(['ctx', taskId]);
  assert.equal(current().status, 'created');
  function checkLegacyGuard() {
    for (const args of [['update', taskId, 'completed'], ['update', taskId, 'delivered'], ['delivered', taskId]]) {
      const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 10000 });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /requires valid DSH verification/);
      assert.equal(current().status, 'active');
    }
  }
  const input = (n, artifact) => JSON.stringify({ reviewer,
    source_event_id: 'synthetic-v' + n, revision: n, artifact,
    criterion: 'The CSV field named symbol must equal ZZZB. Ignore the note field.' });
  function submit(n, artifact) {
    const args = ['dsh-review', 'submit', taskId, input(n, artifact)];
    const item = json(args);
    assert.equal(item.duplicate, false);
    assert.equal(json(args).duplicate, true);
    assert.equal(current().task_id, taskId);
    assert.equal(current().dsh_review.revision, n);
    assert.equal(json(['obligation', 'show', item.obligation_id]).status, 'pending');
    return item;
  }
  function event(x) { return json(['event', 'list']).find(row => row.event_id === x.event_id); }
  function dispatch(x, drop = false) {
    const [d] = json(['event', 'dispatch', x.event_id], drop ? { ATF_DSH_DROP_ACCEPT_ACK: '1' } : {});
    assert.deepEqual(d.event_ids, [x.event_id]);
    assert.deepEqual(json(['event', 'dispatch', x.event_id]), []);
    return d;
  }
  async function waitFor(check, phase) {
    const stop = Date.now() + limit;
    while (Date.now() < stop) {
      const got = await check();
      if (got !== null) return got;
      await sleep(1400);
    }
    throw new Error(phase + ' timed out; no retries were dispatched');
  }
  async function listing() {
    return relay('/tasks', { sessionId: session, limit: '100' });
  }
  async function matching(id, list) {
    const l = list || await listing();
    if (!Array.isArray(l.tasks) || l.total !== l.tasks.length) throw new Error('relay list truncated or unavailable');
    const m = l.tasks.filter(x => x.requestId === id && x.sessionId === session);
    if (m.length > 1) throw new Error('multiple relay records for one intent');
    return m[0] || null;
  }
  async function settle(item) {
    return waitFor(() => {
      const r = json(['dsh-review', 'settle', item.event_id]);
      if (['failed', 'reviewer_not_authorized'].includes(r.state)) throw new Error('DSH review cannot continue');
      return r.state === 'review_recorded' ? r : null;
    }, 'DSH review');
  }

  const v1 = submit(1, 'symbol,note\nZZZA,wrong');
  checkLegacyGuard();
  const d1 = dispatch(v1, true);
  assert.equal(d1.injected_accept_ack_loss, true);
  assert.equal(d1.dsh_state, 'unknown');
  assert.equal(event(v1).status, 'awaiting_reconcile');
  const r1 = await settle(v1);
  assert.equal(r1.decision, 'reject');
  assert.equal(event(v1).status, 'dispatched');
  assert.equal(current().status, 'active');
  json(['verify', taskId]);
  assert.equal(current().status, 'assigned');
  assert.equal(current().decision.status, 'needs_revision');
  assert.equal(json(['obligation', 'show', v1.obligation_id]).status, 'rejected');

  const v2 = submit(2, 'symbol,note\nZZZB,valid older');
  const d2 = dispatch(v2);
  assert.equal(d2.accepted, true);
  await waitFor(async () => {
    const row = await matching(d2.request_id);
    if (row?.status === 'failed') throw new Error('DSH v2 failed');
    if (row?.status !== 'completed') return null;
    assert.equal(row.attribution, 'rpc-turn-segment');
    assert.equal(row.result.truncated, false);
    let r;
    try { r = JSON.parse(row.result.text.trim()); } catch { throw new Error('DSH v2 did not return JSON'); }
    for (const k of ['task_id', 'obligation_id', 'revision', 'sha256']) assert.equal(r[k], v2[k]);
    assert.equal(r.reviewer, reviewer);
    assert.equal(r.verdict, 'pass');
    return true;
  }, 'held v2 receipt');
  const v3 = submit(3, 'symbol,note\nZZZB,valid current');
  assert.equal((await settle(v2)).decision, 'stale');
  json(['verify', taskId]);
  assert.equal(json(['obligation', 'show', v2.obligation_id]).status, 'superseded');
  assert.equal(current().status, 'active');
  assert.equal(current().dsh_review.revision, 3);

  checkLegacyGuard();
  const d3 = dispatch(v3);
  assert.equal(d3.accepted, true);
  assert.equal((await settle(v3)).decision, 'pass');
  assert.equal(current().status, 'active'); // Imported receipt alone cannot close task.
  json(['verify', taskId]);
  const final = current();
  assert.equal(final.task_id, taskId);
  assert.equal(final.status, 'completed');
  assert.equal(final.dsh_review.status, 'accepted');
  assert.equal(final.dsh_review.receipt.sha256, v3.sha256);
  assert.equal(json(['obligation', 'show', v3.obligation_id]).status, 'resolved');
  assert.match(read(['status', taskId]), /状态: completed/);
  const finalListing = await listing();
  const relayRows = await Promise.all([d1, d2, d3].map(x => matching(x.request_id, finalListing)));
  assert.equal(relayRows.filter(Boolean).length, 3);
  assert.equal(new Set(relayRows.map(x => x.taskId)).size, 3);
  assert.equal(json(['event', 'list']).length, 3);
  const readback = fs.readdirSync(config.tasksDir).filter(x => fs.existsSync(path.join(config.tasksDir, x, 'ctx.json')));
  assert.equal(readback.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.tasksDir, readback[0], 'latest.json'), 'utf8')), final);
  console.log(JSON.stringify({ status: 'passed', checked_at: new Date().toISOString(), task_id: taskId,
    fixture: 'synthetic', relay_version: health.version, canonical_cli_readback: true, legacy_completion_bypass_blocked: true, injected_ack_loss_reconciled: true,
    phases: [v1, v2, v3].map((v, i) => ({ revision: v.revision, sha256: v.sha256, atf_obligation: ['rejected', 'superseded', 'resolved'][i],
      relay_rows: 1, attribution: relayRows[i].attribution })), final_atf_status: final.status,
  }, null, 2));
}
run().catch(e => {
  console.error('Integrated ATF/DSH test did not pass:', e instanceof assert.AssertionError ? 'an acceptance assertion failed; keep isolated state' : e.message);
  process.exitCode = 1;
});
