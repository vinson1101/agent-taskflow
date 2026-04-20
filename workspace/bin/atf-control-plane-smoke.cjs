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

  const invalidTriggerMode = runExpectedFailure(controlPlanePath, ['--trigger-mode', 'invalid-mode'], env);
  const invalidActionMode = runExpectedFailure(controlPlanePath, ['--action-mode', 'invalid-mode'], env);
  const invalidLauncherMode = runExpectedFailure(controlPlanePath, ['--launcher-mode', 'invalid-mode'], env);
  assertIncludes(invalidTriggerMode, 'invalid --trigger-mode: invalid-mode. expected one of pending_task|message|room|noop', 'invalid trigger mode');
  assertIncludes(invalidActionMode, 'invalid --action-mode: invalid-mode. expected one of message|pending_task|noop', 'invalid action mode');
  assertIncludes(invalidLauncherMode, 'invalid --launcher-mode: invalid-mode. expected one of manual|noop|sessions_spawn', 'invalid launcher mode');

  runCli(['agent', 'register', 'f0x', `workspace=${env.ATF_WORKSPACE_F0X}`], env, options);

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
  if (controlPlaneStatus.recent_runs.total !== 1) throw new Error(`expected control-plane recent run total=1, got ${controlPlaneStatus.recent_runs.total}`);
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

  runCli(['update', triggerTaskId, 'completed', 'by=f0x'], env, options);
  runCli(['delivered', triggerTaskId, 'by=f0x'], env, options);
  const triggerHistory = readJson(path.join(triggerTaskDir, 'notifications', 'history.json'));
  const latestStatusChange = [...triggerHistory].reverse().find(event => event.event === 'status_change');
  const latestDelivered = [...triggerHistory].reverse().find(event => event.event === 'delivered');
  if (latestStatusChange?.by !== 'f0x') throw new Error(`expected status_change by=f0x, got ${latestStatusChange?.by}`);
  if (latestDelivered?.by !== 'f0x') throw new Error(`expected delivered by=f0x, got ${latestDelivered?.by}`);

  const staleIso = new Date(Date.now() - (65 * 60 * 1000)).toISOString();
  controlPlaneAudit.started_at = staleIso;
  controlPlaneAudit.completed_at = staleIso;
  writeJson(summary.audit_path, controlPlaneAudit);
  writeJson(path.join(path.dirname(summary.audit_path), 'latest.json'), controlPlaneAudit);
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
