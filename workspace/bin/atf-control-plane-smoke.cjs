#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'atf-cli.js');
const controlPlanePath = path.join(repoRoot, 'workspace', 'bin', 'atf-control-plane.cjs');
const smokeRoot = path.join(repoRoot, '.tmp-atf-control-plane-smoke');

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

function executeScript(scriptPath, args, env) {
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
      return {
        stdout: stdout.join('\n').trim(),
        stderr: stderr.join('\n').trim(),
        exitCode: exitSignal.code || 1,
        error: error.message || String(error),
      };
    }
  }

  return {
    stdout: stdout.join('\n').trim(),
    stderr: stderr.join('\n').trim(),
    exitCode: exitSignal.code,
    error: null,
  };
}

function runScript(scriptPath, args, env, options = {}) {
  const result = executeScript(scriptPath, args, env);
  if (result.exitCode !== 0 || result.stderr) {
    const message = [
      `node ${path.basename(scriptPath)} ${args.join(' ')}`,
      result.stdout ? `stdout:\n${result.stdout}` : null,
      result.stderr ? `stderr:\n${result.stderr}` : null,
      result.error ? `error:\n${result.error}` : null,
      result.exitCode ? `exit=${result.exitCode}` : null,
    ].filter(Boolean).join('\n');
    throw new Error(message);
  }

  if (!options.quiet && result.stdout) {
    console.log(`$ node ${path.basename(scriptPath)} ${args.join(' ')}`);
    console.log(result.stdout);
    console.log('');
  }

  return result.stdout;
}

function runExpectedFailure(scriptPath, args, env) {
  const result = executeScript(scriptPath, args, env);
  if (result.exitCode === 0 && !result.stderr && !result.error) {
    throw new Error(`expected failure: node ${path.basename(scriptPath)} ${args.join(' ')}`);
  }
  return [result.stdout, result.stderr, result.error].filter(Boolean).join('\n');
}

function runCli(args, env, options = {}) {
  return runScript(cliPath, args, env, options);
}

function runControlPlane(args, env, options = {}) {
  return runScript(controlPlanePath, args, env, options);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
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
    if (!fs.existsSync(filePath)) continue;
    const ctx = readJson(filePath);
    ctx.updated_at = updatedAt;
    ctx.created_at = createdAt;
    writeJson(filePath, ctx);
  }
}

