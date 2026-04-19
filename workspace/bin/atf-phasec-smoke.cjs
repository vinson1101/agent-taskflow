#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'atf-cli.js');
const smokeRoot = path.join(repoRoot, '.tmp-atf-phasec-smoke');

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

function runCli(args, env, options = {}) {
  const source = fs.readFileSync(cliPath, 'utf8');
  const stdout = [];
  const stderr = [];
  const exitSignal = { code: 0 };
  const cliRequire = createRequire(cliPath);
  const cliProcess = {
    ...process,
    argv: [process.execPath, cliPath, ...args],
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
    require: cliRequire,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(cliPath),
    __filename: cliPath,
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
    vm.runInNewContext(source, context, { filename: cliPath });
  } catch (error) {
    if (error !== exitSignal) {
      const message = [
        `node atf-cli.js ${args.join(' ')}`,
        stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
        stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
        error && error.message ? `error:\n${error.message}` : null,
      ].filter(Boolean).join('\n');
      throw new Error(message);
    }
  }

  if (exitSignal.code !== 0 || stderr.length) {
    const message = [
      `node atf-cli.js ${args.join(' ')}`,
      stdout.length ? `stdout:\n${stdout.join('\n').trim()}` : null,
      stderr.length ? `stderr:\n${stderr.join('\n').trim()}` : null,
      exitSignal.code ? `exit=${exitSignal.code}` : null,
    ].filter(Boolean).join('\n');
    throw new Error(message);
  }

  const output = stdout.join('\n').trim();
  if (!options.quiet && output) {
    console.log(`$ node atf-cli.js ${args.join(' ')}`);
    console.log(output);
    console.log('');
  }
  return output;
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

function assertNotIncludes(output, fragment, label) {
  if (output.includes(fragment)) {
    throw new Error(`${label} unexpectedly contained fragment: ${fragment}\n--- output ---\n${output}`);
  }
}

function resolveTaskDir(taskId, env) {
  const entries = fs.readdirSync(env.ATF_TASKS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ctxFile = path.join(env.ATF_TASKS_DIR, entry.name, 'ctx.json');
    if (!fs.existsSync(ctxFile)) continue;
    const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
    if (ctx.task_id === taskId || ctx.short_id === taskId) {
      return path.join(env.ATF_TASKS_DIR, entry.name);
    }
  }
  throw new Error(`task dir not found for ${taskId}`);
}

function setTaskUpdatedAt(taskId, env, updatedAt, createdAt = updatedAt) {
  const taskDir = resolveTaskDir(taskId, env);
  const ctxFile = path.join(taskDir, 'ctx.json');
  const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
  ctx.updated_at = updatedAt;
  ctx.created_at = createdAt;
  fs.writeFileSync(ctxFile, `${JSON.stringify(ctx, null, 2)}\n`);
}

function setTaskActors(taskId, env, updates) {
  const taskDir = resolveTaskDir(taskId, env);
  for (const fileName of ['ctx.json', 'latest.json']) {
    const filePath = path.join(taskDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    Object.assign(data, updates);
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  safeResetDir(smokeRoot);

  const env = {
    ATF_TASKS_DIR: path.join(smokeRoot, 'tasks'),
    ATF_WORKSPACE_DIR: path.join(smokeRoot, 'workspace'),
    ATF_DATA_DIR: path.join(smokeRoot, 'data'),
  };

  fs.mkdirSync(env.ATF_TASKS_DIR, { recursive: true });
  fs.mkdirSync(env.ATF_WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(env.ATF_DATA_DIR, { recursive: true });

  const createCompleted = runCli(['create', 'Phase C completed demo', 'type=ops', 'difficulty=3', 'priority=normal'], env, options);
  const completedTaskId = extractTaskId(createCompleted);
  runCli(['assign', completedTaskId, 'f0x'], env, options);
  runCli(['update', completedTaskId, 'completed'], env, options);
  runCli(['review', 'add', completedTaskId, 'pinchymeow', 'f0x', 'approved', 'completed and acceptable', 'type=task', 'overall=4', 'quality=4', 'timeliness=4', 'communication=4', 'ownership=4'], env, options);

  const createDelivered = runCli(['create', 'Phase C delivered demo', 'type=delivery', 'difficulty=4', 'priority=high'], env, options);
  const deliveredTaskId = extractTaskId(createDelivered);
  runCli(['assign', deliveredTaskId, 'pinchymeow'], env, options);
  runCli(['delivered', deliveredTaskId], env, options);
  runCli(['review', 'add', deliveredTaskId, 'f0x', 'pinchymeow', 'approved', 'delivered well', 'type=delivery', 'overall=5', 'quality=5', 'timeliness=4', 'communication=4', 'ownership=5'], env, options);

  const createPending = runCli(['create', 'Phase C pending review demo', 'type=research', 'difficulty=2', 'priority=normal'], env, options);
  const pendingTaskId = extractTaskId(createPending);
  runCli(['assign', pendingTaskId, 'f0x'], env, options);
  runCli(['update', pendingTaskId, 'completed'], env, options);
  const selfReview = runCli(['review', 'add', pendingTaskId, 'f0x', 'f0x', 'approved', 'self check only', 'type=task', 'overall=4', 'quality=4', 'timeliness=4', 'communication=4', 'ownership=4'], env, options);

  const createStale = runCli(['create', 'Phase C stale backlog demo', 'type=shadow', 'difficulty=1', 'priority=low'], env, options);
  const staleTaskId = extractTaskId(createStale);
  runCli(['assign', staleTaskId, 'f0x'], env, options);
  runCli(['update', staleTaskId, 'completed'], env, options);
  const staleUpdatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  setTaskUpdatedAt(staleTaskId, env, staleUpdatedAt);

  const statsSummary = runCli(['stats', 'summary'], env, options);
  const statsDigest = runCli(['stats', 'digest'], env, options);
  const statsRecent = runCli(['stats', 'recent'], env, options);
  const statsRecentF0x = runCli(['stats', 'recent', 'days=1', 'agent=f0x', 'limit=5'], env, options);
  const statsStale = runCli(['stats', 'stale'], env, options);
  const statsStaleF0x = runCli(['stats', 'stale', 'agent=f0x', 'status=completed', 'top=5'], env, options);
  const statsTasks = runCli(['stats', 'tasks'], env, options);
  const statsTasksFiltered = runCli(['stats', 'tasks', 'type=research', 'review=pending', 'limit=1'], env, options);
  const statsTasksAgeFiltered = runCli(['stats', 'tasks', 'review=pending', 'max_age=0', 'limit=1'], env, options);
  const statsTasksTooOld = runCli(['stats', 'tasks', 'review=pending', 'min_age=6'], env, options);
  const statsReviews = runCli(['stats', 'reviews'], env, options);
  const statsReviewsAgeFiltered = runCli(['stats', 'reviews', 'max_age=0'], env, options);
  const statsReviewsTooOld = runCli(['stats', 'reviews', 'min_age=6'], env, options);
  const statsTypes = runCli(['stats', 'types'], env, options);
  const statsAgents = runCli(['stats', 'agents'], env, options);
  const statsShowF0x = runCli(['stats', 'show', 'f0x'], env, options);
  const creditsList = runCli(['credits', 'list'], env, options);
  const creditsShowPinchy = runCli(['credits', 'show', 'pinchymeow'], env, options);
  const creditsShowF0x = runCli(['credits', 'show', 'f0x'], env, options);
  const reviewPending = runCli(['review', 'pending'], env, options);
  const reviewPendingFiltered = runCli(['review', 'pending', 'type=research', 'status=completed', 'limit=1'], env, options);
  const reviewPendingAgeFiltered = runCli(['review', 'pending', 'max_age=0', 'limit=1'], env, options);
  const reviewPendingTooOld = runCli(['review', 'pending', 'min_age=6'], env, options);
  const reviewBacklog = runCli(['review', 'backlog'], env, options);
  const reviewBacklogStale = runCli(['review', 'backlog', 'min_age=4', 'top=5'], env, options);
  const agentList = runCli(['agent', 'list'], env, options);

  assertIncludes(statsSummary, 'tasks: total=4', 'stats summary');
  assertIncludes(statsSummary, 'reviewed=2', 'stats summary');
  assertIncludes(statsSummary, 'self_reviewed=1', 'stats summary');
  assertIncludes(statsSummary, 'pending_reviews=2', 'stats summary');
  assertIncludes(statsSummary, 'stale_pending_reviews=1', 'stats summary');
  assertIncludes(statsSummary, 'oldest_pending_age=5d', 'stats summary');
  assertIncludes(statsDigest, 'review_eligible=4  reviewed=2  self_reviewed=1  pending=2  stale=1', 'stats digest');
  assertIncludes(statsDigest, 'recent_tasks=3  completed=2  delivered=1  reviewed=2  pending=1', 'stats digest');
  assertIncludes(statsDigest, 'f0x: tasks=2', 'stats digest');
  assertIncludes(statsDigest, staleTaskId, 'stats digest');
  assertIncludes(statsRecent, 'tasks=3  completed=2  delivered=1  reviewed=2  pending=1  self_reviewed=1', 'stats recent');
  assertIncludes(statsRecent, pendingTaskId, 'stats recent');
  assertNotIncludes(statsRecent, staleTaskId, 'stats recent');
  assertIncludes(statsRecentF0x, 'agent=f0x', 'stats recent f0x');
  assertIncludes(statsRecentF0x, pendingTaskId, 'stats recent f0x');
  assertIncludes(statsStale, 'stale_pending=1  eligible=1  reviewed=0  self_reviewed=0', 'stats stale');
  assertIncludes(statsStale, staleTaskId, 'stats stale');
  assertIncludes(statsStale, 'shadow', 'stats stale');
  assertIncludes(statsStaleF0x, 'agent=f0x', 'stats stale f0x');
  assertIncludes(statsStaleF0x, staleTaskId, 'stats stale f0x');
  assertIncludes(statsTasks, pendingTaskId, 'stats tasks');
  assertIncludes(statsTasks, staleTaskId, 'stats tasks');
  assertIncludes(statsTasks, 'approved', 'stats tasks');
  assertIncludes(statsTasks, 'self', 'stats tasks');
  assertIncludes(statsTasks, 'age', 'stats tasks');
  assertIncludes(statsTasksFiltered, pendingTaskId, 'filtered stats tasks');
  assertIncludes(statsTasksFiltered, 'pending', 'filtered stats tasks');
  assertIncludes(statsTasksAgeFiltered, pendingTaskId, 'age filtered stats tasks');
  assertIncludes(statsTasksAgeFiltered, 'max_age=0', 'age filtered stats tasks');
  assertIncludes(statsTasksTooOld, '暂无任务统计结果', 'too old stats tasks');
  assertIncludes(statsReviews, 'eligible=4  reviewed=2  self_reviewed=1  pending=2', 'stats reviews');
  assertIncludes(statsReviews, '0-1d: 1', 'stats reviews');
  assertIncludes(statsReviews, '4-7d: 1', 'stats reviews');
  assertIncludes(statsReviews, 'f0x', 'stats reviews');
  assertIncludes(statsReviewsAgeFiltered, 'max_age=0', 'age filtered stats reviews');
  assertIncludes(statsReviewsAgeFiltered, 'pending=1', 'age filtered stats reviews');
  assertIncludes(statsReviewsTooOld, 'eligible=0  reviewed=0  self_reviewed=0  pending=0', 'too old stats reviews');
  assertIncludes(statsTypes, 'research', 'stats types');
  assertIncludes(statsTypes, 'delivery', 'stats types');
  assertIncludes(statsAgents, 'f0x', 'stats agents');
  assertIncludes(statsAgents, 'pinchymeow', 'stats agents');
  assertIncludes(statsShowF0x, 'credits: total=', 'stats show f0x');
  assertIncludes(statsShowF0x, 'completion=', 'stats show f0x');
  assertIncludes(creditsList, 'completion', 'credits list');
  assertIncludes(creditsShowPinchy, 'completion: completed=0  delivered=1', 'credits show pinchymeow');
  assertIncludes(creditsShowF0x, 'total_credits: 29', 'credits show f0x');
  assertIncludes(selfReview, 'self_review=true', 'self review add');
  assertIncludes(reviewPending, pendingTaskId, 'review pending');
  assertIncludes(reviewPending, staleTaskId, 'review pending');
  assertIncludes(reviewPending, 'type=research', 'review pending');
  assertIncludes(reviewPending, 'age=0d', 'review pending');
  assertIncludes(reviewPending, 'self_reviews=1', 'review pending');
  assertIncludes(reviewPendingFiltered, pendingTaskId, 'filtered review pending');
  assertIncludes(reviewPendingFiltered, 'status=completed', 'filtered review pending');
  assertIncludes(reviewPendingFiltered, 'self_reviews=1', 'filtered review pending');
  assertIncludes(reviewPendingAgeFiltered, pendingTaskId, 'age filtered review pending');
  assertIncludes(reviewPendingAgeFiltered, 'max_age=0', 'age filtered review pending');
  assertIncludes(reviewPendingTooOld, '暂无待评价任务', 'too old review pending');
  assertIncludes(reviewBacklog, 'pending=2  self_reviewed=1  oldest_age=5d', 'review backlog');
  assertIncludes(reviewBacklog, 'f0x', 'review backlog');
  assertIncludes(reviewBacklog, staleTaskId, 'review backlog');
  assertIncludes(reviewBacklogStale, 'pending=1  self_reviewed=0  oldest_age=5d', 'review backlog stale');
  assertIncludes(reviewBacklogStale, staleTaskId, 'review backlog stale');
  assertIncludes(agentList, 'f0x', 'agent list');
  assertIncludes(agentList, 'pinchymeow', 'agent list');

  setTaskActors(staleTaskId, env, {
    assigned_to: 'fake-no-such-agent',
    dri: 'fake-no-such-agent',
  });

  const statsDigestDirty = runCli(['stats', 'digest'], env, options);
  const reviewBacklogDirty = runCli(['review', 'backlog', 'min_age=4', 'top=5'], env, options);
  const agentAuditDirty = runCli(['agent', 'audit'], env, options);
  const agentRemapDryRun = runCli(['agent', 'remap', 'fake-no-such-agent', 'f0x'], env, options);
  const agentRemapApply = runCli(['agent', 'remap', 'fake-no-such-agent', 'f0x', 'apply=true'], env, options);
  const agentAuditClean = runCli(['agent', 'audit'], env, options);

  assertIncludes(statsDigestDirty, 'unknown_backlog_agents=1', 'dirty stats digest');
  assertIncludes(reviewBacklogDirty, 'fake-no-such-agent [unknown]', 'dirty review backlog');
  assertIncludes(agentAuditDirty, 'unknown_agents=1', 'agent audit dirty');
  assertIncludes(agentAuditDirty, 'fake-no-such-agent [unknown]', 'agent audit dirty');
  assertIncludes(agentAuditDirty, 'task.assigned_to', 'agent audit dirty');
  assertIncludes(agentRemapDryRun, 'apply=false', 'agent remap dry-run');
  assertIncludes(agentRemapDryRun, 'replacements=4', 'agent remap dry-run');
  assertIncludes(agentRemapApply, 'apply=true', 'agent remap apply');
  assertIncludes(agentRemapApply, 'replacements=4', 'agent remap apply');
  assertIncludes(agentAuditClean, 'unknown_agents=0', 'agent audit clean');

  console.log('ATF Phase C Lite smoke passed.');
  console.log(`Smoke data: ${smokeRoot}`);
  console.log(`Tasks dir: ${env.ATF_TASKS_DIR}`);
  console.log(`Data dir: ${env.ATF_DATA_DIR}`);

  if (options.cleanup) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
    console.log('Smoke directory removed.');
  }
}

try {
  main();
} catch (error) {
  console.error('ATF Phase C Lite smoke failed.');
  console.error(error.message || String(error));
  process.exit(1);
}
