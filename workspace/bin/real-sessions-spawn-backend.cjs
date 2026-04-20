#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function trimText(value, limit = 2000) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 14))}...<truncated>`;
}

function splitCommandArgs(command) {
  const input = String(command || '').trim();
  if (!input) return [];
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === '\\' && i + 1 < input.length && input[i + 1] === quote) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error(`unterminated quote in command: ${input}`);
  if (current) parts.push(current);
  return parts;
}

function defaultEventsDir(payloadPath) {
  return path.join(path.dirname(path.dirname(payloadPath)), 'sessions-spawn-events');
}

function parseJsonMaybe(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function summarizeAcceptedResult(result, fallback = {}) {
  const objectResult = result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  return {
    accepted: typeof objectResult?.accepted === 'boolean' ? objectResult.accepted : true,
    session_key: typeof objectResult?.session_key === 'string' ? objectResult.session_key : null,
    agent: objectResult?.agent || fallback.agent || null,
    task_id: objectResult?.task_id || fallback.task_id || null,
    action_id: objectResult?.action_id || fallback.action_id || null,
  };
}

function printHelp() {
  console.log(`ATF Real Sessions Spawn Backend

Usage:
  node workspace/bin/real-sessions-spawn-backend.cjs

Required env:
  ATF_LAUNCH_PAYLOAD_PATH

Mode selection:
  ATF_REAL_SESSIONS_SPAWN_MODE=stub
  ATF_REAL_SESSIONS_SPAWN_CMD='<command>'
  ATF_REAL_SESSIONS_SPAWN_MODULE='/abs/path/to/module.cjs'

Optional env:
  ATF_REAL_SESSIONS_SPAWN_CWD
  ATF_REAL_SESSIONS_SPAWN_TIMEOUT_MS
  ATF_REAL_SESSIONS_SPAWN_EVENTS_DIR

Forwarded launch env:
  ATF_LAUNCH_AGENT / TASK_ID / ACTION_ID / WORKSPACE / GUIDANCE / SUMMARY / PROMPT / PROMPT_PATH
`);
}

function readPayloadFromEnv() {
  const payloadPath = process.env.ATF_LAUNCH_PAYLOAD_PATH;
  if (!payloadPath) throw new Error('missing ATF_LAUNCH_PAYLOAD_PATH');
  if (!fs.existsSync(payloadPath)) throw new Error(`payload file not found: ${payloadPath}`);
  const raw = fs.readFileSync(payloadPath, 'utf8').replace(/^\uFEFF/, '');
  return {
    payloadPath,
    payload: JSON.parse(raw),
  };
}

function buildExecutionContext(payload, context = {}) {
  const payloadPath = context.payload_path || process.env.ATF_LAUNCH_PAYLOAD_PATH;
  const promptPath = context.prompt_path || process.env.ATF_LAUNCH_PROMPT_PATH || null;
  const prompt = process.env.ATF_LAUNCH_PROMPT || null;
  const env = {
    ...process.env,
    ...(context.env || {}),
    ATF_LAUNCH_AGENT: (context.env && context.env.ATF_LAUNCH_AGENT) || process.env.ATF_LAUNCH_AGENT || payload.agent || '',
    ATF_LAUNCH_WORKSPACE: (context.env && context.env.ATF_LAUNCH_WORKSPACE) || process.env.ATF_LAUNCH_WORKSPACE || payload.workspace || '',
    ATF_LAUNCH_TASK_ID: (context.env && context.env.ATF_LAUNCH_TASK_ID) || process.env.ATF_LAUNCH_TASK_ID || payload.payload?.task_id || '',
    ATF_LAUNCH_ACTION_ID: (context.env && context.env.ATF_LAUNCH_ACTION_ID) || process.env.ATF_LAUNCH_ACTION_ID || payload.payload?.action_id || '',
    ATF_LAUNCH_GUIDANCE: (context.env && context.env.ATF_LAUNCH_GUIDANCE) || process.env.ATF_LAUNCH_GUIDANCE || payload.guidance || '',
    ATF_LAUNCH_SUMMARY: (context.env && context.env.ATF_LAUNCH_SUMMARY) || process.env.ATF_LAUNCH_SUMMARY || payload.summary || '',
    ATF_LAUNCH_PROMPT: prompt || '',
    ATF_LAUNCH_PROMPT_PATH: promptPath || '',
    ATF_LAUNCH_PAYLOAD_PATH: payloadPath || '',
  };
  return {
    payload_path: payloadPath,
    prompt_path: promptPath,
    env,
    received_at: new Date().toISOString(),
  };
}

function writeEvent(eventPath, event) {
  fs.mkdirSync(path.dirname(eventPath), { recursive: true });
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
}

function buildEventBase(payload, context, mode) {
  return {
    schema: 'atf.sessions-spawn-backend-event.v1',
    mode,
    launch_id: payload.launch_id || null,
    agent: context.env.ATF_LAUNCH_AGENT || null,
    task_id: context.env.ATF_LAUNCH_TASK_ID || null,
    action_id: context.env.ATF_LAUNCH_ACTION_ID || null,
    workspace: context.env.ATF_LAUNCH_WORKSPACE || null,
    payload_path: context.payload_path || null,
    prompt_path: context.prompt_path || null,
    guidance: context.env.ATF_LAUNCH_GUIDANCE || null,
    summary: context.env.ATF_LAUNCH_SUMMARY || null,
    received_at: context.received_at,
  };
}

function executeStub(payload, context) {
  const sessionKey = `stub:${payload.launch_id || Date.now()}`;
  return {
    ok: true,
    accepted: true,
    mode: 'stub',
    session_key: sessionKey,
    agent: context.env.ATF_LAUNCH_AGENT,
    task_id: context.env.ATF_LAUNCH_TASK_ID,
    action_id: context.env.ATF_LAUNCH_ACTION_ID,
  };
}

function executeModule(payload, context, moduleRef) {
  const modulePath = path.isAbsolute(moduleRef) ? moduleRef : path.resolve(moduleRef);
  const loaded = require(modulePath);
  const handler = typeof loaded === 'function'
    ? loaded
    : (typeof loaded?.sessionsSpawnBackend === 'function' ? loaded.sessionsSpawnBackend : null);
  if (!handler) {
    throw new Error(`ATF_REAL_SESSIONS_SPAWN_MODULE must export a function: ${modulePath}`);
  }
  const backendResult = handler(payload, context);
  const summary = summarizeAcceptedResult(backendResult, {
    agent: context.env.ATF_LAUNCH_AGENT,
    task_id: context.env.ATF_LAUNCH_TASK_ID,
    action_id: context.env.ATF_LAUNCH_ACTION_ID,
  });
  return {
    ok: true,
    accepted: summary.accepted,
    mode: 'module',
    module: modulePath,
    session_key: summary.session_key,
    agent: summary.agent,
    task_id: summary.task_id,
    action_id: summary.action_id,
    backend_result: backendResult,
  };
}

function executeCommand(payload, context, commandRef) {
  const parts = splitCommandArgs(commandRef);
  if (!parts.length) throw new Error('ATF_REAL_SESSIONS_SPAWN_CMD is empty');
  const [command, ...args] = parts;
  const timeoutMs = (() => {
    const value = Number(process.env.ATF_REAL_SESSIONS_SPAWN_TIMEOUT_MS || 30000);
    return Number.isInteger(value) && value >= 0 ? value : 30000;
  })();
  const cwd = process.env.ATF_REAL_SESSIONS_SPAWN_CWD || context.env.ATF_LAUNCH_WORKSPACE || process.cwd();
  const child = spawnSync(command, args, {
    encoding: 'utf8',
    env: context.env,
    cwd,
    timeout: timeoutMs,
  });
  if (child.error) {
    throw new Error(`spawn backend command failed: ${child.error.message}`);
  }
  if ((child.status ?? 0) !== 0) {
    throw new Error(`backend command exited with status ${child.status}${trimText(child.stderr) ? ` | stderr: ${trimText(child.stderr)}` : ''}`);
  }
  const parsedStdout = parseJsonMaybe(child.stdout);
  const summary = summarizeAcceptedResult(parsedStdout, {
    agent: context.env.ATF_LAUNCH_AGENT,
    task_id: context.env.ATF_LAUNCH_TASK_ID,
    action_id: context.env.ATF_LAUNCH_ACTION_ID,
  });
  return {
    ok: true,
    accepted: summary.accepted,
    mode: 'command',
    command: commandRef,
    executable: command,
    args,
    cwd,
    timeout_ms: timeoutMs,
    session_key: summary.session_key,
    agent: summary.agent,
    task_id: summary.task_id,
    action_id: summary.action_id,
    backend_result: parsedStdout,
    stdout: trimText(child.stdout),
    stderr: trimText(child.stderr),
  };
}

function sessionsSpawnBackend(payload, context = {}) {
  const execContext = buildExecutionContext(payload, context);
  const eventsDir = process.env.ATF_REAL_SESSIONS_SPAWN_EVENTS_DIR || defaultEventsDir(execContext.payload_path);
  const eventPath = path.join(eventsDir, `${payload.launch_id || Date.now()}.json`);
  const mode = String(process.env.ATF_REAL_SESSIONS_SPAWN_MODE || '').trim().toLowerCase();

  let result;
  if (mode === 'stub') {
    result = executeStub(payload, execContext);
  } else if (process.env.ATF_REAL_SESSIONS_SPAWN_MODULE) {
    result = executeModule(payload, execContext, process.env.ATF_REAL_SESSIONS_SPAWN_MODULE);
  } else if (process.env.ATF_REAL_SESSIONS_SPAWN_CMD) {
    result = executeCommand(payload, execContext, process.env.ATF_REAL_SESSIONS_SPAWN_CMD);
  } else {
    throw new Error('configure ATF_REAL_SESSIONS_SPAWN_MODE=stub, ATF_REAL_SESSIONS_SPAWN_CMD, or ATF_REAL_SESSIONS_SPAWN_MODULE');
  }

  writeEvent(eventPath, {
    ...buildEventBase(payload, execContext, result.mode || mode || 'unknown'),
    ok: true,
    result,
  });

  return {
    ...result,
    event_path: eventPath,
  };
}

module.exports = sessionsSpawnBackend;
module.exports.sessionsSpawnBackend = sessionsSpawnBackend;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }
  const { payload, payloadPath } = readPayloadFromEnv();
  const result = sessionsSpawnBackend(payload, {
    payload_path: payloadPath,
    prompt_path: process.env.ATF_LAUNCH_PROMPT_PATH || null,
  });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
