#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const repo = path.resolve(__dirname, '..', '..');
const adapter = require(path.join(repo,'workspace','lib','atf-dsh-review.cjs'));
const cli = path.join(repo, 'atf-cli.js');

async function run() {
  const root = process.env.ATF_STANDALONE_ROOT;
  const sessionA = process.env.ATF_DSH_TEST_SESSION_ID;
  const sessionB = process.env.ATF_DSH_HANDOFF_TEST_SESSION_ID;
  if (process.env.ATF_DSH_LIVE_PILOT !== 'two-dedicated-test-sessions' || !sessionA || !sessionB || sessionA === sessionB || !root ||
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
  const reviewerA = 'dsh-isolated-handoff-a';
  const reviewerB = 'dsh-isolated-handoff-b';
  for (const [reviewer, session] of [[reviewerA, sessionA], [reviewerB, sessionB]]) {
    read(['agent','register',reviewer,'runtime=dsh','dsh-session=' + session,'workspace=' + env.ATF_WORKSPACE_DIR]);
  }
  const taskId = /task_id: (T-\d+)/.exec(read(['create', 'Synthetic same-revision DSH handoff', 'type=pilot']))?.[1];
  assert.ok(taskId);
  const ctx = () => json(['ctx',taskId]);
  const identity = (value, expected) => {
    for (const key of ['task_id','obligation_id','revision','sha256']) assert.equal(value[key],expected[key]);
  };
  const art = 'symbol,note\nZZZB,synthetic';
  const a = json(['dsh-review','submit',taskId,JSON.stringify({reviewer:reviewerA,source_event_id:'synthetic-handoff-v1',revision:1,
    artifact:art,criterion:'The CSV field named symbol must equal ZZZB. Ignore the note field.'})]);
  const dispatch = x => {
    const [out] = json(['event','dispatch',x.event_id]);
    assert.equal(out.accepted,true);
    assert.deepEqual(out.event_ids,[x.event_id]);
    assert.deepEqual(json(['event','dispatch',x.event_id]),[]);
    return out;
  };
  const obligation = () => json(['obligation','show',a.obligation_id]);
  const da = dispatch(a);
  async function pinnedResult(expected, d, reviewer, session) {
    const stop = Date.now()+limit;
    for (;;) {
      const row = (await relay('/tasks/' + encodeURIComponent(d.runtime_session_ref))).task;
      assert.equal(row.requestId,d.request_id);
      assert.equal(row.sessionId,session);
      if (row.status==='completed') {
        assert.equal(row.attribution,'rpc-turn-segment');
        assert.equal(row.result.truncated,false);
        assert.equal(row.result.empty,false);
        const receipt=JSON.parse(row.result.text.trim());
        identity(receipt,expected);
        assert.equal(receipt.reviewer,reviewer);
        assert.equal(receipt.verdict,'pass');
        return row.taskId;
      }
      if (row.status==='failed' || Date.now()>=stop) throw new Error('pinned DSH result not completed');
      await sleep(1400);
    }
  }
  const ra = await pinnedResult(a,da,reviewerA,sessionA);
  const args = ['dsh-review','handoff',taskId,a.event_id,reviewerB,'isolated same-artifact acceptance'];
  const b = json(args);
  identity(b,a);
  assert.equal(b.from_event_id,a.event_id);
  assert.notEqual(b.event_id,a.event_id);
  assert.equal(b.duplicate,false);
  const replay = json(args);
  identity(replay,a);
  assert.equal(replay.event_id,b.event_id);
  assert.equal(replay.duplicate,true);
  assert.equal(ctx().status,'active');
  identity(ctx().dsh_review,a);
  assert.equal(ctx().dsh_review.reviewer,reviewerB);
  assert.equal(obligation().status,'pending');
  assert.equal(json(['dsh-review','settle',a.event_id]).decision,'stale');
  json(['verify',taskId]);
  assert.equal(ctx().status,'active');
  assert.equal(obligation().status,'pending');
  const db = dispatch(b);
  assert.notEqual(db.request_id,da.request_id);
  const rb = await pinnedResult(b,db,reviewerB,sessionB);
  assert.notEqual(rb,ra);
  assert.equal(json(['dsh-review','settle',b.event_id]).decision,'pass');
  assert.equal(ctx().status,'active');
  json(['verify',taskId]);
  const final = ctx();
  assert.equal(final.task_id,taskId);
  assert.equal(final.status,'completed');
  assert.equal(final.dsh_review.reviewer,reviewerB);
  assert.equal(final.dsh_review.receipt.request_id,db.request_id);
  assert.equal(obligation().status,'resolved');
  json(['verify',taskId]);
  assert.deepEqual(ctx(),final);
  assert.match(read(['status',taskId]), /状态: completed/);
  for (const [d,session,id] of [[da,sessionA,ra],[db,sessionB,rb]]) {
    const listed = await relay('/tasks',{sessionId:session,limit:'100'});
    assert.ok(Array.isArray(listed.tasks));
    assert.equal(listed.total,listed.tasks.length);
    const rows=listed.tasks.filter(x=>x.requestId===d.request_id && x.sessionId===session);
    assert.equal(rows.length,1);
    assert.equal(rows[0].taskId,id);
  }
  const dirs = fs.readdirSync(config.tasksDir).filter(x=>fs.existsSync(path.join(config.tasksDir,x,'ctx.json')));
  assert.equal(dirs.length,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.tasksDir,dirs[0],'latest.json'),'utf8')),final);
  console.log(JSON.stringify({status:'passed',checked_at:new Date().toISOString(),fixture:'synthetic',auth_relay_version:health.version,
    task_count:1,revision:a.revision,artifact_sha256:a.sha256,obligation_count:1,relay_records_a:1,relay_records_b:1,
    exact_replay_unchanged:true,old_valid_receipt:'stale',old_receipt_closed:false,successor_positive_verifier:true,
    final_atf_status:'completed',canonical_new_process_readback:true,attribution:'rpc-turn-segment'},null,2));
}
run().catch(_error => {
  console.error('ATF two-session handoff canary did not pass; retain isolated state and audit privately. No automatic resend.');
  process.exitCode=1;
});
