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

function printHelp() {
  console.log(`ATF Sessions Spawn Bridge

Usage:
  node workspace/bin/sessions-spawn-bridge.cjs

Required env:
  ATF_LAUNCH_PAYLOAD_PATH            Path to atf.launch-dispatch-payload.v1 JSON

Backend selection:
  ATF_SESSIONS_SPAWN_BACKEND_CMD     Shell-style command to execute
  ATF_SESSIONS_SPAWN_BACKEND_MODULE  Node module exporting a function or { sessionsSpawn() }

Optional env:
  ATF_SESSIONS_SPAWN_BACKEND_CWD         Working directory for backend command
  ATF_SESSIONS_SPAWN_BACKEND_TIMEOUT_MS  Timeout for backend command

Forwarded launch env:
  ATF_LAUNCH_ID / AGENT / WORKSPACE / TASK_ID / ACTION_ID / GUIDANCE / SUMMARY / PAYLOAD_PATH / PROMPT / PROMPT_PATH
`);
}

function readPayload() {
  const payloadPath = process.env.ATF_LAUNCH_PAYLOAD_PATH;
  if (!payloadPath) throw new Error('missing ATF_LAUNCH_PAYLOAD_PATH');
  if (!fs.existsSync(payloadPath)) throw new Error(`payload file not found: ${payloadPath}`);
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  return { payload, payloadPath };
}

function buildWritebackInstructions(payload) {
  const taskId = payload.payload?.task_id || '-';
  const actionKind = payload.payload?.kind || null;
  const sourceType = payload.source_type || null;
  const agent = payload.agent || 'unknown';
  const reviewee = payload.payload?.reviewee || payload.payload?.assigned_to || agent;
  const pendingTaskPath = payload.payload?.pending_message_path || payload.payload?.pending_task_path || payload.source_path || 'pending-task.json';
  const messageId = payload.payload?.message_id || payload.source_ref || null;
  const threadId = payload.payload?.thread_id || null;
  const lines = [
    'ATF writeback is mandatory. Logs or local notes do not count as completion.',
    `When you change task status via ATF CLI, include by=${agent} so ATF can attribute the writeback.`,
  ];

  if (sourceType === 'message' && taskId !== '-' && messageId) {
    lines.push(`First acknowledge or close the message signal in ATF for ${taskId}.`);
    lines.push(`If you only need to confirm receipt, use: node atf-cli.js msg ack ${taskId} ${messageId} ${agent} acked`);
    lines.push(`If you need to respond, send an ATF reply on the same thread${threadId ? ` (${threadId})` : ''}; do not stop at local notes or logs.`);
  } else if (actionKind === 'stale_review_follow_up' && taskId !== '-') {
    if (agent === reviewee) {
      lines.push('Do not write a self review for your own task. Self review does not close stale review backlog in ATF.');
      lines.push(`Request an external review through ATF for ${taskId}, or otherwise follow up with the coordinator/reviewer via ATF message.`);
      lines.push('Only treat the backlog as closed after a non-self review exists in ATF.');
    } else {
      lines.push(`If you are acting as an external reviewer, persist it with: node atf-cli.js review add ${taskId} ${agent} ${reviewee} approved "<summary>" type=task overall=4`);
      lines.push('If approval is not appropriate, use needs_revision or rejected instead of approved.');
    }
  } else if (actionKind === 'decision_follow_up' && taskId !== '-') {
    lines.push(`Write the decision back into ATF for ${taskId}; if the task is blocked, use: node atf-cli.js update ${taskId} blocked by=${agent}`);
  } else if (actionKind === 'pending_reply_follow_up') {
    lines.push(`Reply through the ATF message flow for ${taskId}; do not stop at local notes or logs.`);
  } else if (taskId !== '-') {
    lines.push(`Write the outcome back into ATF for ${taskId} before considering the work done.`);
  }

  lines.push(`After successful ATF writeback, delete the consumed file: ${pendingTaskPath}`);
  return lines;
}

function buildPrompt(payload) {
  const writebackInstructions = buildWritebackInstructions(payload);
  const isMessageLaunch = payload.source_type === 'message';
  const lines = [
    isMessageLaunch
      ? `Wake agent ${payload.agent || 'unknown'} and let it consume its pending ATF message.`
      : `Wake agent ${payload.agent || 'unknown'} and let it consume its pending task.`,
    '',
    `Launch ID: ${payload.launch_id || '-'}`,
    `Task ID: ${payload.payload?.task_id || '-'}`,
    `Action ID: ${payload.payload?.action_id || '-'}`,
    `Workspace: ${payload.workspace || '-'}`,
    isMessageLaunch
      ? `Pending Message: ${payload.payload?.pending_message_path || payload.source_path || '-'}`
      : `Pending Task: ${payload.payload?.pending_task_path || payload.source_path || '-'}`,
    `Summary: ${payload.summary || '-'}`,
    `Guidance: ${payload.guidance || '-'}`,
    '',
    'Instruction:',
    ...(isMessageLaunch
      ? [
          '1. Open the target workspace and inspect the pending message signal.',
          `2. Read the ATF message thread for context${payload.payload?.thread_id ? ` (${payload.payload.thread_id})` : ''}.`,
          '3. Acknowledge or reply through the ATF message flow, not just local notes.',
          '4. Only after ATF writeback succeeds, remove the consumed pending message signal.',
        ]
      : [
          '1. Open the target workspace and inspect pending-task.json.',
          '2. Handle the requested follow-up there.',
          '3. Persist the result back into ATF using the ATF CLI.',
          '4. Only after ATF writeback succeeds, remove the consumed pending-task.json.',
        ]),
    '',
    ...(isMessageLaunch
      ? [
          `Message ID: ${payload.payload?.message_id || '-'}`,
          `From: ${payload.payload?.from_agent || '-'}`,
          `To: ${payload.payload?.to_agent || payload.agent || '-'}`,
          `Thread: ${payload.payload?.thread_id || '-'}`,
          `Type: ${payload.payload?.message_type || '-'}`,
          `Body: ${payload.payload?.body || payload.payload?.body_excerpt || '-'}`,
          '',
        ]
      : []),
    ...writebackInstructions.map(item => `- ${item}`),
  ];
  return `${lines.join('\n')}\n`;
}

