#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'atf-cli.js');
const watcherPath = path.join(repoRoot, 'workspace', 'bin', 'atf-watcher.cjs');
const actionWatcherPath = path.join(repoRoot, 'workspace', 'bin', 'atf-action-watcher.cjs');
const launcherPath = path.join(repoRoot, 'workspace', 'bin', 'atf-launcher.cjs');
const smokeRoot = path.join(repoRoot, '.tmp-atf-watcher-smoke');

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

function runTriggerWatcher(args, env, options = {}) {
  return runScript(watcherPath, args, env, options);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    ATF_WORKSPACE_PINCHYMEOW: path.join(smokeRoot, 'workspace-pinchymeow'),
  };

  for (const dir of Object.values(env)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const watcherHelp = runScript(watcherPath, ['--help'], env, options);
  const actionWatcherHelp = runScript(actionWatcherPath, ['--help'], env, options);
  const launcherHelp = runScript(launcherPath, ['--help'], env, options);
  assertIncludes(watcherHelp, 'pending_task|message|room|noop', 'watcher help');
  assertIncludes(watcherHelp, '--room <name>', 'watcher help');
  assertIncludes(watcherHelp, '--thread <id>', 'watcher help');
  assertIncludes(watcherHelp, '--to <agent>', 'watcher help');
  assertIncludes(actionWatcherHelp, 'message|pending_task|noop', 'action watcher help');
  assertIncludes(actionWatcherHelp, '--thread <id>', 'action watcher help');
  assertIncludes(actionWatcherHelp, '--to <agent>', 'action watcher help');
  assertIncludes(launcherHelp, 'manual|noop|sessions_spawn', 'launcher help');

  const invalidWatcherMode = runExpectedFailure(watcherPath, ['--mode', 'invalid-mode'], env);
  const invalidActionWatcherMode = runExpectedFailure(actionWatcherPath, ['--mode', 'invalid-mode'], env);
  const invalidLauncherMode = runExpectedFailure(launcherPath, ['--mode', 'invalid-mode'], env);
  assertIncludes(invalidWatcherMode, 'invalid --mode: invalid-mode. expected one of pending_task|message|room|noop', 'watcher invalid mode');
  assertIncludes(invalidActionWatcherMode, 'invalid --mode: invalid-mode. expected one of message|pending_task|noop', 'action watcher invalid mode');
  assertIncludes(invalidLauncherMode, 'invalid --mode: invalid-mode. expected one of manual|noop|sessions_spawn', 'launcher invalid mode');

  const createOutput = runCli(['create', 'Watcher room smoke demo', 'type=ops', 'difficulty=1', 'priority=low'], env, options);
  const taskId = extractTaskId(createOutput);
  runCli(['assign', taskId, 'pinchymeow'], env, options);
  const taskDir = resolveTaskDir(taskId, env);
  const workspacePendingTask = path.join(env.ATF_WORKSPACE_PINCHYMEOW, 'pending-task.json');
  if (!fs.existsSync(workspacePendingTask)) throw new Error('expected assign to write workspace pending-task.json');
  if (fs.existsSync(path.join(taskDir, 'pending-task.json'))) throw new Error('assign should not write taskDir/pending-task.json');
  fs.rmSync(path.join(taskDir, 'pending-task.json'), { force: true });
  fs.rmSync(workspacePendingTask, { force: true });

  runCli(['trigger', 'follow-up', taskId, 'pinchymeow', '1s'], env, options);
  const watcherSummary = JSON.parse(runTriggerWatcher([
    '--agent', 'pinchymeow',
    '--mode', 'room',
    '--room', 'design',
    '--executor', 'watcher-smoke',
    '--at', new Date(Date.now() + (2 * 60 * 1000)).toISOString(),
    '--json',
  ], env, options));

  if (watcherSummary.executed !== 1) {
    throw new Error(`expected watcher executed=1, got ${watcherSummary.executed}`);
  }
  if (watcherSummary.pendingAfterExecute !== 0) {
    throw new Error(`expected watcher pendingAfterExecute=0, got ${watcherSummary.pendingAfterExecute}`);
  }

  const messages = readJsonCollection(path.join(taskDir, 'messages'));
  const roomMessage = messages.find(message => message.adapter_mode === 'room');
  if (!roomMessage) throw new Error('expected a room adapter message to be written');
  if (roomMessage.to_agent !== 'room:design') {
    throw new Error(`expected room message target room:design, got ${roomMessage.to_agent}`);
  }
  if (roomMessage.delivery_target?.kind !== 'room') {
    throw new Error(`expected room delivery target, got ${roomMessage.delivery_target?.kind}`);
  }

  const triggerExecutions = readJsonCollection(path.join(taskDir, 'trigger-executions'));
  const roomExecution = triggerExecutions.find(execution => execution.execution_mode === 'room');
  if (!roomExecution) throw new Error('expected a room trigger execution audit record');
  if (fs.existsSync(path.join(taskDir, 'pending-task.json'))) {
    throw new Error('room mode should not leave taskDir/pending-task.json behind');
  }

  console.log('ATF watcher wrapper smoke passed.');

  if (options.cleanup) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
    console.log('Smoke directory removed.');
  }
}

try {
  main();
} catch (error) {
  console.error('ATF watcher wrapper smoke failed.');
  console.error(error.message || String(error));
  process.exit(1);
}
