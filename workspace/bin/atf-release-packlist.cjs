// No registry calls: validate the pack list that npm would generate locally.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const npm = process.env.npm_execpath;
assert.ok(npm && path.isAbsolute(npm), 'run this check as an npm script');
const root = path.resolve(__dirname, '..', '..');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-packlist-cache-'));
let p;
try {
  p = spawnSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts', '--offline', '--cache', cache],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
} finally { fs.rmSync(cache, { recursive: true, force: true }); }
assert.equal(p.status, 0, 'npm packlist check failed');
const list = JSON.parse(p.stdout);
assert.equal(list.length, 1);
const files = list[0]?.files?.map(f => f.path);
assert.ok(Array.isArray(files) && files.length);
const top = new Set(['README.md','PLAN.md','atf-cli.js','index.js','package.json','skill-config.json']);
const prefix = ['docs/', 'workspace/bin/', 'workspace/lib/'];
for (const file of files) {
  assert.ok(top.has(file) || /^(LICENSE|LICENCE|COPYING)(\.[A-Za-z]+)?$/i.test(file) || prefix.some(v => file.startsWith(v)),
    'release payload has a file outside the explicit allowlist: ' + file);
}
for (const required of ['atf-cli.js', 'index.js', 'docs/ATF_RELEASE_ROLLBACK.md',
  'workspace/bin/atf-reliability.cjs', 'workspace/lib/atf-dsh-review.cjs', 'workspace/lib/atf-public-research.cjs']) {
  assert.ok(files.includes(required), 'release payload missing required runtime/docs: ' + required);
}
console.log(JSON.stringify({status: 'passed', file_count: files.length,
  legacy_archive_included: false, test_results_included: false, logs_included: false}));
