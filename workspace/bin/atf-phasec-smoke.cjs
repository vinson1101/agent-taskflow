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

  const statsSummary = runCli(['stats', 'summary'], env, options);
  const statsTasks = runCli(['stats', 'tasks'], env, options);
  const statsTasksFiltered = runCli(['stats', 'tasks', 'type=research', 'review=pending', 'limit=1'], env, options);
  const statsTasksAgeFiltered = runCli(['stats', 'tasks', 'review=pending', 'max_age=0', 'limit=1'], env, options);
  const statsTasksTooOld = runCli(['stats', 'tasks', 'review=pending', 'min_age=1'], env, options);
  const statsReviews = runCli(['stats', 'reviews'], env, options);
  const statsTypes = runCli(['stats', 'types'], env, options);
  const statsAgents = runCli(['stats', 'agents'], env, options);
  const statsShowF0x = runCli(['stats', 'show', 'f0x'], env, options);
  const creditsList = runCli(['credits', 'list'], env, options);
  const creditsShowPinchy = runCli(['credits', 'show', 'pinchymeow'], env, options);
  const creditsShowF0x = runCli(['credits', 'show', 'f0x'], env, options);
  const reviewPending = runCli(['review', 'pending'], env, options);
  const reviewPendingFiltered = runCli(['review', 'pending', 'type=research', 'status=completed', 'limit=1'], env, options);
  const reviewPendingAgeFiltered = runCli(['review', 'pending', 'max_age=0', 'limit=1'], env, options);
  const reviewPendingTooOld = runCli(['review', 'pending', 'min_age=1'], env, options);

  assertIncludes(statsSummary, 'tasks: total=3', 'stats summary');
  assertIncludes(statsSummary, 'reviewed=2', 'stats summary');
  assertIncludes(statsSummary, 'self_reviewed=1', 'stats summary');
  assertIncludes(statsSummary, 'pending_reviews=1', 'stats summary');
  assertIncludes(statsSummary, 'oldest_pending_age=0d', 'stats summary');
  assertIncludes(statsTasks, pendingTaskId, 'stats tasks');
  assertIncludes(statsTasks, 'approved', 'stats tasks');
  assertIncludes(statsTasks, 'self', 'stats tasks');
  assertIncludes(statsTasks, 'age', 'stats tasks');
  assertIncludes(statsTasksFiltered, pendingTaskId, 'filtered stats tasks');
  assertIncludes(statsTasksFiltered, 'pending', 'filtered stats tasks');
  assertIncludes(statsTasksAgeFiltered, pendingTaskId, 'age filtered stats tasks');
  assertIncludes(statsTasksAgeFiltered, 'max_age=0', 'age filtered stats tasks');
  assertIncludes(statsTasksTooOld, '暂无任务统计结果', 'too old stats tasks');
  assertIncludes(statsReviews, 'eligible=3  reviewed=2  self_reviewed=1  pending=1', 'stats reviews');
  assertIncludes(statsReviews, '0-1d: 1', 'stats reviews');
  assertIncludes(statsReviews, 'f0x', 'stats reviews');
  assertIncludes(statsTypes, 'research', 'stats types');
  assertIncludes(statsTypes, 'delivery', 'stats types');
  assertIncludes(statsAgents, 'f0x', 'stats agents');
  assertIncludes(statsAgents, 'pinchymeow', 'stats agents');
  assertIncludes(statsShowF0x, 'credits: total=', 'stats show f0x');
  assertIncludes(statsShowF0x, 'completion=', 'stats show f0x');
  assertIncludes(creditsList, 'completion', 'credits list');
  assertIncludes(creditsShowPinchy, 'completion: completed=0  delivered=1', 'credits show pinchymeow');
  assertIncludes(creditsShowF0x, 'total_credits: 23', 'credits show f0x');
  assertIncludes(selfReview, 'self_review=true', 'self review add');
  assertIncludes(reviewPending, pendingTaskId, 'review pending');
  assertIncludes(reviewPending, 'type=research', 'review pending');
  assertIncludes(reviewPending, 'age=0d', 'review pending');
  assertIncludes(reviewPending, 'self_reviews=1', 'review pending');
  assertIncludes(reviewPendingFiltered, pendingTaskId, 'filtered review pending');
  assertIncludes(reviewPendingFiltered, 'status=completed', 'filtered review pending');
  assertIncludes(reviewPendingFiltered, 'self_reviews=1', 'filtered review pending');
  assertIncludes(reviewPendingAgeFiltered, pendingTaskId, 'age filtered review pending');
  assertIncludes(reviewPendingAgeFiltered, 'max_age=0', 'age filtered review pending');
  assertIncludes(reviewPendingTooOld, '暂无待评价任务', 'too old review pending');

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
