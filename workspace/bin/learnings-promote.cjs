#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { atomicWriteFile } = require('../lib/atf-storage.cjs');

const workspace = process.env.ATF_WORKSPACE_DIR || path.join(process.env.ATF_ROOT || '/root/.openclaw', 'workspace');
const dataDir = process.env.ATF_DATA_DIR || path.join(workspace, 'agent-taskflow', 'data');
const registryPath = path.join(dataDir, 'agents.json');
const memoryPath = process.env.ATF_MEMORY_FILE || path.join(workspace, 'MEMORY.md');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function workspaces() {
  const registry = readJson(registryPath);
  const agents = Array.isArray(registry?.agents) ? registry.agents : [];
  return [...new Set([workspace, ...agents.map(agent => agent.workspace).filter(Boolean)])];
}

function entries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = [...content.matchAll(/\[(LRN-\d{8}-\d+)\](?!\s*\[PROMOTED\])\n([\s\S]*?)(?=\n\[LRN-\d{8}-\d+\]|\n#+[^\n]*\n|$)/g)];
  return matches.map(match => ({ id: match[1], body: match[2].trim(), filePath })).filter(entry => entry.body);
}

function main() {
  const grouped = new Map();
  for (const root of workspaces()) {
    for (const file of ['ERRORS.md', 'LEARNINGS.md', 'FEATURES.md']) {
      for (const entry of entries(path.join(root, '.learnings', file))) {
        const key = entry.body.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(entry);
      }
    }
  }
  const promotable = [...grouped.values()].filter(group => group.length >= 3);
  if (!promotable.length) {
    console.log('learnings promote: 0');
    return;
  }

  const timestamp = new Date().toISOString();
  let memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8').trimEnd() : '# ATF Memory';
  memory += `\n\n## Promoted learnings ${timestamp}\n`;
  for (const group of promotable) memory += `\n- ${group[0].body.replace(/\s+/g, ' ').trim()}\n`;
  atomicWriteFile(memoryPath, `${memory}\n`);

  for (const group of promotable) {
    for (const entry of group) {
      const content = fs.readFileSync(entry.filePath, 'utf8');
      atomicWriteFile(entry.filePath, content.replace(`[${entry.id}]`, `[${entry.id}] [PROMOTED]`));
    }
  }
  console.log(`learnings promote: ${promotable.length}`);
  console.log(`memory: ${memoryPath}`);
}

main();
