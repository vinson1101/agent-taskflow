#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const vm = require('vm');
const { randomBytes } = require('crypto');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const atfCliPath = path.join(repoRoot, 'atf-cli.js');
const LAUNCHER_DISPATCH_MODES = ['manual', 'noop', 'sessions_spawn'];
const LAUNCHER_DISPATCH_MODE_SET = new Set(LAUNCHER_DISPATCH_MODES);

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function parseModeOption(flag, rawValue) {
  const normalized = normalizeMode(rawValue);
  if (!normalized) throw new Error(`${flag} requires a value`);
  if (!LAUNCHER_DISPATCH_MODE_SET.has(normalized)) {
    throw new Error(`invalid ${flag}: ${rawValue}. expected one of ${LAUNCHER_DISPATCH_MODES.join('|')}`);
  }
  return normalized;
}

function defaultOpenClawRoot() {
  const defaultRoot = process.platform === 'win32'
    ? path.join(os.homedir(), '.openclaw')
    : '/root/.openclaw';
  return process.env.ATF_ROOT || defaultRoot;
}

function defaultWorkspaceDir() {
  return process.env.ATF_WORKSPACE_DIR || path.join(defaultOpenClawRoot(), 'workspace');
}

function defaultDataDir() {
  return process.env.ATF_DATA_DIR || path.join(defaultWorkspaceDir(), 'agent-taskflow', 'data');
}

function pendingLaunchRequestsPath() {
  return path.join(defaultDataDir(), 'pending-launch-requests.json');
}

function launchInboxPath(agent) {
  return path.join(defaultDataDir(), 'launch-inboxes', `${agent}.json`);
}

function launcherRunsDir() {
  return path.join(defaultDataDir(), 'launcher-runs');
}

function launcherRunPath(runId) {
  return path.join(launcherRunsDir(), `${runId}.json`);
}

function launcherLatestPath() {
  return path.join(launcherRunsDir(), 'latest.json');
}

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `LWR-${stamp}-${randomBytes(3).toString('hex')}`;
}

function persistSummary(summary) {
  const auditPath = launcherRunPath(summary.run_id);
  const payload = {
    schema: 'atf.launcher-run.v1',
    ...summary,
    audit_path: summary.audit_path || auditPath,
  };
  writeJson(auditPath, payload);
  writeJson(launcherLatestPath(), payload);
  return auditPath;
}

function parseArgs(argv) {
  const options = {
    agent: null,
    dispatcher: 'atf-launcher',
    mode: null,
    limit: null,
    note: null,
    cooldownMinutes: 15,
    leaseMinutes: null,
    scan: true,
    dispatch: true,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = argv[++i] || null;
    else if (arg === '--dispatcher') options.dispatcher = argv[++i] || options.dispatcher;
    else if (arg === '--mode') options.mode = parseModeOption('--mode', argv[++i]);
    else if (arg === '--limit') {
      const value = Number(argv[++i]);
      options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    } else if (arg === '--note') options.note = argv[++i] || null;
    else if (arg === '--cooldown-minutes') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.cooldownMinutes = value;
    } else if (arg === '--lease-minutes') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.leaseMinutes = value;
    } else if (arg === '--no-scan') options.scan = false;
    else if (arg === '--no-dispatch') options.dispatch = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`ATF Launcher v1

Usage:
  node workspace/bin/atf-launcher.cjs [options]

Options:
  --agent <name>             Only scan / dispatch launch requests for one agent
  --dispatcher <name>        Dispatcher name written into launch records
  --mode <mode>              Dispatch mode (${LAUNCHER_DISPATCH_MODES.join('|')})
  --limit <n>                Max number of launch requests to dispatch
  --note <text>              Extra dispatch note
  --cooldown-minutes <n>     Cooldown used while scanning launch requests
  --lease-minutes <n>        Lease window written during dispatch
  --no-scan                  Skip launch scan
  --no-dispatch              Skip launch dispatch
  --dry-run                  Print summary only, never dispatch
  --json                     Print JSON summary
  --help, -h                 Show help
`);
}

