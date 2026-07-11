#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('../lib/atf-reliability.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const config = {
  dataDir: process.env.ATF_DATA_DIR || path.join(process.env.ATF_WORKSPACE_DIR || path.join(process.env.ATF_ROOT || '/root/.openclaw', 'workspace'), 'agent-taskflow', 'data'),
  tasksDir: process.env.ATF_TASKS_DIR || path.join(process.env.ATF_ROOT || '/root/.openclaw', 'atf-tasks'),
};

function output(value) { console.log(JSON.stringify(value, null, 2)); }
function inputJson(value) {
  if (!value) throw new Error('JSON file or JSON string is required');
  return JSON.parse(fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value);
}
function options(parts) {
  return Object.fromEntries(parts.filter(part => part.includes('=')).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index), part.slice(index + 1)];
  }));
}
function runAtf(args) {
  const child = spawnSync(process.execPath, [path.join(repoRoot, 'atf-cli.js'), ...args], { encoding: 'utf8', env: process.env });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `atf exited ${child.status}`);
  return child.stdout;
}
function findTaskId(text) {
  const match = String(text).match(/T-\d+/);
  if (!match) throw new Error(`ATF task id not found in output: ${text}`);
  return match[0];
}
function a2aMessage(payload) {
  return payload?.params?.message || payload?.message || payload?.task?.history?.at(-1) || payload?.result?.message || null;
}
function a2aText(message, payload) {
  const parts = message?.parts || payload?.task?.status?.message?.parts || [];
  return parts.map(part => part.text || part.data || '').filter(Boolean).join('\n') || payload?.task?.id || 'A2A task';
}
function mapA2AStatus(state) {
  const value = String(state || '').toUpperCase();
  if (value.endsWith('COMPLETED')) return 'completed';
  if (value.endsWith('CANCELED') || value.endsWith('REJECTED')) return 'cancelled';
  if (value.endsWith('FAILED')) return 'blocked';
  if (value.endsWith('INPUT_REQUIRED') || value.endsWith('AUTH_REQUIRED')) return 'blocked';
  if (value.endsWith('WORKING')) return 'active';
  return 'assigned';
}
function a2aInbound(payload) {
  const message = a2aMessage(payload);
  const externalTask = payload.task || payload.result?.task || null;
  const metadata = message?.metadata || externalTask?.metadata || {};
  const agent = metadata?.atf?.agent || metadata?.agent || process.env.ATF_A2A_DEFAULT_AGENT;
  if (!agent) throw new Error('A2A inbound requires metadata.atf.agent or ATF_A2A_DEFAULT_AGENT');
  const description = a2aText(message, payload).slice(0, 500);
  const taskId = findTaskId(runAtf(['create', description, 'type=a2a', 'priority=normal']));
  runAtf(['assign', taskId, agent]);
  const a2aTaskId = externalTask?.id || message?.taskId || message?.task_id || `a2a:${taskId}`;
  const mapping = { schema: 'atf.a2a-mapping.v1', a2a_task_id: a2aTaskId, context_id: externalTask?.contextId || message?.contextId || null, atf_task_id: taskId, agent, created_at: new Date().toISOString() };
  core.writeRecord(core.paths(config).a2a, encodeURIComponent(a2aTaskId), mapping);
  return { mapping, task: core.toA2ATask(config, taskId, mapping) };
}
function findMapping(a2aTaskId) {
  return core.collection(core.paths(config).a2a).find(item => item.a2a_task_id === a2aTaskId) || null;
}

async function main() {
  const [command, sub, ...rest] = process.argv.slice(2);
  if (command === 'event' && sub === 'emit') {
    const [eventType, agent, taskId, ...optionParts] = rest;
    const parsed = options(optionParts);
    output(core.emitEvent(config, { event_type: eventType, agent, task_id: taskId || null, runtime: parsed.runtime, source_ref: parsed.source_ref, guidance: parsed.guidance }));
    return;
  }
  if (command === 'event' && sub === 'dispatch') {
    output(await core.dispatchEvents(config, { eventId: rest[0] || null }));
    return;
  }
  if (command === 'event' && (sub === 'list' || !sub)) {
    output(core.collection(core.paths(config).events));
    return;
  }
  if (command === 'obligation' && (sub === 'list' || !sub)) {
    output(core.pendingObligations(config, rest[0] || null));
    return;
  }
  if (command === 'envelope') {
    const eventId = sub;
    const event = core.readJson(path.join(core.paths(config).events, `${eventId}.json`));
    if (!event) throw new Error(`event not found: ${eventId}`);
    output(core.buildWorkEnvelope(config, event));
    return;
  }
  if (command === 'verify') {
    output(core.verifyObligations(config, { taskId: sub || null }));
    return;
  }
  if (command === 'reconcile') {
    const verifier = core.verifyObligations(config);
    const dispatch = await core.dispatchEvents(config);
    output({ schema: 'atf.reconciler-run.v1', verifier, dispatch, idle: verifier.checked === 0 && dispatch.length === 0 });
    return;
  }
  if (command === 'metrics') {
    output(core.metrics(config));
    return;
  }
  if (command === 'context' && sub === 'search') {
    output(core.contextSearch(rest.join(' ')));
    return;
  }
  if (command === 'a2a' && sub === 'inbound') {
    output(a2aInbound(inputJson(rest[0])));
    return;
  }
  if (command === 'a2a' && sub === 'outbound') {
    const mapping = core.collection(core.paths(config).a2a).find(item => item.a2a_task_id === rest[0] || item.atf_task_id === rest[0]) || null;
    const taskId = mapping?.atf_task_id || rest[0];
    output(core.toA2ATask(config, taskId, mapping));
    return;
  }
  if (command === 'a2a' && sub === 'push') {
    const payload = inputJson(rest[0]);
    const externalTask = payload.task || payload.result?.task || payload;
    const mapping = findMapping(externalTask.id);
    if (!mapping) throw new Error(`A2A mapping not found: ${externalTask.id}`);
    const status = mapA2AStatus(externalTask.status?.state);
    runAtf(['update', mapping.atf_task_id, status, `by=${mapping.agent}`]);
    output(core.emitEvent(config, { event_type: 'a2a_push', agent: mapping.agent, task_id: mapping.atf_task_id, source_ref: `${externalTask.id}:${externalTask.status?.state}`, required_writebacks: [] }));
    return;
  }
  throw new Error('usage: atf event emit|dispatch|list | obligation list | envelope <event> | verify [task] | reconcile | metrics | context search <query> | a2a inbound|outbound|push');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
