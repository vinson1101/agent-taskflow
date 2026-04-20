#!/usr/bin/env node

const fs = require('fs');

function printHelp() {
  console.log(`ATF Real Sessions Spawn Runtime Template

Usage:
  1. Copy this file to your host/runtime workspace
  2. Implement spawnRuntimeSession()
  3. Point ATF_REAL_SESSIONS_SPAWN_MODULE at the copied file

Expected env:
  ATF_LAUNCH_PAYLOAD_PATH
  ATF_LAUNCH_AGENT
  ATF_LAUNCH_WORKSPACE
  ATF_LAUNCH_TASK_ID
  ATF_LAUNCH_ACTION_ID
  ATF_LAUNCH_GUIDANCE
  ATF_LAUNCH_SUMMARY
  ATF_LAUNCH_PROMPT
  ATF_LAUNCH_PROMPT_PATH
`);
}

function readPayloadFromEnv() {
  const payloadPath = process.env.ATF_LAUNCH_PAYLOAD_PATH;
  if (!payloadPath) throw new Error('missing ATF_LAUNCH_PAYLOAD_PATH');
  const raw = fs.readFileSync(payloadPath, 'utf8').replace(/^\uFEFF/, '');
  return {
    payloadPath,
    payload: JSON.parse(raw),
  };
}

function buildLaunchInput(payload, context = {}) {
  const env = {
    ...process.env,
    ...(context.env || {}),
  };
  return {
    launch_id: payload.launch_id || null,
    agent: env.ATF_LAUNCH_AGENT || payload.agent || null,
    workspace: env.ATF_LAUNCH_WORKSPACE || payload.workspace || null,
    task_id: env.ATF_LAUNCH_TASK_ID || payload.payload?.task_id || null,
    action_id: env.ATF_LAUNCH_ACTION_ID || payload.payload?.action_id || null,
    guidance: env.ATF_LAUNCH_GUIDANCE || payload.guidance || null,
    summary: env.ATF_LAUNCH_SUMMARY || payload.summary || null,
    prompt: env.ATF_LAUNCH_PROMPT || null,
    prompt_path: context.prompt_path || env.ATF_LAUNCH_PROMPT_PATH || null,
    payload_path: context.payload_path || env.ATF_LAUNCH_PAYLOAD_PATH || null,
  };
}

function requireField(value, name) {
  if (value) return value;
  throw new Error(`missing ${name}`);
}

function spawnRuntimeSession(input) {
  requireField(input.launch_id, 'launch_id');
  requireField(input.agent, 'agent');
  requireField(input.workspace, 'workspace');
  requireField(input.prompt || input.prompt_path, 'prompt or prompt_path');

  // Replace this section with your real runtime integration.
  //
  // Example shape only:
  // const result = sessionsSpawn({
  //   agentId: input.agent,
  //   cwd: input.workspace,
  //   prompt: input.prompt,
  //   promptPath: input.prompt_path,
  //   metadata: {
  //     launchId: input.launch_id,
  //     taskId: input.task_id,
  //     actionId: input.action_id,
  //   },
  // });
  //
  // return result.sessionKey;

  throw new Error('implement spawnRuntimeSession() for your runtime');
}

function realSessionsSpawnRuntimeBackend(payload, context = {}) {
  const input = buildLaunchInput(payload, context);
  const sessionKey = spawnRuntimeSession(input);
  if (!sessionKey || typeof sessionKey !== 'string') {
    throw new Error('spawnRuntimeSession() must return a non-empty session key string');
  }
  return {
    ok: true,
    accepted: true,
    session_key: sessionKey,
    agent: input.agent,
    task_id: input.task_id,
    action_id: input.action_id,
    workspace: input.workspace,
    launched_at: new Date().toISOString(),
  };
}

module.exports = realSessionsSpawnRuntimeBackend;
module.exports.sessionsSpawnBackend = realSessionsSpawnRuntimeBackend;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }
  const { payload, payloadPath } = readPayloadFromEnv();
  const result = realSessionsSpawnRuntimeBackend(payload, {
    payload_path: payloadPath,
    prompt_path: process.env.ATF_LAUNCH_PROMPT_PATH || null,
    env: process.env,
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