function persistPrompt(payloadPath, prompt) {
  const promptPath = payloadPath.replace(/\.json$/i, '.prompt.txt');
  fs.writeFileSync(promptPath, prompt, 'utf8');
  return promptPath;
}

function executeBackendModule(payload, context) {
  const moduleRef = process.env.ATF_SESSIONS_SPAWN_BACKEND_MODULE;
  if (!moduleRef) return null;
  const modulePath = path.isAbsolute(moduleRef) ? moduleRef : path.resolve(moduleRef);
  const loaded = require(modulePath);
  const backend = typeof loaded === 'function'
    ? loaded
    : (typeof loaded?.sessionsSpawn === 'function' ? loaded.sessionsSpawn : null);
  if (!backend) {
    throw new Error(`ATF_SESSIONS_SPAWN_BACKEND_MODULE must export a function: ${modulePath}`);
  }
  const result = backend(payload, context);
  return {
    mode: 'module',
    module: modulePath,
    result,
  };
}

function executeBackendCommand(payload, context) {
  const commandRef = process.env.ATF_SESSIONS_SPAWN_BACKEND_CMD;
  if (!commandRef) return null;
  const parts = splitCommandArgs(commandRef);
  if (!parts.length) throw new Error('ATF_SESSIONS_SPAWN_BACKEND_CMD is empty');
  const [command, ...args] = parts;
  const timeoutMs = (() => {
    const value = Number(process.env.ATF_SESSIONS_SPAWN_BACKEND_TIMEOUT_MS || 30000);
    return Number.isInteger(value) && value >= 0 ? value : 30000;
  })();
  const cwd = process.env.ATF_SESSIONS_SPAWN_BACKEND_CWD || payload.workspace || process.cwd();
  const child = spawnSync(command, args, {
    encoding: 'utf8',
    env: context.env,
    cwd,
    timeout: timeoutMs,
  });
  if (child.error) {
    throw new Error(`backend command failed: ${child.error.message}`);
  }
  if ((child.status ?? 0) !== 0) {
    throw new Error(`backend command exited with status ${child.status}${trimText(child.stderr) ? ` | stderr: ${trimText(child.stderr)}` : ''}`);
  }
  return {
    mode: 'command',
    command: commandRef,
    executable: command,
    args,
    cwd,
    timeout_ms: timeoutMs,
    stdout: trimText(child.stdout),
    stderr: trimText(child.stderr),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const { payload, payloadPath } = readPayload();
  const prompt = buildPrompt(payload);
  const promptPath = persistPrompt(payloadPath, prompt);

  const env = {
    ...process.env,
    ATF_LAUNCH_PROMPT: prompt,
    ATF_LAUNCH_PROMPT_PATH: promptPath,
    ATF_LAUNCH_AGENT: process.env.ATF_LAUNCH_AGENT || payload.agent || '',
    ATF_LAUNCH_WORKSPACE: process.env.ATF_LAUNCH_WORKSPACE || payload.workspace || '',
    ATF_LAUNCH_TASK_ID: process.env.ATF_LAUNCH_TASK_ID || payload.payload?.task_id || '',
    ATF_LAUNCH_ACTION_ID: process.env.ATF_LAUNCH_ACTION_ID || payload.payload?.action_id || '',
    ATF_LAUNCH_GUIDANCE: process.env.ATF_LAUNCH_GUIDANCE || payload.guidance || '',
    ATF_LAUNCH_SUMMARY: process.env.ATF_LAUNCH_SUMMARY || payload.summary || '',
  };

  const context = {
    env,
    payload_path: payloadPath,
    prompt_path: promptPath,
  };

  const moduleResult = executeBackendModule(payload, context);
  const commandResult = moduleResult ? null : executeBackendCommand(payload, context);
  if (!moduleResult && !commandResult) {
    throw new Error('configure ATF_SESSIONS_SPAWN_BACKEND_CMD or ATF_SESSIONS_SPAWN_BACKEND_MODULE');
  }

  console.log(JSON.stringify({
    ok: true,
    launch_id: payload.launch_id,
    agent: payload.agent,
    payload_path: payloadPath,
    prompt_path: promptPath,
    backend: moduleResult || commandResult,
  }, null, 2));
  return 0;
}

try {
  module.exports.buildWritebackInstructions = buildWritebackInstructions;
  module.exports.buildPrompt = buildPrompt;
  module.exports.persistPrompt = persistPrompt;
  if (require.main === module) {
    process.exitCode = main();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
