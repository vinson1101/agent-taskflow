#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const atfCliPath = path.join(repoRoot, 'atf-cli.js');
const WATCHER_EXECUTION_MODES = ['pending_task', 'message', 'room', 'noop'];
const WATCHER_EXECUTION_MODE_SET = new Set(WATCHER_EXECUTION_MODES);

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function parseModeOption(flag, rawValue) {
  const normalized = normalizeMode(rawValue);
  if (!normalized) throw new Error(`${flag} requires a value`);
  if (!WATCHER_EXECUTION_MODE_SET.has(normalized)) {
    throw new Error(`invalid ${flag}: ${rawValue}. expected one of ${WATCHER_EXECUTION_MODES.join('|')}`);
  }
  return normalized;
}

function defaultWorkspaceDir() {
  const openClawRoot = process.env.ATF_ROOT || '/root/.openclaw';
  return process.env.ATF_WORKSPACE_DIR || path.join(openClawRoot, 'workspace');
}

function defaultDataDir() {
  return process.env.ATF_DATA_DIR || path.join(defaultWorkspaceDir(), 'agent-taskflow', 'data');
}

function pendingFiresPath() {
  return path.join(defaultDataDir(), 'pending-trigger-fires.json');
}

function triggerInboxPath(agent) {
  return path.join(defaultDataDir(), 'trigger-inboxes', `${agent}.json`);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    agent: null,
    executor: 'atf-watcher',
    mode: null,
    toAgent: null,
    threadId: null,
    roomId: null,
    limit: null,
    at: null,
    note: null,
    scan: true,
    execute: true,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = argv[++i] || null;
    else if (arg === '--executor') options.executor = argv[++i] || options.executor;
    else if (arg === '--mode') options.mode = parseModeOption('--mode', argv[++i]);
    else if (arg === '--to') options.toAgent = argv[++i] || null;
    else if (arg === '--thread') options.threadId = argv[++i] || null;
    else if (arg === '--room') options.roomId = argv[++i] || null;
    else if (arg === '--limit') {
      const value = Number(argv[++i]);
      options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    } else if (arg === '--at') options.at = argv[++i] || null;
    else if (arg === '--note') options.note = argv[++i] || null;
    else if (arg === '--no-scan') options.scan = false;
    else if (arg === '--no-execute') options.execute = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`ATF Watcher v1

Usage:
  node workspace/bin/atf-watcher.cjs [options]

Options:
  --agent <name>       Only execute fires for one agent
  --executor <name>    Execution actor name written into records
  --mode <mode>        Force execution mode (${WATCHER_EXECUTION_MODES.join('|')})
  --to <agent>         Override target agent for message mode
  --thread <id>        Override thread id passed to trigger execution
  --room <name>        Override room id passed to room mode execution
  --limit <n>          Max number of fires to execute
  --at <ISO>           Scan using a specific timestamp
  --note <text>        Extra execution note
  --no-scan            Skip trigger scan-all
  --no-execute         Skip execute-pending
  --dry-run            Print summary only, never execute
  --json               Print JSON summary
  --help, -h           Show help
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
    const inbox = readJson(triggerInboxPath(agent));
    return inbox?.total || 0;
  }
  const pending = readJson(pendingFiresPath());
  return pending?.total || 0;
}

function buildScanArgs(options) {
  const args = ['trigger', 'scan-all'];
  if (options.agent) args.push(options.agent);
  if (options.at) args.push(`at=${options.at}`);
  return args;
}

function buildExecuteArgs(options) {
  const args = ['trigger', 'execute-pending'];
  if (options.agent) args.push(options.agent);
  if (options.executor) args.push(`executor=${options.executor}`);
  if (options.mode) args.push(`mode=${options.mode}`);
  if (options.toAgent) args.push(`to=${options.toAgent}`);
  if (options.threadId) args.push(`thread=${options.threadId}`);
  if (options.roomId) args.push(`room=${options.roomId}`);
  if (options.limit) args.push(`limit=${options.limit}`);
  if (options.note) args.push(`note=${options.note}`);
  return args;
}

function printTextSummary(summary) {
  console.log(`ATF Watcher Summary`);
  console.log(`  agent: ${summary.agent || 'all'}`);
  console.log(`  scan: ${summary.scan}`);
  console.log(`  execute: ${summary.execute}`);
  console.log(`  dry-run: ${summary.dryRun}`);
  console.log(`  pending before scan: ${summary.pendingBeforeScan}`);
  console.log(`  pending after scan: ${summary.pendingAfterScan}`);
  console.log(`  pending after execute: ${summary.pendingAfterExecute}`);
  console.log(`  executed: ${summary.executed}`);
  if (summary.scanCommand) console.log(`  scan command: ${summary.scanCommand}`);
  if (summary.executeCommand) console.log(`  execute command: ${summary.executeCommand}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const summary = {
    agent: options.agent,
    scan: options.scan,
    execute: options.execute && !options.dryRun,
    dryRun: options.dryRun,
    pendingBeforeScan: countPending(options.agent),
    pendingAfterScan: null,
    pendingAfterExecute: null,
    executed: 0,
    scanCommand: null,
    executeCommand: null,
  };

  if (options.scan) {
    const scanArgs = buildScanArgs(options);
    summary.scanCommand = `node atf-cli.js ${scanArgs.join(' ')}`;
    runAtfCli(scanArgs);
  }

  summary.pendingAfterScan = countPending(options.agent);

  if (options.execute && !options.dryRun) {
    const executeArgs = buildExecuteArgs(options);
    summary.executeCommand = `node atf-cli.js ${executeArgs.join(' ')}`;
    runAtfCli(executeArgs);
  }

  summary.pendingAfterExecute = countPending(options.agent);
  summary.executed = Math.max(0, summary.pendingAfterScan - summary.pendingAfterExecute);

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else printTextSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