function runAtfCli(args) {
  const source = fs.readFileSync(atfCliPath, 'utf8');
  const stdout = [];
  const stderr = [];
  const exitSignal = { code: 0 };
  const cliRequire = createRequire(atfCliPath);
  const cliProcess = {
    ...process,
    argv: [process.execPath, atfCliPath, ...args],
    env: process.env,
    cwd: () => repoRoot,
    exit(code = 0) {
      exitSignal.code = code;
      throw exitSignal;
    },
  };

  const context = {
    require: cliRequire,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(atfCliPath),
    __filename: atfCliPath,
    process: cliProcess,
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
    vm.runInNewContext(source, context, { filename: atfCliPath });
  } catch (error) {
    if (error !== exitSignal) {
      const message = [
        `ATF CLI failed: node ${[atfCliPath, ...args].join(' ')}`,
        stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
        stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
        error && error.message ? `error:\n${error.message}` : null,
      ].filter(Boolean).join('\n');
      throw new Error(message);
    }
  }

  if (stderr.length) {
    const message = [
      `ATF CLI reported stderr: node ${[atfCliPath, ...args].join(' ')}`,
      stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
      `stderr:\n${stderr.join('\n').trim()}`,
    ].filter(Boolean).join('\n');
    throw new Error(message);
  }

  return {
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}

function countPending(agent = null) {
  if (agent) {
    const inbox = readJson(launchInboxPath(agent));
    return inbox?.total || 0;
  }
  const pending = readJson(pendingLaunchRequestsPath());
  return pending?.total || 0;
}

function buildScanArgs(options) {
  const args = ['launch', 'scan'];
  if (options.agent) args.push(options.agent);
  args.push(`cooldown_minutes=${options.cooldownMinutes}`);
  if (options.limit) args.push(`limit=${options.limit}`);
  return args;
}

function buildDispatchArgs(options) {
  const args = ['launch', 'dispatch-pending'];
  if (options.agent) args.push(options.agent);
  if (options.limit) args.push(`limit=${options.limit}`);
  if (options.dispatcher) args.push(`dispatcher=${options.dispatcher}`);
  if (options.mode) args.push(`mode=${options.mode}`);
  if (options.leaseMinutes !== null) args.push(`lease_minutes=${options.leaseMinutes}`);
  if (options.note) args.push(`note=${options.note}`);
  return args;
}

function printTextSummary(summary) {
  console.log('ATF Launcher Summary');
  console.log(`  run id: ${summary.run_id}`);
  console.log(`  status: ${summary.status}`);
  console.log(`  agent: ${summary.agent || 'all'}`);
  console.log(`  scan: ${summary.scan}`);
  console.log(`  dispatch: ${summary.dispatch}`);
  console.log(`  dry-run: ${summary.dryRun}`);
  console.log(`  started: ${summary.started_at}`);
  console.log(`  completed: ${summary.completed_at}`);
  console.log(`  duration_ms: ${summary.duration_ms}`);
  console.log(`  cooldown_minutes: ${summary.cooldownMinutes}`);
  console.log(`  lease_minutes: ${summary.leaseMinutes === null ? '-' : summary.leaseMinutes}`);
  console.log(`  pending before scan: ${summary.pendingBeforeScan}`);
  console.log(`  pending after scan: ${summary.pendingAfterScan}`);
  console.log(`  pending after dispatch: ${summary.pendingAfterDispatch}`);
  console.log(`  created: ${summary.created}`);
  console.log(`  leased: ${summary.leased}`);
  console.log(`  failed: ${summary.failed}`);
  console.log(`  archived: ${summary.archived}`);
  if (summary.scanCommand) console.log(`  scan command: ${summary.scanCommand}`);
  if (summary.dispatchCommand) console.log(`  dispatch command: ${summary.dispatchCommand}`);
  if (summary.audit_path) console.log(`  audit path: ${summary.audit_path}`);
  if (summary.audit_write_error) console.log(`  audit write error: ${summary.audit_write_error}`);
  if (summary.error?.message) console.log(`  error: ${summary.error.message}`);
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
    schema: 'atf.launcher-run.v1',
    run_id: generateRunId(),
    status: 'completed',
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    agent: options.agent,
    scan: options.scan,
    dispatch: options.dispatch && !options.dryRun,
    dryRun: options.dryRun,
    cooldownMinutes: options.cooldownMinutes,
    leaseMinutes: options.leaseMinutes,
    pendingBeforeScan: countPending(options.agent),
    pendingAfterScan: null,
    pendingAfterDispatch: null,
    created: 0,
    leased: 0,
    failed: 0,
    archived: 0,
    scanCommand: null,
    dispatchCommand: null,
    error: null,
    audit_path: null,
    audit_write_error: null,
  };

  try {
    if (options.scan) {
      const scanArgs = buildScanArgs(options);
      summary.scanCommand = `node atf-cli.js ${scanArgs.join(' ')}`;
      const output = runAtfCli(scanArgs).stdout;
      const createdMatch = output.match(/created=(\d+)/);
      const archivedMatch = output.match(/archived=(\d+)/);
      summary.created = createdMatch ? Number(createdMatch[1]) : 0;
      summary.archived += archivedMatch ? Number(archivedMatch[1]) : 0;
    }

    summary.pendingAfterScan = countPending(options.agent);

    if (options.dispatch && !options.dryRun) {
      const dispatchArgs = buildDispatchArgs(options);
      summary.dispatchCommand = `node atf-cli.js ${dispatchArgs.join(' ')}`;
      const output = runAtfCli(dispatchArgs).stdout;
      const leasedMatch = output.match(/leased:(\d+)/);
      const failedMatch = output.match(/failed:(\d+)/);
      const archivedMatch = output.match(/archived:(\d+)/);
      summary.leased = leasedMatch ? Number(leasedMatch[1]) : 0;
      summary.failed = failedMatch ? Number(failedMatch[1]) : 0;
      summary.archived += archivedMatch ? Number(archivedMatch[1]) : 0;
      if (summary.failed > 0) {
        summary.status = 'failed';
        summary.error = { message: `${summary.failed} launch dispatch request(s) failed` };
      }
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = { message: error.message };
  }

  if (summary.pendingAfterScan === null) summary.pendingAfterScan = countPending(options.agent);
  summary.pendingAfterDispatch = countPending(options.agent);
  summary.completed_at = new Date().toISOString();
  summary.duration_ms = Date.now() - startedMs;

  try {
    summary.audit_path = persistSummary(summary);
  } catch (error) {
    summary.audit_write_error = error.message;
  }

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else printTextSummary(summary);

  return summary.status === 'failed' ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
