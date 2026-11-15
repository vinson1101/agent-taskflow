const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { createHash, randomBytes } = require('node:crypto');
const { acquireFileLock } = require('./atf-storage.cjs');

const hash = x => createHash('sha256').update(x).digest('hex');
const MAX_ARTIFACT = 10_000;
const now = () => new Date().toISOString();
const uid = () => process.getuid();
const regex = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const id = (x, label) => {
  if (typeof x !== 'string' || !regex.test(x)) throw new Error('invalid ' + label);
  return x;
};
function safeDir(location, create = false) {
  // Do not follow a symlink for either the inbox or the receipt directory.
  if (create) {
    try { fs.mkdirSync(location, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const st = fs.lstatSync(location);
  if (!st.isDirectory() || st.uid !== uid() || (st.mode & 0o777) !== 0o700)
    throw new Error('manual intake directory must be owned by operator and mode 0700');
  return location;
}
function boundedFile(dir, name, extension, limit, privateMode = false) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name) ||
      !extension.test(name) || !fs.constants.O_NOFOLLOW)
    throw new Error('manual intake requires a local regular filename in the private inbox');
  const fd = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== uid() || st.size > limit || st.size < 1 ||
        (privateMode && ((st.mode & 0o777) !== 0o600 || st.nlink !== 1)))
      throw new Error('manual intake file is not an owned bounded regular file');
    if (!privateMode && (st.mode & 0o022)) throw new Error('manual intake file is writable by another user');
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!n) break;
      offset += n;
    }
    if (offset > limit || offset !== st.size || fs.fstatSync(fd).mtimeMs !== st.mtimeMs)
      throw new Error('manual intake file changed or exceeded size limit');
    return bytes.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}
