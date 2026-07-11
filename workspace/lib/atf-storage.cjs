const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteFile(filePath, content, encoding = 'utf8') {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, encoding);
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function atomicWriteJson(filePath, data) {
  atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function acquireFileLock(filePath) {
  ensureDir(path.dirname(filePath));
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = (() => {
        try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
      })();
      if (Number.isInteger(existing?.pid)) {
        try { process.kill(existing.pid, 0); } catch (probeError) {
          if (probeError.code === 'ESRCH') {
            fs.unlinkSync(filePath);
            return acquireFileLock(filePath);
          }
        }
      }
      throw new Error(`already running: ${filePath}`);
    }
    throw error;
  }
  fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
  fs.closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  };
}

module.exports = { acquireFileLock, atomicWriteFile, atomicWriteJson, ensureDir };
