// Uses a local fake relay. Passing is not evidence of live DSH.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atf-u1-fixture-replay-'));
const taskRows = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...data })); };
  if (url.pathname === '/health') return send({ name: 'dsh-task-dispatch', version: '0.6.3', auth: 'token' });
  assert.equal(req.headers.authorization, 'Bearer unit-test-token');
  if (url.pathname === '/send') {
    const body = JSON.parse((await Array.fromAsync(req)).map(b => b.toString()).join(''));
    assert.equal(req.method, 'POST');
    assert.match(req.headers['content-type'], /application\/json/);
    const tuple = JSON.parse(body.text.split('\n').find(line => line.startsWith('{')));
    const taskId = 'mock-task-' + (taskRows.length + 1);
    taskRows.push({ taskId, requestId: body.requestId, sessionId: body.sessionId, status: 'completed', attribution: 'rpc-turn-segment',
      result: { truncated: false, empty: false, text: JSON.stringify({ ...tuple, verdict: tuple.revision === 1 ? 'reject' : 'pass' }) } });
    return send({ taskId, requestId: body.requestId, sessionId: body.sessionId, status: 'accepted' }, 202);
  }
  if (url.pathname === '/tasks') {
    const tasks = taskRows.filter(t => t.sessionId === url.searchParams.get('sessionId'));
    return send({ tasks, total: tasks.length });
  }
  const row = taskRows.find(t => url.pathname === '/tasks/' + t.taskId);
  if (row) return send({ task: row });
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'atf-dsh-integrated-canary.cjs')], {
    env: { ATF_STANDALONE_ROOT: dir, ATF_DSH_TEST_SESSION_ID: 'mock-dedicated', ATF_DSH_RELAY_TOKEN: 'unit-test-token',
      ATF_DSH_LIVE_PILOT: 'dedicated-test-session', ATF_DSH_RELAY_URL: 'http://127.0.0.1:' + server.address().port,
      ATF_DSH_PILOT_TIMEOUT_MS: '7000' },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  child.once('error', () => { server.close(); process.exitCode = 1; });
  child.once('exit', (code) => {
    fs.rmSync(dir, { recursive: true, force: true });
    server.close();
    if (code !== 0 || taskRows.length !== 3) process.exitCode = 1;
  });
});
