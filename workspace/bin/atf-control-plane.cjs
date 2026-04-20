#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const { randomBytes } = require('crypto');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const TRIGGER_EXECUTION_MODES = ['pending_task', 'message', 'room', 'noop'];
const ACTION_EXECUTION_MODES = ['message', 'pending_task', 'noop'];
const LAUNCH_DISPATCH_MODES = ['manual', 'noop', 'sessions_spawn'];
const TRIGGER_EXECUTION_MODE_SET = new Set(TRIGGER_EXECUTION_MODES);
const ACTION_EXECUTION_MODE_SET = new Set(ACTION_EXECUTION_MODES);
const LAUNCH_DISPATCH_MODE_SET = new Set(LAUNCH_DISPATCH_MODES);

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function parseModeOption(flag, rawValue, validModes, validModeSet) {
  const normalized = normalizeMode(rawValue);
  if (!normalized) throw new Error(`${flag} requires a value`);
  if (!validModeSet.has(normalized)) {
    throw new Error(`invalid ${flag}: ${rawValue}. expected one of ${validModes.join('|')}`);
  }
  return normalized;
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `CPR-${stamp}-${randomBytes(3).toString('hex')}`;
}

function defaultWorkspaceDir() {
  const openClawRoot = process.env.ATF_ROOT || '/root/.openclaw';
  return process.env.ATF_WORKSPACE_DIR || path.join(openClawRoot, 'workspace');
}

function defaultDataDir() {
  return process.env.ATF_DATA_DIR || path.join(defaultWorkspaceDir(), 'agent-taskflow', 'data');
}

function controlPlaneRunsDir() {
  return path.join(defaultDataDir(), 'control-plane-runs');
}

function controlPlaneRunPath(runId) {
  return path.join(controlPlaneRunsDir(), `${runId}.json`);
}

function controlPlaneLatestPath() {
  return path.join(controlPlaneRunsDir(), 'latest.json');
}

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function persistSummary(summary) {
  const auditPath = controlPlaneRunPath(summary.run_id);
  const payload = {
    schema: 'atf.control-plane-run.v1',
    ...summary,
    audit_path: summary.audit_path || auditPath,
  };
  writeJson(auditPath, payload);
  writeJson(controlPlaneLatestPath(), payload);
  return auditPath;
}

function parseArgs(argv) {
  const options = {
    agent: null,
    trigger: true,
    action: true,
    launcher: true,
    triggerExecutor: 'atf-watcher',
    triggerMode: null,
    triggerToAgent: null,
    triggerThreadId: null,
    triggerRoomId: null,
    triggerAt: null,
    actionExecutor: 'action-watcher',
    actionMode: null,
    actionToAgent: null,
    actionThreadId: null,
    launcherDispatcher: 'host-launcher',
    launcherMode: 'sessions_spawn',
    staleDays: 4,
    messageHours: 12,
    decisionHours: 6,
    writebackMinutes: 30,
    minConfidence: 0.9,
    maxRisk: 'medium',
    cooldownMinutes: 15,
    leaseMinutes: 5,
    limit: null,
    quietIdle: false,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = argv[++i] || null;
    else if (arg === '--no-trigger') options.trigger = false;
    else if (arg === '--no-action') options.action = false;
    else if (arg === '--no-launcher') options.launcher = false;
    else if (arg === '--trigger-executor') options.triggerExecutor = argv[++i] || options.triggerExecutor;
    else if (arg === '--trigger-mode') options.triggerMode = parseModeOption('--trigger-mode', argv[++i], TRIGGER_EXECUTION_MODES, TRIGGER_EXECUTION_MODE_SET);
    else if (arg === '--trigger-to') options.triggerToAgent = argv[++i] || null;
    else if (arg === '--trigger-thread') options.triggerThreadId = argv[++i] || null;
    else if (arg === '--trigger-room') options.triggerRoomId = argv[++i] || null;
    else if (arg === '--trigger-at') options.triggerAt = argv[++i] || null;
    else if (arg === '--action-executor') options.actionExecutor = argv[++i] || options.actionExecutor;
    else if (arg === '--action-mode') options.actionMode = parseModeOption('--action-mode', argv[++i], ACTION_EXECUTION_MODES, ACTION_EXECUTION_MODE_SET);
    else if (arg === '--action-to') options.actionToAgent = argv[++i] || null;
    else if (arg === '--action-thread') options.actionThreadId = argv[++i] || null;
    else if (arg === '--launcher-dispatcher') options.launcherDispatcher = argv[++i] || options.launcherDispatcher;
    else if (arg === '--launcher-mode') options.launcherMode = parseModeOption('--launcher-mode', argv[++i], LAUNCH_DISPATCH_MODES, LAUNCH_DISPATCH_MODE_SET);
    else if (arg === '--stale-days') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.staleDays = value;
    } else if (arg === '--message-hours') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.messageHours = value;
    } else if (arg === '--decision-hours') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.decisionHours = value;
    } else if (arg === '--writeback-minutes') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.writebackMinutes = value;
    } else if (arg === '--min-confidence') {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) options.minConfidence = value;
    } else if (arg === '--max-risk') options.maxRisk = argv[++i] || options.maxRisk;
    else if (arg === '--cooldown-minutes') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.cooldownMinutes = value;
    } else if (arg === '--lease-minutes') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.leaseMinutes = value;
    } else if (arg === '--limit') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value > 0) options.limit = value;
    } else if (arg === '--quiet-idle') options.quietIdle = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`ATF Control Plane v1

Usage:
  node workspace/bin/atf-control-plane.cjs [options]

Options:
  --agent <name>               Only operate on one agent
  --no-trigger                 Skip trigger watcher
  --no-action                  Skip action watcher
  --no-launcher                Skip launcher
  --trigger-executor <name>    Execution actor for trigger fires
  --trigger-mode <mode>        Trigger execution mode (${TRIGGER_EXECUTION_MODES.join('|')})
  --trigger-to <agent>         Override trigger message target agent
  --trigger-thread <id>        Override trigger delivery thread id
  --trigger-room <name>        Override trigger room target
  --trigger-at <ISO>           Trigger scan timestamp
  --action-executor <name>     Execution actor for action watcher
  --action-mode <mode>         Action execution mode (${ACTION_EXECUTION_MODES.join('|')})
  --action-to <agent>          Override action message target agent
  --action-thread <id>         Override action delivery thread id
  --launcher-dispatcher <name> Dispatcher name for launcher
  --launcher-mode <mode>       Launcher dispatch mode (${LAUNCH_DISPATCH_MODES.join('|')})
  --stale-days <n>             Action watcher stale review threshold
  --message-hours <n>          Action watcher reply threshold
  --decision-hours <n>         Action watcher decision threshold
  --writeback-minutes <n>      Action watcher overdue writeback threshold
  --min-confidence <n>         Action watcher min confidence
  --max-risk <level>           Action watcher max risk
  --cooldown-minutes <n>       Launcher scan cooldown
  --lease-minutes <n>          Launcher dispatch lease window
  --limit <n>                  Shared limit for action/launcher execution
  --quiet-idle                 Print nothing when the whole control plane is idle
  --dry-run                    Run wrappers in dry-run mode
  --json                       Print JSON summary
  --help, -h                   Show help
`);
}

