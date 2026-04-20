#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'atf-cli.js');
const watcherPath = path.join(repoRoot, 'workspace', 'bin', 'atf-action-watcher.cjs');
const launcherPath = path.join(repoRoot, 'workspace', 'bin', 'atf-launcher.cjs');
const bridgePath = path.join(repoRoot, 'workspace', 'bin', 'sessions-spawn-bridge.cjs');
const smokeRoot = path.join(repoRoot, '.tmp-atf-phased-smoke');
const bridgeHelpers = require(bridgePath);

function parseArgs(argv) {
  return {
    cleanup: argv.includes('--cleanup'),
    quiet: argv.includes('--quiet'),
  };
}

function safeResetDir(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function runScript(scriptPath, args, env, options = {}) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const stdout = [];
  const stderr = [];
  const exitSignal = { code: 0 };
  const scriptRequire = createRequire(scriptPath);
  const scriptProcess = {
    ...process,
    argv: [process.execPath, scriptPath, ...args],
    env: {
      ...process.env,
      ...env,
    },
    cwd: () => repoRoot,
    exit(code = 0) {
      exitSignal.code = code;
      throw exitSignal;
    },
  };

  const context = {
    require: scriptRequire,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(scriptPath),
    __filename: scriptPath,
    process: scriptProcess,
    console: {
      log: (...parts) => stdout.push(util.format(...parts)),
      error: (...parts) => stderr.push(util.format(...parts)),
    },
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  try {
    vm.runInNewContext(source, context, { filename: scriptPath });
  } catch (error) {
    if (error !== exitSignal) {
      const message = [
        `node ${path.basename(scriptPath)} ${args.join(' ')}`,
        stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
        stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
        error && error.message ? `error:\n${error.message}` : null,
      ].filter(Boolean).join('\n');
      throw new Error(message);
    }
  }

  if (exitSignal.code !== 0 || stderr.length) {
    const message = [
      `node ${path.basename(scriptPath)} ${args.join(' ')}`,
      stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
      stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
      exitSignal.code ? `exit=${exitSignal.code}` : null,
    ].filter(Boolean).join('\n');
    throw new Error(message);
  }

  const output = stdout.join('\n').trim();
  if (!options.quiet && output) {
    console.log(`$ node ${path.basename(scriptPath)} ${args.join(' ')}`);
    console.log(output);
    console.log('');
  }
  return output;
}

function runCli(args, env, options = {}) {
  return runScript(cliPath, args, env, options);
}

function runWatcher(args, env, options = {}) {
  return runScript(watcherPath, args, env, options);
}

function runLauncher(args, env, options = {}) {
  return runScript(launcherPath, args, env, options);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function extractId(output, prefix) {
  const regex = new RegExp(`${prefix}-\\d{8}-[a-f0-9]+`);
  const match = output.match(regex);
  if (!match) throw new Error(`${prefix} id not found in output:\n${output}`);
  return match[0];
}

function extractTaskId(output) {
  const match = output.match(/T-\d+/);
  if (!match) throw new Error(`task id not found in output:\n${output}`);
  return match[0];
}

function assertIncludes(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`${label} missing fragment: ${fragment}\n--- output ---\n${output}`);
  }
}

function resolveTaskDir(taskId, env) {
  const entries = fs.readdirSync(env.ATF_TASKS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ctxFile = path.join(env.ATF_TASKS_DIR, entry.name, 'ctx.json');
    if (!fs.existsSync(ctxFile)) continue;
    const ctx = readJson(ctxFile);
    if (ctx.task_id === taskId || ctx.short_id === taskId) {
      return path.join(env.ATF_TASKS_DIR, entry.name);
    }
  }
  throw new Error(`task dir not found for ${taskId}`);
}

function setTaskUpdatedAt(taskId, env, updatedAt, createdAt = updatedAt) {
  const taskDir = resolveTaskDir(taskId, env);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(taskDir, fileName);
    const ctx = readJson(filePath);
    ctx.updated_at = updatedAt;
    ctx.created_at = createdAt;
    writeJson(filePath, ctx);
  }
}

function setMessageCreatedAt(taskId, env, messageId, createdAt) {
  const messageFile = path.join(resolveTaskDir(taskId, env), 'messages', `${messageId}.json`);
  const message = readJson(messageFile);
  const ttlSeconds = Number(message.ttl_seconds || 24 * 60 * 60);
  message.created_at = createdAt;
  message.expires_at = new Date(new Date(createdAt).getTime() + (ttlSeconds * 1000)).toISOString();
  writeJson(messageFile, message);
}

function setReflectionCreatedAt(taskId, env, reflectionId, createdAt) {
  const reflectionFile = path.join(resolveTaskDir(taskId, env), 'reflections', `${reflectionId}.json`);
  const reflection = readJson(reflectionFile);
  reflection.created_at = createdAt;
  reflection.updated_at = createdAt;
  writeJson(reflectionFile, reflection);
}