function strictText(bytes, label) {
  let result;
  try { result = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(label + ' must be UTF-8'); }
  if (!result.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b\ufeff]/.test(result))
    throw new Error(label + ' must be non-empty plain text');
  return result;
}
function json(bytes, label) {
  try { return JSON.parse(strictText(bytes, label)); }
  catch { throw new Error(label + ' must be valid JSON'); }
}
function canonicalManifest(raw) {
  const keys = ['source_kind', 'source_id', 'source_revision', 'source_url', 'content_kind', 'artifact_sha256', 'reviewer', 'criterion'];
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' ||
      Object.keys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)))
    throw new Error('manifest must contain only source/provenance fields; permission assertions are not accepted');
  if (raw.content_kind !== 'complete_research') throw new Error('only complete research artifacts are accepted, not a digest or excerpt');
  const provider = raw.source_kind;
  const source = id(raw.source_id, 'public source ID');
  const canonical = provider === 'synthetic' ? 'https://example.invalid/research/' + source :
    provider === 'cue-public' ? 'cue-public:research/' + source :
    provider === 'grok-public' ? 'https://grok.com/share/' + source : null;
  if (!canonical || raw.source_url !== canonical) throw new Error('source URL is not canonical for the source ID');
  if (!Number.isSafeInteger(raw.source_revision) || raw.source_revision < 1)
    throw new Error('source revision must be a positive integer');
  if (typeof raw.artifact_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.artifact_sha256))
    throw new Error('declared SHA-256 required');
  const reviewer = id(raw.reviewer, 'reviewer');
  if (typeof raw.criterion !== 'string' || !raw.criterion.trim() || Buffer.byteLength(raw.criterion) > 2_000 ||
      /[\r\n\u0000-\u001f\u007f]/.test(raw.criterion))
    throw new Error('review criterion must be bounded single-line text');
  return { source_kind: provider, source_id: source, source_revision: raw.source_revision, source_url: canonical,
    content_kind: raw.content_kind, artifact_sha256: raw.artifact_sha256, reviewer, criterion: raw.criterion };
}
function readBundle(core, config, dsh, taskId, manifestName, artifactName) {
  dsh.requireIsolation(config);
  if (process.env.ATF_PUBLIC_RESEARCH_IMPORT !== '1') throw new Error('public research import is disabled; explicit local opt-in required');
  const task = core.taskContext(config, id(taskId, 'ATF task ID'));
  if (!task?.created_at) throw new Error('canonical ATF task not found');
  const inbox = safeDir(path.join(fs.realpathSync(process.env.ATF_STANDALONE_ROOT), 'public-research-inbox'));
  const manifest = canonicalManifest(json(boundedFile(inbox, manifestName, /\.json$/, 4_096), 'manifest'));
  const bytes = boundedFile(inbox, artifactName, /\.(md|txt)$/, MAX_ARTIFACT);
  const artifact = strictText(bytes, 'artifact');
  if (hash(bytes) !== manifest.artifact_sha256) throw new Error('file bytes do not match declared SHA-256');
  const session = dsh.registeredReviewerSession(core, config, manifest.reviewer);
  if (!session) throw new Error('register an enabled DSH reviewer with a dedicated session binding first');
  const selection = makeSelection(task, manifest, bytes.length, hash(session));
  const selectionId = hash(JSON.stringify(selection));
  return { selection, artifact, selectionId, challenge: 'APPROVE ' + selectionId.slice(0, 12) };
}
function makeSelection(task, manifest, artifactBytes, reviewerSessionSha256) {
  return { task_id: task.short_id || task.task_id, task_created_at: task.created_at,
    ...manifest, artifact_bytes: artifactBytes, reviewer_session_sha256: reviewerSessionSha256 };
}
function sourceEventId(p) {
  return 'public-research:' + hash(JSON.stringify([p.source_kind, p.source_id, p.source_revision]));
}
function receiptDir(config, create) {
  return safeDir(path.join(fs.realpathSync(config.dataDir), 'public-research-approvals'), create);
}
function readApproval(config, selectionId) {
  try {
    return json(boundedFile(receiptDir(config), selectionId + '.json', /\.json$/, 8_192, true), 'approval');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function checkApproval(config, bundle) {
  const receipt = readApproval(config, bundle.selectionId);
  if (receipt?.schema !== 'atf.public-research-approval.v1' || receipt.operator_uid !== uid() ||
      receipt.approval_id !== bundle.selectionId || !Number.isFinite(Date.parse(receipt.approved_at)) ||
      JSON.stringify(receipt.selection) !== JSON.stringify(bundle.selection))
    throw new Error('exact separate trusted operator approval required before import');
  return receipt;
}
function writeApproval(config, bundle) {
  const dir = receiptDir(config, true);
  const prior = readApproval(config, bundle.selectionId);
  if (prior) return checkApproval(config, bundle);
  const receipt = { schema: 'atf.public-research-approval.v1', approval_id: bundle.selectionId,
    approved_at: now(), operator_uid: uid(), selection: bundle.selection };
  const name = path.join(dir, bundle.selectionId + '.json');
  const temp = name + '.' + randomBytes(12).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, name);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return receipt;
}
async function approve(core, config, dsh, [taskId, manifest, artifact], io = { input: process.stdin, output: process.stdout }) {
  if (io.input.isTTY !== true || io.output.isTTY !== true)
    throw new Error('public approval requires an interactive trusted local operator TTY');
  const preview = readBundle(core, config, dsh, taskId, manifest, artifact);
  const p = preview.selection;
  io.output.write('Public research review approval (local only)\n' +
    `Task ${p.task_id}; reviewer ${p.reviewer}; source ${p.source_kind} ${p.source_id} v${p.source_revision}\n` +
    `Provenance reference ${p.source_url}\nArtifact ${artifact}; SHA-256 ${p.artifact_sha256}; bytes ${p.artifact_bytes}\n` +
    `Dedicated reviewer session fingerprint: ${p.reviewer_session_sha256}\n` +
    `Review criterion (operator must check): ${p.criterion}\n` +
    'Confirm only after independently checking this exact file is complete and either synthetic or approved for local copying and submission to the designated reviewer. A public link alone does not grant copying permission.\n');
  const rl = readline.createInterface({ ...io, terminal: false });
  let reply;
  try { reply = await rl.question(`Type "${preview.challenge}" to approve, or press Enter to stop: `); }
  finally { rl.close(); }
  if (reply !== preview.challenge) throw new Error('trusted operator did not approve this artifact');
  const release = acquireFileLock(path.join(config.dataDir, 'runtime-dispatch.lock'));
  try {
    const current = readBundle(core, config, dsh, taskId, manifest, artifact);
    if (current.selectionId !== preview.selectionId) throw new Error('selection changed after preview; nothing approved');
    if (!dsh.registeredReviewerSession(core, config, current.selection.reviewer))
      throw new Error('the approval requires an enabled enrolled DSH reviewer');
    const receipt = writeApproval(config, current);
    return { status: 'approved_local_only', approval_id: receipt.approval_id, task_id: p.task_id, artifact_sha256: p.artifact_sha256 };
  } finally { release(); }
}
function recordFor(bundle, receipt) {
  const p = bundle.selection;
  return { source_kind: p.source_kind, source_id: p.source_id, source_revision: p.source_revision,
    source_url: p.source_url, artifact_sha256: p.artifact_sha256, artifact_bytes: p.artifact_bytes,
    reviewer: p.reviewer, reviewer_session_sha256: p.reviewer_session_sha256,
    approval_id: receipt.approval_id, approved_at: receipt.approved_at, status: 'imported', imported_at: now() };
}
function sameSource(a, b) {
  return a.source_kind === b.source_kind && a.source_id === b.source_id;
}
function validateCanonicalSource(core, config, ctx, record) {
  const records = ctx.dsh_public_research || [];
  if (!Array.isArray(records)) throw new Error('canonical source records invalid');
  if (records.some(x => !sameSource(x, record)) || (ctx.dsh_review && !records.length))
    throw new Error('use a dedicated canonical task for this one public research source');
  for (const row of fs.readdirSync(config.tasksDir, { withFileTypes: true })) {
    if (!row.isDirectory() || row.name === 'dlq') continue;
    const filename = path.join(config.tasksDir, row.name, 'ctx.json');
    let raw;
    try { raw = fs.readFileSync(filename, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('cannot check canonical source ownership'); }
    let other;
    try { other = JSON.parse(raw); } catch { throw new Error('cannot check canonical source ownership'); }
    if (!other || typeof other !== 'object' || Array.isArray(other) ||
        (other.dsh_public_research !== undefined && !Array.isArray(other.dsh_public_research)))
      throw new Error('cannot check canonical source ownership');
    for (const stored of other.dsh_public_research || []) {
      if (!sameSource(stored, record)) continue;
      if ((other.short_id || other.task_id) !== (ctx.short_id || ctx.task_id))
        throw new Error('source already belongs to a different canonical task');
      if (stored.source_revision === record.source_revision && stored.approval_id !== record.approval_id)
        throw new Error('same source revision conflicts with imported provenance or artifact');
    }
  }
  return records.find(x => x.source_revision === record.source_revision) || null;
}
function importPublic(core, config, dsh, [taskId, manifest, artifact]) {
  const selected = readBundle(core, config, dsh, taskId, manifest, artifact);
  const p = selected.selection;
  const sourceEvent = sourceEventId(p);
  const review = dsh.makeReview(core, config, taskId, { reviewer: p.reviewer, revision: p.source_revision,
    source_event_id: sourceEvent, artifact: selected.artifact, criterion: p.criterion }, ctx => {
    const current = readBundle(core, config, dsh, taskId, manifest, artifact);
    if (current.selectionId !== selected.selectionId) throw new Error('selection changed before import; nothing imported');
    const receipt = checkApproval(config, current);
    const record = recordFor(current, receipt);
    return validateCanonicalSource(core, config, ctx, record) || record;
  });
  const event = core.readJson(path.join(core.paths(config).events, review.event_id + '.json'));
  return { ...review, source_state: 'imported', dispatch_state: event?.status || 'unknown', approval_id: selected.selectionId };
}
function requireDispatchApproval(config, task, ref) {
  const records = task.dsh_public_research;
  const matches = Array.isArray(records) ? records.filter(p => p.source_revision === ref.revision &&
    p.artifact_sha256 === ref.sha256 && p.reviewer === ref.reviewer &&
    p.reviewer_session_sha256 === hash(ref.session_id) && sourceEventId(p) === ref.source_event_id) : [];
  if (matches.length !== 1) throw new Error('canonical public-source provenance does not authorize this destination');
  const record = matches[0];
  const manifest = canonicalManifest({ source_kind: record.source_kind, source_id: record.source_id,
    source_revision: record.source_revision, source_url: record.source_url, content_kind: 'complete_research',
    artifact_sha256: record.artifact_sha256, reviewer: ref.reviewer, criterion: task.dsh_review?.criterion });
  const artifactBytes = Buffer.byteLength(task.outputs.review_artifact.text);
  const selection = makeSelection(task, manifest, artifactBytes, record.reviewer_session_sha256);
  const selectionId = hash(JSON.stringify(selection));
  if (record.approval_id !== selectionId || record.artifact_bytes !== artifactBytes)
    throw new Error('canonical public-source evidence does not match exact approval');
  const approval = checkApproval(config, { selection, selectionId });
  if (record.approved_at !== approval.approved_at) throw new Error('canonical public-source approval timestamp differs');
}
module.exports = { approve, importPublic, requireDispatchApproval };
