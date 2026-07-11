const fs = require('fs');
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const { spawnSync } = require('child_process');
const { acquireFileLock, atomicWriteJson, ensureDir } = require('./atf-storage.cjs');

const TERMINAL_EVENTS = new Set(['dispatched', 'resolved', 'dlq']);
const TERMINAL_TASKS = new Set(['completed', 'delivered', 'cancelled', 'archived']);

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`; }
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}
function collection(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => readJson(path.join(dir, name))).filter(Boolean);
}
function paths(config) {
  const dataDir = config.dataDir;
  return {
    events: path.join(dataDir, 'events'),
    dedupe: path.join(dataDir, 'event-dedupe'),
    obligations: path.join(dataDir, 'obligations'),
    envelopes: path.join(dataDir, 'work-envelopes'),
    dispatches: path.join(dataDir, 'runtime-dispatches'),
    verifier: path.join(dataDir, 'verifier-runs'),
    a2a: path.join(dataDir, 'a2a-mappings'),
    metrics: path.join(dataDir, 'metrics'),
  };
}
function writeRecord(dir, key, value) {
  ensureDir(dir);
  const filePath = path.join(dir, `${key}.json`);
  atomicWriteJson(filePath, value);
  return filePath;
}
function taskDir(config, taskId) {
  if (!config.tasksDir || !fs.existsSync(config.tasksDir)) return null;
  for (const name of fs.readdirSync(config.tasksDir)) {
    const dir = path.join(config.tasksDir, name);
    const ctx = readJson(path.join(dir, 'ctx.json'));
    if (ctx && (ctx.task_id === taskId || ctx.short_id === taskId)) return dir;
  }
  return null;
}
function taskContext(config, taskId) {
  const dir = taskDir(config, taskId);
  return dir ? readJson(path.join(dir, 'ctx.json')) : null;
}
function agentEntry(config, agent) {
  const registry = readJson(path.join(config.dataDir, 'agents.json'));
  return (Array.isArray(registry?.agents) ? registry.agents : []).find(item => item.agent === agent) || null;
}
function obligationDefaults(eventType, input) {
  if (Array.isArray(input.required_writebacks)) return input.required_writebacks;
  if (eventType === 'message') return [{ kind: 'message_ack', ref: input.source_ref }];
  if (eventType === 'assign' || eventType === 'a2a_task') return [{ kind: 'task_status' }];
  if (eventType === 'action' || eventType === 'trigger') return [{ kind: 'task_writeback' }];
  return [];
}
function createObligation(config, input) {
  const record = {
    schema: 'atf.obligation.v1',
    obligation_id: input.obligation_id || id('OBL'),
    task_id: input.task_id || null,
    agent: input.agent,
    kind: input.kind,
    ref: input.ref || null,
    status: 'pending',
    required_at: input.required_at || nowIso(),
    due_at: input.due_at || new Date(Date.now() + Number(input.timeout_ms || 30 * 60 * 1000)).toISOString(),
    attempts: 0,
    max_attempts: Number(input.max_attempts || 3),
    last_verifier: null,
    resolved_at: null,
    recovery_state: null,
  };
  record.path = writeRecord(paths(config).obligations, record.obligation_id, record);
  return record;
}
function eventDedupeKey(input) {
  return createHash('sha256').update(JSON.stringify([
    input.event_type, input.agent, input.task_id || null, input.source_ref || null, input.runtime || null,
  ])).digest('hex');
}
function emitEvent(config, input) {
  if (!input?.event_type || !input?.agent) throw new Error('event_type and agent are required');
  const p = paths(config);
  const runtime = input.runtime || agentEntry(config, input.agent)?.runtime || 'openclaw';
  const dedupeKey = input.dedupe_key || eventDedupeKey({ ...input, runtime });
  const release = acquireFileLock(path.join(p.dedupe, `${dedupeKey}.lock`));
  try {
    const priorRef = readJson(path.join(p.dedupe, `${dedupeKey}.json`));
    const prior = priorRef?.event_id ? readJson(path.join(p.events, `${priorRef.event_id}.json`)) : null;
    if (prior) {
      prior.duplicate_count = Number(prior.duplicate_count || 0) + 1;
      prior.last_duplicate_at = nowIso();
      writeRecord(p.events, prior.event_id, prior);
      return { ...prior, duplicate: true };
    }

    const writebacks = obligationDefaults(input.event_type, input);
    const obligations = writebacks.map(writeback => createObligation(config, {
      ...writeback,
      task_id: input.task_id,
      agent: input.agent,
      timeout_ms: writeback.timeout_ms || input.timeout_ms,
    }));
    const event = {
      schema: 'atf.event.v1',
      event_id: input.event_id || id('EVT'),
      event_type: input.event_type,
      runtime,
      agent: input.agent,
      task_id: input.task_id || null,
      source_ref: input.source_ref || null,
      obligation_ids: obligations.map(item => item.obligation_id),
      context_refs: input.context_refs || [],
      guidance: input.guidance || null,
      required_writebacks: writebacks,
      dedupe_key: dedupeKey,
      status: 'pending',
      attempts: 0,
      max_attempts: Number(input.max_attempts || 3),
      created_at: input.created_at || nowIso(),
      dispatched_at: null,
      runtime_session_ref: null,
      error: null,
      duplicate_count: 0,
    };
    event.path = writeRecord(p.events, event.event_id, event);
    writeRecord(p.dedupe, dedupeKey, { event_id: event.event_id, created_at: event.created_at });
    if (process.env.ATF_EVENT_AUTODISPATCH === 'sync') {
      const script = path.resolve(__dirname, '..', 'bin', 'atf-reliability.cjs');
      spawnSync(process.execPath, [script, 'event', 'dispatch', event.event_id], { env: process.env, encoding: 'utf8' });
    }
    return event;
  } finally {
    release();
  }
}
function pendingObligations(config, taskId = null, agent = null) {
  return collection(paths(config).obligations).filter(item => item.status === 'pending'
    && (!taskId || item.task_id === taskId) && (!agent || item.agent === agent));
}
function redact(text) {
  return String(text).replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}
function contextSearch(query, options = {}) {
  const roots = options.roots || String(process.env.ATF_SESSION_CONTEXT_PATHS || '').split(path.delimiter).filter(Boolean);
  if (!query || !roots.length) return [];
  const needle = String(query).toLowerCase();
  const results = [];
  const visit = target => {
    if (results.length >= Number(options.limit || 3)) return;
    let stat;
    try { stat = fs.statSync(target); } catch { return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).slice(0, 200)) visit(path.join(target, name));
      return;
    }
    if (!/\.(jsonl?|md|txt)$/i.test(target) || stat.size > 2_000_000) return;
    const text = fs.readFileSync(target, 'utf8');
    const index = text.toLowerCase().indexOf(needle);
    if (index < 0) return;
    const snippet = redact(text.slice(Math.max(0, index - 180), index + needle.length + 420)).replace(/\s+/g, ' ').trim();
    results.push({ source: target, snippet: snippet.slice(0, Number(options.max_chars || 600)) });
  };
  for (const root of roots) visit(root);
  return results;
}
function buildWorkEnvelope(config, events, options = {}) {
  const list = Array.isArray(events) ? events : [events];
  const first = list[0];
  const ctx = first.task_id ? taskContext(config, first.task_id) : null;
  const dir = first.task_id ? taskDir(config, first.task_id) : null;
  const messages = dir ? collection(path.join(dir, 'messages')).filter(message => message.to_agent === first.agent && message.status === 'sent') : [];
  const obligations = pendingObligations(config, first.task_id, first.agent);
  const context = options.context === false ? [] : contextSearch(ctx?.description || first.guidance || first.task_id || '', options.contextOptions);
  const envelope = {
    schema: 'atf.work-envelope.v1',
    envelope_id: id('ENV'),
    runtime: first.runtime,
    agent: first.agent,
    event_ids: list.map(event => event.event_id),
    wake_reason: [...new Set(list.map(event => event.event_type))],
    task: ctx ? {
      task_id: ctx.short_id || ctx.task_id,
      description: ctx.description,
      status: ctx.status,
      dri: ctx.dri || ctx.assigned_to || null,
      task_profile: ctx.task_profile || null,
    } : null,
    obligations: obligations.map(item => ({ obligation_id: item.obligation_id, kind: item.kind, ref: item.ref, due_at: item.due_at, last_verifier: item.last_verifier })),
    unread_messages: messages.slice(-5).map(message => ({ message_id: message.message_id, from_agent: message.from_agent, type: message.message_type, body: String(message.body || '').slice(0, 500) })),
    context_refs: [...new Set(list.flatMap(event => event.context_refs || []))],
    session_context: context,
    guidance: list.map(event => event.guidance).filter(Boolean),
    required_writebacks: obligations.map(item => ({ obligation_id: item.obligation_id, kind: item.kind, ref: item.ref })),
    verifier_checks: obligations.map(item => item.kind),
    created_at: nowIso(),
  };
  envelope.path = writeRecord(paths(config).envelopes, envelope.envelope_id, envelope);
  return envelope;
}
function parseBackendResult(child, label) {
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${label} exited ${child.status}: ${String(child.stderr || '').trim()}`);
  try { return JSON.parse(child.stdout); } catch { return { accepted: true, output: String(child.stdout || '').trim() }; }
}
async function dispatchAdapter(config, envelope) {
  const p = paths(config);
  const payload = {
    schema: 'atf.runtime-adapter-request.v1',
    runtime: envelope.runtime,
    agent: envelope.agent,
    event_id: envelope.event_ids[0],
    event_ids: envelope.event_ids,
    task_id: envelope.task?.task_id || null,
    obligation_ids: envelope.obligations.map(item => item.obligation_id),
    context_refs: envelope.context_refs,
    guidance: envelope.guidance.join('\n'),
    required_writebacks: envelope.required_writebacks,
    envelope_path: envelope.path,
    workspace: agentEntry(config, envelope.agent)?.workspace || null,
    payload: { task_id: envelope.task?.task_id || null, work_envelope: envelope },
  };
  const payloadPath = writeRecord(p.dispatches, envelope.envelope_id, payload);
  if (envelope.runtime === 'stub') {
    return { schema: 'atf.runtime-adapter-result.v1', accepted: true, runtime_session_ref: `stub:${envelope.envelope_id}`, dispatched_at: nowIso(), payload_path: payloadPath, error: null };
  }
  if (envelope.runtime === 'hermes') {
    const base = String(process.env.ATF_HERMES_API_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('ATF_HERMES_API_URL is required for Hermes dispatch');
    const headers = { 'content-type': 'application/json' };
    if (process.env.ATF_HERMES_API_KEY) headers.authorization = `Bearer ${process.env.ATF_HERMES_API_KEY}`;
    const response = await fetch(`${base}/v1/runs`, { method: 'POST', headers, body: JSON.stringify({
      input: `Process ATF Work Envelope ${envelope.envelope_id}. Read ${envelope.path} and complete every required_writeback through ATF.`,
      session_id: `atf:${envelope.task?.task_id || envelope.envelope_id}`,
      instructions: envelope.guidance.join('\n'),
    }) });
    const body = await response.json();
    if (!response.ok || !body.run_id) throw new Error(`Hermes dispatch failed: HTTP ${response.status}`);
    return { schema: 'atf.runtime-adapter-result.v1', accepted: true, runtime_session_ref: body.run_id, dispatched_at: nowIso(), payload_path: payloadPath, error: null };
  }
  const command = process.env.ATF_OPENCLAW_ADAPTER_CMD;
  if (command) {
    const child = spawnSync(command, [], { encoding: 'utf8', env: { ...process.env, ATF_RUNTIME_PAYLOAD_PATH: payloadPath }, shell: true });
    const result = parseBackendResult(child, 'OpenClaw adapter');
    return { schema: 'atf.runtime-adapter-result.v1', accepted: result.accepted !== false, runtime_session_ref: result.runtime_session_ref || result.session_key || null, dispatched_at: nowIso(), payload_path: payloadPath, error: null };
  }
  if (process.env.ATF_SESSIONS_SPAWN_BACKEND_CMD || process.env.ATF_SESSIONS_SPAWN_BACKEND_MODULE) {
    const bridge = path.resolve(__dirname, '..', 'bin', 'sessions-spawn-bridge.cjs');
    const child = spawnSync(process.execPath, [bridge], { encoding: 'utf8', env: { ...process.env, ATF_LAUNCH_PAYLOAD_PATH: payloadPath } });
    const result = parseBackendResult(child, 'sessions_spawn bridge');
    return { schema: 'atf.runtime-adapter-result.v1', accepted: result.ok !== false, runtime_session_ref: result.backend?.result?.session_key || null, dispatched_at: nowIso(), payload_path: payloadPath, error: null };
  }
  throw new Error('OpenClaw adapter backend is not configured');
}
async function dispatchEvents(config, options = {}) {
  const p = paths(config);
  let release;
  try {
    release = acquireFileLock(path.join(config.dataDir, 'runtime-dispatch.lock'));
  } catch (error) {
    if (error.message.startsWith('already running:')) return [];
    throw error;
  }
  try {
    const selected = collection(p.events).filter(event => (event.status === 'pending' || event.status === 'retry')
      && (!options.eventId || event.event_id === options.eventId));
    const groups = new Map();
    for (const event of selected) {
      const key = `${event.runtime}:${event.agent}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    const results = [];
    for (const events of groups.values()) {
      const envelope = buildWorkEnvelope(config, events, options);
      try {
        const result = await dispatchAdapter(config, envelope);
        if (!result.accepted) throw new Error('runtime adapter rejected dispatch');
        for (const event of events) {
          event.status = 'dispatched';
          event.attempts += 1;
          event.dispatched_at = result.dispatched_at;
          event.runtime_session_ref = result.runtime_session_ref;
          event.dispatch_latency_ms = new Date(result.dispatched_at) - new Date(event.created_at);
          writeRecord(p.events, event.event_id, event);
        }
        results.push({ envelope_id: envelope.envelope_id, event_ids: envelope.event_ids, ...result });
      } catch (error) {
        for (const event of events) {
          event.attempts += 1;
          event.status = event.attempts >= event.max_attempts ? 'dlq' : 'retry';
          event.error = { message: error.message, at: nowIso() };
          writeRecord(p.events, event.event_id, event);
        }
        results.push({ envelope_id: envelope.envelope_id, event_ids: envelope.event_ids, accepted: false, error: error.message });
      }
    }
    return results;
  } finally {
    release();
  }
}
function verifierEvidence(config, obligation) {
  const dir = taskDir(config, obligation.task_id);
  const ctx = dir ? readJson(path.join(dir, 'ctx.json')) : null;
  if (!dir || !ctx) return null;
  if (obligation.kind === 'task_status') {
    if (ctx.status !== 'assigned' && new Date(ctx.updated_at || 0) >= new Date(obligation.required_at)) return { type: 'task_status', status: ctx.status, at: ctx.updated_at };
  }
  if (obligation.kind === 'message_ack') {
    const message = readJson(path.join(dir, 'messages', `${obligation.ref}.json`));
    const receipt = collection(path.join(dir, 'receipts')).find(item => item.message_id === obligation.ref && ['seen', 'acked', 'delivered'].includes(item.receipt_type));
    const reply = collection(path.join(dir, 'messages')).find(item => item.reply_to_message_id === obligation.ref);
    if (message?.status !== 'sent' || receipt || reply) return { type: 'message_ack', receipt_id: receipt?.receipt_id || null, reply_id: reply?.message_id || null, at: receipt?.created_at || reply?.created_at || message?.last_receipt_at };
  }
  if (obligation.kind === 'task_writeback') {
    const history = readJson(path.join(dir, 'notifications', 'history.json')) || [];
    const event = history.find(item => item.event === 'status_change' && item.at >= obligation.required_at && (!item.by || item.by === obligation.agent));
    if (event) return { type: 'task_writeback', status: event.status, at: event.at, by: event.by || null };
  }
  if (obligation.kind === 'artifact_reference' && ctx.outputs && Object.keys(ctx.outputs).length) return { type: 'artifact_reference', at: ctx.updated_at };
  return null;
}
function verifyObligations(config, options = {}) {
  const p = paths(config);
  const checkedAt = nowIso();
  const checked = [];
  for (const obligation of pendingObligations(config, options.taskId, options.agent)) {
    const evidence = verifierEvidence(config, obligation);
    if (evidence) {
      obligation.status = 'resolved';
      obligation.resolved_at = checkedAt;
      obligation.last_verifier = { ok: true, checked_at: checkedAt, evidence };
    } else if (new Date(obligation.due_at) <= new Date(checkedAt)) {
      obligation.attempts += 1;
      if (obligation.attempts >= obligation.max_attempts) {
        obligation.status = 'escalation_required';
        obligation.recovery_state = 'attention';
      } else {
        obligation.due_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        emitEvent(config, {
          event_type: 'obligation_retry', agent: obligation.agent, task_id: obligation.task_id,
          source_ref: `${obligation.obligation_id}:${obligation.attempts}`, required_writebacks: [],
          guidance: `Complete overdue obligation ${obligation.obligation_id}`,
        });
      }
      obligation.last_verifier = { ok: false, checked_at: checkedAt, reason: obligation.status };
    } else {
      obligation.last_verifier = { ok: false, checked_at: checkedAt, reason: 'pending' };
    }
    writeRecord(p.obligations, obligation.obligation_id, obligation);
    checked.push(obligation);
  }
  const run = { schema: 'atf.verifier-run.v1', run_id: id('VER'), checked_at: checkedAt, checked: checked.length,
    resolved: checked.filter(item => item.status === 'resolved').length,
    pending: checked.filter(item => item.status === 'pending').length,
    escalated: checked.filter(item => item.status === 'escalation_required').length };
  writeRecord(p.verifier, run.run_id, run);
  return run;
}
function metrics(config) {
  const events = collection(paths(config).events);
  const obligations = collection(paths(config).obligations);
  const latencies = events.map(event => event.dispatch_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = value => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)] : null;
  const byRuntime = {};
  for (const event of events) {
    byRuntime[event.runtime] ||= { total: 0, dispatched: 0, dlq: 0, obligations: 0, resolved_obligations: 0 };
    byRuntime[event.runtime].total += 1;
    if (event.status === 'dispatched') byRuntime[event.runtime].dispatched += 1;
    if (event.status === 'dlq') byRuntime[event.runtime].dlq += 1;
  }
  for (const obligation of obligations) {
    const runtime = agentEntry(config, obligation.agent)?.runtime || 'openclaw';
    byRuntime[runtime] ||= { total: 0, dispatched: 0, dlq: 0, obligations: 0, resolved_obligations: 0 };
    byRuntime[runtime].obligations += 1;
    if (obligation.status === 'resolved') byRuntime[runtime].resolved_obligations += 1;
  }
  for (const runtime of Object.values(byRuntime)) {
    runtime.continuation_success_rate = runtime.obligations ? runtime.resolved_obligations / runtime.obligations : null;
  }
  const duplicateCount = events.reduce((sum, item) => sum + Number(item.duplicate_count || 0), 0);
  const recoveredCount = obligations.filter(item => item.status === 'resolved' && item.attempts > 0).length;
  const escalatedCount = obligations.filter(item => item.status === 'escalation_required').length;
  const controlPlaneLatest = readJson(path.join(config.dataDir, 'control-plane-runs', 'latest.json'));
  const result = {
    schema: 'atf.reliability-metrics.v1', generated_at: nowIso(),
    dispatch_latency_ms: { p50: percentile(0.5), p95: percentile(0.95) },
    events: {
      total: events.length,
      dispatched: events.filter(item => item.status === 'dispatched').length,
      pending: events.filter(item => item.status === 'pending').length,
      dlq: events.filter(item => item.status === 'dlq').length,
      duplicate_count: duplicateCount,
      duplicate_rate: events.length + duplicateCount ? duplicateCount / (events.length + duplicateCount) : 0,
      session_wakes: new Set(events.map(item => item.runtime_session_ref).filter(Boolean)).size,
    },
    obligations: {
      total: obligations.length,
      unresolved: obligations.filter(item => item.status === 'pending').length,
      recovered: recoveredCount,
      escalated: escalatedCount,
      automatic_recovery_rate: recoveredCount + escalatedCount ? recoveredCount / (recoveredCount + escalatedCount) : null,
      missing_writeback_rate: obligations.length ? obligations.filter(item => item.status !== 'resolved').length / obligations.length : 0,
    },
    by_runtime: byRuntime,
    reconciler: {
      last_duration_ms: controlPlaneLatest?.duration_ms ?? null,
      last_idle: controlPlaneLatest?.idle ?? null,
    },
  };
  writeRecord(paths(config).metrics, `snapshot-${Date.now()}`, result);
  return result;
}
function a2aState(status) {
  if (status === 'completed' || status === 'delivered') return 'TASK_STATE_COMPLETED';
  if (status === 'cancelled' || status === 'archived') return 'TASK_STATE_CANCELED';
  if (status === 'blocked') return 'TASK_STATE_INPUT_REQUIRED';
  if (status === 'created' || status === 'pending' || status === 'assigned') return 'TASK_STATE_SUBMITTED';
  return 'TASK_STATE_WORKING';
}
function toA2ATask(config, taskId, mapping = null) {
  const ctx = taskContext(config, taskId);
  if (!ctx) throw new Error(`task not found: ${taskId}`);
  const outputs = Object.entries(ctx.outputs || {}).map(([name, value]) => ({ artifactId: `${taskId}:${name}`, name, parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] }));
  return { id: mapping?.a2a_task_id || taskId, contextId: mapping?.context_id || `atf:${taskId}`, status: { state: a2aState(ctx.status) }, artifacts: outputs,
    metadata: { 'https://agenttaskflow.dev/extensions/reliability/v1': { atf_task_id: ctx.short_id || ctx.task_id, dri: ctx.dri || ctx.assigned_to || null } } };
}

module.exports = {
  TERMINAL_TASKS, a2aState, buildWorkEnvelope, collection, contextSearch, createObligation,
  dispatchEvents, emitEvent, metrics, paths, pendingObligations, readJson, taskContext, toA2ATask,
  verifyObligations, writeRecord,
};
