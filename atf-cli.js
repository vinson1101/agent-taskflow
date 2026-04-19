#!/usr/bin/env node
/**
 * ATF CLI v2 - 统一任务仓库
 * 所有任务存储在 /root/.openclaw/atf-tasks/
 * 每个任务目录包含: ctx.json, latest.json, README.md, progress.md, research/, notifications/
 */

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { execSync } = require('child_process');

// ============================================================
// 统一配置
// ============================================================
const OPENCLAW_ROOT = process.env.ATF_ROOT || '/root/.openclaw';
const WORKSPACE_DIR = process.env.ATF_WORKSPACE_DIR || `${OPENCLAW_ROOT}/workspace`;
const TASKS_DIR = process.env.ATF_TASKS_DIR || `${OPENCLAW_ROOT}/atf-tasks`;
const DLQ_DIR = `${TASKS_DIR}/dlq`;
const DATA_DIR = process.env.ATF_DATA_DIR || `${WORKSPACE_DIR}/agent-taskflow/data`;
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE  = `${DATA_DIR}/tasks.json`;
const SCORES_FILE = `${DATA_DIR}/scores.json`;
const TRIGGER_INBOX_DIR = `${DATA_DIR}/trigger-inboxes`;
const PENDING_TRIGGER_FIRES_FILE = `${DATA_DIR}/pending-trigger-fires.json`;
const PENDING_DECISIONS_MD = process.env.ATF_PENDING_DECISIONS_MD || `${WORKSPACE_DIR}/pending-decisions.md`;
const PENDING_DECISIONS_JSON = process.env.ATF_PENDING_DECISIONS_JSON || `${WORKSPACE_DIR}/pending-decisions.json`;
const LEARNINGS_PROMOTE_SCRIPT = process.env.ATF_LEARNINGS_PROMOTE_SCRIPT || `${WORKSPACE_DIR}/bin/learnings-promote.cjs`;
const DEFAULT_AGENT_WORKSPACE = process.env.ATF_DEFAULT_AGENT_WORKSPACE || `${OPENCLAW_ROOT}/workspace-acestock`;
const AGENT_WORKSPACES = {
  pinchymeow: process.env.ATF_WORKSPACE_PINCHYMEOW || DEFAULT_AGENT_WORKSPACE,
  f0x: process.env.ATF_WORKSPACE_F0X || `${OPENCLAW_ROOT}/workspace-f0x`,
};
const MESSAGE_TYPES = new Set(['info', 'request', 'decision_request', 'decision_reply', 'handoff', 'feedback', 'blocker']);
const RECEIPT_TYPES = new Set(['delivered', 'seen', 'acked', 'expired', 'failed']);
const SHARED_ENTRY_TYPES = new Set(['context', 'decision', 'intel', 'result', 'note', 'risk']);
const FOCUS_STATUSES = new Set(['open', 'in_progress', 'blocked', 'done', 'dropped']);
const TRIGGER_TYPES = new Set(['cron', 'interval', 'on_message', 'on_status_change', 'on_blocked']);
const TRIGGER_STATUSES = new Set(['active', 'paused', 'fired', 'archived']);
const TRIGGER_FIRE_STATUSES = new Set(['pending', 'consumed', 'ignored']);
const TRIGGER_EXECUTION_MODES = new Set(['pending_task', 'message', 'noop']);
const REFLECTION_FIELDS = new Set(['what_changed', 'what_failed', 'what_should_repeat', 'what_needs_decision']);

if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR,   { recursive: true });
if (!fs.existsSync(TRIGGER_INBOX_DIR)) fs.mkdirSync(TRIGGER_INBOX_DIR, { recursive: true });

// ============================================================
// 工具函数
// ============================================================
function loadJson(f) {
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; }
}
function saveJson(f, d) {
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d, null, 2));
}
function ctxPath(taskId)    { const d=dirOfTaskId(taskId);return `${TASKS_DIR}/${d}/ctx.json`; }
function latestPath(taskId) { return `${TASKS_DIR}/${taskId}/latest.json`; }

function readCtx(taskId) {
  // 先尝试直接路径
  const direct = loadJson(ctxPath(taskId));
  if (direct) return direct;
  // 反向查找：T-049 → 目录名
  if (taskId.startsWith('T-')) {
    const dirs = fs.readdirSync(TASKS_DIR).filter(d => !d.startsWith('.') && !d.endsWith('.json') && d !== 'dlq');
    for (const d of dirs) {
      const ctx = loadJson(`${TASKS_DIR}/${d}/ctx.json`);
      if (ctx && (ctx.task_id === taskId || ctx.short_id === taskId)) return ctx;
    }
  }
  return null;
}

function dirOfTaskId(taskId) {
  // T-049 → 目录名
  if (taskId.startsWith('T-')) {
    const dirs = fs.readdirSync(TASKS_DIR).filter(d => !d.startsWith('.') && !d.endsWith('.json') && d !== 'dlq');
    for (const d of dirs) {
      const ctx = loadJson(`${TASKS_DIR}/${d}/ctx.json`);
      if (ctx && (ctx.task_id === taskId || ctx.short_id === taskId)) return d;
    }
  }
  return taskId; // fallback
}

function writeCtx(taskId, ctx) {
  const dir = dirOfTaskId(taskId);
  ctx.updated_at = new Date().toISOString();
  saveJson(ctxPath(dir), ctx);
  saveJson(latestPath(dir), ctx);
}

function taskDirPath(taskId) {
  return `${TASKS_DIR}/${dirOfTaskId(taskId)}`;
}

function messagesDir(taskId) {
  return `${taskDirPath(taskId)}/messages`;
}

function receiptsDir(taskId) {
  return `${taskDirPath(taskId)}/receipts`;
}

function ensureMessageDirs(taskId) {
  for (const dir of [messagesDir(taskId), receiptsDir(taskId)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId(prefix) {
  const day = new Date().toISOString().substring(0,10).replace(/-/g, '');
  const rand = randomBytes(4).toString('hex');
  return `${prefix}-${day}-${rand}`;
}

function readJsonCollection(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => loadJson(`${dir}/${f}`))
    .filter(Boolean);
}

function appendHistoryEvent(history, event) {
  return [...(history || []), event].slice(-50);
}

function appendNotificationHistory(taskId, event) {
  const historyPath = `${taskDirPath(taskId)}/notifications/history.json`;
  const history = loadJson(historyPath) || [];
  history.push(event);
  saveJson(historyPath, history.slice(-50));
}

const WEEKDAY_MAP = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseDurationSeconds(spec) {
  if (!spec) return null;
  const normalized = spec.trim().toLowerCase();
  const match = normalized.match(/^(?:every:)?(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  if (unit === 's') return value;
  if (unit === 'm') return value * 60;
  if (unit === 'h') return value * 60 * 60;
  if (unit === 'd') return value * 24 * 60 * 60;
  return null;
}

function normalizeCronValueToken(token, kind) {
  const normalized = token.trim().toLowerCase();
  if (kind === 'dow' && WEEKDAY_MAP[normalized] !== undefined) return WEEKDAY_MAP[normalized];
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (kind === 'dow' && value === 7) return 0;
  return value;
}

function parseCronField(field, min, max, kind) {
  if (!field || field === '*') return null;
  const values = new Set();
  for (const part of field.split(',')) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const [rangePart, stepPart] = token.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step <= 0) return undefined;

    if (rangePart === '*') {
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }

    const rangeMatch = rangePart.match(/^([a-z0-9]+)-([a-z0-9]+)$/);
    if (rangeMatch) {
      const start = normalizeCronValueToken(rangeMatch[1], kind);
      const end = normalizeCronValueToken(rangeMatch[2], kind);
      if (start === null || end === null || start < min || end > max || start > end) return undefined;
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }

    const single = normalizeCronValueToken(rangePart, kind);
    if (single === null || single < min || single > max) return undefined;
    values.add(single);
  }
  return values;
}

function normalizeCronExpression(spec) {
  if (!spec) return null;
  const normalized = spec.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('cron:')) return normalized.substring('cron:'.length).trim();
  if (normalized === '@hourly') return '0 * * * *';
  if (normalized === '@daily') return '0 0 * * *';
  if (normalized === '@weekly') return '0 0 * * 0';

  let match = normalized.match(/^hourly@(\d{1,2})$/);
  if (match) return `${Number(match[1])} * * * *`;

  match = normalized.match(/^daily@(\d{1,2}):(\d{2})$/);
  if (match) return `${Number(match[2])} ${Number(match[1])} * * *`;

  match = normalized.match(/^weekly@([a-z0-7,\-\/]+)(?:@|\s+)(\d{1,2}):(\d{2})$/);
  if (match) return `${Number(match[3])} ${Number(match[2])} * * ${match[1]}`;

  const parts = normalized.split(/\s+/);
  if (parts.length === 5) return normalized;
  return null;
}

function parseCronSchedule(spec) {
  const expression = normalizeCronExpression(spec);
  if (!expression) return null;
  const [minuteField, hourField, domField, monthField, dowField] = expression.split(/\s+/);
  const minutes = parseCronField(minuteField, 0, 59, 'minute');
  const hours = parseCronField(hourField, 0, 23, 'hour');
  const daysOfMonth = parseCronField(domField, 1, 31, 'dom');
  const months = parseCronField(monthField, 1, 12, 'month');
  const daysOfWeek = parseCronField(dowField, 0, 6, 'dow');
  if ([minutes, hours, daysOfMonth, months, daysOfWeek].includes(undefined)) return null;
  return { expression, minutes, hours, daysOfMonth, months, daysOfWeek };
}

function cronFieldMatches(values, current) {
  return !values || values.has(current);
}

function cronDayMatches(schedule, date) {
  const dayOfMonthMatch = cronFieldMatches(schedule.daysOfMonth, date.getDate());
  const dayOfWeekMatch = cronFieldMatches(schedule.daysOfWeek, date.getDay());
  if (!schedule.daysOfMonth && !schedule.daysOfWeek) return true;
  if (!schedule.daysOfMonth) return dayOfWeekMatch;
  if (!schedule.daysOfWeek) return dayOfMonthMatch;
  return dayOfMonthMatch || dayOfWeekMatch;
}

function cronScheduleMatches(schedule, date) {
  return cronFieldMatches(schedule.months, date.getMonth() + 1)
    && cronFieldMatches(schedule.hours, date.getHours())
    && cronFieldMatches(schedule.minutes, date.getMinutes())
    && cronDayMatches(schedule, date);
}

function inferNextCronDueAt(triggerSpec, baseIso = new Date().toISOString()) {
  const schedule = parseCronSchedule(triggerSpec);
  if (!schedule) return null;
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  const cursor = new Date(base.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
    if (cronScheduleMatches(schedule, cursor)) return cursor.toISOString();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function inferNextDueAt(triggerType, triggerSpec, baseIso = new Date().toISOString()) {
  const baseTime = new Date(baseIso).getTime();
  if (Number.isNaN(baseTime)) return null;
  if (triggerType === 'interval') {
    const durationSeconds = parseDurationSeconds(triggerSpec);
    if (!durationSeconds) return null;
    return new Date(baseTime + durationSeconds * 1000).toISOString();
  }
  if (triggerType === 'cron') {
    return inferNextCronDueAt(triggerSpec, baseIso);
  }
  return null;
}

function parseTriggerScanArgs(parts) {
  let ownerAgent = null;
  let atIso = null;
  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('at=')) atIso = part.substring('at='.length);
    else ownerAgent = part;
  }
  const resolvedAt = atIso || new Date().toISOString();
  return {
    ownerAgent,
    atIso: resolvedAt,
    invalidAt: Number.isNaN(new Date(resolvedAt).getTime()) ? resolvedAt : null,
  };
}

function inferTriggerTypeFromSpec(spec) {
  if (!spec) return null;
  if (parseDurationSeconds(spec)) return 'interval';
  if (normalizeCronExpression(spec)) return 'cron';
  return null;
}

function defaultThreadId(taskId, focusId = null, threadId = null) {
  if (threadId) return threadId;
  if (focusId) return `focus:${focusId}`;
  return `task:${taskId}`;
}

function parseTriggerCreateParts(parts) {
  let focusId = null;
  let threadId = null;
  let intent = 'generic';
  let note = null;
  const specTokens = [];

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
    else if (part.startsWith('thread=')) threadId = part.substring('thread='.length);
    else if (part.startsWith('intent=')) intent = part.substring('intent='.length) || 'generic';
    else if (part.startsWith('note=')) note = part.substring('note='.length) || null;
    else specTokens.push(part);
  }

  return { focusId, threadId, intent, note, specTokens };
}

function createTriggerRecord(taskId, ctx, ownerAgent, triggerType, triggerSpec, options = {}) {
  const now = new Date().toISOString();
  const normalizedThreadId = options.thread_id || (options.focus_id ? `focus:${options.focus_id}` : null);
  const trigger = {
    schema: 'atf.trigger.v1',
    trigger_id: generateId('TRG'),
    task_id: ctx.short_id || ctx.task_id,
    focus_id: options.focus_id || null,
    thread_id: normalizedThreadId,
    owner_agent: ownerAgent,
    trigger_type: triggerType,
    trigger_spec: triggerSpec,
    intent: options.intent || 'generic',
    note: options.note || null,
    status: 'active',
    created_at: now,
    updated_at: now,
    runtime: {
      fire_count: 0,
      last_fired_at: null,
      last_source_type: null,
      last_source_ref: null,
      last_note: null,
      pending_fire_id: null,
      last_consumed_at: null,
      last_settled_at: null,
      last_settled_status: null,
      last_result: null,
      next_due_at: inferNextDueAt(triggerType, triggerSpec, now),
    },
    history: [
      {
        event: 'created',
        by: ownerAgent,
        at: now,
        note: `${options.intent || 'generic'} ${triggerType}:${triggerSpec}`.trim(),
      },
    ],
  };
  saveTrigger(taskId, trigger);
  return trigger;
}

function parseSharedEntryParts(parts) {
  let focusId = null;
  let threadId = null;
  const tags = new Set();
  const contentTokens = [];

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
    else if (part.startsWith('thread=')) threadId = part.substring('thread='.length);
    else if (part.startsWith('tags=')) {
      for (const tag of part.substring('tags='.length).split(',')) {
        const normalized = tag.trim();
        if (normalized) tags.add(normalized);
      }
    } else if (part.startsWith('tag=')) {
      const normalized = part.substring('tag='.length).trim();
      if (normalized) tags.add(normalized);
    } else {
      contentTokens.push(part);
    }
  }

  return {
    focusId,
    threadId,
    tags: [...tags],
    contentTokens,
  };
}

