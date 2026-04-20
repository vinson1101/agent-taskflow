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
const RISK_LEVELS = ['low', 'medium', 'high', 'urgent'];
const ACTION_WATCHER_EXECUTION_MODES = ['message', 'pending_task', 'noop'];
const ACTION_WATCHER_EXECUTION_MODE_SET = new Set(ACTION_WATCHER_EXECUTION_MODES);

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function parseModeOption(flag, rawValue) {
  const normalized = normalizeMode(rawValue);
  if (!normalized) throw new Error(`${flag} requires a value`);
  if (!ACTION_WATCHER_EXECUTION_MODE_SET.has(normalized)) {
    throw new Error(`invalid ${flag}: ${rawValue}. expected one of ${ACTION_WATCHER_EXECUTION_MODES.join('|')}`);
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

function defaultTasksDir() {
  return process.env.ATF_TASKS_DIR || path.join(defaultOpenClawRoot(), 'atf-tasks');
}

function pendingActionsPath() {
  return path.join(defaultDataDir(), 'pending-actions.json');
}

function actionInboxPath(agent) {
  return path.join(defaultDataDir(), 'action-inboxes', `${agent}.json`);
}

function agentsFilePath() {
  return path.join(defaultDataDir(), 'agents.json');
}

function actionWatcherRunsDir() {
  return path.join(defaultDataDir(), 'action-watcher-runs');
}

function actionWatcherRunPath(runId) {
  return path.join(actionWatcherRunsDir(), `${runId}.json`);
}

function actionWatcherLatestPath() {
  return path.join(actionWatcherRunsDir(), 'latest.json');
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
  return `AWR-${stamp}-${randomBytes(3).toString('hex')}`;
}

function persistSummary(summary) {
  const payload = {
    schema: 'atf.action-watcher-run.v1',
    ...summary,
  };
  writeJson(actionWatcherRunPath(summary.run_id), payload);
  writeJson(actionWatcherLatestPath(), payload);
  return actionWatcherRunPath(summary.run_id);
}

function parseArgs(argv) {
  const options = {
    agent: null,
    executor: 'action-watcher',
    mode: null,
    limit: null,
    note: null,
    staleDays: 4,
    messageHours: 12,
    decisionHours: 6,
    minConfidence: 0,
    maxRisk: 'medium',
    registeredOnly: true,
    allowConfirmationRequired: false,
    sample: 5,
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
    else if (arg === '--limit') {
      const value = Number(argv[++i]);
      options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    } else if (arg === '--note') options.note = argv[++i] || null;
    else if (arg === '--stale-days') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.staleDays = value;
    } else if (arg === '--message-hours') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.messageHours = value;
    } else if (arg === '--decision-hours') {
      const value = Number(argv[++i]);
      if (Number.isInteger(value) && value >= 0) options.decisionHours = value;
    } else if (arg === '--min-confidence') {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) options.minConfidence = value;
    } else if (arg === '--max-risk') {
      const value = String(argv[++i] || '').trim().toLowerCase();
      if (RISK_LEVELS.includes(value)) options.maxRisk = value;
    } else if (arg === '--allow-unregistered') options.registeredOnly = false;
    else if (arg === '--allow-confirmation-required') options.allowConfirmationRequired = true;
    else if (arg === '--sample') {
      const value = Number(argv[++i]);
      options.sample = Number.isInteger(value) && value > 0 ? value : options.sample;
    } else if (arg === '--no-scan') options.scan = false;
    else if (arg === '--no-execute') options.execute = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`ATF Action Watcher v1

Usage:
  node workspace/bin/atf-action-watcher.cjs [options]

Options:
  --agent <name>          Only plan and execute actions for one agent
  --executor <name>       Execution actor name written into action records
  --mode <mode>           Force execution mode (${ACTION_WATCHER_EXECUTION_MODES.join('|')})
  --limit <n>             Max number of actions to execute
  --note <text>           Extra execution note
  --stale-days <n>        Threshold for stale review follow-up
  --message-hours <n>     Threshold for pending message follow-up
  --decision-hours <n>    Threshold for decision reflection follow-up
  --min-confidence <n>    Only execute actions with confidence >= n (0-1)
  --max-risk <level>      Highest allowed risk level (low|medium|high|urgent)
  --allow-unregistered    Allow actions owned by agents missing from registry/env
  --allow-confirmation-required
                          Allow executing actions marked requires_confirmation=true
  --sample <n>            Number of sample planned/filtered actions to print
  --no-scan               Skip action scan
  --no-execute            Skip action execution
  --dry-run               Print summary only, never execute
  --json                  Print JSON summary
  --help, -h              Show help
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
    const inbox = readJson(actionInboxPath(agent));
    return inbox?.total || 0;
  }
  const pending = readJson(pendingActionsPath());
  return pending?.total || 0;
}

function buildConfiguredAgentWorkspaces() {
  const workspaces = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('ATF_WORKSPACE_') || !value) continue;
    const suffix = key.substring('ATF_WORKSPACE_'.length);
    if (!suffix || suffix === 'DIR') continue;
    const agent = suffix.toLowerCase().replace(/_/g, '-');
    if (!agent) continue;
    workspaces[agent] = value;
  }
  return workspaces;
}

function isReputationAgent(actor) {
  if (!actor || typeof actor !== 'string') return false;
  const normalized = actor.trim();
  if (!normalized || normalized.startsWith('room:')) return false;
  if (normalized === '-') return false;
  if (normalized === 'trigger-executor') return false;
  if (normalized.startsWith('watcher')) return false;
  if (normalized.startsWith('adapter-')) return false;
  return true;
}

function normalizeAgentName(agent) {
  return isReputationAgent(agent) ? String(agent).trim() : null;
}

function inferAgentWorkspace(agent) {
  const normalized = normalizeAgentName(agent);
  if (!normalized) return defaultWorkspaceDir();
  const configured = buildConfiguredAgentWorkspaces();
  return configured[normalized] || path.join(defaultOpenClawRoot(), `workspace-${normalized}`);
}

function buildDefaultAgentRegistry() {
  return {
    schema: 'atf.agents.v1',
    updated_at: new Date().toISOString(),
    agents: Object.entries(buildConfiguredAgentWorkspaces())
      .filter(([agent]) => isReputationAgent(agent))
      .map(([agent, workspace]) => ({
        agent,
        workspace: workspace || inferAgentWorkspace(agent),
        source: 'workspace',
        enabled: true,
      }))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function normalizeAgentRegistryItem(agent, value = null, fallbackSource = 'registry') {
  const normalized = normalizeAgentName(agent);
  if (!normalized) return null;
  if (typeof value === 'string') {
    return {
      agent: normalized,
      workspace: value || inferAgentWorkspace(normalized),
      source: fallbackSource,
      enabled: true,
    };
  }

  const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    agent: normalized,
    workspace: item.workspace || inferAgentWorkspace(normalized),
    source: item.source || fallbackSource,
    enabled: item.enabled !== false,
  };
}

function normalizeAgentRegistryObjectEntries(entries, fallbackSource = 'registry') {
  return entries
    .map(([agent, value]) => normalizeAgentRegistryItem(agent, value, fallbackSource))
    .filter(Boolean);
}

function extractAgentRegistryItems(registry) {
  if (Array.isArray(registry)) return registry;
  if (!registry || typeof registry !== 'object') return [];
  if (Array.isArray(registry.agents)) return registry.agents;
  if (registry.agents && typeof registry.agents === 'object') {
    return normalizeAgentRegistryObjectEntries(Object.entries(registry.agents), 'registry');
  }
  if (Array.isArray(registry.items)) return registry.items;
  if (registry.items && typeof registry.items === 'object') {
    return normalizeAgentRegistryObjectEntries(Object.entries(registry.items), 'registry');
  }

  const reservedKeys = new Set(['schema', 'updated_at', 'version', 'meta', 'items']);
  const entries = Object.entries(registry).filter(([key]) => !reservedKeys.has(key));
  const looksLikeAgentMap = entries.length > 0 && entries.every(([key, value]) => {
    if (!isReputationAgent(key)) return false;
    if (value == null) return true;
    if (typeof value === 'string') return true;
    return typeof value === 'object' && !Array.isArray(value);
  });
  return looksLikeAgentMap
    ? normalizeAgentRegistryObjectEntries(entries, 'registry')
    : [];
}

function normalizeAgentRegistry(registry) {
  const defaults = buildDefaultAgentRegistry();
  const agents = new Map(defaults.agents.map(entry => [entry.agent, entry]));
  const items = extractAgentRegistryItems(registry);

  for (const item of items) {
    const agentName = typeof item === 'string'
      ? item
      : (item?.agent || item?.name || item?.id);
    const normalized = normalizeAgentName(agentName);
    if (!normalized) continue;
    const normalizedItem = normalizeAgentRegistryItem(
      normalized,
      item,
      typeof item === 'string' ? 'registry' : (item?.source || 'registry'),
    );
    if (!normalizedItem) continue;
    agents.set(normalized, normalizedItem);
  }

  return {
    schema: 'atf.agents.v1',
    updated_at: registry?.updated_at || defaults.updated_at,
    agents: [...agents.values()]
      .filter(entry => isReputationAgent(entry.agent))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function loadAgentRegistry() {
  const existing = readJson(agentsFilePath());
  return existing ? normalizeAgentRegistry(existing) : buildDefaultAgentRegistry();
}

function getRegisteredAgentSet() {
  return new Set(
    loadAgentRegistry().agents
      .filter(entry => entry.enabled !== false)
      .map(entry => entry.agent)
  );
}

function resolveTaskDir(taskId) {
  const tasksDir = defaultTasksDir();
  const direct = path.join(tasksDir, taskId);
  if (fs.existsSync(path.join(direct, 'ctx.json'))) return direct;
  const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ctxFile = path.join(tasksDir, entry.name, 'ctx.json');
    if (!fs.existsSync(ctxFile)) continue;
    const ctx = readJson(ctxFile);
    if (!ctx) continue;
    if (ctx.task_id === taskId || ctx.short_id === taskId) return path.join(tasksDir, entry.name);
  }
  throw new Error(`task dir not found for ${taskId}`);
}

function readActionFile(taskId, actionId) {
  return readJson(path.join(resolveTaskDir(taskId), 'actions', `${actionId}.json`));
}

function loadPendingActions(agent = null) {
  const source = agent ? readJson(actionInboxPath(agent)) : readJson(pendingActionsPath());
  const items = Array.isArray(source?.items) ? source.items : [];
  return items.filter(action => action && action.status === 'pending');
}

function riskRank(level) {
  return RISK_LEVELS.indexOf(level);
}

function normalizeRiskLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  return RISK_LEVELS.includes(normalized) ? normalized : 'low';
}

function actionPreview(action) {
  return {
    task_id: action.task_id,
    action_id: action.action_id,
    owner_agent: action.owner_agent || null,
    kind: action.kind,
    attempt: Number.isInteger(action.attempt) ? action.attempt : 1,
    priority: action.priority || null,
    confidence: Number.isFinite(action.confidence) ? action.confidence : null,
    risk_level: action.policy?.risk_level || 'low',
    summary: action.summary,
  };
}

function getActionFilterReasons(action, options, registeredAgents) {
  const reasons = [];
  const confidence = Number.isFinite(action.confidence) ? action.confidence : null;
  const riskLevel = normalizeRiskLevel(action.policy?.risk_level);

  if (Number.isFinite(options.minConfidence) && options.minConfidence > 0) {
    if (confidence === null || confidence < options.minConfidence) reasons.push('below_confidence');
  }
  if (options.maxRisk && riskRank(riskLevel) > riskRank(options.maxRisk)) {
    reasons.push('risk_exceeds_max');
  }
  if (options.registeredOnly && !registeredAgents.has(action.owner_agent || '')) {
    reasons.push('unregistered_owner');
  }
  if (!options.allowConfirmationRequired && action.policy?.requires_confirmation) {
    reasons.push('requires_confirmation');
  }

  return reasons;
}

function buildScanArgs(options) {
  const args = ['action', 'scan'];
  if (options.agent) args.push(options.agent);
  args.push(`stale_days=${options.staleDays}`);
  args.push(`message_hours=${options.messageHours}`);
  args.push(`decision_hours=${options.decisionHours}`);
  return args;
}

function buildExecuteArgs(action, options) {
  const args = ['action', 'execute', action.task_id, action.action_id];
  if (options.executor) args.push(`executor=${options.executor}`);
  if (options.mode) args.push(`mode=${options.mode}`);
  if (options.note) args.push(`note=${options.note}`);
  return args;
}

function printTextSummary(summary) {
  console.log('ATF Action Watcher Summary');
  console.log(`  run id: ${summary.run_id}`);
  console.log(`  status: ${summary.status}`);
  console.log(`  agent: ${summary.agent || 'all'}`);
  console.log(`  scan: ${summary.scan}`);
  console.log(`  execute: ${summary.execute}`);
  console.log(`  dry-run: ${summary.dryRun}`);
  console.log(`  started: ${summary.started_at}`);
  console.log(`  completed: ${summary.completed_at}`);
  console.log(`  duration_ms: ${summary.duration_ms}`);
  console.log(`  thresholds: stale=${summary.staleDays}d message=${summary.messageHours}h decision=${summary.decisionHours}h`);
  console.log(`  filters: min_conf=${summary.filters.minConfidence} max_risk=${summary.filters.maxRisk} registered_only=${summary.filters.registeredOnly} allow_confirmation=${summary.filters.allowConfirmationRequired}`);
  console.log(`  pending before scan: ${summary.pendingBeforeScan}`);
  console.log(`  pending after scan: ${summary.pendingAfterScan}`);
  console.log(`  pending after execute: ${summary.pendingAfterExecute}`);
  console.log(`  eligible after filters: ${summary.eligibleActions}`);
  console.log(`  filtered out: ${summary.filteredActions}`);
  console.log(`  execution: executed=${summary.executed} skipped=${summary.skipped} failed=${summary.failed}`);
  if (Object.keys(summary.filteredBy).length) {
    console.log(`  filtered by: ${Object.entries(summary.filteredBy).map(([key, value]) => `${key}=${value}`).join('  ')}`);
  }
  if (summary.samplePlanned.length) {
    console.log('  sample planned:');
    for (const item of summary.samplePlanned) {
      console.log(`    - [${item.task_id}] ${item.action_id} ${item.kind} try=${item.attempt || 1} owner=${item.owner_agent || '-'} conf=${item.confidence ?? '-'} risk=${item.risk_level}`);
    }
  }
  if (summary.sampleFiltered.length) {
    console.log('  sample filtered:');
    for (const item of summary.sampleFiltered) {
      console.log(`    - [${item.task_id}] ${item.action_id} ${item.kind} reasons=${item.reasons.join(',')}`);
    }
  }
  if (summary.resultCodes.length) {
    console.log(`  result codes: ${summary.resultCodes.map(item => `${item.code}=${item.count}`).join('  ')}`);
  }
  if (summary.scanCommand) console.log(`  scan command: ${summary.scanCommand}`);
  if (summary.executeCommands.length) console.log(`  execute commands: ${summary.executeCommands.length}`);
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
    run_id: generateRunId(),
    status: 'completed',
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    agent: options.agent,
    scan: options.scan,
    execute: options.execute && !options.dryRun,
    dryRun: options.dryRun,
    staleDays: options.staleDays,
    messageHours: options.messageHours,
    decisionHours: options.decisionHours,
    filters: {
      minConfidence: options.minConfidence,
      maxRisk: options.maxRisk,
      registeredOnly: options.registeredOnly,
      allowConfirmationRequired: options.allowConfirmationRequired,
    },
    pendingBeforeScan: countPending(options.agent),
    pendingAfterScan: null,
    pendingAfterExecute: null,
    eligibleActions: 0,
    filteredActions: 0,
    filteredBy: {},
    executed: 0,
    skipped: 0,
    failed: 0,
    resultCodes: [],
    samplePlanned: [],
    sampleFiltered: [],
    scanCommand: null,
    executeCommands: [],
  };

  try {
    if (options.scan) {
      const scanArgs = buildScanArgs(options);
      summary.scanCommand = `node atf-cli.js ${scanArgs.join(' ')}`;
      runAtfCli(scanArgs);
    }

    summary.pendingAfterScan = countPending(options.agent);
    const pendingActions = loadPendingActions(options.agent);
    const registeredAgents = getRegisteredAgentSet();
    const allowed = [];
    const filtered = [];

    for (const action of pendingActions) {
      const reasons = getActionFilterReasons(action, options, registeredAgents);
      if (reasons.length) {
        filtered.push({ action, reasons });
        for (const reason of reasons) {
          summary.filteredBy[reason] = (summary.filteredBy[reason] || 0) + 1;
        }
      } else {
        allowed.push(action);
      }
    }

    const limitedAllowed = options.limit ? allowed.slice(0, options.limit) : allowed;
    if (options.limit && allowed.length > limitedAllowed.length) {
      summary.filteredBy.limit = Math.max(0, allowed.length - limitedAllowed.length);
    }

    summary.eligibleActions = limitedAllowed.length;
    summary.filteredActions = filtered.length + Math.max(0, allowed.length - limitedAllowed.length);
    summary.samplePlanned = limitedAllowed.slice(0, options.sample).map(actionPreview);
    summary.sampleFiltered = filtered.slice(0, options.sample).map(item => ({
      ...actionPreview(item.action),
      reasons: item.reasons,
    }));

    if (options.execute && !options.dryRun) {
      const resultCodeCounts = new Map();
      for (const action of limitedAllowed) {
        const executeArgs = buildExecuteArgs(action, options);
        summary.executeCommands.push(`node atf-cli.js ${executeArgs.join(' ')}`);
        try {
          runAtfCli(executeArgs);
          const latest = readActionFile(action.task_id, action.action_id);
          if (latest?.status === 'executed') summary.executed += 1;
          else summary.skipped += 1;
          const code = latest?.verification?.preflight?.ok === false
            ? latest.verification.preflight.code
            : (latest?.verification?.postflight?.code || latest?.verification?.preflight?.code || latest?.status || 'unknown');
          resultCodeCounts.set(code, (resultCodeCounts.get(code) || 0) + 1);
        } catch {
          summary.failed += 1;
          resultCodeCounts.set('execution_error', (resultCodeCounts.get('execution_error') || 0) + 1);
        }
      }

      summary.resultCodes = [...resultCodeCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = { message: error.message };
  }

  summary.pendingAfterExecute = countPending(options.agent);
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