function runNodeScript(scriptRelativePath, args) {
  const scriptPath = path.join(repoRoot, scriptRelativePath);
  const source = fs.readFileSync(scriptPath, 'utf8');
  const stdout = [];
  const stderr = [];
  const exitSignal = { code: 0 };
  const scriptRequire = createRequire(scriptPath);
  const scriptProcess = {
    ...process,
    argv: [process.execPath, scriptPath, ...args],
    env: process.env,
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
      throw new Error([
        `${scriptRelativePath} failed`,
        stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
        stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
        error?.message ? `error:\n${error.message}` : null,
      ].filter(Boolean).join('\n'));
    }
  }

  if (stderr.length) {
    throw new Error([
      `${scriptRelativePath} reported stderr`,
      stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
      `stderr:\n${stderr.join('\n').trim()}`,
    ].filter(Boolean).join('\n'));
  }

  const output = stdout.join('\n').trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${scriptRelativePath} returned non-JSON output:\n${output}`);
  }
}

function buildTriggerArgs(options) {
  const args = ['--json'];
  if (options.agent) args.push('--agent', options.agent);
  if (options.triggerExecutor) args.push('--executor', options.triggerExecutor);
  if (options.triggerMode) args.push('--mode', options.triggerMode);
  if (options.triggerToAgent) args.push('--to', options.triggerToAgent);
  if (options.triggerThreadId) args.push('--thread', options.triggerThreadId);
  if (options.triggerRoomId) args.push('--room', options.triggerRoomId);
  if (options.triggerAt) args.push('--at', options.triggerAt);
  if (options.dryRun) args.push('--dry-run');
  return args;
}

function buildActionArgs(options) {
  const args = ['--json'];
  if (options.agent) args.push('--agent', options.agent);
  if (options.actionExecutor) args.push('--executor', options.actionExecutor);
  if (options.actionMode) args.push('--mode', options.actionMode);
  if (options.actionToAgent) args.push('--to', options.actionToAgent);
  if (options.actionThreadId) args.push('--thread', options.actionThreadId);
  args.push('--stale-days', String(options.staleDays));
  args.push('--message-hours', String(options.messageHours));
  args.push('--decision-hours', String(options.decisionHours));
  args.push('--writeback-minutes', String(options.writebackMinutes));
  args.push('--min-confidence', String(options.minConfidence));
  args.push('--max-risk', String(options.maxRisk));
  if (options.limit) args.push('--limit', String(options.limit));
  if (options.dryRun) args.push('--dry-run');
  return args;
}

function buildLauncherArgs(options) {
  const args = ['--json'];
  if (options.agent) args.push('--agent', options.agent);
  if (options.launcherDispatcher) args.push('--dispatcher', options.launcherDispatcher);
  if (options.launcherMode) args.push('--mode', options.launcherMode);
  args.push('--cooldown-minutes', String(options.cooldownMinutes));
  args.push('--lease-minutes', String(options.leaseMinutes));
  if (options.limit) args.push('--limit', String(options.limit));
  if (options.dryRun) args.push('--dry-run');
  return args;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function hasTriggerActivity(summary) {
  if (!summary) return false;
  return safeNumber(summary.executed) > 0 || safeNumber(summary.pendingAfterExecute) > 0;
}

function hasActionActivity(summary) {
  if (!summary) return false;
  return safeNumber(summary.created) > 0
    || safeNumber(summary.executed) > 0
    || safeNumber(summary.pendingAfterExecute) > 0
    || safeNumber(summary.failed) > 0;
}

function hasLauncherActivity(summary) {
  if (!summary) return false;
  return safeNumber(summary.created) > 0
    || safeNumber(summary.leased) > 0
    || safeNumber(summary.pendingAfterDispatch) > 0;
}

function printTextSummary(summary) {
  console.log('ATF Control Plane Summary');
  console.log(`  run id: ${summary.run_id}`);
  console.log(`  status: ${summary.status}`);
  console.log(`  agent: ${summary.agent || 'all'}`);
  console.log(`  dry-run: ${summary.dry_run}`);
  console.log(`  idle: ${summary.idle}`);
  console.log(`  started: ${summary.started_at}`);
  console.log(`  completed: ${summary.completed_at}`);
  console.log(`  duration_ms: ${summary.duration_ms}`);
  console.log(`  activity: trigger=${summary.activity.trigger} action=${summary.activity.action} launcher=${summary.activity.launcher}`);
  if (summary.trigger) console.log(`  trigger: executed=${summary.trigger.executed} pending_after=${summary.trigger.pendingAfterExecute}`);
  if (summary.action) console.log(`  action: created=${summary.action.created} executed=${summary.action.executed} pending_after=${summary.action.pendingAfterExecute} failed=${summary.action.failed}`);
  if (summary.launcher) console.log(`  launcher: created=${summary.launcher.created} leased=${summary.launcher.leased} pending_after=${summary.launcher.pendingAfterDispatch} status=${summary.launcher.status}`);
  if (summary.audit_path) console.log(`  audit path: ${summary.audit_path}`);
  if (summary.audit_write_error) console.log(`  audit write error: ${summary.audit_write_error}`);
  if (summary.errors.length) {
    console.log('  errors:');
    for (const error of summary.errors) console.log(`    - ${error.component}: ${error.message}`);
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const summary = {
    schema: 'atf.control-plane-run.v1',
    run_id: generateRunId(),
    status: 'completed',
    agent: options.agent,
    dry_run: options.dryRun,
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    trigger: null,
    action: null,
    launcher: null,
    activity: {
      trigger: false,
      action: false,
      launcher: false,
    },
    idle: true,
    errors: [],
    audit_path: null,
    audit_write_error: null,
  };

  const steps = [
    options.trigger ? {
      component: 'trigger',
      script: 'workspace/bin/atf-watcher.cjs',
      args: buildTriggerArgs(options),
    } : null,
    options.action ? {
      component: 'action',
      script: 'workspace/bin/atf-action-watcher.cjs',
      args: buildActionArgs(options),
    } : null,
    options.launcher ? {
      component: 'launcher',
      script: 'workspace/bin/atf-launcher.cjs',
      args: buildLauncherArgs(options),
    } : null,
  ].filter(Boolean);

  for (const step of steps) {
    try {
      const result = runNodeScript(step.script, step.args);
      summary[step.component] = result;
    } catch (error) {
      summary.status = 'failed';
      summary.errors.push({
        component: step.component,
        message: error.message,
      });
    }
  }

  summary.activity.trigger = hasTriggerActivity(summary.trigger);
  summary.activity.action = hasActionActivity(summary.action);
  summary.activity.launcher = hasLauncherActivity(summary.launcher);
  summary.idle = !summary.activity.trigger && !summary.activity.action && !summary.activity.launcher && summary.errors.length === 0;
  summary.completed_at = new Date().toISOString();
  summary.duration_ms = Date.now() - startedMs;

  try {
    summary.audit_path = persistSummary(summary);
  } catch (error) {
    summary.audit_write_error = error.message;
  }

  if (!(options.quietIdle && summary.idle)) {
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else printTextSummary(summary);
  }

  return summary.status === 'failed' ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(util.format(error));
  process.exitCode = 1;
}