function parseSharedListFilters(parts) {
  let entryType = null;
  let focusId = null;
  let threadId = null;
  let author = null;
  let tag = null;

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
    else if (part.startsWith('thread=')) threadId = part.substring('thread='.length);
    else if (part.startsWith('author=')) author = part.substring('author='.length);
    else if (part.startsWith('tag=')) tag = part.substring('tag='.length);
    else entryType = part;
  }

  return { entryType, focusId, threadId, author, tag };
}

function normalizeTriggerExecutionMode(mode) {
  if (!mode) return null;
  const normalized = mode.trim().toLowerCase().replace(/-/g, '_');
  return TRIGGER_EXECUTION_MODES.has(normalized) ? normalized : null;
}

function inferTriggerExecutionMode(trigger, fire = null) {
  const intent = fire?.intent || trigger?.intent || 'generic';
  if (intent === 'follow_up' || intent === 'review') return 'pending_task';
  const triggerType = fire?.trigger_type || trigger?.trigger_type;
  if (['interval', 'cron', 'on_message', 'on_status_change', 'on_blocked'].includes(triggerType)) return 'pending_task';
  return 'pending_task';
}

function parseTriggerExecuteArgs(parts) {
  let target = null;
  let executor = 'trigger-executor';
  let mode = null;
  let limit = null;
  let note = null;
  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('mode=')) mode = normalizeTriggerExecutionMode(part.substring('mode='.length));
    else if (part.startsWith('limit=')) {
      const value = Number(part.substring('limit='.length));
      if (Number.isFinite(value) && value > 0) limit = Math.floor(value);
    } else if (part.startsWith('note=')) note = part.substring('note='.length) || null;
    else if (part.startsWith('executor=')) executor = part.substring('executor='.length) || executor;
    else if (!target) target = part;
    else executor = part;
  }
  return { target, executor, mode, limit, note };
}