function readJsonCollection(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson(path.join(dirPath, name)));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  safeResetDir(smokeRoot);

  const env = {
    ATF_TASKS_DIR: path.join(smokeRoot, 'tasks'),
    ATF_WORKSPACE_DIR: path.join(smokeRoot, 'workspace'),
    ATF_DATA_DIR: path.join(smokeRoot, 'data'),
    ATF_WORKSPACE_F0X: path.join(smokeRoot, 'workspace-f0x'),
  };

  for (const dir of Object.values(env)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const quietIdle = executeScript(controlPlanePath, ['--quiet-idle'], env);
  if (quietIdle.exitCode !== 0) throw new Error(`expected quiet idle control-plane exit=0, got ${quietIdle.exitCode}`);
  if (quietIdle.stdout || quietIdle.stderr) throw new Error('expected quiet idle control-plane to print nothing');

  const controlPlaneHelp = runScript(controlPlanePath, ['--help'], env, options);
  assertIncludes(controlPlaneHelp, '--trigger-mode <mode>', 'control-plane help');
  assertIncludes(controlPlaneHelp, '--trigger-room <name>', 'control-plane help');
  assertIncludes(controlPlaneHelp, '--action-mode <mode>', 'control-plane help');
  assertIncludes(controlPlaneHelp, '--action-thread <id>', 'control-plane help');
  assertIncludes(controlPlaneHelp, '--writeback-minutes <n>', 'control-plane help');
  assertIncludes(controlPlaneHelp, '--resolution-hours <n>', 'control-plane help');

  const invalidTriggerMode = runExpectedFailure(controlPlanePath, ['--trigger-mode', 'invalid-mode'], env);
  const invalidActionMode = runExpectedFailure(controlPlanePath, ['--action-mode', 'invalid-mode'], env);
  const invalidLauncherMode = runExpectedFailure(controlPlanePath, ['--launcher-mode', 'invalid-mode'], env);
  assertIncludes(invalidTriggerMode, 'invalid --trigger-mode: invalid-mode. expected one of pending_task|message|room|noop', 'invalid trigger mode');
  assertIncludes(invalidActionMode, 'invalid --action-mode: invalid-mode. expected one of message|pending_task|noop', 'invalid action mode');
  assertIncludes(invalidLauncherMode, 'invalid --launcher-mode: invalid-mode. expected one of manual|noop|sessions_spawn', 'invalid launcher mode');

  runCli(['agent', 'register', 'f0x', `workspace=${env.ATF_WORKSPACE_F0X}`], env, options);

  const timeoutCreateOutput = runCli(['create', 'Timeout shorthand create demo', 'type=ops', 'difficulty=1', 'priority=low', '--timeout=1h'], env, options);
  const timeoutCreateTaskId = extractTaskId(timeoutCreateOutput);
  const timeoutCreateCtx = readJson(path.join(resolveTaskDir(timeoutCreateTaskId, env), 'ctx.json'));
  if (timeoutCreateCtx.protocol?.final_timeout !== 3600) throw new Error(`expected --timeout create final_timeout=3600, got ${timeoutCreateCtx.protocol?.final_timeout}`);
  if (timeoutCreateCtx.protocol?.confirm_timeout !== 3300) throw new Error(`expected --timeout create confirm_timeout=3300, got ${timeoutCreateCtx.protocol?.confirm_timeout}`);
  runCli(['update', timeoutCreateTaskId, 'completed'], env, options);

  const timeoutOverrideOutput = runCli(['create', 'Timeout shorthand override demo', 'type=ops', 'difficulty=1', 'priority=low', '--timeout=1h', '--confirm-timeout=50m'], env, options);
  const timeoutOverrideTaskId = extractTaskId(timeoutOverrideOutput);
  const timeoutOverrideCtx = readJson(path.join(resolveTaskDir(timeoutOverrideTaskId, env), 'ctx.json'));
  if (timeoutOverrideCtx.protocol?.final_timeout !== 3600) throw new Error(`expected override final_timeout=3600, got ${timeoutOverrideCtx.protocol?.final_timeout}`);
  if (timeoutOverrideCtx.protocol?.confirm_timeout !== 3000) throw new Error(`expected override confirm_timeout=3000, got ${timeoutOverrideCtx.protocol?.confirm_timeout}`);
  runCli(['update', timeoutOverrideTaskId, 'completed'], env, options);

  const timeoutAssignOutput = runCli(['create', 'Timeout shorthand assign demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const timeoutAssignTaskId = extractTaskId(timeoutAssignOutput);
  runCli(['assign', timeoutAssignTaskId, 'f0x', '--timeout=45m'], env, options);
  const timeoutAssignCtx = readJson(path.join(resolveTaskDir(timeoutAssignTaskId, env), 'ctx.json'));
  if (timeoutAssignCtx.protocol?.final_timeout !== 2700) throw new Error(`expected --timeout assign final_timeout=2700, got ${timeoutAssignCtx.protocol?.final_timeout}`);
  if (timeoutAssignCtx.protocol?.confirm_timeout !== 2400) throw new Error(`expected --timeout assign confirm_timeout=2400, got ${timeoutAssignCtx.protocol?.confirm_timeout}`);
  const timeoutAssignPending = readJson(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'));
  if (timeoutAssignPending.protocol?.final_timeout !== 2700) throw new Error(`expected assign pending final_timeout=2700, got ${timeoutAssignPending.protocol?.final_timeout}`);
  if (timeoutAssignPending.protocol?.confirm_timeout !== 2400) throw new Error(`expected assign pending confirm_timeout=2400, got ${timeoutAssignPending.protocol?.confirm_timeout}`);
  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });
  runCli(['update', timeoutAssignTaskId, 'completed'], env, options);

  const directFlowOutput = runCli(['create', 'Direct pending signal demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const directFlowTaskId = extractTaskId(directFlowOutput);
  runCli(['assign', directFlowTaskId, 'f0x'], env, options);
  const directFlowTaskDir = resolveTaskDir(directFlowTaskId, env);
  const directWorkspacePendingPath = path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json');
  if (!fs.existsSync(directWorkspacePendingPath)) throw new Error('expected assign to write workspace pending-task.json');
  if (fs.existsSync(path.join(directFlowTaskDir, 'pending-task.json'))) throw new Error('assign should not write task-dir pending-task.json');
  const directAssignedPending = readJson(directWorkspacePendingPath);
  if (directAssignedPending.task_id !== directFlowTaskId) throw new Error(`expected assigned workspace pending task_id ${directFlowTaskId}, got ${directAssignedPending.task_id}`);
  if (directAssignedPending.assigned_to !== 'f0x') throw new Error(`expected assigned workspace pending assigned_to=f0x, got ${directAssignedPending.assigned_to}`);

  runCli(['block', directFlowTaskId, 'Need direction before continuing'], env, options);
  if (fs.existsSync(directWorkspacePendingPath)) throw new Error('expected block to clear workspace pending-task.json');
  if (fs.existsSync(path.join(directFlowTaskDir, 'pending-task.json'))) throw new Error('block should not leave task-dir pending-task.json');

  runCli(['decide', directFlowTaskId, 'Proceed with current plan'], env, options);
  const directDecisionPending = readJson(directWorkspacePendingPath);
  if (directDecisionPending.decision?.type !== 'answered') throw new Error(`expected decide to write decision.type=answered, got ${directDecisionPending.decision?.type}`);

  runCli(['revise', directFlowTaskId, 'Please tighten the implementation'], env, options);
  const directRevisionPending = readJson(directWorkspacePendingPath);
  if (directRevisionPending.decision?.type !== 'revision') throw new Error(`expected revise to write decision.type=revision, got ${directRevisionPending.decision?.type}`);
  if (fs.existsSync(path.join(directFlowTaskDir, 'pending-task.json'))) throw new Error('revise should not write task-dir pending-task.json');
  fs.rmSync(directWorkspacePendingPath, { force: true });
  runCli(['update', directFlowTaskId, 'completed'], env, options);

  const legacyStatusOutput = runCli(['create', 'Legacy status compatibility demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const legacyStatusTaskId = extractTaskId(legacyStatusOutput);
  const legacyStatusTaskDir = resolveTaskDir(legacyStatusTaskId, env);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(legacyStatusTaskDir, fileName);
    const ctx = readJson(filePath);
    delete ctx.sub_tasks;
    delete ctx.protocol;
    delete ctx.inputs;
    delete ctx.outputs;
    writeJson(filePath, ctx);
  }
  const legacyStatus = runCli(['status', legacyStatusTaskId], env, options);
  assertIncludes(legacyStatus, `任务: ${legacyStatusTaskId}`, 'legacy status');
  assertIncludes(legacyStatus, '状态:', 'legacy status');

  assertIncludes(legacyStatus, 'Protocol: phase=', 'legacy status');

  const invalidTaskStatus = runExpectedFailure(cliPath, ['update', legacyStatusTaskId, 'not-a-status'], env);
  assertIncludes(invalidTaskStatus, '非法 status', 'invalid task status');

  const pendingProtocolOutput = runCli(['create', 'Pending protocol demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const pendingProtocolTaskId = extractTaskId(pendingProtocolOutput);
  runCli(['assign', pendingProtocolTaskId, 'f0x'], env, options);
  runCli(['update', pendingProtocolTaskId, 'pending'], env, options);
  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });
  const pendingTasksStats = runCli(['stats', 'tasks', 'status=pending', 'limit=20'], env, options);
  assertIncludes(pendingTasksStats, pendingProtocolTaskId, 'stats tasks pending');

  const confirmTimeoutOutput = runCli(['create', 'Confirm timeout protocol demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const confirmTimeoutTaskId = extractTaskId(confirmTimeoutOutput);
  runCli(['assign', confirmTimeoutTaskId, 'f0x'], env, options);
  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });
  const confirmTimeoutTaskDir = resolveTaskDir(confirmTimeoutTaskId, env);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(confirmTimeoutTaskDir, fileName);
    const ctx = readJson(filePath);
    ctx.status = 'assigned';
    ctx.protocol = ctx.protocol || {};
    ctx.protocol.confirm_timeout = 60;
    ctx.protocol.assigned_at = new Date(Date.now() - (11 * 60 * 1000)).toISOString();
    writeJson(filePath, ctx);
  }

  const finalTimeoutOutput = runCli(['create', 'Final timeout protocol demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const finalTimeoutTaskId = extractTaskId(finalTimeoutOutput);
  runCli(['assign', finalTimeoutTaskId, 'f0x'], env, options);
  runCli(['update', finalTimeoutTaskId, 'active'], env, options);
  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });
  const finalTimeoutTaskDir = resolveTaskDir(finalTimeoutTaskId, env);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(finalTimeoutTaskDir, fileName);
    const ctx = readJson(filePath);
    ctx.status = 'active';
    ctx.protocol = ctx.protocol || {};
    ctx.protocol.final_timeout = 120;
    ctx.protocol.started_at = new Date(Date.now() - (9 * 60 * 1000)).toISOString();
    writeJson(filePath, ctx);
  }
  const activeTasksStats = runCli(['stats', 'tasks', 'status=active', 'limit=20'], env, options);
  assertIncludes(activeTasksStats, finalTimeoutTaskId, 'stats tasks active');

  const protocolRunSummary = JSON.parse(runControlPlane([
    '--agent', 'f0x',
    '--no-trigger',
    '--no-action',
    '--no-launcher',
    '--json',
  ], env, options));
  const protocolStatus = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=10', 'json'], env, options));
  if (protocolStatus.status !== 'attention') throw new Error(`expected protocol attention status, got ${protocolStatus.status}`);
  if (protocolStatus.code !== 'task_protocol_overdue') throw new Error(`expected task_protocol_overdue code, got ${protocolStatus.code}`);
  if (protocolStatus.task_protocol?.overdue !== 2) throw new Error(`expected two overdue protocol tasks, got ${protocolStatus.task_protocol?.overdue}`);
  if (protocolStatus.task_protocol?.by_phase?.pending !== 1) throw new Error(`expected one pending protocol task, got ${protocolStatus.task_protocol?.by_phase?.pending}`);
  if (protocolStatus.task_protocol?.by_phase?.awaiting_confirmation !== 1) throw new Error(`expected one awaiting_confirmation task, got ${protocolStatus.task_protocol?.by_phase?.awaiting_confirmation}`);
  if (protocolStatus.task_protocol?.by_phase?.in_progress !== 1) throw new Error(`expected one in_progress task, got ${protocolStatus.task_protocol?.by_phase?.in_progress}`);
  const confirmProtocolRow = protocolStatus.task_protocol?.items?.find(item => item.task_id === confirmTimeoutTaskId);
  const finalProtocolRow = protocolStatus.task_protocol?.items?.find(item => item.task_id === finalTimeoutTaskId);
  if (confirmProtocolRow?.code !== 'confirm_timeout') throw new Error(`expected confirm_timeout row, got ${confirmProtocolRow?.code}`);
  if (finalProtocolRow?.code !== 'final_timeout') throw new Error(`expected final_timeout row, got ${finalProtocolRow?.code}`);

  runCli(['update', pendingProtocolTaskId, 'completed'], env, options);
  runCli(['update', confirmTimeoutTaskId, 'completed'], env, options);
  runCli(['update', finalTimeoutTaskId, 'completed'], env, options);

  const triggerTaskOutput = runCli(['create', 'Control plane trigger demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const triggerTaskId = extractTaskId(triggerTaskOutput);
  runCli(['assign', triggerTaskId, 'f0x'], env, options);
  fs.rmSync(path.join(resolveTaskDir(triggerTaskId, env), 'pending-task.json'), { force: true });
  runCli(['trigger', 'follow-up', triggerTaskId, 'f0x', '1s'], env, options);

  const staleTaskOutput = runCli(['create', 'Control plane stale review demo', 'type=ops', 'difficulty=2', 'priority=normal'], env, options);
  const staleTaskId = extractTaskId(staleTaskOutput);
  runCli(['assign', staleTaskId, 'f0x'], env, options);
  runCli(['update', staleTaskId, 'completed'], env, options);
  setTaskUpdatedAt(staleTaskId, env, new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString());
  fs.rmSync(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'), { force: true });

  const summary = JSON.parse(runControlPlane([
    '--agent', 'f0x',
    '--trigger-executor', 'control-plane-smoke',
    '--trigger-mode', 'room',
    '--trigger-room', 'design',
    '--trigger-at', new Date(Date.now() + (2 * 60 * 1000)).toISOString(),
    '--action-executor', 'control-plane-smoke',
    '--action-mode', 'pending_task',
    '--writeback-minutes', '5',
    '--launcher-dispatcher', 'control-plane-smoke',
    '--launcher-mode', 'noop',
    '--min-confidence', '0',
    '--cooldown-minutes', '0',
    '--lease-minutes', '5',
    '--json',
  ], env, options));

  if (summary.status !== 'completed') throw new Error(`expected control-plane status completed, got ${summary.status}`);
  if (!summary.audit_path) throw new Error('expected control-plane summary to include audit_path');
  if (!fs.existsSync(summary.audit_path)) throw new Error('expected control-plane audit file to exist');
  const controlPlaneAudit = readJson(summary.audit_path);
  if (controlPlaneAudit.run_id !== summary.run_id) throw new Error('expected control-plane audit run_id to match');
  if (controlPlaneAudit.schema !== 'atf.control-plane-run.v1') throw new Error(`expected control-plane audit schema, got ${controlPlaneAudit.schema}`);
  if (!summary.activity.trigger) throw new Error('expected trigger activity in control-plane summary');
  if (!summary.activity.action) throw new Error('expected action activity in control-plane summary');
  if (!summary.activity.launcher) throw new Error('expected launcher activity in control-plane summary');
  if (summary.idle) throw new Error('expected non-idle control-plane summary');
  if ((summary.trigger?.executed || 0) !== 1) throw new Error(`expected trigger executed=1, got ${summary.trigger?.executed}`);
  if ((summary.action?.executed || 0) !== 1) throw new Error(`expected action executed=1, got ${summary.action?.executed}`);
  if ((summary.launcher?.created || 0) !== 1) throw new Error(`expected launcher created=1, got ${summary.launcher?.created}`);
  if ((summary.launcher?.leased || 0) !== 1) throw new Error(`expected launcher leased=1, got ${summary.launcher?.leased}`);

  const triggerTaskDir = resolveTaskDir(triggerTaskId, env);
  const triggerMessages = readJsonCollection(path.join(triggerTaskDir, 'messages'));
  const roomMessage = triggerMessages.find(message => message.adapter_mode === 'room');
  if (!roomMessage) throw new Error('expected trigger watcher to write a room message');
  if (roomMessage.to_agent !== 'room:design') throw new Error(`expected room target room:design, got ${roomMessage.to_agent}`);
  if (fs.existsSync(path.join(triggerTaskDir, 'pending-task.json'))) {
    throw new Error('room trigger execution should not write taskDir/pending-task.json');
  }

  const actionPendingTask = readJson(path.join(env.ATF_WORKSPACE_F0X, 'pending-task.json'));
  if (actionPendingTask.kind !== 'stale_review_follow_up') {
    throw new Error(`expected action pending-task kind stale_review_follow_up, got ${actionPendingTask.kind}`);
  }
  if (actionPendingTask.task_id !== staleTaskId) {
    throw new Error(`expected action pending-task task_id ${staleTaskId}, got ${actionPendingTask.task_id}`);
  }

  const launchStatus = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  if (launchStatus.counts.leased !== 1) throw new Error(`expected leased launch count=1, got ${launchStatus.counts.leased}`);
  if (launchStatus.writeback?.active_counts?.pending !== 1) throw new Error(`expected launch writeback pending=1, got ${launchStatus.writeback?.active_counts?.pending}`);

  const controlPlaneRuns = runCli(['control-plane', 'runs', 'f0x', 'limit=5'], env, options);
  const controlPlaneRunShow = JSON.parse(runCli(['control-plane', 'run-show', 'latest'], env, options));
  const controlPlaneStatus = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=5', 'json'], env, options));
  assertIncludes(controlPlaneRuns, summary.run_id, 'control-plane runs');
  assertIncludes(controlPlaneRuns, 'trigger_executed=1', 'control-plane runs');
  if (controlPlaneRunShow.run_id !== summary.run_id) throw new Error(`expected control-plane run-show latest ${summary.run_id}, got ${controlPlaneRunShow.run_id}`);
  if (controlPlaneRunShow.audit_path !== summary.audit_path) throw new Error('expected control-plane run-show audit_path to match');
  if (controlPlaneStatus.latest_run?.run_id !== summary.run_id) throw new Error(`expected control-plane status latest run ${summary.run_id}, got ${controlPlaneStatus.latest_run?.run_id}`);
  if ((controlPlaneStatus.recent_runs.total || 0) < 2) throw new Error(`expected control-plane recent run total>=2, got ${controlPlaneStatus.recent_runs.total}`);
  if (controlPlaneStatus.trigger_queue.total !== 0) throw new Error(`expected control-plane trigger queue total=0, got ${controlPlaneStatus.trigger_queue.total}`);
  if (controlPlaneStatus.action_watcher.pending_actions.total !== 0) throw new Error(`expected control-plane action pending total=0, got ${controlPlaneStatus.action_watcher.pending_actions.total}`);
  if (controlPlaneStatus.launcher.launch_queue.counts.leased !== 1) throw new Error(`expected control-plane launcher leased=1, got ${controlPlaneStatus.launcher.launch_queue.counts.leased}`);
  if (controlPlaneStatus.writeback?.active_counts?.pending !== 1) throw new Error(`expected control-plane writeback pending=1, got ${controlPlaneStatus.writeback?.active_counts?.pending}`);
  if (controlPlaneStatus.writeback?.active_resolution_counts?.unresolved !== 1) throw new Error(`expected control-plane unresolved writeback=1, got ${controlPlaneStatus.writeback?.active_resolution_counts?.unresolved}`);
  if (controlPlaneStatus.status !== 'active') throw new Error(`expected control-plane status active, got ${controlPlaneStatus.status}`);
  if (controlPlaneStatus.code !== 'pending_control_work') throw new Error(`expected control-plane code pending_control_work, got ${controlPlaneStatus.code}`);

  runCli(['update', staleTaskId, 'executing', 'by=f0x'], env, options);
  const launchStatusAcknowledged = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  const controlPlaneStatusAcknowledged = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=5', 'json'], env, options));
  if (launchStatusAcknowledged.writeback?.total_counts?.confirmed !== 1) throw new Error(`expected confirmed launch writeback=1 after ack, got ${launchStatusAcknowledged.writeback?.total_counts?.confirmed}`);
  if (launchStatusAcknowledged.writeback?.total_resolution_counts?.acknowledged !== 1) throw new Error(`expected total acknowledged launch writeback=1, got ${launchStatusAcknowledged.writeback?.total_resolution_counts?.acknowledged}`);
  if (launchStatusAcknowledged.writeback?.latest?.resolution !== 'acknowledged') throw new Error(`expected latest launch writeback resolution acknowledged, got ${launchStatusAcknowledged.writeback?.latest?.resolution}`);
  if (launchStatusAcknowledged.counts.leased !== 0) throw new Error(`expected no leased launch requests after acknowledged writeback, got ${launchStatusAcknowledged.counts.leased}`);
  if (launchStatusAcknowledged.writeback?.active_resolution_counts?.acknowledged !== 0) throw new Error(`expected no active acknowledged writebacks after immediate archive, got ${launchStatusAcknowledged.writeback?.active_resolution_counts?.acknowledged}`);
  if (controlPlaneStatusAcknowledged.writeback?.active_resolution_counts?.acknowledged !== 0) throw new Error(`expected control-plane active acknowledged writeback=0 after immediate archive, got ${controlPlaneStatusAcknowledged.writeback?.active_resolution_counts?.acknowledged}`);
  if (controlPlaneStatusAcknowledged.launcher?.launch_queue?.counts?.leased !== 0) throw new Error(`expected control-plane launcher leased=0 after immediate archive, got ${controlPlaneStatusAcknowledged.launcher?.launch_queue?.counts?.leased}`);
  if (launchStatusAcknowledged.writeback?.post_launch?.latest?.resolution !== 'acknowledged') throw new Error(`expected latest post-launch resolution acknowledged, got ${launchStatusAcknowledged.writeback?.post_launch?.latest?.resolution}`);

  const postLaunchFollowUpSummary = JSON.parse(runControlPlane([
    '--agent', 'f0x',
    '--no-trigger',
    '--no-launcher',
    '--action-executor', 'control-plane-smoke',
    '--action-mode', 'message',
    '--action-thread', 'THR-control-post-launch',
    '--resolution-hours', '0',
    '--min-confidence', '0',
    '--json',
  ], env, options));
  if ((postLaunchFollowUpSummary.action?.eligibleActions || 0) !== 1) throw new Error(`expected post-launch eligibleActions=1, got ${postLaunchFollowUpSummary.action?.eligibleActions}`);
  if ((postLaunchFollowUpSummary.action?.executed || 0) !== 1) throw new Error(`expected post-launch follow-up executed=1, got ${postLaunchFollowUpSummary.action?.executed}`);
  const staleTaskDir = resolveTaskDir(staleTaskId, env);
  const staleTaskActionsAfterResolutionFollowUp = readJsonCollection(path.join(staleTaskDir, 'actions'));
  const resolutionAction = staleTaskActionsAfterResolutionFollowUp.find(action => action.kind === 'launch_resolution_follow_up');
  if (!resolutionAction) throw new Error('expected launch_resolution_follow_up action to be recorded');
  const staleTaskMessagesAfterResolutionFollowUp = readJsonCollection(path.join(staleTaskDir, 'messages'));
  const resolutionActionMessage = staleTaskMessagesAfterResolutionFollowUp.find(message =>
    message.action_id === resolutionAction.action_id
    && message.thread_id === 'THR-control-post-launch'
  );
  if (!resolutionActionMessage) throw new Error('expected post-launch resolution follow-up to generate a message');
  if (!resolutionActionMessage.body.includes(launchStatusAcknowledged.writeback?.latest?.launch_id || '')) throw new Error('expected post-launch resolution follow-up message to mention launch id');
  const launchStatusWithResolutionFollowUp = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  const controlPlaneStatusWithResolutionFollowUp = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=5', 'json'], env, options));
  if ((launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.total_actions || 0) < 1) throw new Error(`expected post-launch follow-up actions >= 1, got ${launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.total_actions}`);
  if (launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.action_id !== resolutionAction.action_id) throw new Error(`expected latest post-launch follow-up ${resolutionAction.action_id}, got ${launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.action_id}`);
  if (launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.message_id !== resolutionActionMessage.message_id) throw new Error(`expected latest post-launch follow-up message ${resolutionActionMessage.message_id}, got ${launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.message_id}`);
  if (launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.preflight_code !== 'post_launch_pending') throw new Error(`expected latest post-launch preflight code post_launch_pending, got ${launchStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.preflight_code}`);
  if (controlPlaneStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.action_id !== resolutionAction.action_id) throw new Error(`expected control-plane latest post-launch follow-up ${resolutionAction.action_id}, got ${controlPlaneStatusWithResolutionFollowUp.writeback?.post_launch?.follow_up?.latest?.action_id}`);

  runCli(['review', 'add', staleTaskId, 'huntmind', 'f0x', 'approved', 'smoke-post-launch', 'type=task', 'overall=4'], env, options);
  const launchStatusResolvedAfterArchive = JSON.parse(runCli(['launch', 'status', 'f0x', 'json'], env, options));
  const controlPlaneStatusResolvedAfterArchive = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=5', 'json'], env, options));
  if ((launchStatusResolvedAfterArchive.writeback?.post_launch?.total_resolution_counts?.resolved || 0) < 1) throw new Error(`expected post-launch resolved count >= 1, got ${launchStatusResolvedAfterArchive.writeback?.post_launch?.total_resolution_counts?.resolved}`);
  if (launchStatusResolvedAfterArchive.writeback?.post_launch?.latest?.resolution !== 'resolved') throw new Error(`expected latest post-launch resolution resolved, got ${launchStatusResolvedAfterArchive.writeback?.post_launch?.latest?.resolution}`);
  if (controlPlaneStatusResolvedAfterArchive.writeback?.post_launch?.latest?.resolution !== 'resolved') throw new Error(`expected control-plane latest post-launch resolution resolved, got ${controlPlaneStatusResolvedAfterArchive.writeback?.post_launch?.latest?.resolution}`);
  if (launchStatusResolvedAfterArchive.writeback?.latest?.resolution !== 'acknowledged') throw new Error(`expected launch closure resolution to remain acknowledged, got ${launchStatusResolvedAfterArchive.writeback?.latest?.resolution}`);

  runCli(['update', triggerTaskId, 'completed', 'by=f0x'], env, options);
  runCli(['delivered', triggerTaskId, 'by=f0x'], env, options);
  const triggerHistory = readJson(path.join(triggerTaskDir, 'notifications', 'history.json'));
  const latestStatusChange = [...triggerHistory].reverse().find(event => event.event === 'status_change');
  const latestDelivered = [...triggerHistory].reverse().find(event => event.event === 'delivered');
  if (latestStatusChange?.by !== 'f0x') throw new Error(`expected status_change by=f0x, got ${latestStatusChange?.by}`);
  if (latestDelivered?.by !== 'f0x') throw new Error(`expected delivered by=f0x, got ${latestDelivered?.by}`);

  const staleIso = new Date(Date.now() - (65 * 60 * 1000)).toISOString();
  const staleAuditPaths = [...new Set([protocolRunSummary.audit_path, summary.audit_path, postLaunchFollowUpSummary.audit_path].filter(Boolean))];
  for (const auditPath of staleAuditPaths) {
    const audit = readJson(auditPath);
    audit.started_at = staleIso;
    audit.completed_at = staleIso;
    writeJson(auditPath, audit);
  }
  writeJson(path.join(path.dirname(summary.audit_path), 'latest.json'), readJson(postLaunchFollowUpSummary.audit_path || summary.audit_path));
  const controlPlaneStatusStale = JSON.parse(runCli(['control-plane', 'status', 'f0x', 'warn_after_minutes=30', 'limit=5', 'json'], env, options));
  if (controlPlaneStatusStale.status !== 'stale') throw new Error(`expected stale control-plane status, got ${controlPlaneStatusStale.status}`);
  if (controlPlaneStatusStale.code !== 'latest_run_stale') throw new Error(`expected control-plane stale code latest_run_stale, got ${controlPlaneStatusStale.code}`);

  console.log('ATF control-plane smoke passed.');

  if (options.cleanup) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
    console.log('Smoke directory removed.');
  }
}

try {
  main();
} catch (error) {
  console.error('ATF control-plane smoke failed.');
  console.error(error.message || String(error));
  process.exit(1);
}
