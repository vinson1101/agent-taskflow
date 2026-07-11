#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const core = require('../lib/atf-reliability.cjs');
const { atomicWriteJson } = require('../lib/atf-storage.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const cli = path.join(repoRoot, 'atf-cli.js');
const reliabilityCli = path.join(repoRoot, 'workspace', 'bin', 'atf-reliability.cjs');
const controlPlane = path.join(repoRoot, 'workspace', 'bin', 'atf-control-plane.cjs');
const smokeRoot = path.join(repoRoot, '.tmp-atf-reliability-smoke');

function assert(value, message) { if (!value) throw new Error(message); }
function run(script, args, env, expectedStatus = 0) {
  const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
  if (child.status !== expectedStatus) throw new Error(`${path.basename(script)} ${args.join(' ')} exited ${child.status}\n${child.stdout}\n${child.stderr}`);
  return child.stdout;
}
function taskId(output) {
  const match = output.match(/T-\d+/);
  if (!match) throw new Error(`task id missing: ${output}`);
  return match[0];
}
function json(output) { return JSON.parse(output); }

async function main() {
  fs.rmSync(smokeRoot, { recursive: true, force: true });
  const env = {
    ...process.env,
    ATF_TASKS_DIR: path.join(smokeRoot, 'tasks'),
    ATF_WORKSPACE_DIR: path.join(smokeRoot, 'workspace'),
    ATF_DATA_DIR: path.join(smokeRoot, 'data'),
  };
  const config = { dataDir: env.ATF_DATA_DIR, tasksDir: env.ATF_TASKS_DIR };
  for (const dir of [env.ATF_TASKS_DIR, env.ATF_WORKSPACE_DIR, env.ATF_DATA_DIR]) fs.mkdirSync(dir, { recursive: true });

  const stubWorkspace = path.join(smokeRoot, 'workspace-stub');
  run(cli, ['agent', 'register', 'stub-agent', `workspace=${stubWorkspace}`, 'runtime=stub'], env);
  const learningsDir = path.join(stubWorkspace, '.learnings');
  fs.mkdirSync(learningsDir, { recursive: true });
  fs.writeFileSync(path.join(learningsDir, 'LEARNINGS.md'), '[LRN-20260711-001]\nKeep durable truth outside sessions\n\n[LRN-20260711-002]\nKeep durable truth outside sessions\n\n[LRN-20260711-003]\nKeep durable truth outside sessions\n');
  run(cli, ['learnings', 'promote'], env);
  assert(fs.readFileSync(path.join(env.ATF_WORKSPACE_DIR, 'MEMORY.md'), 'utf8').includes('Keep durable truth outside sessions'), 'default learnings promote failed');

  const atomicTarget = path.join(smokeRoot, 'atomic.json');
  const atomicWriter = path.join(smokeRoot, 'atomic-writer.cjs');
  const storageModule = path.join(repoRoot, 'workspace', 'lib', 'atf-storage.cjs');
  fs.writeFileSync(atomicWriter, `require(${JSON.stringify(storageModule)}).atomicWriteJson(process.argv[2], {writer: process.argv[3], payload: 'x'.repeat(10000)});\n`);
  await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [atomicWriter, atomicTarget, String(index)], { env });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`atomic writer exited ${code}`)));
  })));
  assert(core.readJson(atomicTarget)?.payload?.length === 10000, 'concurrent atomic JSON write was truncated');

  const assignedTask = taskId(run(cli, ['create', 'Reliability session recovery demo'], env));
  run(cli, ['assign', assignedTask, 'stub-agent'], env);
  const assignEvent = core.collection(core.paths(config).events).find(event => event.task_id === assignedTask && event.event_type === 'assign');
  assert(assignEvent?.runtime === 'stub', 'assign must use registry runtime');

  const duplicateInput = { event_type: 'assign', agent: 'stub-agent', task_id: assignedTask, source_ref: 'same-source' };
  const first = core.emitEvent(config, duplicateInput);
  const duplicate = core.emitEvent(config, duplicateInput);
  assert(duplicate.duplicate === true && duplicate.event_id === first.event_id, 'event dedupe failed');
  const dispatchStarted = Date.now();
  const stubDispatches = await core.dispatchEvents(config);
  assert(stubDispatches.length === 1 && stubDispatches[0].accepted, 'stub dispatch failed');
  assert(Date.now() - dispatchStarted < 5000, 'event dispatch exceeded 5 seconds');
  assert(stubDispatches[0].event_ids.length >= 2, 'per-agent debounce did not merge events');

  run(cli, ['update', assignedTask, 'active', 'by=stub-agent'], env);
  const verifyAssigned = core.verifyObligations(config, { taskId: assignedTask });
  assert(verifyAssigned.resolved >= 1, 'task status verifier did not resolve obligation');

  const messageOutput = run(cli, ['msg', 'send', assignedTask, 'coordinator', 'stub-agent', 'request', 'Please acknowledge'], env);
  const messageId = messageOutput.match(/MSG-\d{8}-[a-f0-9]+/)?.[0];
  assert(messageId, 'message id missing');
  run(cli, ['msg', 'ack', assignedTask, messageId, 'stub-agent', 'acked'], env);
  const verifyMessage = core.verifyObligations(config, { taskId: assignedTask });
  assert(verifyMessage.resolved >= 1, 'message verifier did not resolve obligation');

  const contextDir = path.join(smokeRoot, 'sessions');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, 'session.jsonl'), `Reliability session recovery demo token=private-value\n`);
  process.env.ATF_SESSION_CONTEXT_PATHS = contextDir;
  const contextEvent = core.emitEvent(config, { event_type: 'context_probe', agent: 'stub-agent', task_id: assignedTask, source_ref: 'context-probe', required_writebacks: [] });
  const envelope = core.buildWorkEnvelope(config, contextEvent);
  assert(envelope.schema === 'atf.work-envelope.v1', 'work envelope schema missing');
  assert(envelope.session_context[0]?.snippet.includes('token=[REDACTED]'), 'session context was not redacted');

  const overdue = core.createObligation(config, { task_id: assignedTask, agent: 'stub-agent', kind: 'artifact_reference', due_at: new Date(0).toISOString(), max_attempts: 1 });
  core.verifyObligations(config, { taskId: assignedTask });
  const escalated = core.readJson(path.join(core.paths(config).obligations, `${overdue.obligation_id}.json`));
  assert(escalated.status === 'escalation_required' && escalated.recovery_state === 'attention', 'exhausted obligation did not escalate');

  const hermesWorkspace = path.join(smokeRoot, 'workspace-hermes');
  run(cli, ['agent', 'register', 'hermes-agent', `workspace=${hermesWorkspace}`, 'runtime=hermes'], env);
  const hermesTask = taskId(run(cli, ['create', 'Hermes adapter canary'], env));
  run(cli, ['assign', hermesTask, 'hermes-agent'], env);
  const hermesEvent = core.collection(core.paths(config).events).find(event => event.task_id === hermesTask && event.runtime === 'hermes');
  let hermesBody = null;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      hermesBody = JSON.parse(body);
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ run_id: 'run_atf_canary', status: 'started' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.ATF_HERMES_API_URL = `http://127.0.0.1:${server.address().port}`;
  const hermesDispatch = await core.dispatchEvents(config, { eventId: hermesEvent.event_id });
  server.close();
  assert(hermesDispatch[0]?.runtime_session_ref === 'run_atf_canary', 'Hermes run reference missing');
  assert(hermesBody?.input?.includes('Work Envelope'), 'Hermes did not receive Work Envelope');

  const openclawWorkspace = path.join(smokeRoot, 'workspace-openclaw');
  const openclawBackend = path.join(smokeRoot, 'openclaw-adapter.cjs');
  fs.writeFileSync(openclawBackend, `console.log(JSON.stringify({accepted:true,runtime_session_ref:'openclaw:canary'}));\n`);
  run(cli, ['agent', 'register', 'openclaw-agent', `workspace=${openclawWorkspace}`, 'runtime=openclaw'], env);
  const openclawTask = taskId(run(cli, ['create', 'OpenClaw adapter canary'], env));
  run(cli, ['assign', openclawTask, 'openclaw-agent'], env);
  const openclawEvent = core.collection(core.paths(config).events).find(event => event.task_id === openclawTask && event.runtime === 'openclaw');
  process.env.ATF_OPENCLAW_ADAPTER_CMD = `${process.execPath} ${openclawBackend}`;
  const openclawDispatch = await core.dispatchEvents(config, { eventId: openclawEvent.event_id });
  assert(openclawDispatch[0]?.runtime_session_ref === 'openclaw:canary', 'OpenClaw adapter canary failed');

  const a2aInput = path.join(smokeRoot, 'a2a-inbound.json');
  atomicWriteJson(a2aInput, {
    task: {
      id: 'a2a-task-1',
      contextId: 'a2a-context-1',
      status: { state: 'TASK_STATE_SUBMITTED', message: { messageId: 'a2a-msg-1', role: 'ROLE_USER', parts: [{ text: 'A2A inbound smoke' }] } },
      metadata: { atf: { agent: 'stub-agent' } },
    },
  });
  const inbound = json(run(reliabilityCli, ['a2a', 'inbound', a2aInput], env));
  assert(inbound.mapping.atf_task_id && inbound.task.status.state === 'TASK_STATE_SUBMITTED', 'A2A inbound mapping failed');
  const inboundDir = fs.readdirSync(env.ATF_TASKS_DIR).map(name => path.join(env.ATF_TASKS_DIR, name)).find(dir => core.readJson(path.join(dir, 'ctx.json'))?.task_id === inbound.mapping.atf_task_id);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(inboundDir, fileName);
    const ctx = core.readJson(filePath);
    ctx.outputs = { report: 'A2A artifact smoke' };
    atomicWriteJson(filePath, ctx);
  }
  const pushInput = path.join(smokeRoot, 'a2a-push.json');
  atomicWriteJson(pushInput, { task: { id: 'a2a-task-1', status: { state: 'TASK_STATE_COMPLETED' } } });
  const pushEvent = json(run(reliabilityCli, ['a2a', 'push', pushInput], env));
  assert(pushEvent.event_type === 'a2a_push', 'A2A push did not enter event fast path');
  const outbound = json(run(reliabilityCli, ['a2a', 'outbound', inbound.mapping.atf_task_id], env));
  assert(outbound.id === inbound.mapping.a2a_task_id && outbound.status.state === 'TASK_STATE_COMPLETED', 'A2A outbound status mapping failed');
  assert(outbound.artifacts[0]?.parts[0]?.text === 'A2A artifact smoke', 'A2A outbound artifact mapping failed');

  const lockPath = path.join(env.ATF_DATA_DIR, 'control-plane.lock');
  fs.writeFileSync(lockPath, '{}\n');
  const locked = spawnSync(process.execPath, [controlPlane, '--quiet-idle'], { encoding: 'utf8', env });
  fs.unlinkSync(lockPath);
  assert(locked.status === 1 && locked.stderr.includes('already running'), 'control-plane lock did not reject a second instance');

  const metrics = core.metrics(config);
  assert(metrics.dispatch_latency_ms.p95 < 5000, 'metrics p95 target failed');
  assert(metrics.events.session_wakes >= 2 && metrics.events.duplicate_count >= 1, 'metrics missing wake or duplicate counts');

  fs.rmSync(smokeRoot, { recursive: true, force: true });
  console.log('ATF reliability control-plane smoke passed.');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