function setActionTimestamps(taskId, env, actionId, executedAt) {
  const actionFile = path.join(resolveTaskDir(taskId, env), 'actions', `${actionId}.json`);
  const action = readJson(actionFile);
  action.created_at = executedAt;
  action.updated_at = executedAt;
  if (action.executed_at) action.executed_at = executedAt;
  if (Array.isArray(action.history) && action.history.length) {
    action.history = action.history.map(entry => ({
      ...entry,
      at: entry.event === 'planned' ? executedAt : (entry.at || executedAt),
    }));
    const lastIndex = action.history.length - 1;
    action.history[lastIndex] = {
      ...action.history[lastIndex],
      at: executedAt,
    };
  }
  if (action.execution?.executed_at) action.execution.executed_at = executedAt;
  if (action.execution?.verification?.preflight) action.execution.verification.preflight.checked_at = executedAt;
  if (action.execution?.verification?.postflight) action.execution.verification.postflight.checked_at = executedAt;
  if (action.verification?.preflight) action.verification.preflight.checked_at = executedAt;
  if (action.verification?.postflight) action.verification.postflight.checked_at = executedAt;
  writeJson(actionFile, action);
}

function setLaunchRequestTimestamps(env, launchId, dispatchedAt, leaseExpiresAt = dispatchedAt) {
  const launchFile = path.join(env.ATF_DATA_DIR, 'agent-launch-requests', `${launchId}.json`);
  const request = readJson(launchFile);
  request.created_at = dispatchedAt;
  request.updated_at = dispatchedAt;
  if (request.dispatched_at) request.dispatched_at = dispatchedAt;
  if (request.lease_expires_at) request.lease_expires_at = leaseExpiresAt;
  if (request.dispatch?.dispatched_at) request.dispatch.dispatched_at = dispatchedAt;
  if (request.dispatch?.lease_expires_at) request.dispatch.lease_expires_at = leaseExpiresAt;
  if (Array.isArray(request.history) && request.history.length) {
    request.history = request.history.map((entry, index) => ({
      ...entry,
      at: index === request.history.length - 1 ? dispatchedAt : (entry.at || dispatchedAt),
    }));
  }
  writeJson(launchFile, request);
}

