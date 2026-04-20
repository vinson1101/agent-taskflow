#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.join(__dirname, 'atf-cli.js');
const controlPlanePath = path.join(__dirname, 'workspace', 'bin', 'atf-control-plane.cjs');

function showEntrypointHelp() {
  console.log('AgentTaskFlow (ATF)');
  console.log('');
  console.log('Active entrypoints:');
  console.log(`- CLI: node ${path.basename(cliPath)} <command>`);
  console.log(`- Control plane: node ${path.relative(__dirname, controlPlanePath)} --quiet-idle`);
  console.log('');
  console.log('Examples:');
  console.log(`- node ${path.basename(cliPath)} list`);
  console.log(`- node ${path.basename(cliPath)} action watcher-status`);
  console.log(`- node ${path.relative(__dirname, controlPlanePath)} --dry-run --json`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    showEntrypointHelp();
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: __dirname,
    stdio: 'inherit',
  });
  process.exit(result.status === null ? 1 : result.status);
}

module.exports = {
  cliPath,
  controlPlanePath,
};