function readTaskMessages(taskId) {
  ensureMessageDirs(taskId);
  return readJsonCollection(messagesDir(taskId))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

function readTaskReceipts(taskId) {
  ensureMessageDirs(taskId);
  return readJsonCollection(receiptsDir(taskId))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

function messagePath(taskId, messageId) {
  ensureMessageDirs(taskId);
  return `${messagesDir(taskId)}/${messageId}.json`;
}

function receiptPath(taskId, receiptId) {
  ensureMessageDirs(taskId);
  return `${receiptsDir(taskId)}/${receiptId}.json`;
}

function readMessage(taskId, messageId) {
  return loadJson(messagePath(taskId, messageId));
}

function saveMessage(taskId, message) {
  saveJson(messagePath(taskId, message.message_id), message);
}

function saveReceipt(taskId, receipt) {
  saveJson(receiptPath(taskId, receipt.receipt_id), receipt);
}

function effectiveMessageStatus(message) {
  if (!message) return 'unknown';
  if (message.status === 'sent' && message.expires_at && new Date(message.expires_at) < new Date()) return 'expired';
  return message.status || 'sent';
}

function receiptSummary(receipts) {
  if (!receipts.length) return '-';
  return receipts.map(r => `${r.receipt_type}:${r.from_agent}`).join(', ');
}

function summarizeThreads(messages) {
  const threads = new Map();
  for (const message of messages) {
    if (!threads.has(message.thread_id)) threads.set(message.thread_id, []);
    threads.get(message.thread_id).push(message);
  }

  return [...threads.entries()]
    .map(([threadId, items]) => {
      const sorted = [...items].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      const latest = sorted[sorted.length - 1];
      const participants = [...new Set(sorted.flatMap(item => [item.from_agent, item.to_agent]).filter(Boolean))].sort();
      const blockerCount = sorted.filter(item => item.message_type === 'blocker').length;
      const decisionCount = sorted.filter(item => item.message_type === 'decision_request').length;
      const pendingCount = sorted.filter(item => effectiveMessageStatus(item) === 'sent').length;
      return {
        thread_id: threadId,
        total: sorted.length,
        participants,
        latest,
        blocker_count: blockerCount,
        decision_count: decisionCount,
        pending_count: pendingCount,
      };
    })
    .sort((a, b) => (b.latest?.created_at || '').localeCompare(a.latest?.created_at || ''));
}

function focusDir(taskId) {
  return `${taskDirPath(taskId)}/focus-items`;
}

function ensureFocusDir(taskId) {
  const dir = focusDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function focusPath(taskId, focusId) {
  ensureFocusDir(taskId);
  return `${focusDir(taskId)}/${focusId}.json`;
}

function readTaskFocus(taskId) {
  ensureFocusDir(taskId);
  return readJsonCollection(focusDir(taskId))
    .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
}

function readFocus(taskId, focusId) {
  return loadJson(focusPath(taskId, focusId));
}

function saveFocus(taskId, focus) {
  focus.updated_at = new Date().toISOString();
  saveJson(focusPath(taskId, focus.focus_id), focus);
}

function sharedContextPath(taskId) {
  return `${taskDirPath(taskId)}/shared-context.json`;
}

function ensureSharedContext(taskId, shortId = null) {
  const p = sharedContextPath(taskId);
  if (!fs.existsSync(p)) {
    saveJson(p, {
      schema: 'atf.shared-context.v1',
      task_id: shortId || taskId,
      updated_at: new Date().toISOString(),
      entries: [],
    });
  }
}

function readSharedContext(taskId, shortId = null) {
  ensureSharedContext(taskId, shortId);
  return loadJson(sharedContextPath(taskId));
}

function writeSharedContext(taskId, sharedContext) {
  sharedContext.updated_at = new Date().toISOString();
  saveJson(sharedContextPath(taskId), sharedContext);
}

function triggersDir(taskId) {
  return `${taskDirPath(taskId)}/triggers`;
}

function ensureTriggersDir(taskId) {
  const dir = triggersDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function triggerPath(taskId, triggerId) {
  ensureTriggersDir(taskId);
  return `${triggersDir(taskId)}/${triggerId}.json`;
}

function triggerFiresDir(taskId) {
  return `${taskDirPath(taskId)}/trigger-fires`;
}

function ensureTriggerFiresDir(taskId) {
  const dir = triggerFiresDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function triggerFirePath(taskId, fireId) {
  ensureTriggerFiresDir(taskId);
  return `${triggerFiresDir(taskId)}/${fireId}.json`;
}

function triggerExecutionsDir(taskId) {
  return `${taskDirPath(taskId)}/trigger-executions`;
}

function ensureTriggerExecutionsDir(taskId) {
  const dir = triggerExecutionsDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function triggerExecutionPath(taskId, executionId) {
  ensureTriggerExecutionsDir(taskId);
  return `${triggerExecutionsDir(taskId)}/${executionId}.json`;
}

function readTaskTriggers(taskId) {
  ensureTriggersDir(taskId);
  return readJsonCollection(triggersDir(taskId))
    .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
}

function readTrigger(taskId, triggerId) {
  return loadJson(triggerPath(taskId, triggerId));
}

function readTaskTriggerFires(taskId) {
  ensureTriggerFiresDir(taskId);
  return readJsonCollection(triggerFiresDir(taskId))
    .sort((a, b) => (a.fired_at || '').localeCompare(b.fired_at || ''));
}

function readTriggerFire(taskId, fireId) {
  return loadJson(triggerFirePath(taskId, fireId));
}

function readTaskTriggerExecutions(taskId) {
  ensureTriggerExecutionsDir(taskId);
  return readJsonCollection(triggerExecutionsDir(taskId))
    .sort((a, b) => (a.dispatched_at || a.created_at || '').localeCompare(b.dispatched_at || b.created_at || ''));
}

function readTriggerExecution(taskId, executionId) {
  return loadJson(triggerExecutionPath(taskId, executionId));
}

function triggerInboxPath(agent) {
  return `${TRIGGER_INBOX_DIR}/${agent}.json`;
}

function resolveAgentWorkspace(agent) {
  return AGENT_WORKSPACES[agent] || DEFAULT_AGENT_WORKSPACE;
}

function refreshTriggerIndexes() {
  const now = new Date().toISOString();
  const pendingFires = [];
  const inboxes = {};
  for (const task of getAllTasks()) {
    const taskId = task.short_id || task.task_id;
    for (const fire of readTaskTriggerFires(taskId)) {
      if (fire.status !== 'pending') continue;
      pendingFires.push(fire);
      if (!inboxes[fire.owner_agent]) inboxes[fire.owner_agent] = [];
      inboxes[fire.owner_agent].push(fire);
    }
  }
  pendingFires.sort((a, b) => (a.fired_at || '').localeCompare(b.fired_at || ''));
  saveJson(PENDING_TRIGGER_FIRES_FILE, {
    schema: 'atf.pending-trigger-fires.v1',
    updated_at: now,
    total: pendingFires.length,
    items: pendingFires,
  });

  if (!fs.existsSync(TRIGGER_INBOX_DIR)) fs.mkdirSync(TRIGGER_INBOX_DIR, { recursive: true });
  for (const file of fs.readdirSync(TRIGGER_INBOX_DIR)) {
    if (file.endsWith('.json')) fs.unlinkSync(path.join(TRIGGER_INBOX_DIR, file));
  }
  for (const [agent, items] of Object.entries(inboxes)) {
    items.sort((a, b) => (a.fired_at || '').localeCompare(b.fired_at || ''));
    saveJson(triggerInboxPath(agent), {
      schema: 'atf.trigger-inbox.v1',
      updated_at: now,
      agent,
      total: items.length,
      items,
    });
  }
}

function saveTrigger(taskId, trigger) {
  trigger.updated_at = new Date().toISOString();
  saveJson(triggerPath(taskId, trigger.trigger_id), trigger);
}

function saveTriggerFire(taskId, fire) {
  fire.updated_at = new Date().toISOString();
  saveJson(triggerFirePath(taskId, fire.fire_id), fire);
}

function saveTriggerExecution(taskId, execution) {
  execution.updated_at = new Date().toISOString();
  saveJson(triggerExecutionPath(taskId, execution.execution_id), execution);
}

function normalizeTriggerRuntime(trigger, baseIso = new Date().toISOString()) {
  const runtime = trigger.runtime || {};
  return {
    fire_count: runtime.fire_count || 0,
    last_fired_at: runtime.last_fired_at || null,
    last_source_type: runtime.last_source_type || null,
    last_source_ref: runtime.last_source_ref || null,
    last_note: runtime.last_note || null,
    pending_fire_id: runtime.pending_fire_id || null,
    last_consumed_at: runtime.last_consumed_at || null,
    last_settled_at: runtime.last_settled_at || null,
    last_settled_status: runtime.last_settled_status || null,
    last_result: runtime.last_result || null,
    next_due_at: runtime.next_due_at || inferNextDueAt(trigger.trigger_type, trigger.trigger_spec, baseIso),
  };
}

function recordTriggerFire(taskId, trigger, options = {}) {
  const firedAt = options.fired_at || new Date().toISOString();
  const runtime = normalizeTriggerRuntime(trigger, firedAt);
  const fire = {
    schema: 'atf.trigger-fire.v1',
    fire_id: generateId('TGF'),
    trigger_id: trigger.trigger_id,
    task_id: trigger.task_id,
    focus_id: trigger.focus_id || null,
    thread_id: options.thread_id || trigger.thread_id || (trigger.focus_id ? `focus:${trigger.focus_id}` : null),
    owner_agent: trigger.owner_agent,
    trigger_type: trigger.trigger_type,
    intent: trigger.intent || 'generic',
    source_type: options.source_type || 'manual',
    source_ref: options.source_ref || null,
    note: options.note || null,
    status: 'pending',
    fired_at: firedAt,
    updated_at: firedAt,
    consumed_at: null,
    consumed_by: null,
    result: null,
  };
  saveTriggerFire(taskId, fire);

  trigger.runtime = {
    ...runtime,
    fire_count: runtime.fire_count + 1,
    last_fired_at: firedAt,
    last_source_type: fire.source_type,
    last_source_ref: fire.source_ref,
    last_note: fire.note,
    pending_fire_id: fire.fire_id,
    next_due_at: inferNextDueAt(trigger.trigger_type, trigger.trigger_spec, firedAt),
  };
  trigger.history = appendHistoryEvent(trigger.history, {
    event: 'fired',
    by: options.fired_by || 'runtime',
    at: firedAt,
    note: `${fire.source_type}${fire.source_ref ? `:${fire.source_ref}` : ''}${fire.note ? ` ${fire.note}` : ''}`.trim(),
    fire_id: fire.fire_id,
  });
  saveTrigger(taskId, trigger);

  appendNotificationHistory(taskId, {
    event: 'trigger_fired',
    trigger_id: trigger.trigger_id,
    fire_id: fire.fire_id,
    trigger_type: trigger.trigger_type,
    owner_agent: trigger.owner_agent,
    source_type: fire.source_type,
    source_ref: fire.source_ref,
    focus_id: trigger.focus_id || null,
    at: firedAt,
  });
  refreshTriggerIndexes();
  return fire;
}

function fireMatchingTriggers(taskId, matcher, buildOptions) {
  const fired = [];
  for (const trigger of readTaskTriggers(taskId)) {
    if (trigger.status !== 'active') continue;
    if (!matcher(trigger)) continue;
    const options = typeof buildOptions === 'function' ? buildOptions(trigger) : (buildOptions || {});
    fired.push(recordTriggerFire(taskId, trigger, options));
  }
  return fired;
}

function hasPendingTriggerFire(taskId, trigger) {
  const runtime = normalizeTriggerRuntime(trigger);
  if (!runtime.pending_fire_id) return false;
  const fire = readTriggerFire(taskId, runtime.pending_fire_id);
  return !!(fire && fire.status === 'pending');
}

function settleTriggerFire(taskId, fire, trigger, status, consumer, result = null) {
  const now = new Date().toISOString();
  fire.status = status;
  fire.consumed_at = now;
  fire.consumed_by = consumer;
  fire.result = result || null;
  saveTriggerFire(taskId, fire);

  const runtime = normalizeTriggerRuntime(trigger, now);
  trigger.runtime = {
    ...runtime,
    pending_fire_id: runtime.pending_fire_id === fire.fire_id ? null : runtime.pending_fire_id,
    last_consumed_at: status === 'consumed' ? now : runtime.last_consumed_at,
    last_settled_at: now,
    last_settled_status: status,
    last_result: result || status,
  };
  trigger.history = appendHistoryEvent(trigger.history, {
    event: status === 'consumed' ? 'fire_consumed' : 'fire_ignored',
    by: consumer,
    at: now,
    note: `${fire.fire_id}${result ? ` ${result}` : ''}`,
  });
  saveTrigger(taskId, trigger);
  appendNotificationHistory(taskId, {
    event: status === 'consumed' ? 'trigger_fire_consumed' : 'trigger_fire_ignored',
    trigger_id: trigger.trigger_id,
    fire_id: fire.fire_id,
    consumer,
    at: now,
  });
  refreshTriggerIndexes();
  return fire;
}

function buildPendingTaskFromTrigger(ctx, trigger, fire, executor, note = null, dispatchedAt = new Date().toISOString()) {
  return {
    task_id: ctx.short_id || ctx.task_id,
    assigned_to: fire.owner_agent || trigger.owner_agent || ctx.assigned_to || null,
    description: ctx.description,
    instructions: ctx.instructions || null,
    created_by: executor,
    created_at: dispatchedAt,
    source: 'trigger_fire',
    trigger_fire_id: fire.fire_id,
    trigger_id: fire.trigger_id,
    trigger_type: fire.trigger_type || trigger.trigger_type,
    trigger_intent: fire.intent || trigger.intent || 'generic',
    source_type: fire.source_type || null,
    source_ref: fire.source_ref || null,
    focus_id: fire.focus_id || trigger.focus_id || null,
    thread_id: fire.thread_id || trigger.thread_id || null,
    note: note || fire.note || trigger.note || null,
  };
}

function executeTriggerFire(taskId, fire, trigger, ctx, options = {}) {
  const now = new Date().toISOString();
  const mode = normalizeTriggerExecutionMode(options.mode) || inferTriggerExecutionMode(trigger, fire);
  if (!TRIGGER_EXECUTION_MODES.has(mode)) {
    throw new Error(`unsupported execution mode: ${options.mode || mode}`);
  }
  if (fire.status !== 'pending') {
    throw new Error(`trigger fire is not pending: ${fire.fire_id}`);
  }

  const execution = {
    schema: 'atf.trigger-execution.v1',
    execution_id: generateId('TEX'),
    fire_id: fire.fire_id,
    trigger_id: fire.trigger_id,
    task_id: ctx.short_id || ctx.task_id,
    focus_id: fire.focus_id || trigger.focus_id || null,
    thread_id: fire.thread_id || trigger.thread_id || null,
    owner_agent: fire.owner_agent || trigger.owner_agent || null,
    execution_mode: mode,
    executor: options.executor || 'trigger-executor',
    status: 'dispatched',
    created_at: now,
    dispatched_at: now,
    note: options.note || null,
    artifacts: {},
    payload: null,
  };

  if (mode === 'pending_task') {
    const pendingTaskPath = `${taskDirPath(taskId)}/pending-task.json`;
    const pendingTask = buildPendingTaskFromTrigger(ctx, trigger, fire, execution.executor, execution.note, now);
    fs.writeFileSync(pendingTaskPath, JSON.stringify(pendingTask, null, 2));
    execution.payload = pendingTask;
    execution.artifacts.pending_task_path = pendingTaskPath;
  } else if (mode === 'message') {
    const message = {
      schema: 'atf.message.v1',
      message_id: generateId('MSG'),
      task_id: ctx.short_id || ctx.task_id,
      thread_id: fire.thread_id || trigger.thread_id || defaultThreadId(ctx.short_id || ctx.task_id, fire.focus_id || trigger.focus_id || null, null),
      focus_id: fire.focus_id || trigger.focus_id || null,
      reply_to_message_id: null,
      from_agent: execution.executor,
      to_agent: fire.owner_agent || trigger.owner_agent,
      message_type: 'info',
      body: options.note || fire.note || trigger.note || `trigger fire ${fire.fire_id} dispatched`,
      created_at: now,
      ttl_seconds: 24 * 60 * 60,
      expires_at: new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'sent',
      receipt_ids: [],
      last_receipt_type: null,
      last_receipt_at: null,
    };
    saveMessage(taskId, message);
    execution.payload = message;
    execution.artifacts.message_id = message.message_id;
  } else {
    execution.payload = {
      task_id: ctx.short_id || ctx.task_id,
      trigger_fire_id: fire.fire_id,
      action: 'noop',
    };
  }

  fire.execution_id = execution.execution_id;
  fire.execution_mode = mode;
  fire.executed_at = now;
  fire.executed_by = execution.executor;
  if (execution.note) fire.execution_note = execution.note;
  saveTriggerExecution(taskId, execution);

  trigger.history = appendHistoryEvent(trigger.history, {
    event: 'executed',
    by: execution.executor,
    at: now,
    note: `${execution.execution_id} ${mode}${execution.note ? ` ${execution.note}` : ''}`.trim(),
    fire_id: fire.fire_id,
  });
  saveTrigger(taskId, trigger);
  appendNotificationHistory(taskId, {
    event: 'trigger_fire_executed',
    trigger_id: trigger.trigger_id,
    fire_id: fire.fire_id,
    execution_id: execution.execution_id,
    execution_mode: mode,
    executor: execution.executor,
    at: now,
  });

  settleTriggerFire(taskId, fire, trigger, 'consumed', execution.executor, `executed:${mode}`);
  return execution;
}

function archiveTriggersForFocus(taskId, focusId, reason) {
  if (!focusId) return [];
  const now = new Date().toISOString();
  const archived = [];
  for (const trigger of readTaskTriggers(taskId)) {
    if (trigger.focus_id !== focusId || trigger.status !== 'active') continue;
    const runtime = normalizeTriggerRuntime(trigger, now);
    if (runtime.pending_fire_id) {
      const pendingFire = readTriggerFire(taskId, runtime.pending_fire_id);
      if (pendingFire && pendingFire.status === 'pending') {
        settleTriggerFire(taskId, pendingFire, trigger, 'ignored', 'focus', reason);
      }
    }
    trigger.status = 'archived';
    trigger.history = appendHistoryEvent(trigger.history, {
      event: 'auto_archived',
      by: 'focus',
      at: now,
      note: reason,
    });
    trigger.runtime = { ...normalizeTriggerRuntime(trigger, now), pending_fire_id: null };
    saveTrigger(taskId, trigger);
    archived.push(trigger.trigger_id);
  }
  return archived;
}

function reflectionsDir(taskId) {
  return `${taskDirPath(taskId)}/reflections`;
}

function ensureReflectionsDir(taskId) {
  const dir = reflectionsDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function reflectionPath(taskId, reflectionId) {
  ensureReflectionsDir(taskId);
  return `${reflectionsDir(taskId)}/${reflectionId}.json`;
}

function readTaskReflections(taskId) {
  ensureReflectionsDir(taskId);
  return readJsonCollection(reflectionsDir(taskId))
    .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
}

function readReflection(taskId, reflectionId) {
  return loadJson(reflectionPath(taskId, reflectionId));
}

function saveReflection(taskId, reflection) {
  reflection.updated_at = new Date().toISOString();
  saveJson(reflectionPath(taskId, reflection.reflection_id), reflection);
}

function createReflection(taskId, ctx, author, field, content, options = {}) {
  const now = new Date().toISOString();
  const reflection = {
    schema: 'atf.reflection.v1',
    reflection_id: generateId('RFL'),
    task_id: ctx.short_id || ctx.task_id,
    focus_id: options.focus_id || null,
    trigger_id: options.trigger_id || null,
    fire_id: options.fire_id || null,
    source_type: options.source_type || null,
    source_ref: options.source_ref || null,
    author,
    field,
    content,
    created_at: now,
    updated_at: now,
  };
  saveReflection(taskId, reflection);
  appendNotificationHistory(taskId, {
    event: 'reflection_added',
    reflection_id: reflection.reflection_id,
    field: reflection.field,
    author: reflection.author,
    focus_id: reflection.focus_id,
    trigger_id: reflection.trigger_id,
    fire_id: reflection.fire_id,
    at: now,
  });
  return reflection;
}

// ============================================================
// 任务读写
// ============================================================
function getAllTasks() {
  const tasks = [];
  if (!fs.existsSync(TASKS_DIR)) return tasks;
  const dirs = fs.readdirSync(TASKS_DIR);
  for (const dir of dirs) {
    if (dir === 'dlq' || dir.endsWith('.json')) continue;
    const ctx = loadJson(`${TASKS_DIR}/${dir}/ctx.json`);
    if (ctx) tasks.push(ctx);
  }
  return tasks;
}

function getNextTaskNum() {
  const tasks = getAllTasks();
  if (!tasks.length) return 1;
  return tasks.reduce((max, t) => Math.max(max, t.taskNum || 0), 0) + 1;
}

// ============================================================
// 创建任务目录结构
// ============================================================
function createTaskDir(taskNum, description) {
  const safeDesc = description.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').substring(0, 60);
  const dirName  = `${taskNum}-${safeDesc}`;
  const taskPath = `${TASKS_DIR}/${dirName}`;
  if (fs.existsSync(taskPath)) return { dirName, taskPath };
  fs.mkdirSync(taskPath, { recursive: true });
  const subdirs = ['research', 'implementation', 'notes', 'notifications', 'messages', 'receipts', 'focus-items', 'triggers', 'trigger-fires', 'trigger-executions', 'reflections'];
  for (const s of subdirs) fs.mkdirSync(`${taskPath}/${s}`, { recursive: true });
  fs.writeFileSync(`${taskPath}/README.md`, `# ${taskNum} - ${description}\n\n**状态**: created\n`);
  fs.writeFileSync(`${taskPath}/progress.md`, `## 进度记录\n\n### ${new Date().toISOString()}\n- 任务创建\n`);
  return { dirName, taskPath };
}

function initCtx(taskNum, description, options = {}) {
  const { dirName } = createTaskDir(taskNum, description);
  const taskId = dirName;
  const ctx = {
    task_id: `T-${String(taskNum).padStart(3, '0')}`,
    short_id: `T-${String(taskNum).padStart(3, '0')}`,
    taskNum,
    description,
    status: 'created',
    created_by: options.created_by || 'pinchymeow',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    parent_id: options.parent_id || null,
    sub_tasks: [],
    assigned_to: options.assigned_to || null,
    protocol: {
      confirm_timeout: options.confirm_timeout || 300,
      final_timeout: options.final_timeout || 7200,
      retry_count: 0,
      max_retries: options.max_retries || 3,
      delivery_status: 'pending', // pending → delivered | failed
      delivery_attempts: 0,
    },
    inputs: options.inputs || {},
    outputs: options.outputs || {},
    shared_context: `${TASKS_DIR}/${taskId}/shared-context.json`,
    dri: options.dri || options.assigned_to || null, // DRI：唯一责任人
    dlq_entry: null,
  };
  writeCtx(taskId, ctx);
  saveJson(`${taskDirPath(taskId)}/notifications/history.json`, []);
  ensureSharedContext(taskId, ctx.short_id);
  return { taskId, dirName, ctx };
}

// ============================================================
// fan-out
// ============================================================
function fanOut(parentId, agents) {
  const parent = loadJson(ctxPath(parentId));
  if (!parent) { console.error(`❌ 父任务不存在: ${parentId}`); return; }
  const subtasks = [];
  const startNum = getNextTaskNum();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const num = startNum + i;
    const { taskId, dirName } = initCtx(num, `${parent.description} [${agent}]`, {
      created_by: 'pinchymeow', parent_id: parentId, assigned_to: agent,
      inputs: { parent_task: parentId },
    });
    subtasks.push({ agent, taskId, dirName, taskNum: num });
    console.log(`  ✅ 创建子任务 ${dirName} → ${agent}`);
  }
  parent.sub_tasks = [...(parent.sub_tasks||[]), ...subtasks.map(s => s.taskId)];
  writeCtx(parentId, parent);
  return subtasks;
}

// ============================================================
// CLI 入口
// ============================================================
const [,, cmd, ...args] = process.argv;

if (!cmd) {
  console.log(`
ATF CLI v2
用法:
  atf create <描述>                       创建任务
  atf list                                列出所有任务
  atf status <taskId>                    查看状态（+投递状态+DRI）
  atf assign <taskId> <agent>            指派
  atf update <taskId> <status>           更新状态
  atf fan-out <taskId> <agent1,agent2>   fan-out 分发
  atf delivered <taskId>                 手动标记已送达
  atf dri <taskId> [agent]              设置/查看 DRI（唯一责任人）
  atf ctx <taskId>                       查看 ctx.json
  atf nextnum                            下一个编号
  atf dlq list                           列出 DLQ 任务
  atf dlq show <taskId>                  查看 DLQ 详情
  atf dlq retry <taskId>                 重试（写 pending-task.json）
  atf dlq skip <taskId>                  跳过（archived）
  atf dlq cancel <taskId>               取消
  atf focus add <taskId> <owner> <title>        创建 Focus Item
  atf focus list <taskId> [owner]               列出 Focus Items
  atf focus show <taskId> <focusId>             查看 Focus Item
  atf focus update <taskId> <focusId> <status> [nextAction] 更新 Focus
  atf trigger add <taskId> <owner> <type> <spec> [focus=FOC-...] 创建 Trigger
  atf trigger list <taskId> [owner]             列出 Triggers
  atf trigger inbox <agent> [taskId]            查看 agent 待处理 Trigger fires
  atf trigger rebuild-index                     重建全局 Trigger fire 索引
  atf trigger due <taskId> [owner] [at=ISO]     查看已到期 Trigger
  atf trigger scan <taskId> [owner] [at=ISO]    扫描并触发当前任务的已到期 Trigger
  atf trigger scan-all [owner] [at=ISO]         扫描并触发所有任务的已到期 Trigger
  atf trigger show <taskId> <triggerId>         查看 Trigger
  atf trigger update <taskId> <triggerId> <status> 更新 Trigger
  atf trigger fire <taskId> <triggerId> <sourceType> [ref=...] [note] 手动记录 Trigger firing
  atf trigger fires <taskId> [triggerId] [status] 查看 Trigger firing 记录
  atf trigger consume <taskId> <fireId> <consumer> [result] 标记 Trigger firing 已消费
  atf trigger ignore <taskId> <fireId> <consumer> [reason] 标记 Trigger firing 已忽略
  atf reflect add <taskId> <author> <field> <内容> [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...] 添加 Reflection
  atf reflect from-fire <taskId> <fireId> <author> <field> <内容>  从 Trigger fire 创建 Reflection
  atf reflect list <taskId> [field] [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...]      查看 Reflections
  atf reflect show <taskId> <reflectionId>               查看 Reflection
  atf shared add <taskId> <author> <type> <内容> 添加 shared context
  atf shared list <taskId> [type]               查看 shared context
  atf msg send <taskId> <from> <to> <type> <内容> [focus=FOC-...] [thread=...] [reply=MSG-...]  发送任务消息
  atf msg inbox <agent> [taskId]        查看 agent 收件箱
  atf msg thread <taskId> [threadId|focus=FOC-...]    查看任务消息线程
  atf msg ack <taskId> <messageId> <agent> [receiptType] [note]  写回执
  atf msg receipts <taskId> <messageId> 查看消息回执
  atf learnings add errors|learnings|features <内容>  即时记录
  atf learnings list                     查看所有 learnings
  atf learnings scan                    扫描可 promote 条目
  atf learnings promote                 执行 promote → MEMORY
  atf block <taskId> <question>         阻塞任务，等待 Vinson 决策
  atf decide <taskId> <answer>          Vinson 回答，继续执行
  atf revise <taskId> <feedback>        Vinson 不满意，打回重做
`);
  process.exit(0);
}

switch (cmd) {
  case 'list': {
    const tasks = getAllTasks().sort((a, b) => (a.taskNum||0)-(b.taskNum||0));
    console.log(`\n任务列表 (共 ${tasks.length} 个)\n`);
    console.log('编号     状态        指派        描述');
    console.log('─'.repeat(80));
    for (const t of tasks) {
      const num = String(t.taskNum||'?').padStart(3,' ');
      const sts = (t.status||'?').padEnd(10);
      const agt = (t.assigned_to||'-').padEnd(10);
      console.log(`T-${num}  ${sts}  ${agt}  ${(t.description||'').substring(0,45)}`);
    }
    console.log('');
    break;
  }
  case 'nextnum': console.log(`下一个编号: ${getNextTaskNum()}`); break;

  case 'create': {
    const description = args.join(' ');
    if (!description) { console.error('用法: atf create <描述>'); break; }
    const num = getNextTaskNum();
    const { taskId, dirName, ctx } = initCtx(num, description);
    console.log(`\n✅ 任务已创建: ${dirName}`);
    console.log(`   task_id: ${ctx.task_id}  |  status: ${ctx.status}`);
    console.log(`   confirm_timeout: ${ctx.protocol.confirm_timeout}s  |  final_timeout: ${ctx.protocol.final_timeout}s`);
    break;
  }

  case 'ctx': {
    const taskId = args[0];
    if (!taskId) { console.error('用法: atf ctx <taskId>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    console.log(JSON.stringify(ctx, null, 2));
    break;
  }

  case 'status': {
    const taskId = args[0];
    if (!taskId) { console.error('用法: atf status <taskId>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const ds = ctx.protocol?.delivery_status || 'N/A';
    const da = ctx.protocol?.delivery_attempts || 0;
    const dri = ctx.dri || '-';
    console.log(`\n任务: ${ctx.task_id} - ${ctx.description}`);
    console.log(`状态: ${ctx.status}  |  指派: ${ctx.assigned_to||'-'}  |  DRI: ${dri}`);
    console.log(`投递: ${ds} (${da}次)  |  重试: ${ctx.protocol?.retry_count||0}/${ctx.protocol?.max_retries||3}`);
    console.log(`创建: ${ctx.created_at}  |  更新: ${ctx.updated_at}`);
    if (ctx.sub_tasks.length) console.log(`子任务: ${ctx.sub_tasks.join(', ')}`);
    if (ctx.parent_id) console.log(`父任务: ${ctx.parent_id}`);
    console.log('');
    break;
  }

  case 'assign': {
    const [taskId, agent] = args;
    if (!taskId || !agent) { console.error('用法: atf assign <taskId> <agent>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    ctx.assigned_to = agent; ctx.status = 'assigned';
    if (!ctx.protocol) ctx.protocol = {};
    ctx.protocol.delivery_status = 'pending';
    ctx.protocol.delivery_attempts = 0;
    writeCtx(taskId, ctx);
    // 写 pending-task.json 通知 agent
    const dir = dirOfTaskId(taskId);
    const ws = `${TASKS_DIR}/${dir}`;
    const pending = {
      task_id: taskId,
      assigned_to: agent,
      description: ctx.description,
      instructions: ctx.instructions || null,
      created_by: ctx.assigned_to || 'pinchymeow',
      created_at: new Date().toISOString()
    };
    fs.writeFileSync(`${ws}/pending-task.json`, JSON.stringify(pending, null, 2));
    console.log(`✅ 已指派 ${taskId} → ${agent}`);
    console.log(`   pending-task.json → ${ws}/pending-task.json`);
    break;
  }

  case 'update': {
    const [taskId, status] = args;
    if (!taskId || !status) { console.error('用法: atf update <taskId> <status>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const previousStatus = ctx.status;
    const now = new Date().toISOString();
    ctx.status = status; writeCtx(taskId, ctx);
    appendNotificationHistory(taskId, { event: 'status_change', from: previousStatus, status, at: now });
    const firedTriggers = fireMatchingTriggers(
      taskId,
      trigger => {
        if (trigger.focus_id) return false;
        if (trigger.trigger_type === 'on_status_change') return true;
        return status === 'blocked' && trigger.trigger_type === 'on_blocked';
      },
      trigger => ({
        source_type: status === 'blocked' && trigger.trigger_type === 'on_blocked' ? 'task_blocked' : 'task_status_change',
        source_ref: status,
        note: `${previousStatus || 'unknown'} -> ${status}`,
        fired_by: 'update',
      })
    );
    console.log(`✅ ${taskId} → ${status}`);
    if (firedTriggers.length) console.log(`   trigger fires: ${firedTriggers.map(f => f.fire_id).join(', ')}`);
    break;
  }

  case 'fan-out': {
    const [parentId, agentsStr] = args;
    if (!parentId || !agentsStr) { console.error('用法: atf fan-out <taskId> <agent1,agent2,...>'); break; }
    const agents = agentsStr.split(',').map(a => a.trim());
    const subtasks = fanOut(parentId, agents);
    if (subtasks) {
      console.log(`\n✅ fan-out 完成，创建 ${subtasks.length} 个子任务`);
      for (const s of subtasks) console.log(`   ${s.dirName} → ${s.agent}`);
    }
    break;
  }

  // =============================================================
  // Focus 命令 - 任务内工作焦点
  // =============================================================
  case 'focus': {
    const [sub, ...restArgs] = args;

    if (sub === 'add') {
      const [taskId, ownerAgent, ...titleParts] = restArgs;
      if (!taskId || !ownerAgent || !titleParts.length) {
        console.error('用法: atf focus add <taskId> <owner> <title>'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const now = new Date().toISOString();
      const focus = {
        schema: 'atf.focus.v1',
        focus_id: generateId('FOC'),
        task_id: ctx.short_id || ctx.task_id,
        title: titleParts.join(' '),
        status: 'open',
        owner_agent: ownerAgent,
        next_action: null,
        created_at: now,
        updated_at: now,
        history: [
          { event: 'created', by: ownerAgent, at: now, note: 'focus created' }
        ],
      };
      saveFocus(taskId, focus);
      console.log(`✅ 已创建 Focus ${focus.focus_id}`);
      console.log(`   任务: ${focus.task_id}  |  owner: ${focus.owner_agent}`);
      console.log(`   标题: ${focus.title}`);
      break;
    }

    if (sub === 'list') {
      const [taskId, ownerAgent] = restArgs;
      if (!taskId) { console.error('用法: atf focus list <taskId> [owner]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let focusItems = readTaskFocus(taskId);
      if (ownerAgent) focusItems = focusItems.filter(f => f.owner_agent === ownerAgent);
      if (!focusItems.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Focus Items`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Focus Items (${focusItems.length} 条)\n`);
      for (const focus of focusItems) {
        console.log(`${focus.focus_id}  ${focus.status}  owner:${focus.owner_agent}`);
        console.log(`  ${focus.title}`);
        if (focus.next_action) console.log(`  next: ${focus.next_action}`);
      }
      console.log('');
      break;
    }

    if (false && sub === 'summary') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('鐢ㄦ硶: atf reflect summary <taskId> [focus=FOC-...] [author=x]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`鉂?浠诲姟涓嶅瓨鍦? ${taskId}`); break; }
      let focusId = null;
      let author = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('author=')) author = part.substring('author='.length);
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`鉂?Focus 涓嶅瓨鍦? ${focusId}`); break;
      }
      let reflections = readTaskReflections(taskId);
      if (focusId) reflections = reflections.filter(r => r.focus_id === focusId);
      if (author) reflections = reflections.filter(r => r.author === author);
      if (!reflections.length) { console.log(`浠诲姟 ${ctx.short_id || ctx.task_id} 鏆傛棤 Reflections`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Reflection Summary\n`);
      for (const field of REFLECTION_FIELDS) {
        const items = reflections.filter(reflection => reflection.field === field);
        if (!items.length) continue;
        console.log(`${field}: ${items.length}`);
        for (const reflection of items.slice(-3)) {
          console.log(`  ${reflection.created_at}  ${reflection.author}${reflection.focus_id ? `  focus=${reflection.focus_id}` : ''}`);
          console.log(`  ${reflection.content}`);
        }
      }
      console.log('');
      break;
    }

    if (false && sub === 'summary') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf reflect summary <taskId> [focus=FOC-...] [author=x]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let focusId = null;
      let author = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('author=')) author = part.substring('author='.length);
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      let reflections = readTaskReflections(taskId);
      if (focusId) reflections = reflections.filter(r => r.focus_id === focusId);
      if (author) reflections = reflections.filter(r => r.author === author);
      if (!reflections.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Reflections`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Reflection Summary\n`);
      for (const field of REFLECTION_FIELDS) {
        const items = reflections.filter(reflection => reflection.field === field);
        if (!items.length) continue;
        console.log(`${field}: ${items.length}`);
        for (const reflection of items.slice(-3)) {
          console.log(`  ${reflection.created_at}  ${reflection.author}${reflection.focus_id ? `  focus=${reflection.focus_id}` : ''}`);
          console.log(`  ${reflection.content}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [taskId, focusId] = restArgs;
      if (!taskId || !focusId) { console.error('用法: atf focus show <taskId> <focusId>'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const focus = readFocus(taskId, focusId);
      if (!focus) { console.error(`❌ Focus 不存在: ${focusId}`); break; }
      console.log(JSON.stringify(focus, null, 2));
      break;
    }

    if (sub === 'update') {
      const [taskId, focusId, status, ...nextActionParts] = restArgs;
      if (!taskId || !focusId || !status) {
        console.error('用法: atf focus update <taskId> <focusId> <status> [nextAction]'); break;
      }
      if (!FOCUS_STATUSES.has(status)) {
        console.error(`Focus 状态: ${[...FOCUS_STATUSES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const focus = readFocus(taskId, focusId);
      if (!focus) { console.error(`❌ Focus 不存在: ${focusId}`); break; }
      const now = new Date().toISOString();
      const previousStatus = focus.status;
      focus.status = status;
      if (nextActionParts.length) focus.next_action = nextActionParts.join(' ');
      focus.history = [...(focus.history || []), {
        event: 'updated',
        by: 'cli',
        at: now,
        note: `status=${status}${nextActionParts.length ? ` next=${focus.next_action}` : ''}`,
      }];
      saveFocus(taskId, focus);
      const firedTriggers = fireMatchingTriggers(
        taskId,
        trigger => {
          if (trigger.focus_id !== focus.focus_id) return false;
          if (trigger.trigger_type === 'on_status_change') return true;
          return status === 'blocked' && trigger.trigger_type === 'on_blocked';
        },
        trigger => ({
          source_type: status === 'blocked' && trigger.trigger_type === 'on_blocked' ? 'focus_blocked' : 'focus_status_change',
          source_ref: focus.focus_id,
          note: `${previousStatus || 'unknown'} -> ${status}`,
          fired_by: 'focus',
        })
      );
      let archivedTriggers = [];
      if (status === 'done' || status === 'dropped') {
        archivedTriggers = archiveTriggersForFocus(taskId, focus.focus_id, `focus ${focus.focus_id} -> ${status}`);
      }
      console.log(`✅ Focus ${focus.focus_id} → ${focus.status}`);
      if (focus.next_action) console.log(`   next: ${focus.next_action}`);
      if (firedTriggers.length) console.log(`   trigger fires: ${firedTriggers.map(f => f.fire_id).join(', ')}`);
      if (archivedTriggers.length) console.log(`   archived triggers: ${archivedTriggers.join(', ')}`);
      break;
    }

    console.error('用法: atf focus add|list|show|update ...');
    break;
  }

  // =============================================================
  // shared 命令 - 任务级共享上下文
  // =============================================================
  case 'shared': {
    const [sub, ...restArgs] = args;

    if (sub === 'add') {
      const [taskId, author, entryType, ...contentParts] = restArgs;
      if (!taskId || !author || !entryType || !contentParts.length) {
        console.error('用法: atf shared add <taskId> <author> <type> <内容> [focus=FOC-...] [thread=...] [tag=x] [tags=a,b]'); break;
      }
      if (!SHARED_ENTRY_TYPES.has(entryType)) {
        console.error(`shared 类型: ${[...SHARED_ENTRY_TYPES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const { focusId, threadId, tags, contentTokens } = parseSharedEntryParts(contentParts);
      if (!contentTokens.length) {
        console.error('❌ shared content 不能为空'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`鉂?Focus 涓嶅瓨鍦? ${focusId}`); break;
      }
      const sharedContext = readSharedContext(taskId, ctx.short_id || ctx.task_id);
      const entry = {
        entry_id: generateId('CTX'),
        task_id: ctx.short_id || ctx.task_id,
        author,
        entry_type: entryType,
        focus_id: focusId,
        thread_id: defaultThreadId(ctx.short_id || ctx.task_id, focusId, threadId),
        tags,
        content: contentTokens.join(' '),
        created_at: new Date().toISOString(),
      };
      sharedContext.entries = [...(sharedContext.entries || []), entry];
      if (entry.focus_id) console.log(`   focus: ${entry.focus_id}`);
      if (entry.thread_id) console.log(`   thread: ${entry.thread_id}`);
      if (entry.tags.length) console.log(`   tags: ${entry.tags.join(', ')}`);
      writeSharedContext(taskId, sharedContext);
      console.log(`✅ 已写入 shared context ${entry.entry_id}`);
      console.log(`   任务: ${entry.task_id}  |  ${author} [${entry.entry_type}]`);
      break;
    }

    if (sub === 'list') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf shared list <taskId> [type] [focus=FOC-...] [thread=...] [author=x] [tag=x]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const { entryType, focusId, threadId, author, tag } = parseSharedListFilters(filterParts);
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`鉂?Focus 涓嶅瓨鍦? ${focusId}`); break;
      }
      const sharedContext = readSharedContext(taskId, ctx.short_id || ctx.task_id);
      let entries = sharedContext.entries || [];
      if (entryType) entries = entries.filter(e => e.entry_type === entryType);
      if (focusId) entries = entries.filter(e => e.focus_id === focusId);
      if (threadId) entries = entries.filter(e => e.thread_id === threadId);
      if (author) entries = entries.filter(e => e.author === author);
      if (tag) entries = entries.filter(e => (e.tags || []).includes(tag));
      if (!entries.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 shared context`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} shared context (${entries.length} 条)\n`);
      for (const entry of entries.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))) {
        console.log(`${entry.created_at}  ${entry.author}  [${entry.entry_type}]  ${entry.entry_id}`);
        if (entry.focus_id || entry.thread_id || (entry.tags || []).length) {
          console.log(`  meta: ${entry.focus_id ? `focus=${entry.focus_id}` : ''}${entry.focus_id && entry.thread_id ? '  ' : ''}${entry.thread_id ? `thread=${entry.thread_id}` : ''}${(entry.focus_id || entry.thread_id) && (entry.tags || []).length ? '  ' : ''}${(entry.tags || []).length ? `tags=${entry.tags.join(',')}` : ''}`);
        }
        console.log(`  ${entry.content}`);
      }
      console.log('');
      break;
    }

    console.error('用法: atf shared add|list ...');
    break;
  }

  // =============================================================
  // trigger 命令 - 任务 / Focus 绑定的触发器对象
  // =============================================================
  case 'trigger': {
    const [sub, ...restArgs] = args;

    if (sub === 'add') {
      const [taskId, ownerAgent, triggerType, ...specParts] = restArgs;
      if (!taskId || !ownerAgent || !triggerType || !specParts.length) {
        console.error('用法: atf trigger add <taskId> <owner> <type> <spec> [focus=FOC-...] [thread=...] [intent=x] [note=x]'); break;
      }
      if (!TRIGGER_TYPES.has(triggerType)) {
        console.error(`Trigger 类型: ${[...TRIGGER_TYPES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const { focusId, threadId, intent, note, specTokens } = parseTriggerCreateParts(specParts);
      if (!specTokens.length) {
        console.error('❌ trigger spec 不能为空'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      const trigger = createTriggerRecord(taskId, ctx, ownerAgent, triggerType, specTokens.join(' '), {
        focus_id: focusId,
        thread_id: threadId,
        intent,
        note,
      });
      console.log(`✅ 已创建 Trigger ${trigger.trigger_id}`);
      console.log(`   任务: ${trigger.task_id}  |  owner: ${trigger.owner_agent}`);
      console.log(`   类型: ${trigger.trigger_type}  |  spec: ${trigger.trigger_spec}`);
      if (trigger.intent && trigger.intent !== 'generic') console.log(`   intent: ${trigger.intent}`);
      if (trigger.focus_id) console.log(`   focus: ${trigger.focus_id}`);
      if (trigger.thread_id) console.log(`   thread: ${trigger.thread_id}`);
      if (trigger.note) console.log(`   note: ${trigger.note}`);
      break;
    }

    if (sub === 'follow-up' || sub === 'review') {
      const [taskId, ownerAgent, ...specParts] = restArgs;
      if (!taskId || !ownerAgent || !specParts.length) {
        console.error(`鐢ㄦ硶: atf trigger ${sub} <taskId> <owner> <spec> [focus=FOC-...] [thread=...] [note=x]`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`鉂?浠诲姟涓嶅瓨鍦? ${taskId}`); break; }
      const { focusId, threadId, note, specTokens } = parseTriggerCreateParts(specParts);
      if (!specTokens.length) {
        console.error('鉂?trigger spec 涓嶈兘涓虹┖'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`鉂?Focus 涓嶅瓨鍦? ${focusId}`); break;
      }
      const triggerType = inferTriggerTypeFromSpec(specTokens.join(' '));
      if (!triggerType) {
        console.error('❌ follow-up/review 只支持 interval 或 cron 格式 spec'); break;
      }
      const intent = sub === 'follow-up' ? 'follow_up' : 'review';
      const trigger = createTriggerRecord(taskId, ctx, ownerAgent, triggerType, specTokens.join(' '), {
        focus_id: focusId,
        thread_id: defaultThreadId(ctx.short_id || ctx.task_id, focusId, threadId),
        intent,
        note,
      });
      console.log(`Created ${intent} trigger ${trigger.trigger_id}`);
      console.log(`   task: ${trigger.task_id}  |  owner: ${trigger.owner_agent}`);
      console.log(`   type: ${trigger.trigger_type}  |  spec: ${trigger.trigger_spec}`);
      if (trigger.focus_id) console.log(`   focus: ${trigger.focus_id}`);
      if (trigger.thread_id) console.log(`   thread: ${trigger.thread_id}`);
      if (trigger.note) console.log(`   note: ${trigger.note}`);
      break;
    }

    if (sub === 'list') {
      const [taskId, ownerAgent] = restArgs;
      if (!taskId) { console.error('用法: atf trigger list <taskId> [owner]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let triggers = readTaskTriggers(taskId);
      if (ownerAgent) triggers = triggers.filter(t => t.owner_agent === ownerAgent);
      if (!triggers.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Triggers`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Triggers (${triggers.length} 条)\n`);
      for (const trigger of triggers) {
        const triggerIntent = trigger.intent && trigger.intent !== 'generic' ? `/${trigger.intent}` : '';
        console.log(`${trigger.trigger_id}  ${trigger.status}  owner:${trigger.owner_agent}  [${trigger.trigger_type}${triggerIntent}]`);
        console.log(`  ${trigger.trigger_spec}`);
        if (trigger.focus_id) console.log(`  focus: ${trigger.focus_id}`);
        if (trigger.thread_id) console.log(`  thread: ${trigger.thread_id}`);
        if (trigger.note) console.log(`  note: ${trigger.note}`);
      }
      console.log('');
      break;
    }

    if (sub === 'inbox') {
      const [agent, taskId] = restArgs;
      if (!agent) { console.error('用法: atf trigger inbox <agent> [taskId]'); break; }
      let fires = [];
      if (taskId) {
        const ctx = readCtx(taskId);
        if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
        fires = readTaskTriggerFires(taskId);
      } else {
        let inbox = loadJson(triggerInboxPath(agent));
        if (!inbox) {
          refreshTriggerIndexes();
          inbox = loadJson(triggerInboxPath(agent));
        }
        fires = (inbox || {}).items || [];
      }
      fires = fires
        .filter(fire => fire.owner_agent === agent && fire.status === 'pending')
        .sort((a, b) => (b.fired_at || '').localeCompare(a.fired_at || ''));
      if (!fires.length) { console.log(`agent ${agent} 当前没有待处理 Trigger fires`); break; }
      console.log(`\n${agent} Trigger Inbox (${fires.length} 条)\n`);
      for (const fire of fires) {
        const fireIntent = fire.intent && fire.intent !== 'generic' ? `/${fire.intent}` : '';
        console.log(`[${fire.task_id}] ${fire.fire_id}  trigger:${fire.trigger_id}  [${fire.trigger_type}${fireIntent}]`);
        console.log(`  ${fire.fired_at}  ${fire.source_type}${fire.source_ref ? `:${fire.source_ref}` : ''}`);
        if (fire.focus_id) console.log(`  focus: ${fire.focus_id}`);
        if (fire.thread_id) console.log(`  thread: ${fire.thread_id}`);
        if (fire.note) console.log(`  note: ${fire.note}`);
      }
      console.log('');
      break;
    }

    if (sub === 'rebuild-index') {
      refreshTriggerIndexes();
      const pending = loadJson(PENDING_TRIGGER_FIRES_FILE) || { total: 0 };
      console.log(`✅ Trigger 索引已重建`);
      console.log(`   pending fires: ${pending.total || 0}`);
      console.log(`   global index: ${PENDING_TRIGGER_FIRES_FILE}`);
      break;
    }

    if (sub === 'due') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf trigger due <taskId> [owner] [at=ISO]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const { ownerAgent, atIso: now, invalidAt } = parseTriggerScanArgs(filterParts);
      if (invalidAt) { console.error(`❌ 无效时间: ${invalidAt}`); break; }
      let triggers = readTaskTriggers(taskId)
        .filter(trigger => trigger.status === 'active')
        .map(trigger => {
          trigger.runtime = normalizeTriggerRuntime(trigger, now);
          return trigger;
        })
        .filter(trigger => trigger.runtime.next_due_at && trigger.runtime.next_due_at <= now);
      if (ownerAgent) triggers = triggers.filter(trigger => trigger.owner_agent === ownerAgent);
      if (!triggers.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 当前没有已到期 Trigger`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Due Triggers (${triggers.length} 条)\n`);
      for (const trigger of triggers) {
        console.log(`${trigger.trigger_id}  owner:${trigger.owner_agent}  [${trigger.trigger_type}]`);
        console.log(`  due: ${trigger.runtime.next_due_at}`);
        console.log(`  ${trigger.trigger_spec}`);
        if (trigger.focus_id) console.log(`  focus: ${trigger.focus_id}`);
      }
      console.log('');
      break;
    }

    if (sub === 'scan') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf trigger scan <taskId> [owner] [at=ISO]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const { ownerAgent, atIso: now, invalidAt } = parseTriggerScanArgs(filterParts);
      if (invalidAt) { console.error(`❌ 无效时间: ${invalidAt}`); break; }
      let triggers = readTaskTriggers(taskId)
        .filter(trigger => trigger.status === 'active')
        .map(trigger => {
          trigger.runtime = normalizeTriggerRuntime(trigger, now);
          return trigger;
        })
        .filter(trigger => trigger.runtime.next_due_at && trigger.runtime.next_due_at <= now)
        .filter(trigger => !hasPendingTriggerFire(taskId, trigger));
      if (ownerAgent) triggers = triggers.filter(trigger => trigger.owner_agent === ownerAgent);
      if (!triggers.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 当前没有可触发的 due Trigger`); break; }
      const fires = triggers.map(trigger => recordTriggerFire(taskId, trigger, {
        source_type: 'trigger_scan',
        source_ref: trigger.runtime.next_due_at,
        note: 'due trigger scanned by cli',
        fired_by: 'scan',
        fired_at: now,
      }));
      console.log(`✅ ${ctx.short_id || ctx.task_id} 扫描完成，触发 ${fires.length} 条 due Triggers`);
      for (const fire of fires) {
        console.log(`   ${fire.fire_id}  ${fire.trigger_id}  owner:${fire.owner_agent}`);
      }
      break;
    }

    if (sub === 'scan-all') {
      const { ownerAgent, atIso: now, invalidAt } = parseTriggerScanArgs(restArgs);
      if (invalidAt) { console.error(`❌ 无效时间: ${invalidAt}`); break; }
      const fired = [];
      for (const task of getAllTasks()) {
        const taskId = task.short_id || task.task_id;
        let triggers = readTaskTriggers(taskId)
          .filter(trigger => trigger.status === 'active')
          .map(trigger => {
            trigger.runtime = normalizeTriggerRuntime(trigger, now);
            return trigger;
          })
          .filter(trigger => trigger.runtime.next_due_at && trigger.runtime.next_due_at <= now)
          .filter(trigger => !hasPendingTriggerFire(taskId, trigger));
        if (ownerAgent) triggers = triggers.filter(trigger => trigger.owner_agent === ownerAgent);
        for (const trigger of triggers) {
          fired.push(recordTriggerFire(taskId, trigger, {
            source_type: 'trigger_scan',
            source_ref: trigger.runtime.next_due_at,
            note: 'due trigger scanned by cli',
            fired_by: 'scan',
            fired_at: now,
          }));
        }
      }
      if (!fired.length) { console.log('当前没有可触发的 due Triggers'); break; }
      console.log(`✅ 全量扫描完成，触发 ${fired.length} 条 due Triggers`);
      for (const fire of fired) {
        console.log(`   [${fire.task_id}] ${fire.fire_id}  ${fire.trigger_id}  owner:${fire.owner_agent}`);
      }
      break;
    }

    if (sub === 'show') {
      const [taskId, triggerId] = restArgs;
      if (!taskId || !triggerId) { console.error('用法: atf trigger show <taskId> <triggerId>'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const trigger = readTrigger(taskId, triggerId);
      if (!trigger) { console.error(`❌ Trigger 不存在: ${triggerId}`); break; }
      trigger.runtime = normalizeTriggerRuntime(trigger);
      console.log(JSON.stringify(trigger, null, 2));
      break;
    }

    if (sub === 'update') {
      const [taskId, triggerId, status] = restArgs;
      if (!taskId || !triggerId || !status) {
        console.error('用法: atf trigger update <taskId> <triggerId> <status>'); break;
      }
      if (!TRIGGER_STATUSES.has(status)) {
        console.error(`Trigger 状态: ${[...TRIGGER_STATUSES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const trigger = readTrigger(taskId, triggerId);
      if (!trigger) { console.error(`❌ Trigger 不存在: ${triggerId}`); break; }
      const now = new Date().toISOString();
      const runtime = normalizeTriggerRuntime(trigger, now);
      if (status === 'archived' && runtime.pending_fire_id) {
        const pendingFire = readTriggerFire(taskId, runtime.pending_fire_id);
        if (pendingFire && pendingFire.status === 'pending') {
          settleTriggerFire(taskId, pendingFire, trigger, 'ignored', 'cli', `trigger archived by cli`);
        }
      }
      trigger.status = status;
      trigger.runtime = {
        ...normalizeTriggerRuntime(trigger, now),
        pending_fire_id: status === 'archived' ? null : runtime.pending_fire_id,
        next_due_at: status === 'active' ? runtime.next_due_at || inferNextDueAt(trigger.trigger_type, trigger.trigger_spec, now) : runtime.next_due_at,
      };
      trigger.history = appendHistoryEvent(trigger.history, {
        event: 'updated',
        by: 'cli',
        at: now,
        note: `status=${status}`,
      });
      saveTrigger(taskId, trigger);
      console.log(`✅ Trigger ${trigger.trigger_id} → ${trigger.status}`);
      break;
    }

    if (sub === 'fire') {
      const [taskId, triggerId, sourceType, ...extraParts] = restArgs;
      if (!taskId || !triggerId || !sourceType) {
        console.error('用法: atf trigger fire <taskId> <triggerId> <sourceType> [ref=...] [note]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const trigger = readTrigger(taskId, triggerId);
      if (!trigger) { console.error(`❌ Trigger 不存在: ${triggerId}`); break; }
      if (trigger.status !== 'active') { console.error(`❌ Trigger 当前不是 active: ${trigger.status}`); break; }
      let sourceRef = null;
      const noteTokens = [];
      for (const part of extraParts) {
        if (part.startsWith('ref=')) sourceRef = part.substring('ref='.length);
        else noteTokens.push(part);
      }
      const fire = recordTriggerFire(taskId, trigger, {
        source_type: sourceType,
        source_ref: sourceRef,
        note: noteTokens.join(' ') || null,
        fired_by: 'cli',
      });
      console.log(`✅ Trigger ${trigger.trigger_id} 已记录 firing ${fire.fire_id}`);
      console.log(`   source: ${fire.source_type}${fire.source_ref ? `  |  ref: ${fire.source_ref}` : ''}`);
      if (fire.note) console.log(`   note: ${fire.note}`);
      break;
    }

    if (sub === 'fires') {
      const [taskId, maybeTriggerId, maybeStatus] = restArgs;
      if (!taskId) { console.error('用法: atf trigger fires <taskId> [triggerId] [status]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let triggerId = null;
      let status = null;
      for (const part of [maybeTriggerId, maybeStatus].filter(Boolean)) {
        if (TRIGGER_FIRE_STATUSES.has(part)) status = part;
        else triggerId = part;
      }
      let fires = readTaskTriggerFires(taskId);
      if (triggerId) fires = fires.filter(fire => fire.trigger_id === triggerId);
      if (status) fires = fires.filter(fire => fire.status === status);
      if (!fires.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Trigger firing 记录`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Trigger Fires (${fires.length} 条)\n`);
      for (const fire of fires) {
        const fireIntent = fire.intent && fire.intent !== 'generic' ? `/${fire.intent}` : '';
        console.log(`${fire.fire_id}  ${fire.status}  trigger:${fire.trigger_id}  owner:${fire.owner_agent}  [${fire.trigger_type}${fireIntent}]`);
        console.log(`  ${fire.fired_at}  ${fire.source_type}${fire.source_ref ? `:${fire.source_ref}` : ''}`);
        if (fire.thread_id) console.log(`  thread: ${fire.thread_id}`);
        if (fire.note) console.log(`  note: ${fire.note}`);
        if (fire.execution_id) console.log(`  execution: ${fire.execution_id}${fire.execution_mode ? `  |  ${fire.execution_mode}` : ''}`);
        if (fire.consumed_at) console.log(`  consumed: ${fire.consumed_at} by ${fire.consumed_by || 'unknown'}${fire.result ? `  |  ${fire.result}` : ''}`);
      }
      console.log('');
      break;
    }

    if (sub === 'execute') {
      const [taskId, fireId, ...optionParts] = restArgs;
      if (!taskId || !fireId) {
        console.error('用法: atf trigger execute <taskId> <fireId> [executor] [mode=pending_task|message|noop] [note=x]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const fire = readTriggerFire(taskId, fireId);
      if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
      const trigger = readTrigger(taskId, fire.trigger_id);
      if (!trigger) { console.error(`❌ 对应 Trigger 不存在: ${fire.trigger_id}`); break; }
      const { target, executor, mode, note } = parseTriggerExecuteArgs(optionParts);
      const execution = executeTriggerFire(taskId, fire, trigger, ctx, {
        executor: target || executor,
        mode,
        note,
      });
      console.log(`Executed trigger fire ${fire.fire_id} -> ${execution.execution_id}`);
      console.log(`   mode: ${execution.execution_mode}  |  executor: ${execution.executor}`);
      if (execution.artifacts.pending_task_path) console.log(`   pending-task: ${execution.artifacts.pending_task_path}`);
      if (execution.artifacts.message_id) console.log(`   message: ${execution.artifacts.message_id}`);
      break;
    }

    if (sub === 'execute-pending') {
      const { target: agent, executor, mode, limit, note } = parseTriggerExecuteArgs(restArgs);
      refreshTriggerIndexes();
      let fires = [];
      if (agent) {
        const inbox = loadJson(triggerInboxPath(agent));
        fires = (inbox?.items || []).filter(fire => fire.status === 'pending');
      } else {
        const pending = loadJson(PENDING_TRIGGER_FIRES_FILE);
        fires = (pending?.items || []).filter(fire => fire.status === 'pending');
      }
      fires = fires
        .sort((a, b) => (a.fired_at || '').localeCompare(b.fired_at || ''))
        .slice(0, limit || fires.length);
      if (!fires.length) { console.log('当前没有可执行的 pending trigger fires'); break; }
      const executions = [];
      for (const fire of fires) {
        const ctx = readCtx(fire.task_id);
        if (!ctx) continue;
        const trigger = readTrigger(fire.task_id, fire.trigger_id);
        if (!trigger) continue;
        const latestFire = readTriggerFire(fire.task_id, fire.fire_id);
        if (!latestFire || latestFire.status !== 'pending') continue;
        executions.push(executeTriggerFire(fire.task_id, latestFire, trigger, ctx, {
          executor,
          mode,
          note,
        }));
      }
      if (!executions.length) { console.log('没有成功执行的 trigger fires'); break; }
      console.log(`Executed ${executions.length} pending trigger fires`);
      for (const execution of executions) {
        console.log(`   [${execution.task_id}] ${execution.execution_id}  fire:${execution.fire_id}  mode:${execution.execution_mode}`);
      }
      break;
    }

    if (sub === 'executions') {
      const [taskId, maybeFireId] = restArgs;
      if (!taskId) { console.error('用法: atf trigger executions <taskId> [fireId]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let executions = readTaskTriggerExecutions(taskId);
      if (maybeFireId) executions = executions.filter(execution => execution.fire_id === maybeFireId);
      if (!executions.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Trigger executions`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Trigger Executions (${executions.length} 条)\n`);
      for (const execution of executions) {
        console.log(`${execution.execution_id}  ${execution.status}  fire:${execution.fire_id}  mode:${execution.execution_mode}`);
        console.log(`  ${execution.dispatched_at}  executor:${execution.executor}  owner:${execution.owner_agent || '-'}`);
        if (execution.thread_id) console.log(`  thread: ${execution.thread_id}`);
        if (execution.note) console.log(`  note: ${execution.note}`);
        if (execution.artifacts?.pending_task_path) console.log(`  pending-task: ${execution.artifacts.pending_task_path}`);
        if (execution.artifacts?.message_id) console.log(`  message: ${execution.artifacts.message_id}`);
      }
      console.log('');
      break;
    }

    if (sub === 'consume') {
      const [taskId, fireId, consumer, ...resultParts] = restArgs;
      if (!taskId || !fireId || !consumer) {
        console.error('用法: atf trigger consume <taskId> <fireId> <consumer> [result]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const fire = readTriggerFire(taskId, fireId);
      if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
      const trigger = readTrigger(taskId, fire.trigger_id);
      if (!trigger) { console.error(`❌ 对应 Trigger 不存在: ${fire.trigger_id}`); break; }
      settleTriggerFire(taskId, fire, trigger, 'consumed', consumer, resultParts.join(' ') || null);
      console.log(`✅ Trigger firing ${fire.fire_id} 已消费`);
      console.log(`   trigger: ${trigger.trigger_id}  |  consumer: ${consumer}`);
      if (fire.result) console.log(`   result: ${fire.result}`);
      break;
    }

    if (sub === 'ignore') {
      const [taskId, fireId, consumer, ...reasonParts] = restArgs;
      if (!taskId || !fireId || !consumer) {
        console.error('用法: atf trigger ignore <taskId> <fireId> <consumer> [reason]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const fire = readTriggerFire(taskId, fireId);
      if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
      const trigger = readTrigger(taskId, fire.trigger_id);
      if (!trigger) { console.error(`❌ 对应 Trigger 不存在: ${fire.trigger_id}`); break; }
      settleTriggerFire(taskId, fire, trigger, 'ignored', consumer, reasonParts.join(' ') || null);
      console.log(`✅ Trigger firing ${fire.fire_id} 已忽略`);
      console.log(`   trigger: ${trigger.trigger_id}  |  consumer: ${consumer}`);
      if (fire.result) console.log(`   reason: ${fire.result}`);
      break;
    }

    console.error('用法: atf trigger add|follow-up|review|list|inbox|rebuild-index|due|scan|scan-all|show|update|fire|fires|execute|execute-pending|executions|consume|ignore ...');
    break;
  }

  // =============================================================
  // reflect 命令 - 任务 / Focus 的结构化复盘
  // =============================================================
  case 'reflect': {
    const [sub, ...restArgs] = args;

    if (sub === 'add') {
      const [taskId, author, field, ...contentParts] = restArgs;
      if (!taskId || !author || !field || !contentParts.length) {
        console.error('用法: atf reflect add <taskId> <author> <field> <内容> [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...]'); break;
      }
      if (!REFLECTION_FIELDS.has(field)) {
        console.error(`Reflection 字段: ${[...REFLECTION_FIELDS].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let focusId = null;
      let triggerId = null;
      let fireId = null;
      const contentTokens = [];
      for (const part of contentParts) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('trigger=')) triggerId = part.substring('trigger='.length);
        else if (part.startsWith('fire=')) fireId = part.substring('fire='.length);
        else contentTokens.push(part);
      }
      if (!contentTokens.length) {
        console.error('❌ Reflection 内容不能为空'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      let fire = null;
      if (fireId) {
        fire = readTriggerFire(taskId, fireId);
        if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
        if (!focusId && fire.focus_id) focusId = fire.focus_id;
        if (!triggerId) triggerId = fire.trigger_id;
      }
      if (triggerId && !readTrigger(taskId, triggerId)) {
        console.error(`❌ Trigger 不存在: ${triggerId}`); break;
      }
      const reflection = createReflection(taskId, ctx, author, field, contentTokens.join(' '), {
        focus_id: focusId,
        trigger_id: triggerId,
        fire_id: fireId,
        source_type: fire ? 'trigger_fire' : (triggerId ? 'trigger' : 'manual'),
        source_ref: fireId || triggerId || null,
      });
      console.log(`✅ 已写入 Reflection ${reflection.reflection_id}`);
      console.log(`   任务: ${reflection.task_id}  |  ${author} [${reflection.field}]`);
      if (reflection.focus_id) console.log(`   focus: ${reflection.focus_id}`);
      if (reflection.trigger_id) console.log(`   trigger: ${reflection.trigger_id}`);
      if (reflection.fire_id) console.log(`   fire: ${reflection.fire_id}`);
      break;
    }

    if (sub === 'from-fire') {
      const [taskId, fireId, author, field, ...contentParts] = restArgs;
      if (!taskId || !fireId || !author || !field || !contentParts.length) {
        console.error('用法: atf reflect from-fire <taskId> <fireId> <author> <field> <内容>'); break;
      }
      if (!REFLECTION_FIELDS.has(field)) {
        console.error(`Reflection 字段: ${[...REFLECTION_FIELDS].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const fire = readTriggerFire(taskId, fireId);
      if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
      const trigger = readTrigger(taskId, fire.trigger_id);
      if (!trigger) { console.error(`❌ 对应 Trigger 不存在: ${fire.trigger_id}`); break; }
      const reflection = createReflection(taskId, ctx, author, field, contentParts.join(' '), {
        focus_id: fire.focus_id || null,
        trigger_id: fire.trigger_id,
        fire_id: fire.fire_id,
        source_type: 'trigger_fire',
        source_ref: fire.fire_id,
      });
      console.log(`✅ 已从 Trigger fire 写入 Reflection ${reflection.reflection_id}`);
      console.log(`   fire: ${fire.fire_id}  |  trigger: ${trigger.trigger_id}`);
      break;
    }

    if (sub === 'list') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf reflect list <taskId> [field] [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let field = null;
      let focusId = null;
      let triggerId = null;
      let fireId = null;
      let author = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('trigger=')) triggerId = part.substring('trigger='.length);
        else if (part.startsWith('fire=')) fireId = part.substring('fire='.length);
        else if (part.startsWith('author=')) author = part.substring('author='.length);
        else field = part;
      }
      if (field && !REFLECTION_FIELDS.has(field)) {
        console.error(`Reflection 字段: ${[...REFLECTION_FIELDS].join('|')}`); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      if (triggerId && !readTrigger(taskId, triggerId)) {
        console.error(`❌ Trigger 不存在: ${triggerId}`); break;
      }
      if (fireId && !readTriggerFire(taskId, fireId)) {
        console.error(`❌ Trigger firing 不存在: ${fireId}`); break;
      }
      let reflections = readTaskReflections(taskId);
      if (field) reflections = reflections.filter(r => r.field === field);
      if (focusId) reflections = reflections.filter(r => r.focus_id === focusId);
      if (triggerId) reflections = reflections.filter(r => r.trigger_id === triggerId);
      if (fireId) reflections = reflections.filter(r => r.fire_id === fireId);
      if (author) reflections = reflections.filter(r => r.author === author);
      if (!reflections.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Reflections`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Reflections (${reflections.length} 条)\n`);
      for (const reflection of reflections) {
        console.log(`${reflection.reflection_id}  ${reflection.author}  [${reflection.field}]`);
        if (reflection.focus_id) console.log(`  focus: ${reflection.focus_id}`);
        if (reflection.trigger_id || reflection.fire_id) console.log(`  source: ${reflection.trigger_id ? `trigger=${reflection.trigger_id}` : ''}${reflection.trigger_id && reflection.fire_id ? '  ' : ''}${reflection.fire_id ? `fire=${reflection.fire_id}` : ''}`);
        console.log(`  ${reflection.content}`);
      }
      console.log('');
      break;
    }

    if (sub === 'summary') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf reflect summary <taskId> [focus=FOC-...] [author=x]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let focusId = null;
      let author = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('author=')) author = part.substring('author='.length);
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      let reflections = readTaskReflections(taskId);
      if (focusId) reflections = reflections.filter(r => r.focus_id === focusId);
      if (author) reflections = reflections.filter(r => r.author === author);
      if (!reflections.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Reflections`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Reflection Summary\n`);
      for (const field of REFLECTION_FIELDS) {
        const items = reflections.filter(reflection => reflection.field === field);
        if (!items.length) continue;
        console.log(`${field}: ${items.length}`);
        for (const reflection of items.slice(-3)) {
          console.log(`  ${reflection.created_at}  ${reflection.author}${reflection.focus_id ? `  focus=${reflection.focus_id}` : ''}`);
          console.log(`  ${reflection.content}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [taskId, reflectionId] = restArgs;
      if (!taskId || !reflectionId) { console.error('用法: atf reflect show <taskId> <reflectionId>'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const reflection = readReflection(taskId, reflectionId);
      if (!reflection) { console.error(`❌ Reflection 不存在: ${reflectionId}`); break; }
      console.log(JSON.stringify(reflection, null, 2));
      break;
    }

    console.error('用法: atf reflect add|from-fire|list|summary|show ...');
    break;
  }

  // =============================================================
  // 消息命令 - 同一 gateway 内的异步任务消息
  // =============================================================
  case 'msg': {
    const [sub, ...restArgs] = args;

    if (sub === 'send') {
      const [taskId, fromAgent, toAgent, messageType, ...bodyParts] = restArgs;
      if (!taskId || !fromAgent || !toAgent || !messageType || !bodyParts.length) {
        console.error('用法: atf msg send <taskId> <from> <to> <type> <内容> [focus=FOC-...] [thread=...] [reply=MSG-...]'); break;
      }
      if (!MESSAGE_TYPES.has(messageType)) {
        console.error(`消息类型: ${[...MESSAGE_TYPES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let focusId = null;
      let threadId = null;
      let replyToMessageId = null;
      const contentTokens = [];
      for (const part of bodyParts) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('thread=')) threadId = part.substring('thread='.length);
        else if (part.startsWith('reply=')) replyToMessageId = part.substring('reply='.length);
        else contentTokens.push(part);
      }
      if (!contentTokens.length) {
        console.error('❌ 消息内容不能为空'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      if (replyToMessageId && !readMessage(taskId, replyToMessageId)) {
        console.error(`❌ reply 消息不存在: ${replyToMessageId}`); break;
      }
      if (!threadId) threadId = focusId ? `focus:${focusId}` : `task:${ctx.short_id || ctx.task_id}`;
      const now = new Date();
      const ttlSeconds = 24 * 60 * 60;
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      const message = {
        schema: 'atf.message.v1',
        message_id: generateId('MSG'),
        task_id: ctx.short_id || ctx.task_id,
        thread_id: threadId,
        focus_id: focusId,
        reply_to_message_id: replyToMessageId,
        from_agent: fromAgent,
        to_agent: toAgent,
        message_type: messageType,
        body: contentTokens.join(' '),
        created_at: now.toISOString(),
        ttl_seconds: ttlSeconds,
        expires_at: expiresAt,
        status: 'sent',
        receipt_ids: [],
        last_receipt_type: null,
        last_receipt_at: null,
      };
      saveMessage(taskId, message);
      appendNotificationHistory(taskId, { event: 'message_sent', message_id: message.message_id, from: fromAgent, to: toAgent, type: messageType, thread_id: message.thread_id, focus_id: message.focus_id, at: message.created_at });
      const firedTriggers = fireMatchingTriggers(
        taskId,
        trigger => {
          if (trigger.trigger_type !== 'on_message') return false;
          if (trigger.owner_agent !== toAgent) return false;
          if (trigger.focus_id && trigger.focus_id !== message.focus_id) return false;
          if (trigger.thread_id && trigger.thread_id !== message.thread_id) return false;
          return true;
        },
        trigger => ({
          source_type: 'message',
          source_ref: message.message_id,
          thread_id: message.thread_id,
          note: `${fromAgent} -> ${toAgent} [${messageType}]`,
          fired_by: 'message',
        })
      );
      console.log(`✅ 已发送消息 ${message.message_id}`);
      console.log(`   任务: ${message.task_id}  |  ${fromAgent} → ${toAgent}`);
      console.log(`   类型: ${message.message_type}  |  TTL: ${message.ttl_seconds}s`);
      console.log(`   thread: ${message.thread_id}${message.focus_id ? `  |  focus: ${message.focus_id}` : ''}${message.reply_to_message_id ? `  |  reply: ${message.reply_to_message_id}` : ''}`);
      if (firedTriggers.length) console.log(`   trigger fires: ${firedTriggers.map(f => f.fire_id).join(', ')}`);
      break;
    }

    if (sub === 'inbox') {
      const [agent, taskId] = restArgs;
      if (!agent) { console.error('用法: atf msg inbox <agent> [taskId]'); break; }
      let messages = [];
      if (taskId) {
        const ctx = readCtx(taskId);
        if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
        messages = readTaskMessages(taskId);
      } else {
        for (const task of getAllTasks()) {
          messages.push(...readTaskMessages(task.short_id || task.task_id));
        }
      }
      messages = messages
        .filter(m => m.to_agent === agent)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!messages.length) { console.log(`agent ${agent} 收件箱为空`); break; }
      console.log(`\n${agent} 收件箱 (${messages.length} 条)\n`);
      for (const m of messages) {
        const status = effectiveMessageStatus(m);
        console.log(`[${m.task_id}] ${m.message_id}  ${m.from_agent} → ${m.to_agent}  ${m.message_type}  ${status}`);
        console.log(`  ${m.body}`);
        console.log(`  thread: ${m.thread_id}${m.focus_id ? `  |  focus: ${m.focus_id}` : ''}${m.reply_to_message_id ? `  |  reply: ${m.reply_to_message_id}` : ''}`);
      }
      console.log('');
      break;
    }

    if (sub === 'threads') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf msg threads <taskId> [focus=FOC-...] [agent=x]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`鉂?浠诲姟涓嶅瓨鍦? ${taskId}`); break; }
      let focusId = null;
      let agent = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('agent=')) agent = part.substring('agent='.length);
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`鉂?Focus 涓嶅瓨鍦? ${focusId}`); break;
      }
      let messages = readTaskMessages(taskId);
      if (focusId) messages = messages.filter(message => message.focus_id === focusId || message.thread_id === `focus:${focusId}`);
      let threads = summarizeThreads(messages);
      if (agent) threads = threads.filter(thread => thread.participants.includes(agent));
      if (!threads.length) { console.log(`浠诲姟 ${ctx.short_id || ctx.task_id} 鏆傛棤娑堟伅绾跨▼姒傝`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Message Threads (${threads.length} items)\n`);
      for (const thread of threads) {
        console.log(`${thread.thread_id}  msgs:${thread.total}  agents:${thread.participants.join(',')}`);
        console.log(`  latest: ${thread.latest.created_at}  ${thread.latest.from_agent}->${thread.latest.to_agent}  [${thread.latest.message_type}]`);
        if (thread.blocker_count || thread.decision_count || thread.pending_count) {
          console.log(`  stats: blocker=${thread.blocker_count}  decision=${thread.decision_count}  pending=${thread.pending_count}`);
        }
        console.log(`  ${thread.latest.body}`);
      }
      console.log('');
      break;
    }

    if (sub === 'thread') {
      const [taskId, threadArg] = restArgs;
      if (!taskId) { console.error('用法: atf msg thread <taskId> [threadId|focus=FOC-...]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const allMessages = readTaskMessages(taskId);
      const allReceipts = readTaskReceipts(taskId);
      let targetThread = threadArg || `task:${ctx.short_id || ctx.task_id}`;
      if (threadArg && threadArg.startsWith('focus=')) {
        const focusId = threadArg.substring('focus='.length);
        if (!readFocus(taskId, focusId)) { console.error(`❌ Focus 不存在: ${focusId}`); break; }
        targetThread = `focus:${focusId}`;
      }
      const messages = allMessages.filter(m => m.thread_id === targetThread);
      if (!messages.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无消息线程`); break; }
      console.log(`\n消息线程 ${targetThread} (${messages.length} 条)\n`);
      for (const m of messages) {
        const receipts = allReceipts.filter(r => r.message_id === m.message_id);
        console.log(`${m.created_at}  ${m.from_agent} → ${m.to_agent}  [${m.message_type}] ${effectiveMessageStatus(m)}`);
        console.log(`  ${m.body}`);
        if (m.focus_id || m.reply_to_message_id) console.log(`  meta: ${m.focus_id ? `focus=${m.focus_id}` : ''}${m.focus_id && m.reply_to_message_id ? '  ' : ''}${m.reply_to_message_id ? `reply=${m.reply_to_message_id}` : ''}`);
        console.log(`  回执: ${receiptSummary(receipts)}`);
      }
      console.log('');
      break;
    }

    if (sub === 'ack') {
      const [taskId, messageId, agent, maybeReceiptType, ...noteParts] = restArgs;
      if (!taskId || !messageId || !agent) {
        console.error('用法: atf msg ack <taskId> <messageId> <agent> [receiptType] [note]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const message = readMessage(taskId, messageId);
      if (!message) { console.error(`❌ 消息不存在: ${messageId}`); break; }
      if (message.to_agent !== agent) {
        console.error(`❌ 回执 agent 不匹配，消息接收方是 ${message.to_agent}`); break;
      }
      const receiptType = RECEIPT_TYPES.has(maybeReceiptType) ? maybeReceiptType : 'acked';
      const note = RECEIPT_TYPES.has(maybeReceiptType) ? noteParts.join(' ') : [maybeReceiptType, ...noteParts].filter(Boolean).join(' ');
      const receipt = {
        schema: 'atf.receipt.v1',
        receipt_id: generateId('RCT'),
        message_id: message.message_id,
        task_id: message.task_id,
        from_agent: agent,
        to_agent: message.from_agent,
        receipt_type: receiptType,
        created_at: new Date().toISOString(),
        note: note || null,
      };
      saveReceipt(taskId, receipt);
      message.receipt_ids = [...(message.receipt_ids || []), receipt.receipt_id];
      message.last_receipt_type = receiptType;
      message.last_receipt_at = receipt.created_at;
      message.status = receiptType;
      saveMessage(taskId, message);
      console.log(`✅ 已写回执 ${receipt.receipt_id}`);
      console.log(`   消息: ${message.message_id}  |  ${agent} → ${message.from_agent}`);
      console.log(`   类型: ${receipt.receipt_type}${note ? `  |  note: ${note}` : ''}`);
      break;
    }

    if (sub === 'receipts') {
      const [taskId, messageId] = restArgs;
      if (!taskId || !messageId) { console.error('用法: atf msg receipts <taskId> <messageId>'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const message = readMessage(taskId, messageId);
      if (!message) { console.error(`❌ 消息不存在: ${messageId}`); break; }
      const receipts = readTaskReceipts(taskId).filter(r => r.message_id === messageId);
      if (!receipts.length) { console.log(`消息 ${messageId} 暂无回执`); break; }
      console.log(`\n消息 ${messageId} 回执 (${receipts.length} 条)\n`);
      for (const r of receipts) {
        console.log(`${r.created_at}  ${r.from_agent} → ${r.to_agent}  ${r.receipt_type}${r.note ? `  |  ${r.note}` : ''}`);
      }
      console.log('');
      break;
    }

    console.error('用法: atf msg send|inbox|thread|threads|ack|receipts ...');
    break;
  }

  // =============================================================
  // DLQ 命令
  // =============================================================
  case 'dlq': {
    const sub = args[0];

    // atf dlq list
    if (sub === 'list') {
      if (!fs.existsSync(DLQ_DIR)) { console.log('DLQ 队列为空'); break; }
      const files = fs.readdirSync(DLQ_DIR).filter(f => f.endsWith('.json'));
      if (!files.length) { console.log('DLQ 队列为空'); break; }
      console.log(`\nDLQ 队列 (${files.length} 个)\n`);
      console.log('任务ID      指派        重试       原因');
      console.log('─'.repeat(75));
      for (const f of files.sort()) {
        const d = loadJson(`${DLQ_DIR}/${f}`);
        if (!d) continue;
        const id = (d.short_id||d.task_id||f.replace('.json','')).padEnd(12);
        const agt = (d.assigned_to||'-').padEnd(12);
        const r = `${d.retry_count||0}/${d.protocol?.max_retries||3}`.padEnd(10);
        const reason = (d.dlq_reason||'-').substring(0,40);
        console.log(`${id}  ${agt}  ${r}  ${reason}`);
      }
      console.log('');
      break;
    }

    if (!args[0] || !args[1]) {
      console.error('用法: atf dlq list | atf dlq show|retry|skip|cancel <taskId>'); break;
    }
    const [dlqCmd, shortId] = args;
    // find DLQ file by short_id or task_id
    let dlqFile = `${DLQ_DIR}/${shortId}.json`;
    if (!fs.existsSync(dlqFile)) {
      // reverse lookup by short_id
      let found = null;
      if (fs.existsSync(DLQ_DIR)) {
        for (const f of fs.readdirSync(DLQ_DIR).filter(f => f.endsWith('.json'))) {
          const d = loadJson(`${DLQ_DIR}/${f}`);
          if (d && (d.short_id === shortId || d.task_id === shortId)) { found = f; break; }
        }
      }
      if (!found) { console.error(`❌ DLQ 任务不存在: ${shortId}`); break; }
      dlqFile = `${DLQ_DIR}/${found}`;
    }
    const dlq = loadJson(dlqFile);
    // dir_name = 真正的任务目录名，如 "48-DLQ-催办链路测试"
    const taskId = dlq.dir_name || dlq.short_id || shortId;

    // atf dlq show <taskId>
    if (dlqCmd === 'show') {
      console.log(JSON.stringify(dlq, null, 2));
      break;
    }

    // atf dlq retry <taskId>
    if (dlqCmd === 'retry') {
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const newRetry = (dlq.retry_count||0) + 1;
      const maxRetries = dlq.protocol?.max_retries || 3;
      if (newRetry > maxRetries) {
        console.log(`❌ 已达最大重试次数 ${maxRetries}，无法重试`);
        console.log('用 atf dlq skip 跳过 或 atf dlq cancel 取消');
        break;
      }
      ctx.status = 'assigned';
      ctx.protocol = ctx.protocol || {};
      ctx.protocol.retry_count = newRetry;
      ctx.dlq_entry = null;
      ctx.updated_at = new Date().toISOString();
      writeCtx(taskId, ctx);
      fs.unlinkSync(dlqFile);
      // 写 pending-task.json 通知 agent
      const ws = resolveAgentWorkspace(ctx.assigned_to);
      const pending = {
        task_id: ctx.task_id,
        description: ctx.description,
        assigned_at: new Date().toISOString(),
        retry_count: newRetry,
      };
      fs.writeFileSync(`${ws}/pending-task.json`, JSON.stringify(pending, null, 2));
      console.log(`✅ ${taskId} 重试 (${newRetry}/${maxRetries})，已写入 pending-task.json`);
      console.log(`   → ${ws}/pending-task.json`);
      break;
    }

    // atf dlq skip <taskId>  → archived
    if (dlqCmd === 'skip') {
      const ctx = readCtx(taskId);
      if (ctx) { ctx.status = 'archived'; writeCtx(taskId, ctx); }
      fs.unlinkSync(dlqFile);
      console.log(`✅ ${taskId} 已跳过 (archived)`);
      break;
    }

    // atf dlq cancel <taskId> → cancelled
    if (dlqCmd === 'cancel') {
      const ctx = readCtx(taskId);
      if (ctx) { ctx.status = 'cancelled'; writeCtx(taskId, ctx); }
      fs.unlinkSync(dlqFile);
      console.log(`✅ ${taskId} 已取消`);
      break;
    }

    console.error('用法: atf dlq list | atf dlq show|retry|skip|cancel <taskId>');
    break;
  }

  // =============================================================
  // learnings 命令 - 岚遥进化机制核心
  // =============================================================
  case 'learnings': {
    const [sub, ...restArgs] = args;
    const WORKSPACES = [...new Set([WORKSPACE_DIR, ...Object.values(AGENT_WORKSPACES)])];
    const TYPES = {
      errors: { file: 'ERRORS.md', name: 'ERROR' },
      learnings: { file: 'LEARNINGS.md', name: 'LEARN' },
      features: { file: 'FEATURES.md', name: 'FEATURE' },
    };
    const today = new Date().toISOString().substring(0,10).replace(/-/g,'');
    const seq = String(Math.floor(Math.random()*999)+1).padStart(3,'0');
    const lrnId = `LRN-${today}-${seq}`;

    if (sub === 'scan') {
      const total = { errors: 0, learnings: 0, features: 0 };
      const seen = new Map(); // body前80字符 -> [{ws, type, body}]
      for (const ws of WORKSPACES) {
        const ldir = path.join(ws, '.learnings');
        if (!fs.existsSync(ldir)) continue;
        for (const [key, t] of Object.entries(TYPES)) {
          const fpath = path.join(ldir, t.file);
          if (!fs.existsSync(fpath)) continue;
          const content = fs.readFileSync(fpath, 'utf-8');
          // 匹配每个 [LRN-YYYYMMDD-NNN] 条目（到下一个 [LRN- 或文件末尾）
          const regex = /\[LRN-(\d{8})-(\d+)\]\n([\s\S]*?)(?=\n\[LRN-\d{8}-\d+\]|\n#+[^\n]*\n|$)/g;
          let m;
          while ((m = regex.exec(content)) !== null) {
            const body = m[3].trim();
            if (!body) continue;
            total[key]++;
            const k = body.substring(0,80).replace(/\s/g,'');
            if (!seen.has(k)) seen.set(k,[]);
            seen.get(k).push({ws: path.basename(ws), type: key, body});
          }
        }
      }
      console.log('\nlearnings scan');
      for (const [k,v] of Object.entries(total)) console.log(`  ${k}: ${v} entries`);
      const promotable = [...seen.entries()].filter(([,occ])=>occ.length>=3);
      if (promotable.length) {
        console.log(`\n  可promote（≥3次）:`);
        for (const [body, occ] of promotable) {
          const r = occ[0];
          const agents = [...new Set(occ.map(e=>e.ws))].join(',');
          console.log(`    [${r.type.toUpperCase()}] ×${occ.length} | ${r.body.substring(0,50)}... | ${agents}`);
        }
      } else {
        console.log(`  可promote: 0 条（出现≥3次）`);
      }
      break;
    }

    if (sub === 'add') {
      const [type, ...bodyParts] = restArgs;
      if (!type || !bodyParts.length) {
        console.error('用法: atf learnings add errors|learnings|features <内容>'); break;
      }
      const t = TYPES[type.toLowerCase()];
      if (!t) { console.error('类型: errors|learnings|features'); break; }
      const ws = process.cwd();
      // 找 workspace
      let foundWs = null;
      for (const w of WORKSPACES) {
        if (ws.startsWith(w) || w.startsWith(ws.substring(0,20))) { foundWs = w; break; }
      }
      const targetWs = foundWs || WORKSPACES[0];
      const ldir = path.join(targetWs, '.learnings');
      if (!fs.existsSync(ldir)) fs.mkdirSync(ldir, { recursive: true });
      const fpath = path.join(ldir, t.file);
      const body = bodyParts.join(' ');
      const entry = `\n[${lrnId}]
${body}\n`;
      fs.appendFileSync(fpath, entry);
      console.log(`✅ [${lrnId}] 写入 ${targetWs}/.learnings/${t.file}`);
      console.log(`   ${t.name}: ${body.substring(0,80)}${body.length>80?'...':''}`);
      break;
    }

    if (sub === 'list') {
      console.log('\nlearnings 列表\n');
      for (const ws of WORKSPACES) {
        const ldir = path.join(ws, '.learnings');
        if (!fs.existsSync(ldir)) continue;
        console.log(`workspace: ${path.basename(ws)}`);
        for (const [key, t] of Object.entries(TYPES)) {
          const fpath = path.join(ldir, t.file);
          if (!fs.existsSync(fpath)) continue;
          const lines = fs.readFileSync(fpath,'utf-8').split('\n');
          let count = 0, promoted = 0;
          for (const l of lines) {
            if (l.match(/^\[LRN-\d{8}-\d+\]/)) count++;
            if (l.includes('[PROMOTED]')) promoted++;
          }
          console.log(`  ${t.name}: ${count} (promoted: ${promoted})`);
        }
      }
      break;
    }

    if (sub === 'promote') {
      // 调用 learnings-promote.cjs --promote
      const out = execSync(`node "${LEARNINGS_PROMOTE_SCRIPT}" --promote`, { encoding:'utf-8' });
      console.log(out);
      break;
    }

    console.error('用法:\n  atf learnings add errors|learnings|features <内容>  记录一条\n  atf learnings list                               查看列表\n  atf learnings scan                               扫描统计\n  atf learnings promote                            执行 promote');
    break;
  }

  // ── 标记已送达（completed ≠ delivered）────────────────────
  case 'delivered': {
    const taskId = args[0];
    if (!taskId) { console.error('用法: atf delivered <taskId>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    ctx.status = 'delivered';
    ctx.protocol = ctx.protocol || {};
    ctx.protocol.delivery_status = 'delivered';
    writeCtx(taskId, ctx);
    const hf = `${TASKS_DIR}/${taskId}/notifications/history.json`;
    const h = loadJson(hf)||[]; h.push({event:'delivered',at:new Date().toISOString()}); saveJson(hf,h.slice(-50));
    console.log(`✅ ${taskId} → delivered`);
    break;
  }

  // ── DRI（唯一责任人）─────────────────────────────────────
  case 'dri': {
    const [taskId, driAgent] = args;
    if (!taskId) { console.error('用法: atf dri <taskId> [agent]'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    if (!driAgent) { console.log(`DRI: ${ctx.dri||'-'}  (非DRI只能补充，不能覆盖结论)`); break; }
    ctx.dri = driAgent;
    writeCtx(taskId, ctx);
    console.log(`✅ ${taskId} DRI → ${driAgent}`);
    break;
  }

  // ── block：阻塞任务，等待 Vinson 决策 ─────────────────────
  case 'block': {
    const [taskId, ...questionParts] = args;
    if (!taskId || !questionParts.length) { console.error('用法: atf block <taskId> <问题>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const question = questionParts.join(' ');
    const now = new Date().toISOString();

    // 更新 ctx
    ctx.status = 'blocked';
    ctx.decision = { status: 'waiting', question, asked_at: now };
    writeCtx(taskId, ctx);

    // 写 pending-decisions.md（供 Watcher 检查并通知 Vinson）
    const pdPath = PENDING_DECISIONS_MD;
    const entry = {
      task_id: taskId,
      description: ctx.description,
      status: 'waiting',
      question,
      asked_by: ctx.assigned_to || 'pinchymeow',
      asked_at: now,
    };
    let pdList = [];
    if (fs.existsSync(pdPath)) {
      const content = fs.readFileSync(pdPath, 'utf-8');
      // 提取现有 JSON 块
      const matches = [...content.matchAll(/```json\n({[\s\S]*?})\n```/g)];
      for (const m of matches) {
        try { pdList.push(JSON.parse(m[1])); } catch {}
      }
    }
    // 替换同 task_id 条目或追加
    pdList = pdList.filter(p => p.task_id !== taskId);
    pdList.push(entry);
    const md = `# Pending Decisions - 待决策事项\n\n**最后更新**: ${now}\n\n---\n\n## 当前议项\n\n${pdList.filter(p => p.status === 'waiting').map(p => `- **[${p.task_id}]** ${p.question}\n  - 任务: ${p.description}\n  - 来自: ${p.asked_by}`).join('\n\n')}\n\n---\n\n## 已关闭议题\n\n${pdList.filter(p => p.status !== 'waiting').map(p => `- ~~${p.task_id}: ${p.question} → **${p.status}** (${p.answer || p.feedback||''})`).join('\n')}\n\n---\n\n## 决策记录\n\n${pdList.filter(p => p.status !== 'waiting').map(p => `### ${p.task_id} - ${p.decided_at||p.asked_at}\n\n**问题**: ${p.question}\n\n**结论**: ${p.answer || p.feedback}\n\n**决策者**: Vinson\n`).join('\n---\n')}\n`;
    fs.writeFileSync(pdPath, md);

    // Write JSON for Watcher
    const pdJsonPath = PENDING_DECISIONS_JSON;
    const jEntry = {
      task_id: taskId, description: ctx.description, status: 'waiting',
      question, asked_by: ctx.assigned_to || 'pinchymeow', asked_at: now,
    };
    let jList = loadJson(pdJsonPath) || [];
    jList = jList.filter(p => p.task_id !== taskId);
    jList.push(jEntry);
    saveJson(pdJsonPath, jList);

    // 删除 pending-task.json（阻塞时不让 agent 继续拿任务）
    const dir = dirOfTaskId(taskId);
    const ptPath = `${TASKS_DIR}/${dir}/pending-task.json`;
    if (fs.existsSync(ptPath)) fs.unlinkSync(ptPath);

    console.log(`✅ ${taskId} 已阻塞，等待决策`);
    console.log(`   问题: ${question}`);
    console.log(`   → pending-decisions.md 已更新`);
    break;
  }

  // ── decide：Vinson 回答，继续执行 ────────────────────────
  case 'decide': {
    const [taskId, ...answerParts] = args;
    if (!taskId || !answerParts.length) { console.error('用法: atf decide <taskId> <回答>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    if (ctx.decision?.status !== 'waiting') { console.error('❌ 该任务没有等待中的决策'); break; }
    const answer = answerParts.join(' ');
    const now = new Date().toISOString();

    // 更新 ctx
    ctx.status = 'assigned';
    ctx.decision = { status: 'decided', question: ctx.decision.question, answer, decided_at: now };
    writeCtx(taskId, ctx);

    // 写 pending-task.json 恢复 agent 执行
    const dir = dirOfTaskId(taskId);
    const ptPath = `${TASKS_DIR}/${dir}/pending-task.json`;
    const pending = {
      task_id: taskId,
      assigned_to: ctx.assigned_to,
      description: ctx.description,
      instructions: ctx.instructions || null,
      decision: { type: 'answered', question: ctx.decision.question, answer },
      created_by: 'pinchymeow',
      created_at: now,
    };
    fs.writeFileSync(ptPath, JSON.stringify(pending, null, 2));

    // Update pending-decisions.json (Watcher reads this)
    const pdJsonPath = PENDING_DECISIONS_JSON;
    const q = ctx.decision.question;
    const entry = {
      task_id: taskId, description: ctx.description, status: 'decided',
      question: q, answer, asked_by: ctx.assigned_to || 'pinchymeow',
      asked_at: ctx.decision.asked_at, decided_at: now,
    };
    let pdList = loadJson(pdJsonPath) || [];
    pdList = pdList.filter(p => p.task_id !== taskId);
    pdList.push(entry);
    saveJson(pdJsonPath, pdList);


    console.log(`✅ ${taskId} 决策已收到，继续执行`);
    console.log(`   问题: ${ctx.decision.question}`);
    console.log(`   回答: ${answer}`);
    console.log(`   → pending-task.json 已写入，agent 继续执行`);
    break;
  }

  // ── revise：Vinson 不满意，打回重做 ─────────────────────
  case 'revise': {
    const [taskId, ...feedbackParts] = args;
    if (!taskId || !feedbackParts.length) { console.error('用法: atf revise <taskId> <反馈>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const feedback = feedbackParts.join(' ');
    const now = new Date().toISOString();

    // 更新 ctx
    ctx.status = 'assigned';
    ctx.decision = { status: 'needs_revision', feedback, revised_at: now };
    writeCtx(taskId, ctx);

    // 写 pending-task.json 通知 agent 重做
    const dir = dirOfTaskId(taskId);
    const ptPath = `${TASKS_DIR}/${dir}/pending-task.json`;
    const pending = {
      task_id: taskId,
      assigned_to: ctx.assigned_to,
      description: ctx.description,
      instructions: ctx.instructions || null,
      decision: { type: 'revision', feedback },
      created_by: 'pinchymeow',
      created_at: now,
    };
    fs.writeFileSync(ptPath, JSON.stringify(pending, null, 2));

    console.log(`✅ ${taskId} 已打回重做`);
    console.log(`   反馈: ${feedback}`);
    console.log(`   → pending-task.json 已写入，agent 重新执行`);
    break;
  }

  default:
    console.error(`未知命令: ${cmd}`);
    console.error('用法: atf create|list|status|assign|update|fan-out|focus|trigger|reflect|shared|msg|dlq|learnings|delivered|dri|ctx|nextnum|block|decide|revise');
}