function createMockSessionsSpawnBridge(scriptPath, eventsDir) {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(scriptPath, `const fs = require('fs');
const path = require('path');

module.exports = function sessionsSpawn(payload, context) {
  const payloadPath = context?.payload_path;
  const eventsDir = context?.env?.ATF_MOCK_SESSIONS_SPAWN_EVENTS_DIR;
  if (!payloadPath) {
    throw new Error('missing payload_path');
  }
  if (!eventsDir) {
    throw new Error('missing ATF_MOCK_SESSIONS_SPAWN_EVENTS_DIR');
  }
  const event = {
    schema: 'atf.mock-sessions-spawn-event.v1',
    launch_id: context?.env?.ATF_LAUNCH_ID,
    agent: context?.env?.ATF_LAUNCH_AGENT,
    task_id: payload?.payload?.task_id || null,
    action_id: payload?.payload?.action_id || null,
    payload_path: payloadPath,
    guidance: payload?.guidance || null,
    received_at: new Date().toISOString(),
  };
  fs.mkdirSync(eventsDir, { recursive: true });
  const eventPath = path.join(eventsDir, \`\${event.launch_id}.json\`);
  fs.writeFileSync(eventPath, JSON.stringify(event, null, 2));
  return { ok: true, launch_id: event.launch_id, agent: event.agent, event_path: eventPath };
};
`, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  safeResetDir(smokeRoot);

  const env = {
    ATF_TASKS_DIR: path.join(smokeRoot, 'tasks'),
    ATF_WORKSPACE_DIR: path.join(smokeRoot, 'workspace'),
    ATF_DATA_DIR: path.join(smokeRoot, 'data'),
    ATF_WORKSPACE_PINCHYMEOW: path.join(smokeRoot, 'workspace-pinchymeow'),
    ATF_WORKSPACE_F0X: path.join(smokeRoot, 'workspace-f0x'),
    ATF_WORKSPACE_CLAUDE: path.join(smokeRoot, 'workspace-claude'),
  };
  const mockSpawnEventsDir = path.join(smokeRoot, 'mock-sessions-spawn-events');
  const mockSpawnScriptPath = path.join(smokeRoot, 'bin', 'mock-sessions-spawn.cjs');
  createMockSessionsSpawnBridge(mockSpawnScriptPath, mockSpawnEventsDir);

  for (const dir of Object.values(env)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  env.ATF_MOCK_SESSIONS_SPAWN_EVENTS_DIR = mockSpawnEventsDir;
  env.ATF_LAUNCH_SESSIONS_SPAWN_MODULE = mockSpawnScriptPath;

  runCli(['agent', 'register', 'pinchymeow', `workspace=${env.ATF_WORKSPACE_PINCHYMEOW}`], env, options);
  runCli(['agent', 'register', 'f0x', `workspace=${env.ATF_WORKSPACE_F0X}`], env, options);
  runCli(['agent', 'register', 'claude', `workspace=${env.ATF_WORKSPACE_CLAUDE}`], env, options);

  const staleOutput = runCli(['create', 'Phase D stale review demo', 'type=ops', 'difficulty=3', 'priority=normal'], env, options);
  const staleTaskId = extractTaskId(staleOutput);
  runCli(['assign', staleTaskId, 'f0x'], env, options);
  runCli(['update', staleTaskId, 'completed'], env, options);
  setTaskUpdatedAt(staleTaskId, env, new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString());

  const blockerOutput = runCli(['create', 'Phase D blocker follow-up demo', 'type=research', 'difficulty=2', 'priority=high'], env, options);
  const blockerTaskId = extractTaskId(blockerOutput);
  runCli(['assign', blockerTaskId, 'claude'], env, options);
  const blockerMessageOutput = runCli(['msg', 'send', blockerTaskId, 'claude', 'pinchymeow', 'blocker', 'Need release decision before continuing'], env, options);
  const blockerMessageId = extractId(blockerMessageOutput, 'MSG');
  setMessageCreatedAt(blockerTaskId, env, blockerMessageId, new Date(Date.now() - (14 * 60 * 60 * 1000)).toISOString());

  const closedOutput = runCli(['create', 'Phase D preflight close demo', 'type=research', 'difficulty=2', 'priority=normal'], env, options);
  const closedTaskId = extractTaskId(closedOutput);
  runCli(['assign', closedTaskId, 'claude'], env, options);
  const closedMessageOutput = runCli(['msg', 'send', closedTaskId, 'claude', 'pinchymeow', 'request', 'Please confirm the rollout window'], env, options);
  const closedMessageId = extractId(closedMessageOutput, 'MSG');
  setMessageCreatedAt(closedTaskId, env, closedMessageId, new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString());

  const unknownOutput = runCli(['create', 'Phase D unknown owner demo', 'type=research', 'difficulty=2', 'priority=normal'], env, options);
  const unknownTaskId = extractTaskId(unknownOutput);
  runCli(['assign', unknownTaskId, 'claude'], env, options);
  const unknownMessageOutput = runCli(['msg', 'send', unknownTaskId, 'claude', 'ghost', 'blocker', 'Need owner confirmation from ghost'], env, options);
  const unknownMessageId = extractId(unknownMessageOutput, 'MSG');
  setMessageCreatedAt(unknownTaskId, env, unknownMessageId, new Date(Date.now() - (15 * 60 * 60 * 1000)).toISOString());

  const decisionOutput = runCli(['create', 'Phase D decision reflection demo', 'type=delivery', 'difficulty=4', 'priority=high'], env, options);
  const decisionTaskId = extractTaskId(decisionOutput);
  runCli(['assign', decisionTaskId, 'pinchymeow'], env, options);
  const reflectionOutput = runCli(['reflect', 'add', decisionTaskId, 'claude', 'what_needs_decision', 'Need explicit scope cut before shipping'], env, options);
  const reflectionId = extractId(reflectionOutput, 'RFL');
  setReflectionCreatedAt(decisionTaskId, env, reflectionId, new Date(Date.now() - (7 * 60 * 60 * 1000)).toISOString());

  const actionScan = runCli(['action', 'scan'], env, options);
  const actionScanAgain = runCli(['action', 'scan'], env, options);
  const pendingActions = readJson(path.join(env.ATF_DATA_DIR, 'pending-actions.json'));
  const pinchyActionInbox = runCli(['action', 'inbox', 'pinchymeow'], env, options);
  const f0xActionInbox = runCli(['action', 'inbox', 'f0x'], env, options);
  const actionListPending = runCli(['action', 'list', 'status=pending'], env, options);

  assertIncludes(actionScan, 'created=5', 'action scan');
  assertIncludes(actionScan, 'stale_review_follow_up', 'action scan');
  assertIncludes(actionScan, 'pending_reply_follow_up', 'action scan');
  assertIncludes(actionScan, 'decision_follow_up', 'action scan');
  assertIncludes(actionScanAgain, 'created=0', 'action scan dedupe');
  assertIncludes(actionScanAgain, 'duplicates=5', 'action scan dedupe');
  if (pendingActions.total !== 5) {
    throw new Error(`expected 5 pending actions after scan, got ${pendingActions.total}`);
  }
  for (const item of pendingActions.items) {
    if (!Number.isFinite(item.confidence)) throw new Error(`action ${item.action_id} missing confidence`);
    if (!item.policy?.verification_mode) throw new Error(`action ${item.action_id} missing policy.verification_mode`);
    if (!Array.isArray(item.evidence?.items) || !item.evidence.items.length) throw new Error(`action ${item.action_id} missing evidence items`);
  }
  assertIncludes(pinchyActionInbox, 'pending_reply_follow_up', 'pinchymeow action inbox');
  assertIncludes(pinchyActionInbox, 'decision_follow_up', 'pinchymeow action inbox');
  assertIncludes(f0xActionInbox, 'stale_review_follow_up', 'f0x action inbox');
  assertIncludes(actionListPending, 'status=pending', 'action list pending');

  const closedReplyOutput = runCli(['msg', 'send', closedTaskId, 'pinchymeow', 'claude', 'info', 'Rollout window confirmed', `reply=${closedMessageId}`], env, options);
  const closedReplyId = extractId(closedReplyOutput, 'MSG');
  if (!closedReplyId) throw new Error('expected close reply message id');

  const watcherDryRun = JSON.parse(runWatcher(['--no-scan', '--dry-run', '--json', '--min-confidence', '0.9'], env, options));
  if (watcherDryRun.eligibleActions !== 3) throw new Error(`expected 3 eligible actions in watcher dry-run, got ${watcherDryRun.eligibleActions}`);
  if (watcherDryRun.filteredBy.below_confidence !== 1) throw new Error(`expected below_confidence=1, got ${watcherDryRun.filteredBy.below_confidence}`);
  if (watcherDryRun.filteredBy.unregistered_owner !== 1) throw new Error(`expected unregistered_owner=1, got ${watcherDryRun.filteredBy.unregistered_owner}`);
  if (!watcherDryRun.run_id) throw new Error('expected watcher dry-run to include run_id');
  if (!watcherDryRun.audit_path || !fs.existsSync(watcherDryRun.audit_path)) throw new Error('expected watcher dry-run audit file to exist');
  const watcherDryRunAudit = readJson(watcherDryRun.audit_path);
  if (watcherDryRunAudit.run_id !== watcherDryRun.run_id) throw new Error('expected watcher dry-run audit to match run_id');
  if (watcherDryRunAudit.schema !== 'atf.action-watcher-run.v1') throw new Error(`expected watcher audit schema, got ${watcherDryRunAudit.schema}`);

  const overrideThreadId = 'THR-phase-d-smoke';
  const executePinchy = JSON.parse(runWatcher(['--agent', 'pinchymeow', '--mode', 'message', '--to', 'pinchymeow', '--thread', overrideThreadId, '--executor', 'phase-d-smoke', '--min-confidence', '0.9', '--no-scan', '--json'], env, options));
  const pinchyMessageInbox = runCli(['msg', 'inbox', 'pinchymeow'], env, options);
  const closedPendingAction = pendingActions.items.find(item => item.task_id === closedTaskId && item.kind === 'pending_reply_follow_up');
  const blockerPendingAction = pendingActions.items.find(item => item.task_id === blockerTaskId && item.kind === 'pending_reply_follow_up');
  const closedPendingActionFile = readJson(path.join(resolveTaskDir(closedTaskId, env), 'actions', `${closedPendingAction.action_id}.json`));
  const blockerPendingActionFile = readJson(path.join(resolveTaskDir(blockerTaskId, env), 'actions', `${blockerPendingAction.action_id}.json`));
  const closedTaskMessages = fs.readdirSync(path.join(resolveTaskDir(closedTaskId, env), 'messages'))
    .map(file => readJson(path.join(resolveTaskDir(closedTaskId, env), 'messages', file)));
  const closedActionMessages = closedTaskMessages.filter(message => message.source_type === 'action');
  const blockerTaskMessages = fs.readdirSync(path.join(resolveTaskDir(blockerTaskId, env), 'messages'))
    .map(file => readJson(path.join(resolveTaskDir(blockerTaskId, env), 'messages', file)));
  const blockerActionMessage = blockerTaskMessages.find(message =>
    message.source_type === 'action'
    && message.action_id === blockerPendingAction.action_id
  );

  if (executePinchy.executed !== 1) throw new Error(`expected pinchy watcher executed=1, got ${executePinchy.executed}`);
  if (executePinchy.skipped !== 1) throw new Error(`expected pinchy watcher skipped=1, got ${executePinchy.skipped}`);
  if (executePinchy.filteredBy.below_confidence !== 1) throw new Error(`expected pinchy watcher below_confidence=1, got ${executePinchy.filteredBy.below_confidence}`);
  assertIncludes(pinchyMessageInbox, 'adapter-action', 'pinchymeow message inbox');
  assertIncludes(pinchyMessageInbox, blockerTaskId, 'pinchymeow message inbox');
  if (pinchyMessageInbox.includes(decisionTaskId)) throw new Error('decision follow-up should not be dispatched in the first guarded watcher run');
  if (closedActionMessages.length !== 0) throw new Error(`expected no action-generated messages for ${closedTaskId}, got ${closedActionMessages.length}`);
  if (!blockerActionMessage) throw new Error('expected blocker action to generate a message');
  if (blockerActionMessage.to_agent !== 'pinchymeow') throw new Error(`expected blocker action message to_agent=pinchymeow, got ${blockerActionMessage.to_agent}`);
  if (blockerActionMessage.thread_id !== overrideThreadId) throw new Error(`expected blocker action message thread_id=${overrideThreadId}, got ${blockerActionMessage.thread_id}`);
  if (closedPendingActionFile.status !== 'skipped') throw new Error(`expected closed action to be skipped, got ${closedPendingActionFile.status}`);
  if (closedPendingActionFile.verification?.preflight?.ok !== false) throw new Error('expected closed action preflight to fail');
  if (closedPendingActionFile.verification?.preflight?.code !== 'reply_received') throw new Error(`expected reply_received preflight code, got ${closedPendingActionFile.verification?.preflight?.code}`);
  if (blockerPendingActionFile.verification?.preflight?.ok !== true) throw new Error('expected blocker action preflight to pass');
  if (blockerPendingActionFile.verification?.postflight?.ok !== true) throw new Error('expected blocker action postflight to pass');

  const executeDecision = JSON.parse(runWatcher(['--agent', 'pinchymeow', '--mode', 'message', '--executor', 'phase-d-smoke', '--min-confidence', '0.8', '--no-scan', '--json'], env, options));
  const decisionPendingAction = pendingActions.items.find(item => item.task_id === decisionTaskId && item.kind === 'decision_follow_up');
  const decisionPendingActionFile = readJson(path.join(resolveTaskDir(decisionTaskId, env), 'actions', `${decisionPendingAction.action_id}.json`));
  if (executeDecision.executed !== 1) throw new Error(`expected decision watcher executed=1, got ${executeDecision.executed}`);
  if (decisionPendingActionFile.verification?.postflight?.ok !== true) throw new Error('expected decision action postflight to pass');

  const executeF0x = JSON.parse(runWatcher(['--agent', 'f0x', '--mode', 'pending_task', '--executor', 'phase-d-smoke', '--no-scan', '--json'], env, options));
  const pendingTaskFile = path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json');
  const pendingTask = readJson(pendingTaskFile);
  const stalePendingAction = pendingActions.items.find(item => item.task_id === staleTaskId && item.kind === 'stale_review_follow_up');
  const stalePendingActionFile = readJson(path.join(resolveTaskDir(staleTaskId, env), 'actions', `${stalePendingAction.action_id}.json`));
  const unknownPendingAction = pendingActions.items.find(item => item.task_id === unknownTaskId && item.kind === 'pending_reply_follow_up');
  const unknownPendingActionFile = readJson(path.join(resolveTaskDir(unknownTaskId, env), 'actions', `${unknownPendingAction.action_id}.json`));

  if (executeF0x.executed !== 1) throw new Error(`expected f0x watcher executed=1, got ${executeF0x.executed}`);
  assertIncludes(pendingTask.kind, 'stale_review_follow_up', 'pending task kind');
  assertIncludes(pendingTask.summary, staleTaskId, 'pending task summary');
  if (stalePendingActionFile.verification?.postflight?.ok !== true) throw new Error('expected stale review postflight to pass');
  if (unknownPendingActionFile.status !== 'pending') throw new Error(`expected unknown-owner action to remain pending, got ${unknownPendingActionFile.status}`);

  const actionListExecuted = runCli(['action', 'list', 'status=executed'], env, options);
  const actionListSkipped = runCli(['action', 'list', 'status=skipped'], env, options);
  const actionScanAfterExecute = runCli(['action', 'scan'], env, options);
  const watcherRuns = runCli(['action', 'runs', 'limit=4'], env, options);
  const pinchyWatcherRuns = runCli(['action', 'runs', 'pinchymeow', 'status=completed', 'limit=4'], env, options);
  const latestWatcherRun = JSON.parse(runCli(['action', 'run-show', 'latest'], env, options));
  const watcherStatusBeforeCooldown = JSON.parse(runCli(['action', 'watcher-status', 'limit=4', 'json'], env, options));

  assertIncludes(actionListExecuted, 'stale_review_follow_up', 'action list executed');
  assertIncludes(actionListExecuted, 'pending_reply_follow_up', 'action list executed');
  assertIncludes(actionListExecuted, 'decision_follow_up', 'action list executed');
  assertIncludes(actionListSkipped, closedTaskId, 'action list skipped');
  assertIncludes(actionScanAfterExecute, 'created=0', 'post execute dedupe');
  assertIncludes(actionScanAfterExecute, 'duplicates=4', 'post execute dedupe');
  assertIncludes(actionScanAfterExecute, 'cooldown=3', 'post execute cooldown block');
  assertIncludes(actionScanAfterExecute, 'pending=1', 'post execute pending block');
  assertIncludes(watcherRuns, watcherDryRun.run_id, 'action watcher runs');
  assertIncludes(watcherRuns, executeF0x.run_id, 'action watcher runs');
  assertIncludes(pinchyWatcherRuns, executePinchy.run_id, 'pinchy watcher runs');
  assertIncludes(pinchyWatcherRuns, executeDecision.run_id, 'pinchy watcher runs');
  if (pinchyWatcherRuns.includes(executeF0x.run_id)) throw new Error('pinchy watcher runs should not include f0x run');
  if (latestWatcherRun.run_id !== executeF0x.run_id) throw new Error(`expected latest watcher run to be ${executeF0x.run_id}, got ${latestWatcherRun.run_id}`);
  if (latestWatcherRun.schema !== 'atf.action-watcher-run.v1') throw new Error(`expected latest watcher run schema, got ${latestWatcherRun.schema}`);
  if (watcherStatusBeforeCooldown.status !== 'ok') throw new Error(`expected watcher status ok, got ${watcherStatusBeforeCooldown.status}`);
  if (watcherStatusBeforeCooldown.latest_run?.run_id !== executeF0x.run_id) throw new Error(`expected watcher status latest run ${executeF0x.run_id}, got ${watcherStatusBeforeCooldown.latest_run?.run_id}`);
  if (watcherStatusBeforeCooldown.recent_runs.total !== 4) throw new Error(`expected watcher status recent run total=4, got ${watcherStatusBeforeCooldown.recent_runs.total}`);
  if (watcherStatusBeforeCooldown.pending_actions.total !== 1) throw new Error(`expected watcher status pending total=1 before cooldown reissue, got ${watcherStatusBeforeCooldown.pending_actions.total}`);

  setActionTimestamps(blockerTaskId, env, blockerPendingAction.action_id, new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString());
  const actionScanAfterCooldown = runCli(['action', 'scan', 'pinchymeow'], env, options);
  const pendingAfterCooldown = readJson(path.join(env.ATF_DATA_DIR, 'pending-actions.json'));
  const blockerReissuedAction = pendingAfterCooldown.items.find(item =>
    item.task_id === blockerTaskId
    && item.kind === 'pending_reply_follow_up'
    && item.action_id !== blockerPendingAction.action_id
  );
  const pinchyPendingAfterCooldown = runCli(['action', 'list', 'pinchymeow', 'status=pending'], env, options);
  const watcherStatusAfterCooldown = JSON.parse(runCli(['action', 'watcher-status', 'limit=4', 'json'], env, options));
  const pinchyWatcherStatusAfterCooldown = JSON.parse(runCli(['action', 'watcher-status', 'pinchymeow', 'limit=4', 'json'], env, options));

  assertIncludes(actionScanAfterCooldown, 'created=1', 'action scan after cooldown');
  assertIncludes(actionScanAfterCooldown, 'duplicates=1', 'action scan after cooldown');
  assertIncludes(actionScanAfterCooldown, 'cooldown=1', 'action scan after cooldown');
  assertIncludes(actionScanAfterCooldown, 'try=2', 'action scan reissue attempt');
  if (!blockerReissuedAction) throw new Error('expected blocker follow-up to be reissued after cooldown');
  if (blockerReissuedAction.attempt !== 2) throw new Error(`expected reissued blocker action attempt=2, got ${blockerReissuedAction.attempt}`);
  if (blockerReissuedAction.reissue_of !== blockerPendingAction.action_id) throw new Error(`expected reissued blocker action to point to ${blockerPendingAction.action_id}, got ${blockerReissuedAction.reissue_of}`);
  if (blockerReissuedAction.cooldown_hours !== 12) throw new Error(`expected reissued blocker action cooldown_hours=12, got ${blockerReissuedAction.cooldown_hours}`);
  if ((blockerReissuedAction.confidence || 0) <= (blockerPendingActionFile.confidence || 0)) throw new Error('expected reissued blocker action confidence to increase');
  assertIncludes(pinchyPendingAfterCooldown, blockerReissuedAction.action_id, 'pinchy pending list after cooldown');
  assertIncludes(pinchyPendingAfterCooldown, 'try=2', 'pinchy pending list after cooldown');
  if (watcherStatusAfterCooldown.pending_actions.total !== 2) throw new Error(`expected watcher status pending total=2 after cooldown reissue, got ${watcherStatusAfterCooldown.pending_actions.total}`);
  if (pinchyWatcherStatusAfterCooldown.pending_actions.total !== 1) throw new Error(`expected pinchy watcher status pending total=1 after cooldown reissue, got ${pinchyWatcherStatusAfterCooldown.pending_actions.total}`);
  if (pinchyWatcherStatusAfterCooldown.recent_runs.total !== 2) throw new Error(`expected pinchy watcher recent runs total=2, got ${pinchyWatcherStatusAfterCooldown.recent_runs.total}`);

  const launcherDryRun = JSON.parse(runLauncher(['--agent', 'f0x', '--cooldown-minutes', '5', '--dry-run', '--json'], env, options));
  const pendingLaunchRequests = readJson(path.join(env.ATF_DATA_DIR, 'pending-launch-requests.json'));
  const launchStatusPending = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  if (launcherDryRun.created !== 1) throw new Error(`expected launcher dry-run created=1, got ${launcherDryRun.created}`);
  if (launcherDryRun.pendingAfterScan !== 1) throw new Error(`expected launcher pendingAfterScan=1, got ${launcherDryRun.pendingAfterScan}`);
  if (launcherDryRun.status !== 'completed') throw new Error(`expected launcher dry-run status completed, got ${launcherDryRun.status}`);
  if (pendingLaunchRequests.total !== 1) throw new Error(`expected 1 pending launch request, got ${pendingLaunchRequests.total}`);
  if (launchStatusPending.status !== 'pending') throw new Error(`expected launch status pending, got ${launchStatusPending.status}`);
  const firstLaunchRequest = pendingLaunchRequests.items[0];
  if (firstLaunchRequest.agent !== 'f0x') throw new Error(`expected first launch request agent=f0x, got ${firstLaunchRequest.agent}`);

  const launcherRun = JSON.parse(runLauncher(['--agent', 'f0x', '--cooldown-minutes', '5', '--mode', 'noop', '--dispatcher', 'phase-d-smoke', '--lease-minutes', '5', '--json'], env, options));
  const leasedLaunchRequest = readJson(path.join(env.ATF_DATA_DIR, 'agent-launch-requests', `${firstLaunchRequest.launch_id}.json`));
  const launcherRuns = runCli(['launch', 'runs', 'limit=4'], env, options);
  const latestLauncherRun = JSON.parse(runCli(['launch', 'run-show', 'latest'], env, options));
  const launcherWatcherStatus = JSON.parse(runCli(['launch', 'launcher-status', 'limit=4', 'json'], env, options));
  const launchStatusLeased = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  if (launcherRun.leased !== 1) throw new Error(`expected launcher leased=1, got ${launcherRun.leased}`);
  if (launcherRun.status !== 'completed') throw new Error(`expected launcher run status completed, got ${launcherRun.status}`);
  if (!launcherRun.audit_path) throw new Error('expected launcher run output to include audit_path');
  if (leasedLaunchRequest.status !== 'leased') throw new Error(`expected launch request leased, got ${leasedLaunchRequest.status}`);
  if (launchStatusLeased.status !== 'leased') throw new Error(`expected launch status leased, got ${launchStatusLeased.status}`);
  assertIncludes(launcherRuns, launcherDryRun.run_id, 'launcher runs');
  assertIncludes(launcherRuns, launcherRun.run_id, 'launcher runs');
  if (latestLauncherRun.run_id !== launcherRun.run_id) throw new Error(`expected latest launcher run to be ${launcherRun.run_id}, got ${latestLauncherRun.run_id}`);
  if (latestLauncherRun.schema !== 'atf.launcher-run.v1') throw new Error(`expected latest launcher run schema, got ${latestLauncherRun.schema}`);
  if (!latestLauncherRun.audit_path) throw new Error('expected latest launcher run to persist audit_path');
  if (launcherWatcherStatus.status !== 'ok') throw new Error(`expected launcher watcher status ok, got ${launcherWatcherStatus.status}`);
  if (launcherWatcherStatus.latest_run?.run_id !== launcherRun.run_id) throw new Error(`expected launcher watcher latest run ${launcherRun.run_id}, got ${launcherWatcherStatus.latest_run?.run_id}`);
  if (launcherWatcherStatus.recent_runs.total !== 2) throw new Error(`expected launcher watcher recent run total=2, got ${launcherWatcherStatus.recent_runs.total}`);
  if (launcherWatcherStatus.launch_queue.counts.leased !== 1) throw new Error(`expected launcher watcher leased count=1, got ${launcherWatcherStatus.launch_queue.counts.leased}`);

  setLaunchRequestTimestamps(env, firstLaunchRequest.launch_id, new Date(Date.now() - (10 * 60 * 1000)).toISOString(), new Date(Date.now() - (4 * 60 * 1000)).toISOString());
  const launchScanAfterLeaseExpiry = runCli(['launch', 'scan', 'f0x', 'cooldown_minutes=5'], env, options);
  const launchRequestsAfterLeaseExpiry = readJson(path.join(env.ATF_DATA_DIR, 'pending-launch-requests.json'));
  const reissuedLaunch = launchRequestsAfterLeaseExpiry.items.find(item => item.launch_id !== firstLaunchRequest.launch_id);
  if (!reissuedLaunch) throw new Error('expected reissued launch request after lease expiry');
  assertIncludes(launchScanAfterLeaseExpiry, 'created=1', 'launch scan after lease expiry');
  assertIncludes(launchScanAfterLeaseExpiry, 'archived=1', 'launch scan after lease expiry');
  if (reissuedLaunch.attempt !== 2) throw new Error(`expected reissued launch attempt=2, got ${reissuedLaunch.attempt}`);
  if (reissuedLaunch.reissue_of !== firstLaunchRequest.launch_id) throw new Error(`expected reissued launch to point to ${firstLaunchRequest.launch_id}, got ${reissuedLaunch.reissue_of}`);

  const sessionsSpawnDispatch = runCli(['launch', 'dispatch', reissuedLaunch.launch_id, 'dispatcher=phase-d-smoke', 'mode=sessions_spawn', 'lease_minutes=5'], env, options);
  const spawnedLaunchRequest = readJson(path.join(env.ATF_DATA_DIR, 'agent-launch-requests', `${reissuedLaunch.launch_id}.json`));
  const mockSpawnEvent = readJson(path.join(mockSpawnEventsDir, `${reissuedLaunch.launch_id}.json`));
  const staleReviewPrompt = bridgeHelpers.buildPrompt({
    launch_id: reissuedLaunch.launch_id,
    agent: 'f0x',
    workspace: env.ATF_WORKSPACE_F0X,
    source_path: path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'),
    guidance: reissuedLaunch.guidance,
    summary: reissuedLaunch.summary,
    payload: {
      task_id: staleTaskId,
      action_id: stalePendingAction.action_id,
      kind: 'stale_review_follow_up',
      reviewee: 'f0x',
      assigned_to: 'f0x',
      pending_task_path: path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'),
    },
  });
  assertIncludes(sessionsSpawnDispatch, 'mode: sessions_spawn', 'sessions_spawn dispatch');
  if (spawnedLaunchRequest.status !== 'leased') throw new Error(`expected sessions_spawn launch request leased, got ${spawnedLaunchRequest.status}`);
  if (spawnedLaunchRequest.dispatch_mode !== 'sessions_spawn') throw new Error(`expected dispatch_mode sessions_spawn, got ${spawnedLaunchRequest.dispatch_mode}`);
  if (!spawnedLaunchRequest.dispatch?.artifacts?.payload_path) throw new Error('expected sessions_spawn payload_path artifact');
  if (!fs.existsSync(spawnedLaunchRequest.dispatch.artifacts.payload_path)) throw new Error('expected sessions_spawn payload file to exist');
  if (spawnedLaunchRequest.dispatch?.artifacts?.module !== env.ATF_LAUNCH_SESSIONS_SPAWN_MODULE) {
    throw new Error(`expected sessions_spawn module ${env.ATF_LAUNCH_SESSIONS_SPAWN_MODULE}, got ${spawnedLaunchRequest.dispatch?.artifacts?.module}`);
  }
  if (mockSpawnEvent.agent !== 'f0x') throw new Error(`expected mock sessions_spawn agent=f0x, got ${mockSpawnEvent.agent}`);
  if (mockSpawnEvent.task_id !== staleTaskId) throw new Error(`expected mock sessions_spawn task_id=${staleTaskId}, got ${mockSpawnEvent.task_id}`);
  if (mockSpawnEvent.action_id !== stalePendingAction.action_id) throw new Error(`expected mock sessions_spawn action_id=${stalePendingAction.action_id}, got ${mockSpawnEvent.action_id}`);
  if (mockSpawnEvent.payload_path !== spawnedLaunchRequest.dispatch.artifacts.payload_path) throw new Error('expected mock sessions_spawn payload_path to match dispatch artifact');
  if (!staleReviewPrompt.includes('Do not write a self review')) throw new Error('expected stale review prompt to warn against self review');
  if (staleReviewPrompt.includes(`review add ${staleTaskId} f0x f0x approved`)) throw new Error('stale review prompt must not suggest self review closure');

  runCli(['review', 'add', staleTaskId, 'huntmind', 'f0x', 'approved', 'smoke-review', 'type=task', 'overall=4'], env, options);
  const launchScanAfterReviewWriteback = runCli(['launch', 'scan', 'f0x', 'cooldown_minutes=5'], env, options);
  const launchStatusAfterReviewWriteback = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  assertIncludes(launchScanAfterReviewWriteback, 'created=0', 'launch scan after review writeback');
  assertIncludes(launchScanAfterReviewWriteback, 'archived=1', 'launch scan after review writeback');
  if (launchStatusAfterReviewWriteback.counts.pending !== 0) throw new Error(`expected no pending launch requests after review writeback, got ${launchStatusAfterReviewWriteback.counts.pending}`);
  if (launchStatusAfterReviewWriteback.counts.leased !== 0) throw new Error(`expected no leased launch requests after review writeback, got ${launchStatusAfterReviewWriteback.counts.leased}`);

  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });
  const launchScanAfterSourceClear = runCli(['launch', 'scan', 'f0x', 'cooldown_minutes=5'], env, options);
  const launchStatusAfterClear = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  assertIncludes(launchScanAfterSourceClear, 'created=0', 'launch scan after source clear');
  if (launchStatusAfterClear.counts.pending !== 0) throw new Error(`expected no pending launch requests after source clear, got ${launchStatusAfterClear.counts.pending}`);

  if (options.cleanup) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }

  console.log('ATF Phase D action layer smoke passed.');
}

try {
  main();
} catch (error) {
  console.error('ATF Phase D action layer smoke failed.');
  console.error(error.message);
  process.exit(1);
}
