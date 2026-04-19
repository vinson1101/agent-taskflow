#!/usr/bin/env node
/**
 * ATF CLI v2 - 统一任务仓库
 * 所有任务存储在 /root/.openclaw/atf-tasks/
 * 每个任务目录包含: ctx.json, latest.json, README.md, progress.md, research/, notifications/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomBytes } = require('crypto');
const { execSync } = require('child_process');

// ============================================================
// 统一配置
// ============================================================
const DEFAULT_OPENCLAW_ROOT = process.platform === 'win32'
  ? path.join(os.homedir(), '.openclaw')
  : '/root/.openclaw';
const OPENCLAW_ROOT = process.env.ATF_ROOT || DEFAULT_OPENCLAW_ROOT;
const WORKSPACE_DIR = process.env.ATF_WORKSPACE_DIR || `${OPENCLAW_ROOT}/workspace`;
const TASKS_DIR = process.env.ATF_TASKS_DIR || `${OPENCLAW_ROOT}/atf-tasks`;
const DLQ_DIR = `${TASKS_DIR}/dlq`;
const DATA_DIR = process.env.ATF_DATA_DIR || `${WORKSPACE_DIR}/agent-taskflow/data`;
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE  = `${DATA_DIR}/tasks.json`;
const SCORES_FILE = `${DATA_DIR}/scores.json`;
const CREDITS_FILE = `${DATA_DIR}/credits.json`;
const TRIGGER_INBOX_DIR = `${DATA_DIR}/trigger-inboxes`;
const PENDING_TRIGGER_FIRES_FILE = `${DATA_DIR}/pending-trigger-fires.json`;
const ACTION_INBOX_DIR = `${DATA_DIR}/action-inboxes`;
const PENDING_ACTIONS_FILE = `${DATA_DIR}/pending-actions.json`;
const ACTION_WATCHER_RUNS_DIR = `${DATA_DIR}/action-watcher-runs`;
const ACTION_WATCHER_LATEST_FILE = `${ACTION_WATCHER_RUNS_DIR}/latest.json`;
const PENDING_DECISIONS_MD = process.env.ATF_PENDING_DECISIONS_MD || `${WORKSPACE_DIR}/pending-decisions.md`;
const PENDING_DECISIONS_JSON = process.env.ATF_PENDING_DECISIONS_JSON || `${WORKSPACE_DIR}/pending-decisions.json`;
const LEARNINGS_PROMOTE_SCRIPT = process.env.ATF_LEARNINGS_PROMOTE_SCRIPT || `${WORKSPACE_DIR}/bin/learnings-promote.cjs`;
const DEFAULT_AGENT_WORKSPACE = process.env.ATF_DEFAULT_AGENT_WORKSPACE || WORKSPACE_DIR;
function buildConfiguredAgentWorkspaces() {
  const workspaces = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('ATF_WORKSPACE_') || !value) continue;
    const suffix = key.substring('ATF_WORKSPACE_'.length);
    if (!suffix || suffix === 'DIR') continue;
    const agent = suffix.toLowerCase().replace(/_/g, '-');
    if (!agent) continue;
    workspaces[agent] = value;
  }
  return workspaces;
}
const AGENT_WORKSPACES = buildConfiguredAgentWorkspaces();
const MESSAGE_TYPES = new Set(['info', 'request', 'decision_request', 'decision_reply', 'handoff', 'feedback', 'blocker']);
const RECEIPT_TYPES = new Set(['delivered', 'seen', 'acked', 'expired', 'failed']);
const SHARED_ENTRY_TYPES = new Set(['context', 'decision', 'intel', 'result', 'note', 'risk']);
const FOCUS_STATUSES = new Set(['open', 'in_progress', 'blocked', 'done', 'dropped']);
const TRIGGER_TYPES = new Set(['cron', 'interval', 'on_message', 'on_status_change', 'on_blocked']);
const TRIGGER_STATUSES = new Set(['active', 'paused', 'fired', 'archived']);
const TRIGGER_FIRE_STATUSES = new Set(['pending', 'consumed', 'ignored']);
const TRIGGER_EXECUTION_MODES = new Set(['pending_task', 'message', 'room', 'noop']);
const ACTION_KINDS = new Set(['stale_review_follow_up', 'pending_reply_follow_up', 'decision_follow_up']);
const ACTION_STATUSES = new Set(['pending', 'executed', 'skipped', 'archived']);
const ACTION_EXECUTION_MODES = new Set(['message', 'pending_task', 'noop']);
const ACTION_WATCHER_RUN_STATUSES = new Set(['completed', 'failed']);
const REFLECTION_FIELDS = new Set(['what_changed', 'what_failed', 'what_should_repeat', 'what_needs_decision']);
const REVIEW_TYPES = new Set(['task', 'delivery', 'collaboration']);
const REVIEW_OUTCOMES = new Set(['approved', 'needs_revision', 'rejected']);
const REVIEW_SCORE_FIELDS = ['overall', 'quality', 'timeliness', 'communication', 'ownership'];
const TASK_PROFILE_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const HANDOFF_CONTEXT_LIMIT = 5;
const HANDOFF_REFLECTION_LIMIT = 2;

if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR,   { recursive: true });
if (!fs.existsSync(TRIGGER_INBOX_DIR)) fs.mkdirSync(TRIGGER_INBOX_DIR, { recursive: true });
if (!fs.existsSync(ACTION_INBOX_DIR)) fs.mkdirSync(ACTION_INBOX_DIR, { recursive: true });

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

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function averageNumbers(values) {
  const nums = (values || []).filter(value => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function isClearedValue(value) {
  if (value === undefined || value === null) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || normalized === '-' || normalized === 'none' || normalized === 'null';
}

function normalizeTaskTypeValue(value) {
  if (isClearedValue(value)) return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeTaskTags(tags) {
  const values = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',');
  return [...new Set(values
    .map(tag => String(tag || '').trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean))].sort();
}

function normalizeTaskProfile(profile = {}, baseProfile = null) {
  const base = baseProfile && typeof baseProfile === 'object' ? baseProfile : {};
  const normalized = {
    type: Object.prototype.hasOwnProperty.call(profile, 'type')
      ? normalizeTaskTypeValue(profile.type)
      : normalizeTaskTypeValue(base.type),
    difficulty: Object.prototype.hasOwnProperty.call(profile, 'difficulty')
      ? (Number.isInteger(profile.difficulty) && profile.difficulty >= 1 && profile.difficulty <= 5 ? profile.difficulty : null)
      : (Number.isInteger(base.difficulty) && base.difficulty >= 1 && base.difficulty <= 5 ? base.difficulty : null),
    priority: Object.prototype.hasOwnProperty.call(profile, 'priority')
      ? (isClearedValue(profile.priority) ? null : (TASK_PROFILE_PRIORITIES.has(String(profile.priority).trim().toLowerCase()) ? String(profile.priority).trim().toLowerCase() : null))
      : (TASK_PROFILE_PRIORITIES.has(String(base.priority || '').trim().toLowerCase()) ? String(base.priority).trim().toLowerCase() : null),
    tags: Object.prototype.hasOwnProperty.call(profile, 'tags')
      ? normalizeTaskTags(profile.tags)
      : normalizeTaskTags(base.tags || []),
  };
  return normalized;
}

function getTaskProfile(ctx) {
  return normalizeTaskProfile(ctx?.task_profile || {}, null);
}

function hasTaskProfile(profileInput) {
  const profile = profileInput?.task_profile !== undefined || profileInput?.task_id !== undefined
    ? getTaskProfile(profileInput)
    : normalizeTaskProfile(profileInput || {}, null);
  return Boolean(profile.type || profile.difficulty || profile.priority || profile.tags.length);
}

function formatTaskProfileSummary(profileInput, options = {}) {
  const fallback = options.fallback || 'no profile';
  const profile = profileInput?.task_profile !== undefined || profileInput?.task_id !== undefined
    ? getTaskProfile(profileInput)
    : normalizeTaskProfile(profileInput || {}, null);
  if (!hasTaskProfile(profile)) return fallback;
  const parts = [];
  if (profile.type) parts.push(`type=${profile.type}`);
  if (profile.difficulty) parts.push(`difficulty=${profile.difficulty}`);
  if (profile.priority) parts.push(`priority=${profile.priority}`);
  if (profile.tags.length) parts.push(`tags=${profile.tags.join(',')}`);
  return parts.join('  ');
}

function parseTaskProfileArgs(parts = []) {
  const profile = {};
  const descriptionTokens = [];
  const errors = [];
  const tags = new Set();
  let matched = false;

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('type=')) {
      matched = true;
      profile.type = normalizeTaskTypeValue(part.substring('type='.length));
      continue;
    }
    if (part.startsWith('difficulty=')) {
      matched = true;
      const raw = part.substring('difficulty='.length);
      if (isClearedValue(raw)) {
        profile.difficulty = null;
      } else {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > 5) errors.push('difficulty 必须是 1-5 的整数');
        else profile.difficulty = value;
      }
      continue;
    }
    if (part.startsWith('priority=')) {
      matched = true;
      const raw = part.substring('priority='.length);
      if (isClearedValue(raw)) {
        profile.priority = null;
      } else {
        const normalized = String(raw).trim().toLowerCase();
        if (!TASK_PROFILE_PRIORITIES.has(normalized)) errors.push(`priority 只能是 ${[...TASK_PROFILE_PRIORITIES].join('|')}`);
        else profile.priority = normalized;
      }
      continue;
    }
    if (part.startsWith('tags=')) {
      matched = true;
      for (const tag of normalizeTaskTags(part.substring('tags='.length))) tags.add(tag);
      profile.tags = [...tags];
      continue;
    }
    if (part.startsWith('tag=')) {
      matched = true;
      for (const tag of normalizeTaskTags(part.substring('tag='.length))) tags.add(tag);
      profile.tags = [...tags];
      continue;
    }
    descriptionTokens.push(part);
  }

  if (!profile.tags) profile.tags = [];
  return { profile, descriptionTokens, errors, matched };
}

function parseProtocolTimeoutValue(raw, fieldName) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return { error: `${fieldName} 不能为空` };
  const durationSeconds = parseDurationSeconds(normalized);
  if (durationSeconds !== null) return { value: durationSeconds };
  const seconds = Number(normalized);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    return { error: `${fieldName} 必须是正整数秒数，或像 40m / 2h 这样的时长` };
  }
  return { value: seconds };
}

function parseProtocolTimeoutArgs(parts = []) {
  const protocol = {};
  const remainingParts = [];
  const errors = [];
  let matched = false;

  const consumeField = (fieldName, raw) => {
    matched = true;
    const parsed = parseProtocolTimeoutValue(raw, fieldName);
    if (parsed.error) errors.push(parsed.error);
    else protocol[fieldName] = parsed.value;
  };

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;

    if (part.startsWith('confirm_timeout=')) {
      consumeField('confirm_timeout', part.substring('confirm_timeout='.length));
      continue;
    }
    if (part.startsWith('final_timeout=')) {
      consumeField('final_timeout', part.substring('final_timeout='.length));
      continue;
    }
    if (part.startsWith('confirm-timeout=')) {
      consumeField('confirm_timeout', part.substring('confirm-timeout='.length));
      continue;
    }
    if (part.startsWith('final-timeout=')) {
      consumeField('final_timeout', part.substring('final-timeout='.length));
      continue;
    }
    if (part.startsWith('--confirm-timeout=')) {
      consumeField('confirm_timeout', part.substring('--confirm-timeout='.length));
      continue;
    }
    if (part.startsWith('--final-timeout=')) {
      consumeField('final_timeout', part.substring('--final-timeout='.length));
      continue;
    }
    if (part === '--confirm-timeout' || part === '--final-timeout') {
      const fieldName = part === '--confirm-timeout' ? 'confirm_timeout' : 'final_timeout';
      const raw = parts[i + 1];
      if (raw === undefined) errors.push(`${fieldName} 缺少值`);
      else consumeField(fieldName, raw);
      i += 1;
      continue;
    }

    remainingParts.push(part);
  }

  return { protocol, remainingParts, errors, matched };
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
  const threadId = fire?.thread_id || trigger?.thread_id || null;
  if (intent === 'review' && threadId && threadId.startsWith('room:')) return 'room';
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
  let toAgent = null;
  let threadId = null;
  let roomId = null;
  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('mode=')) mode = normalizeTriggerExecutionMode(part.substring('mode='.length));
    else if (part.startsWith('limit=')) {
      const value = Number(part.substring('limit='.length));
      if (Number.isFinite(value) && value > 0) limit = Math.floor(value);
    } else if (part.startsWith('note=')) note = part.substring('note='.length) || null;
    else if (part.startsWith('to=')) toAgent = part.substring('to='.length) || null;
    else if (part.startsWith('thread=')) threadId = part.substring('thread='.length) || null;
    else if (part.startsWith('room=')) roomId = part.substring('room='.length) || null;
    else if (part.startsWith('executor=')) executor = part.substring('executor='.length) || executor;
    else if (!target) target = part;
    else executor = part;
  }
  return { target, executor, mode, limit, note, toAgent, threadId, roomId };
}

function compactText(text, maxLength = 220) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeReviewScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) return null;
  return roundNumber(numeric, 1);
}

function normalizeReviewScores(scores = {}) {
  const normalized = {};
  for (const field of REVIEW_SCORE_FIELDS) {
    if (scores[field] === undefined || scores[field] === null || scores[field] === '') continue;
    const value = normalizeReviewScore(scores[field]);
    if (value === null) return null;
    normalized[field] = value;
  }
  if (normalized.overall === undefined) {
    const derived = averageNumbers(
      REVIEW_SCORE_FIELDS
        .filter(field => field !== 'overall')
        .map(field => normalized[field])
    );
    if (derived !== null) normalized.overall = roundNumber(derived, 1);
  }
  return normalized;
}

function isReputationAgent(actor) {
  if (!actor || typeof actor !== 'string') return false;
  const normalized = actor.trim();
  if (!normalized || normalized.startsWith('room:')) return false;
  if (normalized === '-') return false;
  if (normalized === 'trigger-executor') return false;
  if (normalized.startsWith('watcher')) return false;
  if (normalized.startsWith('adapter-')) return false;
  return true;
}

function buildDefaultAgentRegistry() {
  return {
    schema: 'atf.agents.v1',
    updated_at: new Date().toISOString(),
    agents: Object.entries(AGENT_WORKSPACES)
      .filter(([agent]) => isReputationAgent(agent))
      .map(([agent, workspace]) => ({
        agent,
        workspace: workspace || inferAgentWorkspace(agent),
        source: 'workspace',
        enabled: true,
      }))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function normalizeAgentName(agent) {
  if (!isReputationAgent(agent)) return null;
  const normalized = String(agent).trim();
  return normalized || null;
}

function inferAgentWorkspace(agent) {
  const normalized = normalizeAgentName(agent);
  if (!normalized) return DEFAULT_AGENT_WORKSPACE;
  return AGENT_WORKSPACES[normalized] || `${OPENCLAW_ROOT}/workspace-${normalized}`;
}

function normalizeAgentRegistryItem(agent, value = null, fallbackSource = 'registry') {
  const normalized = normalizeAgentName(agent);
  if (!normalized) return null;
  if (typeof value === 'string') {
    return {
      agent: normalized,
      workspace: value || inferAgentWorkspace(normalized),
      source: fallbackSource,
      enabled: true,
    };
  }

  const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    agent: normalized,
    workspace: item.workspace || inferAgentWorkspace(normalized),
    source: item.source || fallbackSource,
    enabled: item.enabled !== false,
  };
}

function normalizeAgentRegistryObjectEntries(entries, fallbackSource = 'registry') {
  return entries
    .map(([agent, value]) => normalizeAgentRegistryItem(agent, value, fallbackSource))
    .filter(Boolean);
}

function extractAgentRegistryItems(registry) {
  if (Array.isArray(registry)) return registry;
  if (!registry || typeof registry !== 'object') return [];
  if (Array.isArray(registry.agents)) return registry.agents;
  if (registry.agents && typeof registry.agents === 'object') {
    return normalizeAgentRegistryObjectEntries(Object.entries(registry.agents), 'registry');
  }
  if (Array.isArray(registry.items)) return registry.items;
  if (registry.items && typeof registry.items === 'object') {
    return normalizeAgentRegistryObjectEntries(Object.entries(registry.items), 'registry');
  }

  const reservedKeys = new Set(['schema', 'updated_at', 'version', 'meta', 'items']);
  const entries = Object.entries(registry).filter(([key]) => !reservedKeys.has(key));
  const looksLikeAgentMap = entries.length > 0 && entries.every(([key, value]) => {
    if (!isReputationAgent(key)) return false;
    if (value == null) return true;
    if (typeof value === 'string') return true;
    return typeof value === 'object' && !Array.isArray(value);
  });
  return looksLikeAgentMap
    ? normalizeAgentRegistryObjectEntries(entries, 'registry')
    : [];
}

function normalizeAgentRegistry(registry) {
  const defaults = buildDefaultAgentRegistry();
  const agents = new Map(defaults.agents.map(entry => [entry.agent, entry]));
  const items = extractAgentRegistryItems(registry);

  for (const item of items) {
    const agentName = typeof item === 'string'
      ? item
      : (item?.agent || item?.name || item?.id);
    const normalized = normalizeAgentName(agentName);
    if (!normalized) continue;
    const normalizedItem = normalizeAgentRegistryItem(normalized, item, typeof item === 'string' ? 'registry' : (item?.source || 'registry'));
    if (!normalizedItem) continue;
    agents.set(normalized, normalizedItem);
  }

  return {
    schema: 'atf.agents.v1',
    updated_at: registry?.updated_at || defaults.updated_at,
    agents: [...agents.values()]
      .filter(entry => isReputationAgent(entry.agent))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function loadAgentRegistry(options = {}) {
  const existing = loadJson(AGENTS_FILE);
  const normalized = existing ? normalizeAgentRegistry(existing) : buildDefaultAgentRegistry();
  if (options.persistIfMissing && !existing) saveJson(AGENTS_FILE, normalized);
  return normalized;
}

function saveAgentRegistry(registry) {
  const normalized = normalizeAgentRegistry(registry);
  normalized.updated_at = new Date().toISOString();
  saveJson(AGENTS_FILE, normalized);
  return normalized;
}

function upsertAgentRegistryEntry(agent, options = {}) {
  const normalized = normalizeAgentName(agent);
  if (!normalized) throw new Error('非法 agent 名');
  const registry = loadAgentRegistry({ persistIfMissing: true });
  const existing = registry.agents.find(entry => entry.agent === normalized) || null;
  const nextEntry = {
    agent: normalized,
    workspace: options.workspace || existing?.workspace || inferAgentWorkspace(normalized),
    source: options.source || existing?.source || 'manual',
    enabled: options.enabled === undefined ? (existing ? existing.enabled !== false : true) : options.enabled !== false,
  };
  const saved = saveAgentRegistry({
    ...registry,
    agents: [
      ...registry.agents.filter(entry => entry.agent !== normalized),
      nextEntry,
    ],
  });
  return {
    created: !existing,
    updated: Boolean(existing),
    entry: saved.agents.find(item => item.agent === normalized) || nextEntry,
    registry: saved,
  };
}

function getRegisteredAgentSet(options = {}) {
  return new Set(
    loadAgentRegistry(options).agents
      .filter(entry => entry.enabled !== false)
      .map(entry => entry.agent)
  );
}

function isRegisteredAgent(agent, registryOrSet = null) {
  if (!isReputationAgent(agent)) return false;
  const normalized = String(agent).trim();
  const set = registryOrSet instanceof Set
    ? registryOrSet
    : getRegisteredAgentSet();
  return set.has(normalized);
}

function isUnassignedAgentValue(agent) {
  if (agent === null || agent === undefined) return true;
  const normalized = String(agent).trim();
  return !normalized || normalized === '-';
}

function formatAgentDisplay(agent, registryOrSet = null) {
  if (isUnassignedAgentValue(agent)) return '[unassigned]';
  const normalized = String(agent).trim();
  return isRegisteredAgent(normalized, registryOrSet)
    ? normalized
    : `${normalized} [unknown]`;
}

function sortByTimestamp(items, field = 'created_at') {
  return [...(items || [])].sort((a, b) => (a?.[field] || '').localeCompare(b?.[field] || ''));
}

function buildExecutionError(message, code = 'EXECUTION_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sharedContextRelevanceScore(entry, focusId = null, threadId = null) {
  let score = 0;
  if (focusId && entry.focus_id === focusId) score += 2;
  if (threadId && entry.thread_id === threadId) score += 2;
  if (!entry.focus_id && !entry.thread_id) score += 1;
  return score;
}

function selectSharedContextEntries(taskId, shortId, focusId = null, threadId = null, limit = HANDOFF_CONTEXT_LIMIT) {
  const sharedContext = readSharedContext(taskId, shortId) || { entries: [] };
  const entries = [...(sharedContext.entries || [])]
    .map(entry => ({ ...entry, __score: sharedContextRelevanceScore(entry, focusId, threadId) }))
    .filter(entry => entry.__score > 0 || (!focusId && !threadId))
    .sort((a, b) => {
      const scoreDiff = b.__score - a.__score;
      if (scoreDiff) return scoreDiff;
      return (b.created_at || '').localeCompare(a.created_at || '');
    })
    .slice(0, limit)
    .reverse();

  return entries.map(({ __score, ...entry }) => ({
    entry_id: entry.entry_id,
    type: entry.entry_type,
    author: entry.author,
    focus_id: entry.focus_id || null,
    thread_id: entry.thread_id || null,
    tags: entry.tags || [],
    content: compactText(entry.content, 280),
    created_at: entry.created_at,
  }));
}

function buildThreadMessageSnapshot(taskId, threadId = null, limit = HANDOFF_CONTEXT_LIMIT) {
  if (!threadId) return [];
  return sortByTimestamp(readTaskMessages(taskId).filter(message => message.thread_id === threadId))
    .slice(-limit)
    .map(message => ({
      message_id: message.message_id,
      from_agent: message.from_agent,
      to_agent: message.to_agent,
      message_type: message.message_type,
      body: compactText(message.body, 240),
      created_at: message.created_at,
      status: effectiveMessageStatus(message),
      reply_to_message_id: message.reply_to_message_id || null,
    }));
}

function buildReflectionSummarySnapshot(taskId, focusId = null, limitPerField = HANDOFF_REFLECTION_LIMIT) {
  let reflections = readTaskReflections(taskId);
  if (focusId) reflections = reflections.filter(reflection => reflection.focus_id === focusId);
  return [...REFLECTION_FIELDS]
    .map(field => {
      const items = reflections.filter(reflection => reflection.field === field);
      if (!items.length) return null;
      return {
        field,
        total: items.length,
        latest: sortByTimestamp(items, 'created_at').slice(-limitPerField).map(reflection => ({
          reflection_id: reflection.reflection_id,
          author: reflection.author,
          content: compactText(reflection.content, 220),
          created_at: reflection.created_at,
        })),
      };
    })
    .filter(Boolean);
}

function buildFocusSnapshot(taskId, focusId = null) {
  if (!focusId) return null;
  const focus = readFocus(taskId, focusId);
  if (!focus) return null;
  return {
    focus_id: focus.focus_id,
    title: focus.title,
    status: focus.status,
    owner_agent: focus.owner_agent,
    next_action: focus.next_action || null,
    updated_at: focus.updated_at || null,
  };
}

function inferTriggerRecommendedAction(ctx, trigger, fire, focus = null) {
  const intent = fire.intent || trigger.intent || 'generic';
  if (intent === 'follow_up') {
    return focus?.next_action
      ? `Follow up on focus "${focus.title}" and drive next action: ${focus.next_action}`
      : focus?.title
      ? `Follow up on focus "${focus.title}" and confirm latest progress.`
      : `Follow up on task ${ctx.short_id || ctx.task_id} and confirm current progress.`;
  }
  if (intent === 'review') {
    return focus?.title
      ? `Review focus "${focus.title}", capture findings, and write back concrete issues or approvals.`
      : `Review task ${ctx.short_id || ctx.task_id} and write back concrete findings.`;
  }
  return focus?.title
    ? `Handle trigger for focus "${focus.title}" and update downstream context explicitly.`
    : `Handle trigger for task ${ctx.short_id || ctx.task_id} and update downstream context explicitly.`;
}

function resolveTriggerDeliveryTarget(ctx, trigger, fire, mode, options = {}) {
  const taskId = ctx.short_id || ctx.task_id;
  const focusId = fire.focus_id || trigger.focus_id || null;
  let threadId = options.threadId || fire.thread_id || trigger.thread_id || defaultThreadId(taskId, focusId, null);
  const ownerAgent = fire.owner_agent || trigger.owner_agent || ctx.assigned_to || null;

  if (mode === 'room') {
    const roomId = options.roomId || (threadId && threadId.startsWith('room:') ? threadId.substring('room:'.length) : null);
    if (!roomId) throw buildExecutionError('room mode requires room=<name> or thread=room:<name>', 'EXECUTION_SKIPPED');
    threadId = `room:${roomId}`;
    return {
      kind: 'room',
      room_id: roomId,
      recipient: `room:${roomId}`,
      thread_id: threadId,
      focus_id: focusId,
    };
  }

  if (mode === 'message') {
    const targetAgent = options.toAgent || ownerAgent;
    if (!targetAgent) throw buildExecutionError('message mode requires target agent', 'EXECUTION_SKIPPED');
    return {
      kind: 'agent',
      agent: targetAgent,
      thread_id: threadId,
      focus_id: focusId,
    };
  }

  if (mode === 'pending_task') {
    return {
      kind: 'pending_task',
      agent: ownerAgent,
      thread_id: threadId,
      focus_id: focusId,
    };
  }

  return {
    kind: 'noop',
    thread_id: threadId,
    focus_id: focusId,
  };
}

function buildTriggerHandoff(taskId, ctx, trigger, fire, execution, deliveryTarget) {
  const shortId = ctx.short_id || ctx.task_id;
  const focusId = fire.focus_id || trigger.focus_id || null;
  const focus = buildFocusSnapshot(taskId, focusId);
  const threadId = deliveryTarget.thread_id || fire.thread_id || trigger.thread_id || null;

  return {
    schema: 'atf.trigger-handoff.v1',
    handoff_id: execution.execution_id,
    built_at: execution.dispatched_at,
    task: {
      task_id: shortId,
      status: ctx.status,
      description: ctx.description,
      instructions: ctx.instructions || null,
      task_profile: getTaskProfile(ctx),
      assigned_to: ctx.assigned_to || null,
      dri: ctx.dri || null,
    },
    focus,
    trigger: {
      trigger_id: trigger.trigger_id,
      trigger_type: trigger.trigger_type,
      trigger_spec: trigger.trigger_spec,
      intent: fire.intent || trigger.intent || 'generic',
      owner_agent: fire.owner_agent || trigger.owner_agent || null,
      note: fire.note || trigger.note || null,
      thread_id: threadId,
    },
    fire: {
      fire_id: fire.fire_id,
      fired_at: fire.fired_at,
      source_type: fire.source_type || null,
      source_ref: fire.source_ref || null,
      note: fire.note || null,
    },
    delivery: deliveryTarget,
    guidance: {
      recommended_action: inferTriggerRecommendedAction(ctx, trigger, fire, focus),
      response_contract: `Acknowledge or write back outcome explicitly for ${shortId}.`,
    },
    context: {
      shared_entries: selectSharedContextEntries(taskId, shortId, focusId, threadId),
      recent_messages: buildThreadMessageSnapshot(taskId, threadId),
      reflection_summary: buildReflectionSummarySnapshot(taskId, focusId),
      source_paths: {
        task_dir: taskDirPath(taskId),
        shared_context: sharedContextPath(taskId),
      },
    },
  };
}

function buildTriggerMessageBody(handoff, deliveryTarget, mode) {
  const parts = [
    `[${handoff.trigger.intent}] ${handoff.task.task_id} trigger fired.`,
    handoff.focus?.title ? `Focus: ${handoff.focus.title}` : `Task: ${handoff.task.description}`,
    `Action: ${handoff.guidance.recommended_action}`,
  ];
  if (handoff.trigger.note) parts.push(`Note: ${handoff.trigger.note}`);
  if (mode === 'room' && deliveryTarget.room_id) parts.push(`Room: ${deliveryTarget.room_id}`);
  return parts.join('\n');
}

function buildAdapterMessageRecord(taskId, ctx, trigger, fire, execution, deliveryTarget, handoff, mode) {
  const ttlSeconds = 24 * 60 * 60;
  const now = execution.dispatched_at;
  const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
  const toAgent = deliveryTarget.kind === 'room' ? deliveryTarget.recipient : deliveryTarget.agent;
  return {
    schema: 'atf.message.v1',
    message_id: generateId('MSG'),
    task_id: ctx.short_id || ctx.task_id,
    thread_id: deliveryTarget.thread_id,
    focus_id: deliveryTarget.focus_id || null,
    reply_to_message_id: null,
    from_agent: execution.executor,
    to_agent: toAgent,
    message_type: 'handoff',
    body: buildTriggerMessageBody(handoff, deliveryTarget, mode),
    created_at: now,
    ttl_seconds: ttlSeconds,
    expires_at: expiresAt,
    status: 'sent',
    receipt_ids: [],
    last_receipt_type: null,
    last_receipt_at: null,
    adapter_mode: mode,
    trigger_id: trigger.trigger_id,
    trigger_fire_id: fire.fire_id,
    execution_id: execution.execution_id,
    delivery_target: deliveryTarget,
    handoff,
  };
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
  return inferAgentWorkspace(agent);
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

function buildPendingTaskFromTrigger(ctx, trigger, fire, executor, options = {}) {
  const dispatchedAt = options.dispatchedAt || new Date().toISOString();
  const note = options.note || null;
  return {
    task_id: ctx.short_id || ctx.task_id,
    assigned_to: fire.owner_agent || trigger.owner_agent || ctx.assigned_to || null,
    description: ctx.description,
    instructions: ctx.instructions || null,
    task_profile: getTaskProfile(ctx),
    created_by: executor,
    created_at: dispatchedAt,
    source: 'trigger_fire',
    trigger_fire_id: fire.fire_id,
    trigger_id: fire.trigger_id,
    trigger_type: fire.trigger_type || trigger.trigger_type,
    trigger_intent: fire.intent || trigger.intent || 'generic',
    source_type: fire.source_type || null,
    source_ref: fire.source_ref || null,
    focus_id: (options.deliveryTarget && options.deliveryTarget.focus_id) || fire.focus_id || trigger.focus_id || null,
    thread_id: (options.deliveryTarget && options.deliveryTarget.thread_id) || fire.thread_id || trigger.thread_id || null,
    note: note || fire.note || trigger.note || null,
    adapter_mode: options.mode || 'pending_task',
    delivery_target: options.deliveryTarget || null,
    handoff: options.handoff || null,
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
    delivery_target: null,
    artifacts: {},
    payload: null,
    error: null,
  };

  try {
    const deliveryTarget = resolveTriggerDeliveryTarget(ctx, trigger, fire, mode, options);
    execution.delivery_target = deliveryTarget;
    execution.thread_id = deliveryTarget.thread_id || execution.thread_id;
    const handoff = buildTriggerHandoff(taskId, ctx, trigger, fire, execution, deliveryTarget);

    if (mode === 'pending_task') {
      const pendingTaskPath = `${taskDirPath(taskId)}/pending-task.json`;
      const pendingTask = buildPendingTaskFromTrigger(ctx, trigger, fire, execution.executor, {
        note: execution.note,
        dispatchedAt: now,
        mode,
        deliveryTarget,
        handoff,
      });
      fs.writeFileSync(pendingTaskPath, JSON.stringify(pendingTask, null, 2));
      execution.payload = {
        handoff,
        pending_task: pendingTask,
      };
      execution.artifacts.pending_task_path = pendingTaskPath;
    } else if (mode === 'message' || mode === 'room') {
      const message = buildAdapterMessageRecord(taskId, ctx, trigger, fire, execution, deliveryTarget, handoff, mode);
      saveMessage(taskId, message);
      appendNotificationHistory(taskId, {
        event: 'message_sent',
        message_id: message.message_id,
        from: message.from_agent,
        to: message.to_agent,
        type: message.message_type,
        adapter_mode: mode,
        thread_id: message.thread_id,
        focus_id: message.focus_id,
        at: message.created_at,
      });
      execution.payload = {
        handoff,
        message: {
          message_id: message.message_id,
          to_agent: message.to_agent,
          thread_id: message.thread_id,
          message_type: message.message_type,
        },
      };
      execution.artifacts.message_id = message.message_id;
      execution.artifacts.message_path = messagePath(taskId, message.message_id);
    } else {
      execution.payload = {
        handoff,
        task_id: ctx.short_id || ctx.task_id,
        trigger_fire_id: fire.fire_id,
        action: 'noop',
      };
    }

    fire.execution_id = execution.execution_id;
    fire.execution_mode = mode;
    fire.executed_at = now;
    fire.executed_by = execution.executor;
    fire.last_execution_id = execution.execution_id;
    fire.last_execution_status = 'dispatched';
    fire.last_execution_mode = mode;
    fire.last_execution_at = now;
    fire.last_execution_by = execution.executor;
    fire.last_execution_error = null;
    if (execution.note) {
      fire.execution_note = execution.note;
      fire.last_execution_note = execution.note;
    }
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
      target_kind: deliveryTarget.kind,
      at: now,
    });

    settleTriggerFire(taskId, fire, trigger, 'consumed', execution.executor, `executed:${mode}`);
    return execution;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const status = error.code === 'EXECUTION_SKIPPED' ? 'skipped' : 'failed';
    execution.status = status;
    execution.failed_at = failedAt;
    execution.error = {
      code: error.code || 'EXECUTION_FAILED',
      message: error.message,
    };

    fire.last_execution_id = execution.execution_id;
    fire.last_execution_status = status;
    fire.last_execution_mode = mode;
    fire.last_execution_at = failedAt;
    fire.last_execution_by = execution.executor;
    fire.last_execution_error = error.message;
    if (execution.note) fire.last_execution_note = execution.note;
    saveTriggerFire(taskId, fire);
    saveTriggerExecution(taskId, execution);

    trigger.history = appendHistoryEvent(trigger.history, {
      event: status === 'skipped' ? 'execution_skipped' : 'execution_failed',
      by: execution.executor,
      at: failedAt,
      note: `${execution.execution_id} ${mode} ${error.message}`.trim(),
      fire_id: fire.fire_id,
    });
    saveTrigger(taskId, trigger);
    appendNotificationHistory(taskId, {
      event: status === 'skipped' ? 'trigger_fire_execution_skipped' : 'trigger_fire_execution_failed',
      trigger_id: trigger.trigger_id,
      fire_id: fire.fire_id,
      execution_id: execution.execution_id,
      execution_mode: mode,
      executor: execution.executor,
      error: error.message,
      at: failedAt,
    });
    refreshTriggerIndexes();
  }
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

function reviewsDir(taskId) {
  return `${taskDirPath(taskId)}/reviews`;
}

function ensureReviewsDir(taskId) {
  const dir = reviewsDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function reviewPath(taskId, reviewId) {
  ensureReviewsDir(taskId);
  return `${reviewsDir(taskId)}/${reviewId}.json`;
}

function readTaskReviews(taskId) {
  ensureReviewsDir(taskId);
  return readJsonCollection(reviewsDir(taskId))
    .map(review => ({
      ...review,
      self_review: review?.self_review === undefined ? review?.reviewer === review?.reviewee : Boolean(review.self_review),
    }))
    .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
}

function readReview(taskId, reviewId) {
  return loadJson(reviewPath(taskId, reviewId));
}

function saveReview(taskId, review) {
  review.updated_at = new Date().toISOString();
  saveJson(reviewPath(taskId, review.review_id), review);
}

function isSelfReview(review) {
  return Boolean(review?.self_review ?? (review?.reviewer && review?.reviewer === review?.reviewee));
}

function createReview(taskId, ctx, reviewer, reviewee, outcome, summary, options = {}) {
  const now = new Date().toISOString();
  const scores = normalizeReviewScores(options.scores || {});
  if (!scores || !Object.keys(scores).length || scores.overall === undefined) {
    throw new Error('review requires overall score or at least one score dimension');
  }
  const review = {
    schema: 'atf.review.v1',
    review_id: generateId('REV'),
    task_id: ctx.short_id || ctx.task_id,
    focus_id: options.focus_id || null,
    thread_id: options.thread_id || null,
    trigger_id: options.trigger_id || null,
    fire_id: options.fire_id || null,
    review_type: options.review_type || 'task',
    reviewer,
    reviewee,
    self_review: reviewer === reviewee,
    outcome,
    summary,
    scores,
    created_at: now,
    updated_at: now,
  };
  saveReview(taskId, review);
  appendNotificationHistory(taskId, {
    event: 'review_added',
    review_id: review.review_id,
    review_type: review.review_type,
    reviewer: review.reviewer,
    reviewee: review.reviewee,
    self_review: review.self_review,
    outcome: review.outcome,
    overall: review.scores.overall,
    at: now,
  });
  return review;
}

function ensureReputationAgentEntry(index, agent) {
  if (!isReputationAgent(agent)) return null;
  if (!index.has(agent)) {
    index.set(agent, {
      agent,
      observed_task_ids: new Set(),
      thread_ids: new Set(),
      task_stats: {
        assigned: 0,
        dri_owned: 0,
        completed: 0,
        delivered: 0,
        blocked: 0,
        cancelled: 0,
        archived: 0,
        active: 0,
      },
      collaboration_stats: {
        messages_sent: 0,
        messages_received: 0,
        receipts_written: 0,
        reflections_authored: 0,
      },
      review_stats: {
        received: 0,
        given: 0,
        outcomes: {
          approved: 0,
          needs_revision: 0,
          rejected: 0,
        },
        score_totals: REVIEW_SCORE_FIELDS.reduce((acc, field) => ({ ...acc, [field]: 0 }), {}),
        score_counts: REVIEW_SCORE_FIELDS.reduce((acc, field) => ({ ...acc, [field]: 0 }), {}),
        reviewers: new Set(),
        recent_reviews: [],
        last_review_at: null,
      },
      task_type_stats: {},
    });
  }
  return index.get(agent);
}

function ensureReputationTaskTypeEntry(agentEntry, taskType) {
  if (!agentEntry || !taskType) return null;
  if (!agentEntry.task_type_stats[taskType]) {
    agentEntry.task_type_stats[taskType] = {
      type: taskType,
      task_stats: {
        assigned: 0,
        completed: 0,
        delivered: 0,
        blocked: 0,
        active: 0,
      },
      review_stats: {
        received: 0,
        outcomes: {
          approved: 0,
          needs_revision: 0,
          rejected: 0,
        },
        score_total: 0,
        score_count: 0,
        last_review_at: null,
      },
    };
  }
  return agentEntry.task_type_stats[taskType];
}

function buildReputationIndex() {
  const agentIndex = new Map();
  const tasks = getAllTasks();

  for (const ctx of tasks) {
    const taskId = ctx.short_id || ctx.task_id;
    const taskProfile = getTaskProfile(ctx);
    const taskType = taskProfile.type;
    const assignee = ensureReputationAgentEntry(agentIndex, ctx.assigned_to);
    const dri = ensureReputationAgentEntry(agentIndex, ctx.dri);

    if (assignee) {
      assignee.observed_task_ids.add(taskId);
      assignee.task_stats.assigned += 1;
      const delivered = ctx.status === 'delivered' || ctx.protocol?.delivery_status === 'delivered';
      if (ctx.status === 'completed' || delivered) assignee.task_stats.completed += 1;
      if (delivered) assignee.task_stats.delivered += 1;
      if (ctx.status === 'blocked') assignee.task_stats.blocked += 1;
      else if (ctx.status === 'cancelled') assignee.task_stats.cancelled += 1;
      else if (ctx.status === 'archived') assignee.task_stats.archived += 1;
      else if (ctx.status !== 'completed' && ctx.status !== 'delivered') assignee.task_stats.active += 1;
      const typeStats = ensureReputationTaskTypeEntry(assignee, taskType);
      if (typeStats) {
        typeStats.task_stats.assigned += 1;
        if (ctx.status === 'completed' || delivered) typeStats.task_stats.completed += 1;
        if (delivered) typeStats.task_stats.delivered += 1;
        if (ctx.status === 'blocked') typeStats.task_stats.blocked += 1;
        else if (ctx.status !== 'completed' && ctx.status !== 'delivered') typeStats.task_stats.active += 1;
      }
    }

    if (dri) {
      dri.observed_task_ids.add(taskId);
      dri.task_stats.dri_owned += 1;
    }

    for (const message of readTaskMessages(taskId)) {
      const sender = ensureReputationAgentEntry(agentIndex, message.from_agent);
      if (sender) {
        sender.observed_task_ids.add(taskId);
        sender.collaboration_stats.messages_sent += 1;
        if (message.thread_id) sender.thread_ids.add(message.thread_id);
      }

      const recipient = ensureReputationAgentEntry(agentIndex, message.to_agent);
      if (recipient) {
        recipient.observed_task_ids.add(taskId);
        recipient.collaboration_stats.messages_received += 1;
        if (message.thread_id) recipient.thread_ids.add(message.thread_id);
      }
    }

    for (const receipt of readTaskReceipts(taskId)) {
      const author = ensureReputationAgentEntry(agentIndex, receipt.from_agent);
      if (author) {
        author.observed_task_ids.add(taskId);
        author.collaboration_stats.receipts_written += 1;
      }
    }

    for (const reflection of readTaskReflections(taskId)) {
      const author = ensureReputationAgentEntry(agentIndex, reflection.author);
      if (author) {
        author.observed_task_ids.add(taskId);
        author.collaboration_stats.reflections_authored += 1;
      }
    }

    for (const review of readTaskReviews(taskId)) {
      if (isSelfReview(review)) continue;
      const reviewer = ensureReputationAgentEntry(agentIndex, review.reviewer);
      if (reviewer) {
        reviewer.observed_task_ids.add(taskId);
        reviewer.review_stats.given += 1;
      }

      const reviewee = ensureReputationAgentEntry(agentIndex, review.reviewee);
      if (!reviewee) continue;
      reviewee.observed_task_ids.add(taskId);
      reviewee.review_stats.received += 1;
      reviewee.review_stats.outcomes[review.outcome] += 1;
      reviewee.review_stats.last_review_at = review.created_at;
      reviewee.review_stats.reviewers.add(review.reviewer);
      for (const field of REVIEW_SCORE_FIELDS) {
        const value = review?.scores?.[field];
        if (!Number.isFinite(value)) continue;
        reviewee.review_stats.score_totals[field] += value;
        reviewee.review_stats.score_counts[field] += 1;
      }
      reviewee.review_stats.recent_reviews.push({
        review_id: review.review_id,
        task_id: review.task_id,
        reviewer: review.reviewer,
        review_type: review.review_type,
        outcome: review.outcome,
        overall: review?.scores?.overall ?? null,
        summary: compactText(review.summary, 180),
        created_at: review.created_at,
      });
      const typeStats = ensureReputationTaskTypeEntry(reviewee, taskType);
      if (typeStats) {
        typeStats.review_stats.received += 1;
        if (typeStats.review_stats.outcomes[review.outcome] !== undefined) typeStats.review_stats.outcomes[review.outcome] += 1;
        if (Number.isFinite(review?.scores?.overall)) {
          typeStats.review_stats.score_total += review.scores.overall;
          typeStats.review_stats.score_count += 1;
        }
        typeStats.review_stats.last_review_at = review.created_at;
      }
    }
  }

  const agents = [...agentIndex.values()]
    .map(entry => {
      const average_scores = {};
      for (const field of REVIEW_SCORE_FIELDS) {
        const count = entry.review_stats.score_counts[field];
        average_scores[field] = count ? roundNumber(entry.review_stats.score_totals[field] / count, 2) : null;
      }

      const assigned = entry.task_stats.assigned;
      const resolvedAssignments = Math.max(assigned - entry.task_stats.active, 0);
      const messagesReceived = entry.collaboration_stats.messages_received;
      const completionRate = resolvedAssignments ? roundNumber(entry.task_stats.completed / resolvedAssignments, 3) : null;
      const deliveryRate = resolvedAssignments ? roundNumber(entry.task_stats.delivered / resolvedAssignments, 3) : null;
      const blockedRate = resolvedAssignments ? roundNumber(entry.task_stats.blocked / resolvedAssignments, 3) : null;
      const responseRate = messagesReceived ? roundNumber(entry.collaboration_stats.receipts_written / messagesReceived, 3) : null;
      const approvalRate = entry.review_stats.received ? roundNumber(entry.review_stats.outcomes.approved / entry.review_stats.received, 3) : null;
      const overallScore = averageNumbers([
        average_scores.overall !== null ? (average_scores.overall / 5) * 100 : null,
        completionRate !== null ? completionRate * 100 : null,
        deliveryRate !== null ? deliveryRate * 100 : null,
        responseRate !== null ? responseRate * 100 : null,
        approvalRate !== null ? approvalRate * 100 : null,
      ]);
      const taskTypes = Object.values(entry.task_type_stats)
        .map(bucket => {
          const resolvedAssignments = Math.max(bucket.task_stats.assigned - bucket.task_stats.active, 0);
          const completion = resolvedAssignments ? roundNumber(bucket.task_stats.completed / resolvedAssignments, 3) : null;
          const delivery = resolvedAssignments ? roundNumber(bucket.task_stats.delivered / resolvedAssignments, 3) : null;
          const approval = bucket.review_stats.received ? roundNumber(bucket.review_stats.outcomes.approved / bucket.review_stats.received, 3) : null;
          const averageOverall = bucket.review_stats.score_count ? roundNumber(bucket.review_stats.score_total / bucket.review_stats.score_count, 2) : null;
          const bucketScore = averageNumbers([
            averageOverall !== null ? (averageOverall / 5) * 100 : null,
            completion !== null ? completion * 100 : null,
            delivery !== null ? delivery * 100 : null,
            approval !== null ? approval * 100 : null,
          ]);
          return {
            type: bucket.type,
            overall_score: bucketScore === null ? null : roundNumber(bucketScore, 1),
            task_stats: bucket.task_stats,
            review_stats: {
              received: bucket.review_stats.received,
              outcomes: bucket.review_stats.outcomes,
              average_overall: averageOverall,
              last_review_at: bucket.review_stats.last_review_at,
            },
          };
        })
        .sort((a, b) => {
          const scoreDiff = (b.overall_score ?? -1) - (a.overall_score ?? -1);
          if (scoreDiff) return scoreDiff;
          const taskDiff = (b.task_stats.assigned ?? 0) - (a.task_stats.assigned ?? 0);
          if (taskDiff) return taskDiff;
          return a.type.localeCompare(b.type);
        });

      return {
        agent: entry.agent,
        overall_score: overallScore === null ? null : roundNumber(overallScore, 1),
        task_stats: entry.task_stats,
        collaboration_stats: {
          ...entry.collaboration_stats,
          threads_participated: entry.thread_ids.size,
        },
        review_stats: {
          received: entry.review_stats.received,
          given: entry.review_stats.given,
          outcomes: entry.review_stats.outcomes,
          average_scores,
          approval_rate: approvalRate,
          unique_reviewers: entry.review_stats.reviewers.size,
          last_review_at: entry.review_stats.last_review_at,
          recent_reviews: [...entry.review_stats.recent_reviews]
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 5),
        },
        derived: {
          resolved_assignments: resolvedAssignments,
          completion_rate: completionRate,
          delivery_rate: deliveryRate,
          blocked_rate: blockedRate,
          response_rate: responseRate,
        },
        specialization: {
          dominant_task_type: taskTypes[0]?.type || null,
          task_types: taskTypes,
        },
        observed_task_count: entry.observed_task_ids.size,
        observed_task_ids: [...entry.observed_task_ids].sort(),
      };
    })
    .sort((a, b) => {
      const scoreDiff = (b.overall_score ?? -1) - (a.overall_score ?? -1);
      if (scoreDiff) return scoreDiff;
      return a.agent.localeCompare(b.agent);
    });

  const index = {
    schema: 'atf.reputation-index.v1',
    updated_at: new Date().toISOString(),
    total_tasks: tasks.length,
    total_agents: agents.length,
    agents,
  };
  saveJson(SCORES_FILE, index);
  return index;
}

function loadReputationIndex(options = {}) {
  const existing = loadJson(SCORES_FILE);
  if (existing?.schema === 'atf.reputation-index.v1' && Array.isArray(existing.agents)) return existing;
  if (options.rebuildIfMissing === false) return null;
  return buildReputationIndex();
}

function findAgentReputation(agentName, index = null) {
  if (!agentName) return null;
  const reputationIndex = index || loadReputationIndex({ rebuildIfMissing: false });
  return reputationIndex?.agents?.find(agent => agent.agent === agentName) || null;
}

function formatRate(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${roundNumber(value * 100, 1)}%`;
}

function parseIsoTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeAgeDays(value, referenceTime = null) {
  const date = value instanceof Date ? value : parseIsoTimestamp(value);
  const reference = referenceTime instanceof Date ? referenceTime : new Date();
  if (!date) return null;
  const diffMs = reference.getTime() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function computeAgeHours(value, referenceTime = null) {
  const date = value instanceof Date ? value : parseIsoTimestamp(value);
  const reference = referenceTime instanceof Date ? referenceTime : new Date();
  if (!date) return null;
  const diffMs = reference.getTime() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (60 * 60 * 1000));
}

function computeAgeMinutes(value, referenceTime = null) {
  const date = value instanceof Date ? value : parseIsoTimestamp(value);
  const reference = referenceTime instanceof Date ? referenceTime : new Date();
  if (!date) return null;
  const diffMs = reference.getTime() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (60 * 1000));
}

function getAgeBucketLabel(ageDays) {
  if (!Number.isInteger(ageDays) || ageDays < 0) return 'unknown';
  if (ageDays <= 1) return '0-1d';
  if (ageDays <= 3) return '2-3d';
  if (ageDays <= 7) return '4-7d';
  return '8d+';
}

function normalizeAgeFilterValue(value) {
  if (isClearedValue(value)) return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return undefined;
  return num;
}

function matchesAgeRange(ageDays, minAge = null, maxAge = null) {
  if (minAge === null && maxAge === null) return true;
  if (!Number.isInteger(ageDays) || ageDays < 0) return false;
  if (minAge !== null && ageDays < minAge) return false;
  if (maxAge !== null && ageDays > maxAge) return false;
  return true;
}

function getEffectiveTaskReviewStatus(ctx) {
  if (!ctx) return 'unknown';
  if (ctx.status === 'delivered' || ctx.protocol?.delivery_status === 'delivered') return 'delivered';
  return ctx.status || 'unknown';
}

function isReviewEligibleTaskStatus(status) {
  return status === 'completed' || status === 'delivered';
}

function buildTaskReviewSummary(taskId, options = {}) {
  let reviews = readTaskReviews(taskId);
  if (options.reviewee) reviews = reviews.filter(review => review.reviewee === options.reviewee);
  if (options.reviewType) reviews = reviews.filter(review => review.review_type === options.reviewType);
  const selfReviews = reviews.filter(review => isSelfReview(review));
  const externalReviews = reviews.filter(review => !isSelfReview(review));
  if (options.externalOnly) reviews = externalReviews;
  if (!reviews.length) {
    if (!selfReviews.length || options.externalOnly) return null;
    return {
      total: 0,
      external_total: 0,
      self_total: selfReviews.length,
      avg_overall: null,
      outcomes: {
        approved: 0,
        needs_revision: 0,
        rejected: 0,
      },
      review_types: {
        task: 0,
        delivery: 0,
        collaboration: 0,
      },
      reviewees: [...new Set(selfReviews.map(review => review.reviewee).filter(Boolean))].sort(),
      reviewers: [...new Set(selfReviews.map(review => review.reviewer).filter(Boolean))].sort(),
      last_review_at: [...selfReviews].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]?.created_at || null,
    };
  }

  const outcomes = {
    approved: 0,
    needs_revision: 0,
    rejected: 0,
  };
  const reviewTypes = {
    task: 0,
    delivery: 0,
    collaboration: 0,
  };
  for (const review of reviews) {
    if (outcomes[review.outcome] !== undefined) outcomes[review.outcome] += 1;
    if (reviewTypes[review.review_type] !== undefined) reviewTypes[review.review_type] += 1;
  }

  return {
    total: reviews.length,
    external_total: externalReviews.length,
    self_total: selfReviews.length,
    avg_overall: roundNumber(averageNumbers(reviews.map(review => review?.scores?.overall)), 2),
    outcomes,
    review_types: reviewTypes,
    reviewees: [...new Set(reviews.map(review => review.reviewee).filter(Boolean))].sort(),
    reviewers: [...new Set(reviews.map(review => review.reviewer).filter(Boolean))].sort(),
    last_review_at: [...reviews].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]?.created_at || null,
  };
}

function getPrimaryTaskReviewee(ctx) {
  return ctx?.assigned_to || ctx?.dri || null;
}

function taskNeedsReview(ctx, reviewee = null) {
  if (!ctx) return false;
  const targetReviewee = reviewee || getPrimaryTaskReviewee(ctx);
  if (!targetReviewee) return false;
  const reviewStatus = getEffectiveTaskReviewStatus(ctx);
  if (!isReviewEligibleTaskStatus(reviewStatus)) return false;
  const taskId = ctx.short_id || ctx.task_id;
  const reviews = readTaskReviews(taskId).filter(review =>
    review.reviewee === targetReviewee
    && !isSelfReview(review)
    && (review.review_type === 'task' || review.review_type === 'delivery')
  );
  return reviews.length === 0;
}

function collectPendingReviewTasks(agentOrOptions = null, options = {}) {
  const filters = agentOrOptions && typeof agentOrOptions === 'object' && !Array.isArray(agentOrOptions)
    ? { ...agentOrOptions }
    : { ...options, agent: agentOrOptions || options.agent || null };
  const agent = filters.agent || null;
  const typeFilter = normalizeTaskTypeValue(filters.type);
  const statusFilter = isClearedValue(filters.status) ? null : String(filters.status).trim().toLowerCase();
  const minAge = Number.isInteger(filters.min_age) && filters.min_age >= 0 ? filters.min_age : null;
  const maxAge = Number.isInteger(filters.max_age) && filters.max_age >= 0 ? filters.max_age : null;
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : null;

  const pendingTasks = getAllTasks()
    .filter(ctx => {
      const targetReviewee = agent || getPrimaryTaskReviewee(ctx);
      if (!targetReviewee) return false;
      if (agent && ctx.assigned_to !== agent && ctx.dri !== agent) return false;
      const taskProfile = getTaskProfile(ctx);
      const reviewStatus = getEffectiveTaskReviewStatus(ctx);
      if (typeFilter && taskProfile.type !== typeFilter) return false;
      if (statusFilter && reviewStatus !== statusFilter) return false;
      return taskNeedsReview(ctx, targetReviewee);
    })
    .map(ctx => {
      const taskId = ctx.short_id || ctx.task_id;
      const targetReviewee = agent || getPrimaryTaskReviewee(ctx);
      const taskProfile = getTaskProfile(ctx);
      const updatedAt = ctx.updated_at || ctx.created_at || null;
      return {
        task_id: taskId,
        description: ctx.description,
        status: getEffectiveTaskReviewStatus(ctx),
        reviewee: targetReviewee,
        updated_at: updatedAt,
        age_days: computeAgeDays(updatedAt),
        task_type: taskProfile.type || null,
        task_profile: taskProfile,
        existing_review_summary: buildTaskReviewSummary(taskId, { externalOnly: true }),
        self_review_count: readTaskReviews(taskId).filter(review => isSelfReview(review)).length,
      };
    })
    .filter(task => matchesAgeRange(task.age_days, minAge, maxAge))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  return limit ? pendingTasks.slice(0, limit) : pendingTasks;
}

function buildTaskTypeStats() {
  const buckets = new Map();
  const ensureBucket = (taskType) => {
    const key = taskType || 'untyped';
    if (!buckets.has(key)) {
      buckets.set(key, {
        type: key,
        total: 0,
        completed: 0,
        delivered: 0,
        reviews: 0,
        pending_reviews: 0,
        outcomes: {
          approved: 0,
          needs_revision: 0,
          rejected: 0,
        },
        overall_scores: [],
      });
    }
    return buckets.get(key);
  };

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    const taskProfile = getTaskProfile(ctx);
    const bucket = ensureBucket(taskProfile.type);
    const reviewStatus = getEffectiveTaskReviewStatus(ctx);
    bucket.total += 1;
    if (isReviewEligibleTaskStatus(reviewStatus)) bucket.completed += 1;
    if (reviewStatus === 'delivered') bucket.delivered += 1;

    for (const review of readTaskReviews(taskId)) {
      if (isSelfReview(review)) continue;
      bucket.reviews += 1;
      if (bucket.outcomes[review.outcome] !== undefined) bucket.outcomes[review.outcome] += 1;
      if (Number.isFinite(review?.scores?.overall)) bucket.overall_scores.push(review.scores.overall);
    }
  }

  for (const task of collectPendingReviewTasks()) {
    ensureBucket(task.task_type).pending_reviews += 1;
  }

  return [...buckets.values()]
    .map(bucket => ({
      type: bucket.type,
      total: bucket.total,
      completed: bucket.completed,
      delivered: bucket.delivered,
      completion_rate: bucket.total ? bucket.completed / bucket.total : null,
      delivery_rate: bucket.total ? bucket.delivered / bucket.total : null,
      reviews: bucket.reviews,
      pending_reviews: bucket.pending_reviews,
      outcomes: bucket.outcomes,
      avg_overall: roundNumber(averageNumbers(bucket.overall_scores), 2),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.type.localeCompare(b.type);
    });
}

function deriveTaskFeedbackState(ctx, reviewSummary = null) {
  const reviewStatus = getEffectiveTaskReviewStatus(ctx);
  if (!isReviewEligibleTaskStatus(reviewStatus)) return 'n/a';
  if (taskNeedsReview(ctx)) return 'pending';
  if (!reviewSummary || !reviewSummary.total) return 'reviewed';
  if (reviewSummary.outcomes.rejected > 0) return 'rejected';
  if (reviewSummary.outcomes.needs_revision > 0) return 'needs_revision';
  if (reviewSummary.outcomes.approved > 0) return 'approved';
  return 'reviewed';
}

function collectTaskStatsRows(options = {}) {
  const agentFilter = isClearedValue(options.agent) ? null : String(options.agent).trim();
  const typeFilter = normalizeTaskTypeValue(options.type);
  const statusFilter = isClearedValue(options.status) ? null : String(options.status).trim().toLowerCase();
  const reviewFilterRaw = isClearedValue(options.review) ? null : String(options.review).trim().toLowerCase();
  const reviewFilter = reviewFilterRaw === 'na' ? 'n/a' : reviewFilterRaw;
  const minAge = Number.isInteger(options.min_age) && options.min_age >= 0 ? options.min_age : null;
  const maxAge = Number.isInteger(options.max_age) && options.max_age >= 0 ? options.max_age : null;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;

  const rows = getAllTasks()
    .map(ctx => {
      const taskId = ctx.short_id || ctx.task_id;
      const taskProfile = getTaskProfile(ctx);
      const reviewSummary = buildTaskReviewSummary(taskId, { externalOnly: true });
      const completion = computeTaskCompletionCredits(ctx);
      const updatedAt = ctx.updated_at || ctx.created_at || null;
      const selfReviewCount = readTaskReviews(taskId).filter(review => isSelfReview(review)).length;
      return {
        task_id: taskId,
        status: getEffectiveTaskReviewStatus(ctx),
        assigned_to: ctx.assigned_to || '-',
        dri: ctx.dri || null,
        type: taskProfile.type || '-',
        priority: taskProfile.priority || '-',
        difficulty: taskProfile.difficulty || null,
        feedback_state: deriveTaskFeedbackState(ctx, reviewSummary),
        avg_overall: reviewSummary?.avg_overall ?? null,
        review_count: reviewSummary?.total ?? 0,
        self_review_count: selfReviewCount,
        completion_credits: completion?.completion_credits ?? 0,
        updated_at: updatedAt,
        age_days: computeAgeDays(updatedAt),
        description: ctx.description || '',
      };
    })
    .filter(row => {
      if (agentFilter && row.assigned_to !== agentFilter && row.dri !== agentFilter) return false;
      if (typeFilter && row.type !== typeFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (!matchesAgeRange(row.age_days, minAge, maxAge)) return false;
      if (reviewFilter && reviewFilter !== 'all') {
        if (reviewFilter === 'reviewed') return ['approved', 'needs_revision', 'rejected', 'reviewed'].includes(row.feedback_state);
        return row.feedback_state === reviewFilter;
      }
      return true;
    })
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  return limit ? rows.slice(0, limit) : rows;
}

function buildReviewCoverageStats(options = {}) {
  const agentFilter = isClearedValue(options.agent) ? null : String(options.agent).trim();
  const typeFilter = normalizeTaskTypeValue(options.type);
  const statusFilter = isClearedValue(options.status) ? null : String(options.status).trim().toLowerCase();
  const minAge = Number.isInteger(options.min_age) && options.min_age >= 0 ? options.min_age : null;
  const maxAge = Number.isInteger(options.max_age) && options.max_age >= 0 ? options.max_age : null;
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 5;
  const registeredAgents = getRegisteredAgentSet();

  const eligibleRows = getAllTasks()
    .map(ctx => {
      const taskProfile = getTaskProfile(ctx);
      return {
        ctx,
        review_status: getEffectiveTaskReviewStatus(ctx),
        reviewee: getPrimaryTaskReviewee(ctx),
        task_type: taskProfile.type || 'untyped',
      };
    })
    .filter(row => {
      if (!isReviewEligibleTaskStatus(row.review_status)) return false;
      if (agentFilter && row.ctx.assigned_to !== agentFilter && row.ctx.dri !== agentFilter) return false;
      if (typeFilter && row.task_type !== typeFilter) return false;
      if (statusFilter && row.review_status !== statusFilter) return false;
      if (!matchesAgeRange(computeAgeDays(row.ctx.updated_at || row.ctx.created_at || null), minAge, maxAge)) return false;
      return true;
    });

  const pendingTasks = collectPendingReviewTasks({
    agent: agentFilter,
    type: typeFilter,
    status: statusFilter,
    min_age: minAge,
    max_age: maxAge,
  });

  const pendingByAgent = new Map();
  const pendingByType = new Map();
  const pendingByStatus = new Map();
  const pendingByAgeBucket = new Map();
  const oldestTasks = [];
  let oldestPendingAt = null;
  let oldestPendingAgeDays = null;
  const selfReviewedTasks = new Set();

  for (const row of eligibleRows) {
    const taskId = row.ctx.short_id || row.ctx.task_id;
    const hasSelfReview = readTaskReviews(taskId).some(review =>
      review.reviewee === row.reviewee
      && isSelfReview(review)
      && (review.review_type === 'task' || review.review_type === 'delivery')
    );
    if (hasSelfReview) selfReviewedTasks.add(taskId);
  }

  for (const task of pendingTasks) {
    const agentKey = task.reviewee || '-';
    const typeKey = task.task_type || 'untyped';
    const statusKey = task.status || 'unknown';
    const ageDays = Number.isInteger(task.age_days) ? task.age_days : null;
    const ageBucketKey = getAgeBucketLabel(ageDays);

    if (!pendingByAgent.has(agentKey)) {
      pendingByAgent.set(agentKey, {
        agent: agentKey,
        registered: isRegisteredAgent(agentKey, registeredAgents),
        pending: 0,
        completed: 0,
        delivered: 0,
        oldest_updated_at: task.updated_at || null,
        latest_updated_at: task.updated_at || null,
      });
    }
    if (!pendingByType.has(typeKey)) {
      pendingByType.set(typeKey, {
        type: typeKey,
        pending: 0,
        completed: 0,
        delivered: 0,
      });
    }

    oldestTasks.push({
      task_id: task.task_id,
      reviewee: task.reviewee,
      reviewee_registered: isRegisteredAgent(task.reviewee, registeredAgents),
      status: task.status,
      type: task.task_type || 'untyped',
      age_days: ageDays,
      updated_at: task.updated_at || null,
      description: task.description,
    });

    const agentBucket = pendingByAgent.get(agentKey);
    agentBucket.pending += 1;
    if (statusKey === 'delivered') agentBucket.delivered += 1;
    else if (statusKey === 'completed') agentBucket.completed += 1;
    if (!agentBucket.oldest_updated_at || (task.updated_at || '') < agentBucket.oldest_updated_at) agentBucket.oldest_updated_at = task.updated_at || agentBucket.oldest_updated_at;
    if (!agentBucket.latest_updated_at || (task.updated_at || '') > agentBucket.latest_updated_at) agentBucket.latest_updated_at = task.updated_at || agentBucket.latest_updated_at;

    const typeBucket = pendingByType.get(typeKey);
    typeBucket.pending += 1;
    if (statusKey === 'delivered') typeBucket.delivered += 1;
    else if (statusKey === 'completed') typeBucket.completed += 1;

    pendingByStatus.set(statusKey, (pendingByStatus.get(statusKey) || 0) + 1);
    pendingByAgeBucket.set(ageBucketKey, (pendingByAgeBucket.get(ageBucketKey) || 0) + 1);

    if (task.updated_at && (!oldestPendingAt || task.updated_at < oldestPendingAt)) oldestPendingAt = task.updated_at;
    if (ageDays !== null && (oldestPendingAgeDays === null || ageDays > oldestPendingAgeDays)) oldestPendingAgeDays = ageDays;
  }

  const eligible = eligibleRows.length;
  const pending = pendingTasks.length;
  const reviewed = Math.max(eligible - pending, 0);

  return {
    eligible_tasks: eligible,
    reviewed_tasks: reviewed,
    external_reviewed_tasks: reviewed,
    pending_reviews: pending,
    review_coverage: eligible ? reviewed / eligible : null,
    external_review_coverage: eligible ? reviewed / eligible : null,
    self_reviewed_tasks: selfReviewedTasks.size,
    oldest_pending_at: oldestPendingAt,
    oldest_pending_age_days: oldestPendingAgeDays,
    by_agent: [...pendingByAgent.values()]
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending;
        return a.agent.localeCompare(b.agent);
      })
      .slice(0, top),
    by_type: [...pendingByType.values()]
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending;
        return a.type.localeCompare(b.type);
      })
      .slice(0, top),
    by_status: [...pendingByStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    by_age_bucket: [...pendingByAgeBucket.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => {
        const order = ['0-1d', '2-3d', '4-7d', '8d+', 'unknown'];
        return order.indexOf(a.bucket) - order.indexOf(b.bucket);
      }),
    oldest_tasks: oldestTasks
      .sort((a, b) => {
        const ageA = Number.isInteger(a.age_days) ? a.age_days : -1;
        const ageB = Number.isInteger(b.age_days) ? b.age_days : -1;
        if (ageB !== ageA) return ageB - ageA;
        return (a.updated_at || '').localeCompare(b.updated_at || '');
      })
      .slice(0, top),
  };
}

function buildRecentTaskWindow(options = {}) {
  const days = Number.isInteger(options.days) && options.days >= 0 ? options.days : 1;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 10;
  const registeredAgents = getRegisteredAgentSet();
  const rows = collectTaskStatsRows({
    agent: options.agent,
    type: options.type,
    status: options.status,
    review: options.review,
    max_age: days,
  });
  const statusCounts = new Map();
  const feedbackCounts = new Map();
  const agentCounts = new Map();
  let selfReviewed = 0;
  let completed = 0;
  let delivered = 0;

  for (const row of rows) {
    const agentKey = row.assigned_to || '-';
    statusCounts.set(row.status, (statusCounts.get(row.status) || 0) + 1);
    feedbackCounts.set(row.feedback_state, (feedbackCounts.get(row.feedback_state) || 0) + 1);
    if (!agentCounts.has(agentKey)) {
      agentCounts.set(agentKey, {
        agent: agentKey,
        registered: isRegisteredAgent(agentKey, registeredAgents),
        unassigned: isUnassignedAgentValue(agentKey),
        tasks: 0,
        completed: 0,
        delivered: 0,
        reviewed: 0,
        pending: 0,
        self_reviewed: 0,
      });
    }
    const agentBucket = agentCounts.get(agentKey);
    agentBucket.tasks += 1;
    if (row.self_review_count) selfReviewed += 1;
    if (row.self_review_count) agentBucket.self_reviewed += 1;
    if (row.status === 'delivered') delivered += 1;
    if (row.status === 'delivered') agentBucket.delivered += 1;
    if (row.status === 'completed') completed += 1;
    if (row.status === 'completed') agentBucket.completed += 1;
    if (row.feedback_state === 'pending') agentBucket.pending += 1;
    if (['approved', 'needs_revision', 'rejected', 'reviewed'].includes(row.feedback_state)) agentBucket.reviewed += 1;
  }

  return {
    days,
    total: rows.length,
    completed,
    delivered,
    self_reviewed: selfReviewed,
    pending: feedbackCounts.get('pending') || 0,
    reviewed: (feedbackCounts.get('approved') || 0) + (feedbackCounts.get('needs_revision') || 0) + (feedbackCounts.get('rejected') || 0) + (feedbackCounts.get('reviewed') || 0),
    status_counts: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    feedback_counts: [...feedbackCounts.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    by_agent: [...agentCounts.values()]
      .sort((a, b) => {
        if (b.tasks !== a.tasks) return b.tasks - a.tasks;
        return a.agent.localeCompare(b.agent);
      }),
    rows: rows.slice(0, limit),
  };
}

function buildStaleBacklogStats(options = {}) {
  const days = Number.isInteger(options.days) && options.days >= 0 ? options.days : 4;
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 10;
  const reviewStats = buildReviewCoverageStats({
    agent: options.agent,
    type: options.type,
    status: options.status,
    min_age: days,
    top,
  });
  const tasks = collectPendingReviewTasks({
    agent: options.agent,
    type: options.type,
    status: options.status,
    min_age: days,
  }).sort((a, b) => {
    const ageA = Number.isInteger(a.age_days) ? a.age_days : -1;
    const ageB = Number.isInteger(b.age_days) ? b.age_days : -1;
    if (ageB !== ageA) return ageB - ageA;
    return (a.updated_at || '').localeCompare(b.updated_at || '');
  });

  return {
    days,
    pending: tasks.length,
    review_stats: reviewStats,
    tasks: tasks.slice(0, top),
  };
}

function buildReviewBacklogStats(options = {}) {
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 10;
  const registeredAgents = getRegisteredAgentSet();
  const tasks = collectPendingReviewTasks({
    agent: options.agent,
    type: options.type,
    status: options.status,
    min_age: options.min_age,
    max_age: options.max_age,
  }).sort((a, b) => {
    const ageA = Number.isInteger(a.age_days) ? a.age_days : -1;
    const ageB = Number.isInteger(b.age_days) ? b.age_days : -1;
    if (ageB !== ageA) return ageB - ageA;
    return (a.updated_at || '').localeCompare(b.updated_at || '');
  });

  const byAgent = new Map();
  const byType = new Map();
  const byStatus = new Map();
  const byAgeBucket = new Map();
  let selfReviewedTasks = 0;
  let oldestPendingAt = null;
  let oldestPendingAgeDays = null;

  for (const task of tasks) {
    const agentKey = task.reviewee || '-';
    const typeKey = task.task_type || 'untyped';
    const statusKey = task.status || 'unknown';
    const ageDays = Number.isInteger(task.age_days) ? task.age_days : null;
    const ageBucketKey = getAgeBucketLabel(ageDays);

    if (!byAgent.has(agentKey)) {
      byAgent.set(agentKey, {
        agent: agentKey,
        registered: isRegisteredAgent(agentKey, registeredAgents),
        unassigned: isUnassignedAgentValue(agentKey),
        pending: 0,
        self_reviewed: 0,
        completed: 0,
        delivered: 0,
        oldest_age_days: null,
        oldest_updated_at: null,
      });
    }
    if (!byType.has(typeKey)) {
      byType.set(typeKey, {
        type: typeKey,
        pending: 0,
        self_reviewed: 0,
        completed: 0,
        delivered: 0,
      });
    }

    const agentBucket = byAgent.get(agentKey);
    const typeBucket = byType.get(typeKey);

    agentBucket.pending += 1;
    typeBucket.pending += 1;
    if (statusKey === 'delivered') {
      agentBucket.delivered += 1;
      typeBucket.delivered += 1;
    } else if (statusKey === 'completed') {
      agentBucket.completed += 1;
      typeBucket.completed += 1;
    }
    if (task.self_review_count) {
      selfReviewedTasks += 1;
      agentBucket.self_reviewed += 1;
      typeBucket.self_reviewed += 1;
    }

    byStatus.set(statusKey, (byStatus.get(statusKey) || 0) + 1);
    byAgeBucket.set(ageBucketKey, (byAgeBucket.get(ageBucketKey) || 0) + 1);

    if (task.updated_at && (!oldestPendingAt || task.updated_at < oldestPendingAt)) oldestPendingAt = task.updated_at;
    if (ageDays !== null && (oldestPendingAgeDays === null || ageDays > oldestPendingAgeDays)) oldestPendingAgeDays = ageDays;
    if (ageDays !== null && (agentBucket.oldest_age_days === null || ageDays > agentBucket.oldest_age_days)) agentBucket.oldest_age_days = ageDays;
    if (task.updated_at && (!agentBucket.oldest_updated_at || task.updated_at < agentBucket.oldest_updated_at)) agentBucket.oldest_updated_at = task.updated_at;
  }

  return {
    pending_tasks: tasks.length,
    self_reviewed_tasks: selfReviewedTasks,
    oldest_pending_at: oldestPendingAt,
    oldest_pending_age_days: oldestPendingAgeDays,
    by_agent: [...byAgent.values()]
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending;
        const ageA = Number.isInteger(a.oldest_age_days) ? a.oldest_age_days : -1;
        const ageB = Number.isInteger(b.oldest_age_days) ? b.oldest_age_days : -1;
        if (ageB !== ageA) return ageB - ageA;
        return a.agent.localeCompare(b.agent);
      })
      .slice(0, top),
    by_type: [...byType.values()]
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending;
        return a.type.localeCompare(b.type);
      })
      .slice(0, top),
    by_status: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    by_age_bucket: [...byAgeBucket.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => {
        const order = ['0-1d', '2-3d', '4-7d', '8d+', 'unknown'];
        return order.indexOf(a.bucket) - order.indexOf(b.bucket);
      }),
    tasks: tasks.slice(0, top),
  };
}

function buildOpsDigest(options = {}) {
  const days = Number.isInteger(options.days) && options.days >= 0 ? options.days : 1;
  const staleDays = Number.isInteger(options.stale_days) && options.stale_days >= 0 ? options.stale_days : 4;
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 5;
  const tasks = getAllTasks();
  const reviewCoverage = buildReviewCoverageStats({ top });
  const recent = buildRecentTaskWindow({ days, limit: top * 2 });
  const backlog = buildReviewBacklogStats({ min_age: staleDays, top });
  const activeAgents = recent.by_agent.filter(bucket => bucket.tasks > 0 && !bucket.unassigned).length;
  const backlogAgents = backlog.by_agent.filter(bucket => bucket.pending > 0 && !bucket.unassigned).length;

  return {
    days,
    stale_days: staleDays,
    top,
    total_tasks: tasks.length,
    recent,
    review_coverage: reviewCoverage,
    backlog,
    active_agents: activeAgents,
    backlog_agents: backlogAgents,
  };
}

function ensureActionWatcherRunsDir() {
  if (!fs.existsSync(ACTION_WATCHER_RUNS_DIR)) fs.mkdirSync(ACTION_WATCHER_RUNS_DIR, { recursive: true });
}

function actionWatcherRunPath(runId) {
  return `${ACTION_WATCHER_RUNS_DIR}/${runId}.json`;
}

function readActionWatcherRuns(options = {}) {
  if (!fs.existsSync(ACTION_WATCHER_RUNS_DIR)) return [];
  const status = options.status || null;
  const agent = options.agent || null;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const runs = fs.readdirSync(ACTION_WATCHER_RUNS_DIR)
    .filter(file => file.endsWith('.json') && file !== 'latest.json')
    .map(file => loadJson(path.join(ACTION_WATCHER_RUNS_DIR, file)))
    .filter(Boolean)
    .filter(run => !status || run.status === status)
    .filter(run => !agent || run.agent === agent)
    .sort((a, b) => (b.completed_at || b.started_at || b.created_at || '').localeCompare(a.completed_at || a.started_at || a.created_at || ''));
  return limit ? runs.slice(0, limit) : runs;
}

function readActionWatcherRun(runId) {
  if (!runId) return null;
  if (runId === 'latest') return loadJson(ACTION_WATCHER_LATEST_FILE);
  return loadJson(actionWatcherRunPath(runId));
}

function summarizePendingActions(actions = []) {
  const byAgent = new Map();
  const byKind = new Map();
  let oldestAgeHours = null;

  for (const action of actions) {
    const owner = action.owner_agent || 'unassigned';
    byAgent.set(owner, (byAgent.get(owner) || 0) + 1);
    byKind.set(action.kind || 'unknown', (byKind.get(action.kind || 'unknown') || 0) + 1);
    const ageHours = computeAgeHours(action.created_at || action.updated_at || null);
    if (Number.isInteger(ageHours) && (oldestAgeHours === null || ageHours > oldestAgeHours)) {
      oldestAgeHours = ageHours;
    }
  }

  return {
    total: actions.length,
    oldest_age_hours: oldestAgeHours,
    by_agent: [...byAgent.entries()]
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)),
    by_kind: [...byKind.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  };
}

function buildActionWatcherStatus(options = {}) {
  const agent = isClearedValue(options.agent) ? null : String(options.agent || '').trim() || null;
  const warnAfterMinutes = Number.isInteger(options.warn_after_minutes) && options.warn_after_minutes >= 0
    ? options.warn_after_minutes
    : 30;
  const recentLimit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 10;
  const recentRuns = readActionWatcherRuns({ agent, limit: recentLimit });
  const latestRun = recentRuns[0] || (!agent ? readActionWatcherRun('latest') : null);
  const latestAt = latestRun?.completed_at || latestRun?.started_at || latestRun?.created_at || null;
  const latestAgeMinutes = latestAt ? computeAgeMinutes(latestAt) : null;
  const pendingActions = collectActions({
    owner_agent: agent,
    status: 'pending',
  });
  const pending = summarizePendingActions(pendingActions);
  const completedRuns = recentRuns.filter(run => run.status === 'completed').length;
  const failedRuns = recentRuns.filter(run => run.status === 'failed').length;

  let status = 'ok';
  let code = 'healthy';
  if (!latestRun) {
    status = 'never_run';
    code = 'no_runs_recorded';
  } else if (latestRun.status === 'failed') {
    status = 'failed';
    code = 'latest_run_failed';
  } else if (Number.isInteger(latestAgeMinutes) && latestAgeMinutes > warnAfterMinutes) {
    status = 'stale';
    code = 'latest_run_stale';
  }

  return {
    schema: 'atf.action-watcher-status.v1',
    status,
    code,
    scope: {
      agent,
      warn_after_minutes: warnAfterMinutes,
      recent_runs_limit: recentLimit,
    },
    generated_at: new Date().toISOString(),
    latest_run: latestRun ? {
      run_id: latestRun.run_id || null,
      status: latestRun.status || null,
      started_at: latestRun.started_at || null,
      completed_at: latestRun.completed_at || null,
      age_minutes: latestAgeMinutes,
      dry_run: Boolean(latestRun.dryRun),
      executed: latestRun.executed ?? 0,
      skipped: latestRun.skipped ?? 0,
      failed: latestRun.failed ?? 0,
      eligible_actions: latestRun.eligibleActions ?? 0,
      filtered_actions: latestRun.filteredActions ?? 0,
    } : null,
    recent_runs: {
      total: recentRuns.length,
      completed: completedRuns,
      failed: failedRuns,
    },
    pending_actions: pending,
  };
}

function actionsDir(taskId) {
  return `${taskDirPath(taskId)}/actions`;
}

function ensureActionsDir(taskId) {
  const dir = actionsDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function actionPath(taskId, actionId) {
  ensureActionsDir(taskId);
  return `${actionsDir(taskId)}/${actionId}.json`;
}

function readTaskActions(taskId) {
  ensureActionsDir(taskId);
  return readJsonCollection(actionsDir(taskId))
    .sort((a, b) => (a.updated_at || a.created_at || '').localeCompare(b.updated_at || b.created_at || ''));
}

function readAction(taskId, actionId) {
  return loadJson(actionPath(taskId, actionId));
}

function saveAction(taskId, action) {
  action.updated_at = new Date().toISOString();
  saveJson(actionPath(taskId, action.action_id), action);
}

function actionInboxPath(agent) {
  return `${ACTION_INBOX_DIR}/${agent}.json`;
}

function refreshActionIndexes() {
  const now = new Date().toISOString();
  const pendingActions = [];
  const inboxes = {};

  for (const task of getAllTasks()) {
    const taskId = task.short_id || task.task_id;
    for (const action of readTaskActions(taskId)) {
      if (action.status !== 'pending') continue;
      pendingActions.push(action);
      if (!action.owner_agent) continue;
      if (!inboxes[action.owner_agent]) inboxes[action.owner_agent] = [];
      inboxes[action.owner_agent].push(action);
    }
  }

  pendingActions.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  saveJson(PENDING_ACTIONS_FILE, {
    schema: 'atf.pending-actions.v1',
    updated_at: now,
    total: pendingActions.length,
    items: pendingActions,
  });

  if (!fs.existsSync(ACTION_INBOX_DIR)) fs.mkdirSync(ACTION_INBOX_DIR, { recursive: true });
  for (const file of fs.readdirSync(ACTION_INBOX_DIR)) {
    if (file.endsWith('.json')) fs.unlinkSync(path.join(ACTION_INBOX_DIR, file));
  }
  for (const [agent, items] of Object.entries(inboxes)) {
    items.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    saveJson(actionInboxPath(agent), {
      schema: 'atf.action-inbox.v1',
      updated_at: now,
      agent,
      total: items.length,
      items,
    });
  }
}

function normalizeActionKind(value) {
  if (isClearedValue(value)) return null;
  const normalized = String(value).trim().toLowerCase();
  return ACTION_KINDS.has(normalized) ? normalized : null;
}

function normalizeActionExecutionMode(mode) {
  if (!mode) return null;
  const normalized = String(mode).trim().toLowerCase();
  return ACTION_EXECUTION_MODES.has(normalized) ? normalized : null;
}

function actionPriorityRank(priority) {
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  if (priority === 'low') return 1;
  return 0;
}

function compareActionCandidates(a, b) {
  const priorityDiff = actionPriorityRank(b.priority) - actionPriorityRank(a.priority);
  if (priorityDiff) return priorityDiff;
  const ageA = Number.isInteger(a.age_days) ? (a.age_days * 24) : (Number.isInteger(a.age_hours) ? a.age_hours : -1);
  const ageB = Number.isInteger(b.age_days) ? (b.age_days * 24) : (Number.isInteger(b.age_hours) ? b.age_hours : -1);
  if (ageB !== ageA) return ageB - ageA;
  const confidenceDiff = deriveActionConfidence(b) - deriveActionConfidence(a);
  if (confidenceDiff) return confidenceDiff;
  return (a.source_at || '').localeCompare(b.source_at || '');
}

function hasActionForDedupeKey(taskId, dedupeKey) {
  if (!dedupeKey) return false;
  return readTaskActions(taskId).some(action => action.dedupe_key === dedupeKey && action.status !== 'archived');
}

function getSignalActions(taskId, dedupeKey) {
  if (!dedupeKey) return [];
  return readTaskActions(taskId)
    .filter(action => action.dedupe_key === dedupeKey && action.status !== 'archived')
    .sort((a, b) => (b.executed_at || b.updated_at || b.created_at || '').localeCompare(a.executed_at || a.updated_at || a.created_at || ''));
}

function deriveActionCooldownHours(entity) {
  if (!entity?.kind) return null;
  if (entity.kind === 'stale_review_follow_up') return 24;
  if (entity.kind === 'pending_reply_follow_up') {
    const messageHours = Number.isInteger(entity.payload?.message_hours) ? entity.payload.message_hours : null;
    return Math.max(6, Math.min(24, messageHours || 12));
  }
  if (entity.kind === 'decision_follow_up') {
    const decisionHours = Number.isInteger(entity.payload?.decision_hours) ? entity.payload.decision_hours : null;
    return Math.max(4, Math.min(12, decisionHours || 6));
  }
  return null;
}

function buildActionReissueState(taskId, candidate, referenceTime = null) {
  const signalActions = getSignalActions(taskId, candidate?.dedupe_key);
  const latestAction = signalActions[0] || null;
  const cooldownHours = deriveActionCooldownHours(candidate);
  const attempt = latestAction ? Math.max(Number(latestAction.attempt) || 1, signalActions.length) + 1 : 1;
  if (!latestAction) {
    return {
      blocked: false,
      attempt,
      latest_action: null,
      cooldown_hours: cooldownHours,
      blocker: null,
    };
  }
  if (latestAction.status === 'pending') {
    return {
      blocked: true,
      attempt,
      latest_action: latestAction,
      cooldown_hours: cooldownHours,
      blocker: 'pending_exists',
    };
  }

  const latestAt = latestAction.executed_at || latestAction.updated_at || latestAction.created_at || null;
  const ageHours = latestAt ? computeAgeHours(latestAt, parseIsoTimestamp(referenceTime) || new Date()) : null;
  if (Number.isInteger(cooldownHours) && Number.isInteger(ageHours) && ageHours < cooldownHours) {
    return {
      blocked: true,
      attempt,
      latest_action: latestAction,
      cooldown_hours: cooldownHours,
      age_hours: ageHours,
      available_in_hours: Math.max(0, cooldownHours - ageHours),
      blocker: 'cooldown_active',
    };
  }

  return {
    blocked: false,
    attempt,
    latest_action: latestAction,
    cooldown_hours: cooldownHours,
    age_hours: ageHours,
    blocker: null,
  };
}

function deriveFollowUpPriority(ageDays = null, ageHours = null) {
  if (Number.isInteger(ageDays) && ageDays >= 7) return 'high';
  if (Number.isInteger(ageHours) && ageHours >= 24) return 'high';
  return 'normal';
}

function roundActionConfidence(value) {
  if (!Number.isFinite(value)) return null;
  return roundNumber(Math.max(0, Math.min(0.99, value)), 2);
}

function deriveActionConfidence(candidate) {
  if (Number.isFinite(candidate?.confidence)) return roundActionConfidence(candidate.confidence);
  if (!candidate?.kind) return null;

  let confidence = 0.82;
  if (candidate.kind === 'stale_review_follow_up') {
    confidence = 0.9;
    if (Number.isInteger(candidate.age_days) && candidate.age_days >= 7) confidence += 0.04;
  } else if (candidate.kind === 'pending_reply_follow_up') {
    confidence = candidate.payload?.original_message_type === 'blocker' ? 0.95 : 0.9;
    if (Number.isInteger(candidate.age_hours) && candidate.age_hours >= 24) confidence += 0.02;
  } else if (candidate.kind === 'decision_follow_up') {
    confidence = 0.86;
    if (Number.isInteger(candidate.age_hours) && candidate.age_hours >= 12) confidence += 0.03;
  }

  if (Number.isInteger(candidate.attempt) && candidate.attempt > 1) {
    confidence += Math.min(0.04, (candidate.attempt - 1) * 0.02);
  }

  return roundActionConfidence(confidence);
}

function buildActionPolicy(candidate) {
  const defaults = {
    risk_level: 'low',
    reversible: true,
    requires_confirmation: false,
    verification_mode: 'generic',
    recovery_plan: 'Skip the action if the source signal is already closed, then rely on the next scan to produce a fresher follow-up.',
  };

  if (candidate?.kind === 'stale_review_follow_up') {
    defaults.verification_mode = 'review_pending';
    defaults.recovery_plan = 'Skip if an external review already exists or the task is no longer review-eligible; rescan later if backlog persists.';
  } else if (candidate?.kind === 'pending_reply_follow_up') {
    defaults.verification_mode = 'reply_pending';
    defaults.recovery_plan = 'Skip if the thread already received a reply or the source message is closed; rescan later for a stronger escalation if silence continues.';
  } else if (candidate?.kind === 'decision_follow_up') {
    defaults.risk_level = 'medium';
    defaults.verification_mode = 'decision_pending';
    defaults.recovery_plan = 'Skip if a decision reply or task-level decision state already closed the signal; otherwise let the next scan escalate with fresher context.';
  }

  return {
    risk_level: candidate?.policy?.risk_level || defaults.risk_level,
    reversible: candidate?.policy?.reversible === undefined ? defaults.reversible : Boolean(candidate.policy.reversible),
    requires_confirmation: Boolean(candidate?.policy?.requires_confirmation ?? defaults.requires_confirmation),
    verification_mode: candidate?.policy?.verification_mode || defaults.verification_mode,
    recovery_plan: candidate?.policy?.recovery_plan || defaults.recovery_plan,
  };
}

function buildActionEvidence(taskId, ctx, candidate, capturedAt) {
  const items = [];
  const sourceAt = candidate?.source_at || null;
  const freshnessHours = sourceAt ? computeAgeHours(sourceAt, parseIsoTimestamp(capturedAt) || new Date()) : null;

  if (candidate?.kind === 'stale_review_follow_up') {
    items.push({
      type: 'task_state',
      ref: taskId,
      at: ctx?.updated_at || ctx?.created_at || null,
      summary: `review_status=${getEffectiveTaskReviewStatus(ctx)} reviewee=${candidate.owner_agent || '-'}`,
    });
    items.push({
      type: 'review_backlog',
      ref: candidate.source_ref || taskId,
      at: sourceAt,
      summary: `age_days=${candidate.age_days ?? '-'} external_review_missing=true self_review_count=${candidate.payload?.self_review_count ?? 0}`,
    });
  } else if (candidate?.kind === 'pending_reply_follow_up') {
    items.push({
      type: 'message',
      ref: candidate.payload?.original_message_id || candidate.source_ref || null,
      at: sourceAt,
      summary: `${candidate.payload?.original_from || '-'} -> ${candidate.payload?.original_to || '-'} [${candidate.payload?.original_message_type || '-'}]`,
    });
    items.push({
      type: 'thread',
      ref: candidate.thread_id || candidate.payload?.thread_id || null,
      at: sourceAt,
      summary: `reply_missing_for=${candidate.age_hours ?? '-'}h excerpt=${candidate.payload?.original_excerpt || '-'}`,
    });
  } else if (candidate?.kind === 'decision_follow_up') {
    items.push({
      type: 'reflection',
      ref: candidate.payload?.reflection_id || candidate.source_ref || null,
      at: sourceAt,
      summary: candidate.payload?.reflection_excerpt || 'what_needs_decision',
    });
    items.push({
      type: 'decision_state',
      ref: taskId,
      at: ctx?.updated_at || ctx?.created_at || null,
      summary: `decision_status=${ctx?.decision?.status || 'none'} age_hours=${candidate.age_hours ?? '-'}`,
    });
  }

  return {
    captured_at: capturedAt,
    source_at: sourceAt,
    freshness_hours: Number.isInteger(freshnessHours) ? freshnessHours : null,
    why: candidate?.summary || null,
    items,
  };
}

function createActionCheck(stage, checkedAt, ok, code, summary, facts = {}) {
  return {
    stage,
    checked_at: checkedAt,
    ok: Boolean(ok),
    code,
    summary,
    facts,
  };
}

function findReplyAfterMessage(messages, message) {
  if (!message?.thread_id || !message?.to_agent) return null;
  return messages.find(item =>
    item.thread_id === message.thread_id
    && (item.created_at || '') > (message.created_at || '')
    && item.from_agent === message.to_agent
  ) || null;
}

function findDecisionReplyAfter(messages, threadId, createdAt) {
  if (!threadId) return null;
  return messages.find(message =>
    message.thread_id === threadId
    && message.message_type === 'decision_reply'
    && (message.created_at || '') > (createdAt || '')
  ) || null;
}

function runActionPreflight(taskId, action, ctx, checkedAt = null) {
  const now = checkedAt || new Date().toISOString();

  if (!action) {
    return createActionCheck('preflight', now, false, 'missing_action', 'action record is missing');
  }

  if (action.kind === 'stale_review_follow_up') {
    const ownerAgent = action.owner_agent || getPrimaryTaskReviewee(ctx);
    const reviewStatus = getEffectiveTaskReviewStatus(ctx);
    const ageDays = computeAgeDays(ctx?.updated_at || ctx?.created_at);
    const staleDays = Number.isInteger(action.payload?.stale_days) ? action.payload.stale_days : null;

    if (!ownerAgent) {
      return createActionCheck('preflight', now, false, 'missing_owner', 'review follow-up has no owner agent', {
        review_status: reviewStatus,
      });
    }
    if (!isReviewEligibleTaskStatus(reviewStatus)) {
      return createActionCheck('preflight', now, false, 'review_not_eligible', `task review status is now ${reviewStatus}`, {
        review_status: reviewStatus,
      });
    }
    if (!taskNeedsReview(ctx, ownerAgent)) {
      return createActionCheck('preflight', now, false, 'review_closed', 'external review already exists', {
        review_status: reviewStatus,
        owner_agent: ownerAgent,
      });
    }
    if (Number.isInteger(staleDays) && Number.isInteger(ageDays) && ageDays < staleDays) {
      return createActionCheck('preflight', now, false, 'review_not_stale', `review backlog age ${ageDays}d is below threshold ${staleDays}d`, {
        age_days: ageDays,
        stale_days: staleDays,
      });
    }
    return createActionCheck('preflight', now, true, 'review_pending', 'external review is still missing', {
      owner_agent: ownerAgent,
      review_status: reviewStatus,
      age_days: ageDays,
      stale_days: staleDays,
    });
  }

  if (action.kind === 'pending_reply_follow_up') {
    const originalMessageId = action.payload?.original_message_id || action.source_ref || null;
    const originalMessage = originalMessageId ? readMessage(taskId, originalMessageId) : null;
    if (!originalMessage) {
      return createActionCheck('preflight', now, false, 'missing_source_message', 'source message no longer exists', {
        original_message_id: originalMessageId,
      });
    }
    const status = effectiveMessageStatus(originalMessage);
    if (status !== 'sent') {
      return createActionCheck('preflight', now, false, 'source_message_closed', `source message status is ${status}`, {
        original_message_id: originalMessageId,
        status,
      });
    }
    const messages = readTaskMessages(taskId);
    const reply = findReplyAfterMessage(messages, originalMessage);
    if (reply) {
      return createActionCheck('preflight', now, false, 'reply_received', `thread already received a reply from ${reply.from_agent}`, {
        original_message_id: originalMessageId,
        reply_message_id: reply.message_id,
        thread_id: originalMessage.thread_id || null,
      });
    }
    return createActionCheck('preflight', now, true, 'reply_pending', 'thread is still waiting for a reply', {
      original_message_id: originalMessageId,
      thread_id: originalMessage.thread_id || null,
      age_hours: computeAgeHours(originalMessage.created_at),
    });
  }

  if (action.kind === 'decision_follow_up') {
    const reflectionId = action.payload?.reflection_id || action.source_ref || null;
    const reflection = reflectionId ? readReflection(taskId, reflectionId) : null;
    if (!reflection) {
      return createActionCheck('preflight', now, false, 'missing_source_reflection', 'source reflection no longer exists', {
        reflection_id: reflectionId,
      });
    }
    if (reflection.field !== 'what_needs_decision') {
      return createActionCheck('preflight', now, false, 'reflection_mismatch', `reflection field is now ${reflection.field}`, {
        reflection_id: reflectionId,
        field: reflection.field,
      });
    }
    if (ctx?.decision?.status === 'waiting' || ctx?.decision?.status === 'decided') {
      return createActionCheck('preflight', now, false, 'decision_state_closed', `task decision status is ${ctx.decision.status}`, {
        decision_status: ctx.decision.status,
      });
    }
    const threadId = action.thread_id || defaultThreadId(taskId, reflection.focus_id || null, null);
    const reply = findDecisionReplyAfter(readTaskMessages(taskId), threadId, reflection.created_at);
    if (reply) {
      return createActionCheck('preflight', now, false, 'decision_reply_received', 'thread already contains a later decision reply', {
        reflection_id: reflectionId,
        reply_message_id: reply.message_id,
        thread_id: threadId,
      });
    }
    return createActionCheck('preflight', now, true, 'decision_pending', 'decision reflection is still open', {
      reflection_id: reflectionId,
      thread_id: threadId,
      age_hours: computeAgeHours(reflection.created_at),
    });
  }

  return createActionCheck('preflight', now, true, 'generic', 'no kind-specific preflight rule matched');
}

function runActionPostflight(taskId, action, execution, checkedAt = null) {
  const now = checkedAt || new Date().toISOString();

  if (!execution) {
    return createActionCheck('postflight', now, false, 'missing_execution', 'execution metadata is missing');
  }

  if (execution.mode === 'noop') {
    return createActionCheck('postflight', now, true, 'noop', 'noop mode intentionally produced no side effect');
  }

  if (execution.status !== 'executed') {
    return createActionCheck('postflight', now, false, 'not_dispatched', execution.error?.message || 'action was not dispatched');
  }

  if (execution.mode === 'message') {
    const messageId = execution.artifacts?.message_id || null;
    const message = messageId ? readMessage(taskId, messageId) : null;
    if (!message) {
      return createActionCheck('postflight', now, false, 'message_missing', 'message artifact was not found after execution', {
        message_id: messageId,
      });
    }
    if (message.source_ref !== action.action_id) {
      return createActionCheck('postflight', now, false, 'message_source_mismatch', 'message exists but source_ref does not point back to the action', {
        message_id: messageId,
        source_ref: message.source_ref || null,
      });
    }
    return createActionCheck('postflight', now, true, 'message_recorded', 'follow-up message was written successfully', {
      message_id: messageId,
      to_agent: message.to_agent || null,
      thread_id: message.thread_id || null,
    });
  }

  if (execution.mode === 'pending_task') {
    const filePath = execution.artifacts?.pending_task_path || null;
    const pendingTask = filePath ? loadJson(filePath) : null;
    if (!pendingTask) {
      return createActionCheck('postflight', now, false, 'pending_task_missing', 'pending-task artifact was not found after execution', {
        pending_task_path: filePath,
      });
    }
    if (pendingTask.action_id !== action.action_id) {
      return createActionCheck('postflight', now, false, 'pending_task_mismatch', 'pending-task artifact does not point back to the action', {
        pending_task_path: filePath,
        action_id: pendingTask.action_id || null,
      });
    }
    return createActionCheck('postflight', now, true, 'pending_task_written', 'pending-task artifact was written successfully', {
      pending_task_path: filePath,
      assigned_to: pendingTask.assigned_to || null,
    });
  }

  return createActionCheck('postflight', now, false, 'unsupported_mode', `unsupported action mode: ${execution.mode}`);
}

function createActionRecord(taskId, ctx, candidate, planner = 'action-scan') {
  const now = new Date().toISOString();
  const action = {
    schema: 'atf.action.v1',
    action_id: generateId('ACT'),
    task_id: ctx.short_id || ctx.task_id,
    focus_id: candidate.focus_id || null,
    thread_id: candidate.thread_id || defaultThreadId(ctx.short_id || ctx.task_id, candidate.focus_id || null, null),
    owner_agent: candidate.owner_agent || null,
    kind: candidate.kind,
    status: 'pending',
    priority: candidate.priority || 'normal',
    source_type: candidate.source_type,
    source_ref: candidate.source_ref || null,
    dedupe_key: candidate.dedupe_key,
    signal_key: candidate.dedupe_key,
    attempt: Number.isInteger(candidate.attempt) && candidate.attempt > 0 ? candidate.attempt : 1,
    reissue_of: candidate.reissue_of || null,
    cooldown_hours: Number.isInteger(candidate.cooldown_hours) ? candidate.cooldown_hours : null,
    summary: candidate.summary,
    guidance: candidate.guidance,
    suggested_message_type: candidate.suggested_message_type || 'request',
    confidence: deriveActionConfidence(candidate),
    policy: buildActionPolicy(candidate),
    evidence: buildActionEvidence(taskId, ctx, candidate, now),
    age_days: Number.isInteger(candidate.age_days) ? candidate.age_days : null,
    age_hours: Number.isInteger(candidate.age_hours) ? candidate.age_hours : null,
    payload: candidate.payload || {},
    execution_mode: null,
    executed_at: null,
    execution: null,
    verification: {
      preflight: null,
      postflight: null,
    },
    created_at: now,
    updated_at: now,
    history: [
      {
        event: 'planned',
        by: planner,
        at: now,
        note: `${candidate.summary}${Number.isInteger(candidate.attempt) && candidate.attempt > 1 ? ` | attempt=${candidate.attempt}` : ''}`,
      },
    ],
  };
  saveAction(taskId, action);
  appendNotificationHistory(taskId, {
    event: 'action_planned',
    action_id: action.action_id,
    kind: action.kind,
    owner_agent: action.owner_agent,
    source_type: action.source_type,
    source_ref: action.source_ref,
    at: now,
  });
  return action;
}

function buildStaleReviewActionCandidates(options = {}) {
  const staleDays = Number.isInteger(options.stale_days) && options.stale_days >= 0 ? options.stale_days : 4;
  const ownerFilter = isClearedValue(options.owner_agent) ? null : String(options.owner_agent).trim();
  return collectPendingReviewTasks({ min_age: staleDays })
    .map(task => {
      const ctx = readCtx(task.task_id);
      if (!ctx) return null;
      const ownerAgent = task.reviewee || ctx.dri || ctx.assigned_to || null;
      if (!ownerAgent) return null;
      if (ownerFilter && ownerAgent !== ownerFilter) return null;
      const ageDays = Number.isInteger(task.age_days) ? task.age_days : null;
      return {
        task_id: task.task_id,
        owner_agent: ownerAgent,
        kind: 'stale_review_follow_up',
        priority: deriveFollowUpPriority(ageDays, null),
        source_type: 'review_backlog',
        source_ref: task.task_id,
        source_at: task.updated_at || ctx.updated_at || ctx.created_at || null,
        dedupe_key: `stale_review_follow_up:${task.task_id}:${ownerAgent}:${task.updated_at || 'na'}`,
        summary: `${task.task_id} 已 ${task.status} ${ageDays ?? '?'}d 仍缺外部 review`,
        guidance: `跟进外部 review，或直接补一条非 self review 结果回写到 ATF。`,
        suggested_message_type: 'request',
        thread_id: defaultThreadId(task.task_id, null, null),
        age_days: ageDays,
        payload: {
          reviewee: task.reviewee,
          task_status: task.status,
          task_type: task.task_type || null,
          description: task.description,
          updated_at: task.updated_at || null,
          self_review_count: task.self_review_count || 0,
          stale_days: staleDays,
          reissue_cooldown_hours: 24,
        },
      };
    })
    .filter(Boolean);
}

function buildPendingReplyActionCandidates(options = {}) {
  const messageHours = Number.isInteger(options.message_hours) && options.message_hours >= 0 ? options.message_hours : 12;
  const ownerFilter = isClearedValue(options.owner_agent) ? null : String(options.owner_agent).trim();
  const candidates = [];

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    const messages = readTaskMessages(taskId);
    for (const message of messages) {
      if (!['request', 'decision_request', 'blocker'].includes(message.message_type)) continue;
      if (message.source_type === 'action' || String(message.from_agent || '').startsWith('adapter-action')) continue;
      if (effectiveMessageStatus(message) !== 'sent') continue;
      const ageHours = computeAgeHours(message.created_at);
      if (!Number.isInteger(ageHours) || ageHours < messageHours) continue;
      if (!message.to_agent) continue;
      if (ownerFilter && message.to_agent !== ownerFilter) continue;
      const replied = findReplyAfterMessage(messages, message);
      if (replied) continue;

      candidates.push({
        task_id: taskId,
        owner_agent: message.to_agent,
        focus_id: message.focus_id || null,
        thread_id: message.thread_id || defaultThreadId(taskId, message.focus_id || null, null),
        kind: 'pending_reply_follow_up',
        priority: message.message_type === 'blocker'
          ? 'high'
          : deriveFollowUpPriority(null, ageHours),
        source_type: 'message',
        source_ref: message.message_id,
        source_at: message.created_at || null,
        dedupe_key: `pending_reply_follow_up:${message.message_id}`,
        summary: `${message.to_agent} 仍未响应 ${message.from_agent} 的 ${message.message_type}`,
        guidance: `回复或回执这条消息，避免 thread ${message.thread_id} 持续悬挂。`,
        suggested_message_type: message.message_type === 'decision_request' ? 'decision_request' : 'request',
        age_hours: ageHours,
        payload: {
          description: ctx.description,
          original_message_id: message.message_id,
          original_message_type: message.message_type,
          original_from: message.from_agent,
          original_to: message.to_agent,
          original_excerpt: compactText(message.body, 180),
          created_at: message.created_at || null,
          thread_id: message.thread_id || null,
          message_hours: messageHours,
        },
      });
    }
  }

  return candidates;
}

function buildDecisionFollowUpCandidates(options = {}) {
  const decisionHours = Number.isInteger(options.decision_hours) && options.decision_hours >= 0 ? options.decision_hours : 6;
  const ownerFilter = isClearedValue(options.owner_agent) ? null : String(options.owner_agent).trim();
  const candidates = [];

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    if (ctx.decision?.status === 'waiting' || ctx.decision?.status === 'decided') continue;
    const messages = readTaskMessages(taskId);
    for (const reflection of readTaskReflections(taskId)) {
      if (reflection.field !== 'what_needs_decision') continue;
      const ageHours = computeAgeHours(reflection.created_at);
      if (!Number.isInteger(ageHours) || ageHours < decisionHours) continue;
      const ownerAgent = ctx.dri || ctx.assigned_to || reflection.author || null;
      if (!ownerAgent) continue;
      if (ownerFilter && ownerAgent !== ownerFilter) continue;
      const threadId = defaultThreadId(taskId, reflection.focus_id || null, null);
      const replied = findDecisionReplyAfter(messages, threadId, reflection.created_at);
      if (replied) continue;

      candidates.push({
        task_id: taskId,
        owner_agent: ownerAgent,
        focus_id: reflection.focus_id || null,
        thread_id: threadId,
        kind: 'decision_follow_up',
        priority: deriveFollowUpPriority(null, ageHours),
        source_type: 'reflection',
        source_ref: reflection.reflection_id,
        source_at: reflection.created_at || null,
        dedupe_key: `decision_follow_up:${reflection.reflection_id}`,
        summary: `${taskId} 存在未闭环的 decision reflection`,
        guidance: `明确给出决策，或把任务显式切到 blocked/decide 流程。`,
        suggested_message_type: 'decision_request',
        age_hours: ageHours,
        payload: {
          description: ctx.description,
          reflection_id: reflection.reflection_id,
          reflection_author: reflection.author,
          reflection_excerpt: compactText(reflection.content, 180),
          created_at: reflection.created_at || null,
          decision_hours: decisionHours,
        },
      });
    }
  }

  return candidates;
}

function buildActionCandidates(options = {}) {
  const kindFilter = normalizeActionKind(options.kind);
  let candidates = [];
  if (!kindFilter || kindFilter === 'stale_review_follow_up') {
    candidates.push(...buildStaleReviewActionCandidates(options));
  }
  if (!kindFilter || kindFilter === 'pending_reply_follow_up') {
    candidates.push(...buildPendingReplyActionCandidates(options));
  }
  if (!kindFilter || kindFilter === 'decision_follow_up') {
    candidates.push(...buildDecisionFollowUpCandidates(options));
  }
  return candidates.sort(compareActionCandidates);
}

function scanActions(options = {}) {
  const planner = options.planner || 'action-scan';
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const candidates = buildActionCandidates(options);
  const created = [];
  let duplicates = 0;
  let cooldownBlocked = 0;
  let pendingBlocked = 0;
  const scanNow = new Date().toISOString();

  for (const candidate of candidates) {
    if (limit && created.length >= limit) break;
    const reissue = buildActionReissueState(candidate.task_id, candidate, scanNow);
    if (reissue.blocked) {
      if (reissue.blocker === 'cooldown_active') cooldownBlocked += 1;
      if (reissue.blocker === 'pending_exists') pendingBlocked += 1;
      duplicates += 1;
      continue;
    }
    const ctx = readCtx(candidate.task_id);
    if (!ctx) continue;
    candidate.attempt = reissue.attempt;
    candidate.reissue_of = reissue.latest_action?.action_id || null;
    candidate.cooldown_hours = reissue.cooldown_hours;
    created.push(createActionRecord(candidate.task_id, ctx, candidate, planner));
  }

  refreshActionIndexes();
  return {
    scanned: candidates.length,
    created,
    duplicates,
    cooldown_blocked: cooldownBlocked,
    pending_blocked: pendingBlocked,
  };
}

function buildActionMessageBody(action) {
  const parts = [
    `[phase-d/${action.kind}] ${action.task_id}`,
    action.summary,
    `Action: ${action.guidance}`,
  ];
  if (Number.isInteger(action.attempt) && action.attempt > 1) parts.push(`Attempt: ${action.attempt}`);
  if (Number.isFinite(action.confidence)) parts.push(`Confidence: ${action.confidence}`);
  if (action.policy?.verification_mode) parts.push(`Verify: ${action.policy.verification_mode}`);
  if (action.payload?.description) parts.push(`Task: ${action.payload.description}`);
  if (Number.isInteger(action.age_days)) parts.push(`Age: ${action.age_days}d`);
  if (Number.isInteger(action.age_hours)) parts.push(`Age: ${action.age_hours}h`);
  if (action.payload?.original_excerpt) parts.push(`Signal: ${action.payload.original_excerpt}`);
  if (action.payload?.reflection_excerpt) parts.push(`Reflection: ${action.payload.reflection_excerpt}`);
  return parts.join('\n');
}

function executeAction(taskId, action, ctx, options = {}) {
  const mode = normalizeActionExecutionMode(options.mode) || 'message';
  const executor = options.executor || 'action-executor';
  const toAgent = options.toAgent || action.owner_agent || null;
  const threadId = options.threadId || action.thread_id || defaultThreadId(ctx.short_id || ctx.task_id, action.focus_id || null, null);
  const now = new Date().toISOString();
  const preflight = action.status === 'pending'
    ? runActionPreflight(taskId, action, ctx, now)
    : createActionCheck('preflight', now, false, 'not_pending', `action ${action.action_id} is not pending`);
  const execution = {
    executor,
    mode,
    to_agent: toAgent,
    thread_id: threadId,
    note: options.note || null,
    executed_at: now,
    artifacts: {},
    verification: {
      preflight,
      postflight: null,
    },
  };

  if (action.status !== 'pending') {
    execution.status = 'skipped';
    execution.error = { message: `action ${action.action_id} is not pending` };
  } else if (!preflight.ok) {
    execution.status = 'skipped';
    execution.error = { message: preflight.summary };
  } else if (!toAgent && mode !== 'noop') {
    execution.status = 'skipped';
    execution.error = { message: `action ${action.action_id} has no owner agent` };
  } else if (mode === 'noop') {
    execution.status = 'skipped';
  } else if (mode === 'message') {
    const nowDate = new Date(now);
    const ttlSeconds = 24 * 60 * 60;
    const message = {
      schema: 'atf.message.v1',
      message_id: generateId('MSG'),
      task_id: ctx.short_id || ctx.task_id,
      thread_id: threadId,
      focus_id: action.focus_id || null,
      reply_to_message_id: null,
      from_agent: 'adapter-action',
      to_agent: toAgent,
      message_type: action.suggested_message_type || 'request',
      body: buildActionMessageBody(action),
      created_at: now,
      ttl_seconds: ttlSeconds,
      expires_at: new Date(nowDate.getTime() + (ttlSeconds * 1000)).toISOString(),
      status: 'sent',
      receipt_ids: [],
      last_receipt_type: null,
      last_receipt_at: null,
      source_type: 'action',
      source_ref: action.action_id,
      action_id: action.action_id,
    };
    saveMessage(taskId, message);
    appendNotificationHistory(taskId, {
      event: 'message_sent',
      message_id: message.message_id,
      from: message.from_agent,
      to: message.to_agent,
      type: message.message_type,
      thread_id: message.thread_id,
      focus_id: message.focus_id,
      at: message.created_at,
    });
    execution.status = 'executed';
    execution.artifacts.message_id = message.message_id;
    execution.artifacts.message_path = messagePath(taskId, message.message_id);
  } else if (mode === 'pending_task') {
    const workspace = resolveAgentWorkspace(toAgent);
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });
    const filePath = path.join(workspace, 'pending-task.json');
    const pendingTask = {
      schema: 'atf.action-pending-task.v1',
      action_id: action.action_id,
      task_id: ctx.short_id || ctx.task_id,
      assigned_to: toAgent,
      kind: action.kind,
      attempt: action.attempt || 1,
      reissue_of: action.reissue_of || null,
      priority: action.priority,
      summary: action.summary,
      guidance: action.guidance,
      payload: action.payload,
      created_by: executor,
      created_at: now,
    };
    fs.writeFileSync(filePath, JSON.stringify(pendingTask, null, 2));
    execution.status = 'executed';
    execution.artifacts.pending_task_path = filePath;
  } else {
    execution.status = 'skipped';
    execution.error = { message: `unsupported action mode: ${mode}` };
  }

  execution.verification.postflight = runActionPostflight(taskId, action, execution, now);
  if (execution.status === 'executed' && !execution.verification.postflight.ok) {
    execution.status = 'skipped';
    execution.error = { message: execution.verification.postflight.summary };
  }

  action.execution_mode = mode;
  action.executed_at = execution.status === 'executed' ? now : action.executed_at;
  action.execution = execution;
  action.verification = execution.verification;
  action.status = execution.status === 'executed' ? 'executed' : 'skipped';
  action.history = appendHistoryEvent(action.history, {
    event: execution.status === 'executed' ? 'executed' : 'skipped',
    by: executor,
    at: now,
    note: execution.note || execution.error?.message || mode,
  });
  saveAction(taskId, action);
  appendNotificationHistory(taskId, {
    event: execution.status === 'executed' ? 'action_executed' : 'action_skipped',
    action_id: action.action_id,
    kind: action.kind,
    owner_agent: action.owner_agent,
    execution_mode: mode,
    at: now,
  });
  refreshActionIndexes();
  return action;
}

function collectActions(options = {}) {
  const ownerFilter = isClearedValue(options.owner_agent) ? null : String(options.owner_agent).trim();
  const statusFilter = isClearedValue(options.status) ? null : String(options.status).trim().toLowerCase();
  const kindFilter = normalizeActionKind(options.kind);
  const taskFilter = isClearedValue(options.task_id) ? null : String(options.task_id).trim();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const rows = [];

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    if (taskFilter && taskId !== taskFilter) continue;
    for (const action of readTaskActions(taskId)) {
      if (ownerFilter && action.owner_agent !== ownerFilter) continue;
      if (statusFilter && action.status !== statusFilter) continue;
      if (kindFilter && action.kind !== kindFilter) continue;
      rows.push(action);
    }
  }

  rows.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'pending') return -1;
      if (b.status === 'pending') return 1;
    }
    return (a.created_at || '').localeCompare(b.created_at || '');
  });
  return limit ? rows.slice(0, limit) : rows;
}

function parseActionPlanArgs(parts) {
  let ownerAgent = null;
  let kind = null;
  let staleDays = 4;
  let messageHours = 12;
  let decisionHours = 6;
  let limit = null;
  let invalid = null;

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('kind=')) {
      kind = normalizeActionKind(part.substring('kind='.length));
      if (!kind) invalid = part;
      continue;
    }
    if (part.startsWith('stale_days=')) {
      const value = Number(part.substring('stale_days='.length));
      if (!Number.isInteger(value) || value < 0) {
        invalid = part;
        break;
      }
      staleDays = value;
      continue;
    }
    if (part.startsWith('message_hours=')) {
      const value = Number(part.substring('message_hours='.length));
      if (!Number.isInteger(value) || value < 0) {
        invalid = part;
        break;
      }
      messageHours = value;
      continue;
    }
    if (part.startsWith('decision_hours=')) {
      const value = Number(part.substring('decision_hours='.length));
      if (!Number.isInteger(value) || value < 0) {
        invalid = part;
        break;
      }
      decisionHours = value;
      continue;
    }
    if (part.startsWith('limit=')) {
      const value = Number(part.substring('limit='.length));
      if (!Number.isInteger(value) || value <= 0) {
        invalid = part;
        break;
      }
      limit = value;
      continue;
    }
    if (!ownerAgent) {
      ownerAgent = part;
      continue;
    }
    invalid = part;
    break;
  }

  return {
    ownerAgent,
    kind,
    staleDays,
    messageHours,
    decisionHours,
    limit,
    invalid,
  };
}

function parseActionExecuteArgs(parts) {
  let ownerAgent = null;
  let kind = null;
  let executor = 'action-executor';
  let mode = null;
  let limit = null;
  let note = null;
  let toAgent = null;
  let threadId = null;
  let invalid = null;

  for (const part of parts.filter(Boolean)) {
    if (part.startsWith('kind=')) {
      kind = normalizeActionKind(part.substring('kind='.length));
      if (!kind) invalid = part;
      continue;
    }
    if (part.startsWith('executor=')) {
      executor = part.substring('executor='.length) || executor;
      continue;
    }
    if (part.startsWith('mode=')) {
      mode = normalizeActionExecutionMode(part.substring('mode='.length));
      if (!mode) invalid = part;
      continue;
    }
    if (part.startsWith('limit=')) {
      const value = Number(part.substring('limit='.length));
      if (!Number.isInteger(value) || value <= 0) {
        invalid = part;
        break;
      }
      limit = value;
      continue;
    }
    if (part.startsWith('note=')) {
      note = part.substring('note='.length) || null;
      continue;
    }
    if (part.startsWith('to=')) {
      toAgent = part.substring('to='.length) || null;
      continue;
    }
    if (part.startsWith('thread=')) {
      threadId = part.substring('thread='.length) || null;
      continue;
    }
    if (!ownerAgent) {
      ownerAgent = part;
      continue;
    }
    invalid = part;
    break;
  }

  return {
    ownerAgent,
    kind,
    executor,
    mode,
    limit,
    note,
    toAgent,
    threadId,
    invalid,
  };
}

function formatAgentReputationSummary(agent) {
  if (!agent) return 'no data';
  return [
    `score=${agent.overall_score ?? '-'}`,
    `delivery=${formatRate(agent.derived.delivery_rate)}`,
    `response=${formatRate(agent.derived.response_rate)}`,
    `avg_review=${agent.review_stats.average_scores.overall ?? '-'}`,
    `reviews=${agent.review_stats.received}`,
  ].join('  ');
}

function reviewCreditBase(reviewType) {
  if (reviewType === 'delivery') return 10;
  if (reviewType === 'task') return 8;
  if (reviewType === 'collaboration') return 4;
  return 6;
}

function computeReviewCredits(review) {
  const base = reviewCreditBase(review.review_type);
  const overall = Number.isFinite(review?.scores?.overall) ? review.scores.overall : null;
  let revieweeCredits = 0;
  if (review.outcome === 'approved') {
    const bonus = overall === null ? 0 : Math.max(0, Math.round((overall - 3) * 2));
    revieweeCredits = base + bonus;
  } else if (review.outcome === 'needs_revision') {
    revieweeCredits = Math.max(1, Math.round(base * 0.3));
  } else if (review.outcome === 'rejected') {
    revieweeCredits = -Math.max(3, Math.round(base * 0.8));
  }
  const reviewerCredits = review.reviewer && review.reviewer !== review.reviewee ? 1 : 0;
  return {
    reviewee_credits: revieweeCredits,
    reviewer_credits: reviewerCredits,
  };
}

function computeTaskCompletionCredits(ctx) {
  const reviewStatus = getEffectiveTaskReviewStatus(ctx);
  if (reviewStatus === 'delivered') {
    return {
      completion_credits: 10,
      completion_stage: 'delivered',
    };
  }
  if (reviewStatus === 'completed') {
    return {
      completion_credits: 6,
      completion_stage: 'completed',
    };
  }
  return null;
}

function ensureCreditsAgentEntry(index, agent) {
  if (!isReputationAgent(agent)) return null;
  if (!index.has(agent)) {
    index.set(agent, {
      agent,
      total_credits: 0,
      role_credits: {
        from_completion: 0,
        as_reviewee: 0,
        as_reviewer: 0,
      },
      completion_stats: {
        completed: 0,
        delivered: 0,
      },
      review_stats: {
        received: 0,
        given: 0,
        outcomes: {
          approved: 0,
          needs_revision: 0,
          rejected: 0,
        },
        by_type: {
          task: 0,
          delivery: 0,
          collaboration: 0,
        },
      },
      last_credit_at: null,
      recent_events: [],
    });
  }
  return index.get(agent);
}

function buildCreditsIndex() {
  const agentIndex = new Map();
  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    const completion = computeTaskCompletionCredits(ctx);
    const assignee = ensureCreditsAgentEntry(agentIndex, ctx.assigned_to);
    if (assignee && completion) {
      assignee.total_credits += completion.completion_credits;
      assignee.role_credits.from_completion += completion.completion_credits;
      if (completion.completion_stage === 'delivered') assignee.completion_stats.delivered += 1;
      else assignee.completion_stats.completed += 1;
      assignee.last_credit_at = ctx.updated_at || ctx.created_at || new Date().toISOString();
      assignee.recent_events.push({
        event_id: `CMP-${taskId}`,
        event_type: 'completion',
        role: 'assignee',
        task_id: taskId,
        completion_stage: completion.completion_stage,
        credits: completion.completion_credits,
        summary: compactText(ctx.description, 160),
        at: ctx.updated_at || ctx.created_at || new Date().toISOString(),
        counterparty: null,
      });
    }

    for (const review of readTaskReviews(taskId)) {
      if (isSelfReview(review)) continue;
      const credits = computeReviewCredits(review);
      const reviewee = ensureCreditsAgentEntry(agentIndex, review.reviewee);
      if (reviewee) {
        reviewee.total_credits += credits.reviewee_credits;
        reviewee.role_credits.as_reviewee += credits.reviewee_credits;
        reviewee.review_stats.received += 1;
        if (reviewee.review_stats.outcomes[review.outcome] !== undefined) reviewee.review_stats.outcomes[review.outcome] += 1;
        if (reviewee.review_stats.by_type[review.review_type] !== undefined) reviewee.review_stats.by_type[review.review_type] += 1;
        reviewee.last_credit_at = review.created_at;
        reviewee.recent_events.push({
          event_id: review.review_id,
          event_type: 'review',
          role: 'reviewee',
          task_id: review.task_id,
          review_type: review.review_type,
          outcome: review.outcome,
          credits: credits.reviewee_credits,
          summary: compactText(review.summary, 160),
          at: review.created_at,
          counterparty: review.reviewer,
        });
      }

      const reviewer = ensureCreditsAgentEntry(agentIndex, review.reviewer);
      if (reviewer && credits.reviewer_credits) {
        reviewer.total_credits += credits.reviewer_credits;
        reviewer.role_credits.as_reviewer += credits.reviewer_credits;
        reviewer.review_stats.given += 1;
        reviewer.last_credit_at = review.created_at;
        reviewer.recent_events.push({
          event_id: review.review_id,
          event_type: 'review',
          role: 'reviewer',
          task_id: review.task_id,
          review_type: review.review_type,
          outcome: review.outcome,
          credits: credits.reviewer_credits,
          summary: compactText(review.summary, 160),
          at: review.created_at,
          counterparty: review.reviewee,
        });
      }
    }
  }

  const agents = [...agentIndex.values()]
    .map(entry => ({
      agent: entry.agent,
      total_credits: entry.total_credits,
      role_credits: entry.role_credits,
      completion_stats: entry.completion_stats,
      review_stats: entry.review_stats,
      last_credit_at: entry.last_credit_at,
      recent_events: [...entry.recent_events]
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, 8),
    }))
    .sort((a, b) => {
      const creditDiff = (b.total_credits ?? 0) - (a.total_credits ?? 0);
      if (creditDiff) return creditDiff;
      return a.agent.localeCompare(b.agent);
    });

  const index = {
    schema: 'atf.credits-index.v1',
    updated_at: new Date().toISOString(),
    total_agents: agents.length,
    agents,
  };
  saveJson(CREDITS_FILE, index);
  return index;
}

function loadCreditsIndex(options = {}) {
  const existing = loadJson(CREDITS_FILE);
  if (existing?.schema === 'atf.credits-index.v1' && Array.isArray(existing.agents)) return existing;
  if (options.rebuildIfMissing === false) return null;
  return buildCreditsIndex();
}

function findAgentCredits(agentName, index = null) {
  if (!agentName) return null;
  const creditsIndex = index || loadCreditsIndex({ rebuildIfMissing: false });
  return creditsIndex?.agents?.find(agent => agent.agent === agentName) || null;
}

function formatAgentCreditsSummary(agent) {
  if (!agent) return 'no data';
  return [
    `total=${agent.total_credits ?? 0}`,
    `completion=${agent.role_credits?.from_completion ?? 0}`,
    `reviewee=${agent.role_credits?.as_reviewee ?? 0}`,
    `reviewer=${agent.role_credits?.as_reviewer ?? 0}`,
  ].join('  ');
}

function findAgentTaskTypeStats(agent, taskType) {
  if (!agent || !taskType) return null;
  return agent.specialization?.task_types?.find(item => item.type === taskType) || null;
}

function computeTaskFitSignal(agentReputation, taskProfile) {
  if (!taskProfile?.type) {
    return {
      score: 0,
      reason: 'type_fit=n/a',
    };
  }
  const typeStats = findAgentTaskTypeStats(agentReputation, taskProfile.type);
  const difficulty = taskProfile.difficulty || 3;
  if (!typeStats) {
    return {
      score: difficulty >= 4 ? -10 : -4,
      reason: `type_fit=none(${taskProfile.type})`,
    };
  }

  const assigned = typeStats.task_stats.assigned || 0;
  const experienceBonus = Math.min(12, assigned * 3);
  const qualityBonus = typeStats.overall_score === null ? 0 : roundNumber((typeStats.overall_score - 50) * 0.35, 1);
  const lowExperiencePenalty = difficulty >= 4 && assigned <= 1 ? 6 : 0;
  const score = roundNumber(experienceBonus + qualityBonus - lowExperiencePenalty, 1);

  return {
    score,
    reason: `type_fit=${taskProfile.type}:${typeStats.overall_score ?? '-'}@${assigned}`,
  };
}

function collectKnownAgents() {
  return loadAgentRegistry({ persistIfMissing: false }).agents
    .filter(entry => entry.enabled !== false)
    .map(entry => entry.agent)
    .filter(Boolean)
    .sort();
}

function recordAgentObservation(observed, registeredAgents, agent, source, taskId = null, filePath = null) {
  if (!isReputationAgent(agent)) return;
  const normalized = String(agent).trim();
  if (!observed.has(normalized)) {
    observed.set(normalized, {
      agent: normalized,
      registered: isRegisteredAgent(normalized, registeredAgents),
      count: 0,
      sources: new Map(),
      task_ids: new Set(),
      files: new Set(),
      examples: [],
    });
  }
  const bucket = observed.get(normalized);
  bucket.count += 1;
  bucket.sources.set(source, (bucket.sources.get(source) || 0) + 1);
  if (taskId) bucket.task_ids.add(taskId);
  if (filePath) bucket.files.add(filePath);
  if (bucket.examples.length < 5) {
    bucket.examples.push({
      source,
      task_id: taskId || null,
      file_path: filePath || null,
    });
  }
}

function buildAgentAudit(top = 10) {
  const registry = loadAgentRegistry({ persistIfMissing: false });
  const registeredAgents = new Set(registry.agents.filter(entry => entry.enabled !== false).map(entry => entry.agent));
  const observed = new Map();
  const unknownSourceCounts = new Map();

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    const dir = taskDirPath(taskId);
    recordAgentObservation(observed, registeredAgents, ctx.assigned_to, 'task.assigned_to', taskId, `${dir}/ctx.json`);
    recordAgentObservation(observed, registeredAgents, ctx.dri, 'task.dri', taskId, `${dir}/ctx.json`);
    recordAgentObservation(observed, registeredAgents, ctx.created_by, 'task.created_by', taskId, `${dir}/ctx.json`);

    for (const focus of readTaskFocus(taskId)) {
      recordAgentObservation(observed, registeredAgents, focus.owner_agent, 'focus.owner_agent', taskId, focusPath(taskId, focus.focus_id));
    }
    for (const trigger of readTaskTriggers(taskId)) {
      recordAgentObservation(observed, registeredAgents, trigger.owner_agent, 'trigger.owner_agent', taskId, triggerPath(taskId, trigger.trigger_id));
    }
    for (const fire of readTaskTriggerFires(taskId)) {
      recordAgentObservation(observed, registeredAgents, fire.owner_agent, 'trigger_fire.owner_agent', taskId, triggerFirePath(taskId, fire.fire_id));
      recordAgentObservation(observed, registeredAgents, fire.consumed_by, 'trigger_fire.consumed_by', taskId, triggerFirePath(taskId, fire.fire_id));
      recordAgentObservation(observed, registeredAgents, fire.executed_by, 'trigger_fire.executed_by', taskId, triggerFirePath(taskId, fire.fire_id));
    }
    for (const execution of readTaskTriggerExecutions(taskId)) {
      recordAgentObservation(observed, registeredAgents, execution.owner_agent, 'trigger_execution.owner_agent', taskId, triggerExecutionPath(taskId, execution.execution_id));
      recordAgentObservation(observed, registeredAgents, execution.executor, 'trigger_execution.executor', taskId, triggerExecutionPath(taskId, execution.execution_id));
      recordAgentObservation(observed, registeredAgents, execution.delivery_target?.agent, 'trigger_execution.delivery_agent', taskId, triggerExecutionPath(taskId, execution.execution_id));
    }
    for (const message of readTaskMessages(taskId)) {
      recordAgentObservation(observed, registeredAgents, message.from_agent, 'message.from_agent', taskId, messagePath(taskId, message.message_id));
      recordAgentObservation(observed, registeredAgents, message.to_agent, 'message.to_agent', taskId, messagePath(taskId, message.message_id));
    }
    for (const receipt of readTaskReceipts(taskId)) {
      recordAgentObservation(observed, registeredAgents, receipt.from_agent, 'receipt.from_agent', taskId, receiptPath(taskId, receipt.receipt_id));
      recordAgentObservation(observed, registeredAgents, receipt.to_agent, 'receipt.to_agent', taskId, receiptPath(taskId, receipt.receipt_id));
    }
    for (const review of readTaskReviews(taskId)) {
      recordAgentObservation(observed, registeredAgents, review.reviewer, 'review.reviewer', taskId, reviewPath(taskId, review.review_id));
      recordAgentObservation(observed, registeredAgents, review.reviewee, 'review.reviewee', taskId, reviewPath(taskId, review.review_id));
    }
  }

  const observedAgents = [...observed.values()]
    .map(entry => ({
      agent: entry.agent,
      registered: entry.registered,
      count: entry.count,
      sources: [...entry.sources.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
      task_ids: [...entry.task_ids].sort(),
      files: [...entry.files].sort(),
      examples: entry.examples,
    }))
    .sort((a, b) => {
      if (a.registered !== b.registered) return a.registered ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.agent.localeCompare(b.agent);
    });

  const unknownAgents = observedAgents.filter(entry => !entry.registered);
  for (const entry of unknownAgents) {
    for (const source of entry.sources) {
      unknownSourceCounts.set(source.source, (unknownSourceCounts.get(source.source) || 0) + source.count);
    }
  }

  return {
    registry,
    registered_agents: registry.agents.filter(entry => entry.enabled !== false),
    observed_agents: observedAgents,
    unknown_agents: unknownAgents,
    unknown_source_counts: [...unknownSourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    top,
  };
}

const AGENT_REFERENCE_FIELDS = new Set([
  'assigned_to',
  'dri',
  'created_by',
  'reviewer',
  'reviewee',
  'from_agent',
  'to_agent',
  'owner_agent',
  'consumed_by',
  'executed_by',
  'executor',
  'agent',
]);

function remapAgentReferencesInValue(value, fromAgent, toAgent, counters) {
  let changed = false;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (remapAgentReferencesInValue(item, fromAgent, toAgent, counters)) changed = true;
    }
    return changed;
  }
  for (const [key, child] of Object.entries(value)) {
    if (AGENT_REFERENCE_FIELDS.has(key) && child === fromAgent) {
      value[key] = toAgent;
      counters.replacements += 1;
      counters.fields.set(key, (counters.fields.get(key) || 0) + 1);
      changed = true;
      continue;
    }
    if (child && typeof child === 'object') {
      if (remapAgentReferencesInValue(child, fromAgent, toAgent, counters)) changed = true;
    }
  }
  return changed;
}

function buildTaskRemapFileEntries(taskId) {
  const dir = taskDirPath(taskId);
  const entries = [
    { file_path: `${dir}/ctx.json`, source: 'task', task_id: taskId },
    { file_path: `${dir}/latest.json`, source: 'task', task_id: taskId },
  ];
  for (const focus of readTaskFocus(taskId)) {
    entries.push({ file_path: focusPath(taskId, focus.focus_id), source: 'focus', task_id: taskId });
  }
  for (const trigger of readTaskTriggers(taskId)) {
    entries.push({ file_path: triggerPath(taskId, trigger.trigger_id), source: 'trigger', task_id: taskId });
  }
  for (const fire of readTaskTriggerFires(taskId)) {
    entries.push({ file_path: triggerFirePath(taskId, fire.fire_id), source: 'trigger_fire', task_id: taskId });
  }
  for (const execution of readTaskTriggerExecutions(taskId)) {
    entries.push({ file_path: triggerExecutionPath(taskId, execution.execution_id), source: 'trigger_execution', task_id: taskId });
  }
  for (const message of readTaskMessages(taskId)) {
    entries.push({ file_path: messagePath(taskId, message.message_id), source: 'message', task_id: taskId });
  }
  for (const receipt of readTaskReceipts(taskId)) {
    entries.push({ file_path: receiptPath(taskId, receipt.receipt_id), source: 'receipt', task_id: taskId });
  }
  for (const review of readTaskReviews(taskId)) {
    entries.push({ file_path: reviewPath(taskId, review.review_id), source: 'review', task_id: taskId });
  }
  return entries;
}

function remapAgentReferences(fromAgent, toAgent, options = {}) {
  const apply = Boolean(options.apply);
  const registry = loadAgentRegistry({ persistIfMissing: apply });
  const registeredAgents = new Set(registry.agents.filter(entry => entry.enabled !== false).map(entry => entry.agent));
  const sourceCounts = new Map();
  const fieldCounts = new Map();
  const touchedTasks = new Set();
  const touchedFiles = [];
  let replacements = 0;

  for (const ctx of getAllTasks()) {
    const taskId = ctx.short_id || ctx.task_id;
    for (const entry of buildTaskRemapFileEntries(taskId)) {
      const data = loadJson(entry.file_path);
      if (!data) continue;
      const counters = { replacements: 0, fields: new Map() };
      if (!remapAgentReferencesInValue(data, fromAgent, toAgent, counters)) continue;
      replacements += counters.replacements;
      sourceCounts.set(entry.source, (sourceCounts.get(entry.source) || 0) + counters.replacements);
      for (const [field, count] of counters.fields.entries()) {
        fieldCounts.set(field, (fieldCounts.get(field) || 0) + count);
      }
      touchedTasks.add(entry.task_id);
      touchedFiles.push(entry.file_path);
      if (apply) saveJson(entry.file_path, data);
    }
  }

  let registryChanged = false;
  if (apply) {
    const fromEntry = registry.agents.find(entry => entry.agent === fromAgent);
    const toEntry = registry.agents.find(entry => entry.agent === toAgent);
    if (fromEntry && !toEntry) {
      fromEntry.agent = toAgent;
      fromEntry.workspace = fromEntry.workspace || AGENT_WORKSPACES[toAgent] || null;
      fromEntry.source = 'registry';
      registryChanged = true;
    } else if (fromEntry && toEntry) {
      registry.agents = registry.agents.filter(entry => entry.agent !== fromAgent);
      registryChanged = true;
    }
    if (registryChanged) saveAgentRegistry(registry);
  }

  if (apply && replacements > 0) {
    refreshTriggerIndexes();
    buildReputationIndex();
    buildCreditsIndex();
  }

  return {
    from_agent: fromAgent,
    to_agent: toAgent,
    apply,
    target_registered: isRegisteredAgent(toAgent, registeredAgents),
    source_counts: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    field_counts: [...fieldCounts.entries()]
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field)),
    touched_tasks: [...touchedTasks].sort(),
    touched_files: touchedFiles.sort(),
    replacements,
    registry_changed: registryChanged,
  };
}

function isActiveTaskStatus(status) {
  return !['completed', 'delivered', 'cancelled', 'archived'].includes(status);
}

function buildAssignmentRecommendations(taskId, options = {}) {
  const ctx = readCtx(taskId);
  if (!ctx) return null;
  const top = Math.max(1, options.top || 3);
  const reputationIndex = loadReputationIndex();
  const creditsIndex = loadCreditsIndex();
  const pendingReviewTasks = collectPendingReviewTasks();
  const agents = collectKnownAgents();
  const taskProfile = getTaskProfile(ctx);
  const priorityMultiplier = ({
    low: 0.85,
    normal: 1,
    high: 1.15,
    urgent: 1.35,
  })[taskProfile.priority || 'normal'];
  const difficultyPenalty = Math.max(((taskProfile.difficulty || 3) - 3) * 3, 0);

  const recommendations = agents.map(agentName => {
    const reputation = findAgentReputation(agentName, reputationIndex);
    const credits = findAgentCredits(agentName, creditsIndex);
    const activeTasks = getAllTasks().filter(task => task.assigned_to === agentName && isActiveTaskStatus(task.status)).length;
    const pendingReviews = pendingReviewTasks.filter(task => task.reviewee === agentName).length;
    const reputationScore = reputation?.overall_score ?? 50;
    const creditSignal = Math.max(-20, Math.min(20, (credits?.total_credits ?? 0) * 1.5));
    const workloadPenalty = roundNumber(activeTasks * 10 * priorityMultiplier + (activeTasks * difficultyPenalty), 1);
    const pendingReviewPenalty = roundNumber(pendingReviews * 5 * priorityMultiplier, 1);
    const taskFit = computeTaskFitSignal(reputation, taskProfile);
    const recommendationScore = roundNumber(reputationScore + creditSignal + taskFit.score - workloadPenalty - pendingReviewPenalty, 1);

    return {
      agent: agentName,
      recommendation_score: recommendationScore,
      reputation_score: reputation?.overall_score ?? null,
      total_credits: credits?.total_credits ?? 0,
      active_tasks: activeTasks,
      pending_reviews: pendingReviews,
      task_fit_score: taskFit.score,
      reasons: [
        `reputation=${reputation?.overall_score ?? '-'}`,
        `credits=${credits?.total_credits ?? 0}`,
        `active=${activeTasks}`,
        `pending_reviews=${pendingReviews}`,
        taskFit.reason,
      ],
    };
  })
    .sort((a, b) => {
      const scoreDiff = (b.recommendation_score ?? -Infinity) - (a.recommendation_score ?? -Infinity);
      if (scoreDiff) return scoreDiff;
      return a.agent.localeCompare(b.agent);
    });

  return {
    task: {
      task_id: ctx.short_id || ctx.task_id,
      description: ctx.description,
      task_profile: taskProfile,
      current_assignee: ctx.assigned_to || null,
      dri: ctx.dri || null,
      status: ctx.status,
    },
    generated_at: new Date().toISOString(),
    top,
    recommendations: recommendations.slice(0, top),
  };
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
  const subdirs = ['research', 'implementation', 'notes', 'notifications', 'messages', 'receipts', 'focus-items', 'triggers', 'trigger-fires', 'trigger-executions', 'reflections', 'reviews'];
  for (const s of subdirs) fs.mkdirSync(`${taskPath}/${s}`, { recursive: true });
  fs.writeFileSync(`${taskPath}/README.md`, `# ${taskNum} - ${description}\n\n**状态**: created\n`);
  fs.writeFileSync(`${taskPath}/progress.md`, `## 进度记录\n\n### ${new Date().toISOString()}\n- 任务创建\n`);
  return { dirName, taskPath };
}

function initCtx(taskNum, description, options = {}) {
  const { dirName } = createTaskDir(taskNum, description);
  const taskId = dirName;
  const taskProfile = normalizeTaskProfile(options.task_profile || {}, null);
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
      confirm_timeout: options.confirm_timeout ?? 300,
      final_timeout: options.final_timeout ?? 7200,
      retry_count: 0,
      max_retries: options.max_retries || 3,
      delivery_status: 'pending', // pending → delivered | failed
      delivery_attempts: 0,
    },
    inputs: options.inputs || {},
    outputs: options.outputs || {},
    task_profile: taskProfile,
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
  atf create <描述> [type=x] [difficulty=1-5] [priority=x] [tags=a,b] [--confirm-timeout=40m] [--final-timeout=2h]  创建任务
  atf list                                列出所有任务
  atf status <taskId>                    查看状态（+投递状态+DRI）
  atf stats summary                      查看整体完成/反馈统计
  atf stats agents                       查看 agent 完成度/反馈统计
  atf stats digest [days=N] [stale_days=N] [top=N]  查看日常巡检摘要
  atf stats recent [days=N] [agent=x] [type=x] [status=x] [review=x] [limit=N]  查看最近窗口任务活动
  atf stats stale [days=N] [agent=x] [type=x] [status=completed|delivered] [top=N]  查看 stale review backlog
  atf stats tasks [agent=x] [type=x] [status=x] [review=all|pending|reviewed|approved|needs_revision|rejected|na] [min_age=N] [max_age=N] [limit=N]  查看任务级统计
  atf stats reviews [agent=x] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [top=N]  查看 review 覆盖率和 backlog 汇总
  atf stats types                        查看任务类型维度统计
  atf stats show <agent>                 查看单个 agent 完成度/反馈统计
  atf profile <taskId>                   查看任务画像
  atf profile set <taskId> [type=x] [difficulty=1-5] [priority=x] [tag=x] [tags=a,b]  更新任务画像
  atf assign <taskId> <agent> [--confirm-timeout=40m] [--final-timeout=2h]  指派
  atf assign recommend <taskId> [top=N]  查看内部指派建议
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
  atf review add <taskId> <reviewer> <reviewee> <outcome> <总结> [type=x] [overall=4] [quality=4] [timeliness=4] [communication=4] [ownership=4] [focus=FOC-...] [thread=x] [trigger=TRG-...] [fire=TGF-...]
  atf review list <taskId> [reviewee] [reviewer=x] [type=x] [outcome=x] [focus=FOC-...]
  atf review pending [agent] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [limit=N]  查看待评价任务
  atf review backlog [agent] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [top=N]  查看待评价 backlog 汇总
  atf review show <taskId> <reviewId>                查看单条 Review
  atf action scan [owner] [kind=x] [stale_days=N] [message_hours=N] [decision_hours=N] [limit=N]  扫描并生成 Phase D 动作
  atf action list [taskId|owner] [status=x] [kind=x] [limit=N]      查看动作队列
  atf action inbox <agent> [kind=x]                 查看 agent 待执行动作
  atf action rebuild-index                          重建全局动作索引
  atf action runs [agent] [status=completed|failed] [limit=N]       查看 watcher 运行审计
  atf action run-show <runId|latest>               查看单次 watcher 运行明细
  atf action watcher-status [agent] [warn_after_minutes=N] [limit=N] [json]  查看 action watcher 健康状态
  atf action show <taskId> <actionId>               查看动作
  atf action execute <taskId> <actionId> [executor=x] [mode=message|pending_task|noop] [to=agent] [thread=x] [note=x]
  atf action execute-pending [owner] [kind=x] [limit=N] [executor=x] [mode=message|pending_task|noop]
  atf agent list                                     查看注册 agent 列表
  atf agent audit [top=N]                            审计未知/脏 agent 引用
  atf agent remap <from> <to> [apply=true]          重映射错误 agent 名（默认 dry-run）
  atf credits rebuild                                重建 credits 积分索引
  atf credits list                                   查看内部积分概览
  atf credits show <agent>                           查看单个 agent 积分明细
  atf reputation rebuild                             重建 reputation / scores 索引
  atf reputation list                                查看 agent 信誉概览
  atf reputation show <agent>                        查看单个 agent 信誉画像
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
    const timeoutParsed = parseProtocolTimeoutArgs(args);
    if (timeoutParsed.errors.length) { console.error(`❌ ${timeoutParsed.errors.join('；')}`); break; }
    const parsed = parseTaskProfileArgs(timeoutParsed.remainingParts);
    if (parsed.errors.length) { console.error(`❌ ${parsed.errors.join('；')}`); break; }
    const description = parsed.descriptionTokens.join(' ');
    if (!description) { console.error('用法: atf create <描述> [type=x] [difficulty=1-5] [priority=x] [tags=a,b] [--confirm-timeout=40m] [--final-timeout=2h]'); break; }
    const num = getNextTaskNum();
    const { taskId, dirName, ctx } = initCtx(num, description, { task_profile: parsed.profile, ...timeoutParsed.protocol });
    console.log(`\n✅ 任务已创建: ${dirName}`);
    console.log(`   task_id: ${ctx.task_id}  |  status: ${ctx.status}`);
    console.log(`   confirm_timeout: ${ctx.protocol.confirm_timeout}s  |  final_timeout: ${ctx.protocol.final_timeout}s`);
    if (hasTaskProfile(ctx)) console.log(`   profile: ${formatTaskProfileSummary(ctx)}`);
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

  case 'profile': {
    if (args[0] === 'set') {
      const taskId = args[1];
      if (!taskId) { console.error('用法: atf profile set <taskId> [type=x] [difficulty=1-5] [priority=x] [tag=x] [tags=a,b]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const parsed = parseTaskProfileArgs(args.slice(2));
      if (parsed.errors.length) { console.error(`❌ ${parsed.errors.join('；')}`); break; }
      if (!parsed.matched || parsed.descriptionTokens.length) {
        console.error('用法: atf profile set <taskId> [type=x] [difficulty=1-5] [priority=x] [tag=x] [tags=a,b]');
        break;
      }
      ctx.task_profile = normalizeTaskProfile(parsed.profile, getTaskProfile(ctx));
      writeCtx(taskId, ctx);
      console.log(`✅ ${ctx.short_id || ctx.task_id} profile 已更新`);
      console.log(`   ${formatTaskProfileSummary(ctx)}`);
      break;
    }

    const taskId = args[0];
    if (!taskId) { console.error('用法: atf profile <taskId> | atf profile set <taskId> [type=x] [difficulty=1-5] [priority=x] [tag=x] [tags=a,b]'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const profile = getTaskProfile(ctx);
    console.log(`\n${ctx.short_id || ctx.task_id} Profile\n`);
    console.log(`summary: ${formatTaskProfileSummary(profile)}`);
    console.log(JSON.stringify(profile, null, 2));
    console.log('');
    break;
  }

  case 'status': {
    const taskId = args[0];
    if (!taskId) { console.error('用法: atf status <taskId>'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    const reputationIndex = loadReputationIndex();
    const creditsIndex = loadCreditsIndex();
    const assigneeReputation = findAgentReputation(ctx.assigned_to, reputationIndex);
    const assigneeCredits = findAgentCredits(ctx.assigned_to, creditsIndex);
    const reviewSummary = buildTaskReviewSummary(taskId);
    const externalReviewSummary = buildTaskReviewSummary(taskId, { externalOnly: true });
    const ds = ctx.protocol?.delivery_status || 'N/A';
    const da = ctx.protocol?.delivery_attempts || 0;
    const dri = ctx.dri || '-';
    const taskProfile = getTaskProfile(ctx);
    console.log(`\n任务: ${ctx.task_id} - ${ctx.description}`);
    console.log(`状态: ${ctx.status}  |  指派: ${ctx.assigned_to||'-'}  |  DRI: ${dri}`);
    console.log(`投递: ${ds} (${da}次)  |  重试: ${ctx.protocol?.retry_count||0}/${ctx.protocol?.max_retries||3}`);
    console.log(`创建: ${ctx.created_at}  |  更新: ${ctx.updated_at}`);
    if (hasTaskProfile(taskProfile)) console.log(`Profile: ${formatTaskProfileSummary(taskProfile)}`);
    if (ctx.sub_tasks.length) console.log(`子任务: ${ctx.sub_tasks.join(', ')}`);
    if (ctx.parent_id) console.log(`父任务: ${ctx.parent_id}`);
    if (externalReviewSummary) {
      console.log(`Reviews: total=${externalReviewSummary.total}  approved=${externalReviewSummary.outcomes.approved}  needs_revision=${externalReviewSummary.outcomes.needs_revision}  rejected=${externalReviewSummary.outcomes.rejected}  avg_overall=${externalReviewSummary.avg_overall ?? '-'}`);
    } else if (taskNeedsReview(ctx)) {
      console.log(`Reviews: pending for ${getPrimaryTaskReviewee(ctx)}`);
    }
    if (reviewSummary?.self_total) console.log(`Self Reviews: ${reviewSummary.self_total}`);
    if (ctx.assigned_to) {
      console.log(`Reputation(${ctx.assigned_to}): ${formatAgentReputationSummary(assigneeReputation)}`);
      console.log(`Credits(${ctx.assigned_to}): ${formatAgentCreditsSummary(assigneeCredits)}`);
    }
    console.log('');
    break;
  }

  case 'assign': {
    if (args[0] === 'recommend') {
      const taskId = args[1];
      if (!taskId) { console.error('用法: atf assign recommend <taskId> [top=N]'); break; }
      let top = 3;
      for (const part of args.slice(2)) {
        if (part && part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (Number.isFinite(value) && value > 0) top = Math.floor(value);
        }
      }
      const recommendation = buildAssignmentRecommendations(taskId, { top });
      if (!recommendation) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      console.log(`\n${recommendation.task.task_id} Assign Recommendations\n`);
      console.log(`${recommendation.task.description}`);
      console.log(`status=${recommendation.task.status}${recommendation.task.current_assignee ? `  current=${recommendation.task.current_assignee}` : ''}${recommendation.task.dri ? `  dri=${recommendation.task.dri}` : ''}`);
      if (hasTaskProfile(recommendation.task.task_profile)) console.log(`profile=${formatTaskProfileSummary(recommendation.task.task_profile)}`);
      console.log('');
      for (const item of recommendation.recommendations) {
        console.log(`${item.agent}  score=${item.recommendation_score}`);
        console.log(`  ${item.reasons.join('  ')}`);
      }
      console.log('');
      break;
    }

    const [taskId, agent, ...rest] = args;
    const timeoutParsed = parseProtocolTimeoutArgs(rest);
    if (timeoutParsed.errors.length) { console.error(`❌ ${timeoutParsed.errors.join('；')}`); break; }
    if (!taskId || !agent) { console.error('用法: atf assign <taskId> <agent> [--confirm-timeout=40m] [--final-timeout=2h]'); break; }
    const ctx = readCtx(taskId);
    if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
    ctx.assigned_to = agent; ctx.status = 'assigned';
    if (!ctx.protocol) ctx.protocol = {};
    if (timeoutParsed.protocol.confirm_timeout !== undefined) ctx.protocol.confirm_timeout = timeoutParsed.protocol.confirm_timeout;
    if (timeoutParsed.protocol.final_timeout !== undefined) ctx.protocol.final_timeout = timeoutParsed.protocol.final_timeout;
    ctx.protocol.delivery_status = 'pending';
    ctx.protocol.delivery_attempts = 0;
    writeCtx(taskId, ctx);
    buildReputationIndex();
    buildCreditsIndex();
    // 写 pending-task.json 通知 agent
    const dir = dirOfTaskId(taskId);
    const ws = `${TASKS_DIR}/${dir}`;
    const pending = {
      task_id: taskId,
      assigned_to: agent,
      description: ctx.description,
      instructions: ctx.instructions || null,
      task_profile: getTaskProfile(ctx),
      protocol: {
        confirm_timeout: ctx.protocol.confirm_timeout,
        final_timeout: ctx.protocol.final_timeout,
      },
      created_by: ctx.assigned_to || 'pinchymeow',
      created_at: new Date().toISOString()
    };
    fs.writeFileSync(`${ws}/pending-task.json`, JSON.stringify(pending, null, 2));
    console.log(`✅ 已指派 ${taskId} → ${agent}`);
    console.log(`   pending-task.json → ${ws}/pending-task.json`);
    console.log(`   confirm_timeout: ${ctx.protocol.confirm_timeout}s  |  final_timeout: ${ctx.protocol.final_timeout}s`);
    if (hasTaskProfile(ctx)) console.log(`   task_profile: ${formatTaskProfileSummary(ctx)}`);
    const assigneeReputation = findAgentReputation(agent, loadReputationIndex());
    const assigneeCredits = findAgentCredits(agent, loadCreditsIndex());
    console.log(`   reputation: ${formatAgentReputationSummary(assigneeReputation)}`);
    console.log(`   credits: ${formatAgentCreditsSummary(assigneeCredits)}`);
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
    buildReputationIndex();
    buildCreditsIndex();
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
        if (fire.last_execution_status && fire.last_execution_status !== 'dispatched' && fire.last_execution_id) {
          console.log(`  last-exec: ${fire.last_execution_id}  ${fire.last_execution_status}${fire.last_execution_mode ? `  |  ${fire.last_execution_mode}` : ''}`);
          if (fire.last_execution_error) console.log(`  error: ${fire.last_execution_error}`);
        }
        if (fire.consumed_at) console.log(`  consumed: ${fire.consumed_at} by ${fire.consumed_by || 'unknown'}${fire.result ? `  |  ${fire.result}` : ''}`);
      }
      console.log('');
      break;
    }

    if (sub === 'execute') {
      const [taskId, fireId, ...optionParts] = restArgs;
      if (!taskId || !fireId) {
        console.error('用法: atf trigger execute <taskId> <fireId> [executor] [mode=pending_task|message|room|noop] [note=x] [to=agent] [thread=x] [room=x]'); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const fire = readTriggerFire(taskId, fireId);
      if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
      const trigger = readTrigger(taskId, fire.trigger_id);
      if (!trigger) { console.error(`❌ 对应 Trigger 不存在: ${fire.trigger_id}`); break; }
      const { target, executor, mode, note, toAgent, threadId, roomId } = parseTriggerExecuteArgs(optionParts);
      const execution = executeTriggerFire(taskId, fire, trigger, ctx, {
        executor: target || executor,
        mode,
        note,
        toAgent,
        threadId,
        roomId,
      });
      console.log(`${execution.status === 'dispatched' ? 'Executed' : execution.status === 'skipped' ? 'Skipped' : 'Failed'} trigger fire ${fire.fire_id} -> ${execution.execution_id}`);
      console.log(`   mode: ${execution.execution_mode}  |  executor: ${execution.executor}  |  status: ${execution.status}`);
      if (execution.delivery_target?.kind) console.log(`   target: ${execution.delivery_target.kind}${execution.delivery_target.agent ? `:${execution.delivery_target.agent}` : execution.delivery_target.room_id ? `:${execution.delivery_target.room_id}` : ''}`);
      if (execution.artifacts.pending_task_path) console.log(`   pending-task: ${execution.artifacts.pending_task_path}`);
      if (execution.artifacts.message_id) console.log(`   message: ${execution.artifacts.message_id}`);
      if (execution.artifacts.message_path) console.log(`   message-path: ${execution.artifacts.message_path}`);
      if (execution.error?.message) console.log(`   error: ${execution.error.message}`);
      break;
    }

    if (sub === 'execute-pending') {
      const { target: agent, executor, mode, limit, note, toAgent, threadId, roomId } = parseTriggerExecuteArgs(restArgs);
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
          toAgent,
          threadId,
          roomId,
        }));
      }
      if (!executions.length) { console.log('没有成功执行的 trigger fires'); break; }
      const dispatched = executions.filter(execution => execution.status === 'dispatched').length;
      const failed = executions.filter(execution => execution.status === 'failed').length;
      const skipped = executions.filter(execution => execution.status === 'skipped').length;
      console.log(`Processed ${executions.length} pending trigger fires  |  dispatched:${dispatched}  skipped:${skipped}  failed:${failed}`);
      for (const execution of executions) {
        console.log(`   [${execution.task_id}] ${execution.execution_id}  fire:${execution.fire_id}  mode:${execution.execution_mode}  status:${execution.status}`);
        if (execution.error?.message) console.log(`      error: ${execution.error.message}`);
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
        if (execution.delivery_target?.kind) console.log(`  target: ${execution.delivery_target.kind}${execution.delivery_target.agent ? `:${execution.delivery_target.agent}` : execution.delivery_target.room_id ? `:${execution.delivery_target.room_id}` : ''}`);
        if (execution.thread_id) console.log(`  thread: ${execution.thread_id}`);
        if (execution.note) console.log(`  note: ${execution.note}`);
        if (execution.artifacts?.pending_task_path) console.log(`  pending-task: ${execution.artifacts.pending_task_path}`);
        if (execution.artifacts?.message_id) console.log(`  message: ${execution.artifacts.message_id}`);
        if (execution.artifacts?.message_path) console.log(`  message-path: ${execution.artifacts.message_path}`);
        if (execution.error?.message) console.log(`  error: ${execution.error.message}`);
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
  // review 命令 - 任务交付评价与协作评价
  // =============================================================
  case 'review': {
    const [sub, ...restArgs] = args;

    if (sub === 'add') {
      const [taskId, reviewer, reviewee, outcome, ...summaryParts] = restArgs;
      if (!taskId || !reviewer || !reviewee || !outcome || !summaryParts.length) {
        console.error('用法: atf review add <taskId> <reviewer> <reviewee> <outcome> <总结> [type=x] [overall=4] [quality=4] [timeliness=4] [communication=4] [ownership=4] [focus=FOC-...] [thread=x] [trigger=TRG-...] [fire=TGF-...]'); break;
      }
      if (!REVIEW_OUTCOMES.has(outcome)) {
        console.error(`Review outcome: ${[...REVIEW_OUTCOMES].join('|')}`); break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }

      let reviewType = 'task';
      let focusId = null;
      let threadId = null;
      let triggerId = null;
      let fireId = null;
      const scoreInputs = {};
      const summaryTokens = [];
      for (const part of summaryParts) {
        if (part.startsWith('type=')) reviewType = part.substring('type='.length) || 'task';
        else if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else if (part.startsWith('thread=')) threadId = part.substring('thread='.length);
        else if (part.startsWith('trigger=')) triggerId = part.substring('trigger='.length);
        else if (part.startsWith('fire=')) fireId = part.substring('fire='.length);
        else if (part.startsWith('score=')) scoreInputs.overall = part.substring('score='.length);
        else if (part.startsWith('overall=')) scoreInputs.overall = part.substring('overall='.length);
        else if (part.startsWith('quality=')) scoreInputs.quality = part.substring('quality='.length);
        else if (part.startsWith('timeliness=')) scoreInputs.timeliness = part.substring('timeliness='.length);
        else if (part.startsWith('communication=')) scoreInputs.communication = part.substring('communication='.length);
        else if (part.startsWith('ownership=')) scoreInputs.ownership = part.substring('ownership='.length);
        else summaryTokens.push(part);
      }
      if (!REVIEW_TYPES.has(reviewType)) {
        console.error(`Review type: ${[...REVIEW_TYPES].join('|')}`); break;
      }
      if (!summaryTokens.length) {
        console.error('❌ Review 总结不能为空'); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      let fire = null;
      if (fireId) {
        fire = readTriggerFire(taskId, fireId);
        if (!fire) { console.error(`❌ Trigger firing 不存在: ${fireId}`); break; }
        if (!focusId && fire.focus_id) focusId = fire.focus_id;
        if (!threadId && fire.thread_id) threadId = fire.thread_id;
        if (!triggerId) triggerId = fire.trigger_id;
      }
      if (triggerId && !readTrigger(taskId, triggerId)) {
        console.error(`❌ Trigger 不存在: ${triggerId}`); break;
      }
      if (!threadId) threadId = defaultThreadId(ctx.short_id || ctx.task_id, focusId, null);
      const scores = normalizeReviewScores(scoreInputs);
      if (!scores || !Object.keys(scores).length || scores.overall === undefined) {
        console.error('❌ Review 需要 overall=1-5 或至少一个维度评分（quality/timeliness/communication/ownership）'); break;
      }
      try {
        const review = createReview(taskId, ctx, reviewer, reviewee, outcome, summaryTokens.join(' '), {
          review_type: reviewType,
          focus_id: focusId,
          thread_id: threadId,
          trigger_id: triggerId,
          fire_id: fireId,
          scores,
        });
        buildReputationIndex();
        buildCreditsIndex();
        console.log(`✅ 已写入 Review ${review.review_id}`);
        console.log(`   任务: ${review.task_id}  |  ${review.reviewer} -> ${review.reviewee}`);
        console.log(`   类型: ${review.review_type}  |  outcome: ${review.outcome}  |  overall: ${review.scores.overall}${review.self_review ? '  |  self_review=true' : ''}`);
        const revieweeCredits = findAgentCredits(review.reviewee, loadCreditsIndex());
        console.log(`   credits(${review.reviewee}): ${formatAgentCreditsSummary(revieweeCredits)}`);
        if (review.focus_id || review.thread_id) console.log(`   scope: ${review.focus_id ? `focus=${review.focus_id}` : ''}${review.focus_id && review.thread_id ? '  ' : ''}${review.thread_id ? `thread=${review.thread_id}` : ''}`);
      } catch (error) {
        console.error(`❌ ${error.message}`);
      }
      break;
    }

    if (sub === 'pending') {
      let agent = null;
      let typeFilter = null;
      let statusFilter = null;
      let minAge = null;
      let maxAge = null;
      let limit = null;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('min_age=')) {
          const value = normalizeAgeFilterValue(part.substring('min_age='.length));
          if (value === undefined) {
            console.error('review pending min_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          minAge = value;
          continue;
        }
        if (part.startsWith('max_age=')) {
          const value = normalizeAgeFilterValue(part.substring('max_age='.length));
          if (value === undefined) {
            console.error('review pending max_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          maxAge = value;
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('review pending limit 必须是正整数');
            invalidArgs = true;
            break;
          }
          limit = value;
          continue;
        }
        if (!agent) {
          agent = part;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf review pending [agent] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [limit=N]');
        break;
      }
      if (statusFilter && !['completed', 'delivered'].includes(statusFilter)) {
        console.error('review pending status 只支持 completed|delivered');
        break;
      }
      if (minAge !== null && maxAge !== null && minAge > maxAge) {
        console.error('review pending 要求 min_age <= max_age');
        break;
      }
      const pendingTasks = collectPendingReviewTasks({
        agent: agent || null,
        type: typeFilter,
        status: statusFilter,
        min_age: minAge,
        max_age: maxAge,
        limit,
      });
      const filterLabel = [
        agent ? `agent=${agent}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        minAge !== null ? `min_age=${minAge}` : null,
        maxAge !== null ? `max_age=${maxAge}` : null,
        limit ? `limit=${limit}` : null,
      ].filter(Boolean).join('  ');
      if (!pendingTasks.length) {
        console.log(filterLabel ? `${filterLabel} 暂无待评价任务` : '当前暂无待评价任务');
        break;
      }
      console.log(`\n待评价任务 (${pendingTasks.length}${filterLabel ? `  |  ${filterLabel}` : ''})\n`);
      for (const task of pendingTasks) {
        console.log(`[${task.task_id}] ${formatAgentDisplay(task.reviewee)}  ${task.status}  ${task.updated_at}${task.task_type ? `  type=${task.task_type}` : ''}${Number.isInteger(task.age_days) ? `  age=${task.age_days}d` : ''}`);
        console.log(`  ${task.description}`);
        if (task.existing_review_summary) {
          console.log(`  existing_reviews=${task.existing_review_summary.total}  avg_overall=${task.existing_review_summary.avg_overall ?? '-'}`);
        }
        if (task.self_review_count) console.log(`  self_reviews=${task.self_review_count}`);
      }
      console.log('');
      break;
    }

    if (sub === 'backlog') {
      let agent = null;
      let typeFilter = null;
      let statusFilter = null;
      let minAge = null;
      let maxAge = null;
      let top = 10;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('min_age=')) {
          const value = normalizeAgeFilterValue(part.substring('min_age='.length));
          if (value === undefined) {
            console.error('review backlog min_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          minAge = value;
          continue;
        }
        if (part.startsWith('max_age=')) {
          const value = normalizeAgeFilterValue(part.substring('max_age='.length));
          if (value === undefined) {
            console.error('review backlog max_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          maxAge = value;
          continue;
        }
        if (part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('review backlog top 必须是正整数');
            invalidArgs = true;
            break;
          }
          top = value;
          continue;
        }
        if (!agent) {
          agent = part;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf review backlog [agent] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [top=N]');
        break;
      }
      if (statusFilter && !['completed', 'delivered'].includes(statusFilter)) {
        console.error('review backlog status 只支持 completed|delivered');
        break;
      }
      if (minAge !== null && maxAge !== null && minAge > maxAge) {
        console.error('review backlog 要求 min_age <= max_age');
        break;
      }

      const backlog = buildReviewBacklogStats({
        agent: agent || null,
        type: typeFilter,
        status: statusFilter,
        min_age: minAge,
        max_age: maxAge,
        top,
      });
      const filterLabel = [
        agent ? `agent=${agent}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        minAge !== null ? `min_age=${minAge}` : null,
        maxAge !== null ? `max_age=${maxAge}` : null,
        top ? `top=${top}` : null,
      ].filter(Boolean).join('  ');
      if (!backlog.pending_tasks) {
        console.log(filterLabel ? `review backlog (${filterLabel}) 暂无待处理积压` : '当前暂无待处理 review backlog');
        break;
      }

      console.log(`\nReview Backlog${filterLabel ? `  |  ${filterLabel}` : ''}\n`);
      console.log(`pending=${backlog.pending_tasks}  self_reviewed=${backlog.self_reviewed_tasks}${backlog.oldest_pending_age_days !== null ? `  oldest_age=${backlog.oldest_pending_age_days}d` : ''}`);
      if (backlog.oldest_pending_at) console.log(`oldest_pending_at=${backlog.oldest_pending_at}`);
      if (backlog.by_age_bucket.length) {
        console.log('\nbacklog by age:');
        for (const bucket of backlog.by_age_bucket) {
          console.log(`- ${bucket.bucket}: ${bucket.count}`);
        }
      }
      if (backlog.by_agent.length) {
        console.log('\nbacklog by agent:');
        console.log('agent           pending  self  completed  delivered  oldest_age  oldest');
        console.log('-'.repeat(78));
        for (const bucket of backlog.by_agent) {
          console.log(`${formatAgentDisplay(bucket.agent).padEnd(15)} ${String(bucket.pending).padEnd(8)} ${String(bucket.self_reviewed).padEnd(5)} ${String(bucket.completed).padEnd(10)} ${String(bucket.delivered).padEnd(10)} ${String(Number.isInteger(bucket.oldest_age_days) ? `${bucket.oldest_age_days}d` : '-').padEnd(11)} ${bucket.oldest_updated_at || '-'}`);
        }
      }
      if (backlog.by_type.length) {
        console.log('\nbacklog by type:');
        console.log('type             pending  self  completed  delivered');
        console.log('-'.repeat(54));
        for (const bucket of backlog.by_type) {
          console.log(`${bucket.type.padEnd(16)} ${String(bucket.pending).padEnd(8)} ${String(bucket.self_reviewed).padEnd(5)} ${String(bucket.completed).padEnd(10)} ${String(bucket.delivered).padEnd(10)}`);
        }
      }
      if (backlog.tasks.length) {
        console.log('\nbacklog tasks:');
        for (const task of backlog.tasks) {
          console.log(`[${task.task_id}] ${formatAgentDisplay(task.reviewee)}  ${task.status}  ${task.updated_at}${task.task_type ? `  type=${task.task_type}` : ''}${Number.isInteger(task.age_days) ? `  age=${task.age_days}d` : ''}${task.self_review_count ? `  self_reviews=${task.self_review_count}` : ''}`);
          console.log(`  ${task.description}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'list') {
      const [taskId, ...filterParts] = restArgs;
      if (!taskId) { console.error('用法: atf review list <taskId> [reviewee] [reviewer=x] [type=x] [outcome=x] [focus=FOC-...]'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      let reviewee = null;
      let reviewer = null;
      let reviewType = null;
      let outcomeFilter = null;
      let focusId = null;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('reviewer=')) reviewer = part.substring('reviewer='.length);
        else if (part.startsWith('type=')) reviewType = part.substring('type='.length);
        else if (part.startsWith('outcome=')) outcomeFilter = part.substring('outcome='.length);
        else if (part.startsWith('focus=')) focusId = part.substring('focus='.length);
        else reviewee = part;
      }
      if (reviewType && !REVIEW_TYPES.has(reviewType)) {
        console.error(`Review type: ${[...REVIEW_TYPES].join('|')}`); break;
      }
      if (outcomeFilter && !REVIEW_OUTCOMES.has(outcomeFilter)) {
        console.error(`Review outcome: ${[...REVIEW_OUTCOMES].join('|')}`); break;
      }
      if (focusId && !readFocus(taskId, focusId)) {
        console.error(`❌ Focus 不存在: ${focusId}`); break;
      }
      let reviews = readTaskReviews(taskId);
      if (reviewee) reviews = reviews.filter(review => review.reviewee === reviewee);
      if (reviewer) reviews = reviews.filter(review => review.reviewer === reviewer);
      if (reviewType) reviews = reviews.filter(review => review.review_type === reviewType);
      if (outcomeFilter) reviews = reviews.filter(review => review.outcome === outcomeFilter);
      if (focusId) reviews = reviews.filter(review => review.focus_id === focusId);
      if (!reviews.length) { console.log(`任务 ${ctx.short_id || ctx.task_id} 暂无 Reviews`); break; }
      console.log(`\n${ctx.short_id || ctx.task_id} Reviews (${reviews.length} 条)\n`);
      for (const review of reviews) {
        console.log(`${review.review_id}  ${review.reviewer} -> ${review.reviewee}  [${review.review_type}] ${review.outcome}${isSelfReview(review) ? '  [self]' : ''}`);
        console.log(`  overall=${review.scores.overall}${review.focus_id ? `  focus=${review.focus_id}` : ''}${review.thread_id ? `  thread=${review.thread_id}` : ''}`);
        console.log(`  ${review.summary}`);
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [taskId, reviewId] = restArgs;
      if (!taskId || !reviewId) { console.error('用法: atf review show <taskId> <reviewId>'); break; }
      const ctx = readCtx(taskId);
      if (!ctx) { console.error(`❌ 任务不存在: ${taskId}`); break; }
      const review = readReview(taskId, reviewId);
      if (!review) { console.error(`❌ Review 不存在: ${reviewId}`); break; }
      console.log(JSON.stringify(review, null, 2));
      break;
    }

    console.error('用法: atf review add|pending|backlog|list|show ...');
    break;
  }

  // =============================================================
  // action 命令 - Phase D 主动运营动作层
  // =============================================================
  case 'action': {
    const [sub, ...restArgs] = args;

    if (sub === 'scan') {
      const parsed = parseActionPlanArgs(restArgs);
      if (parsed.invalid) {
        console.error('用法: atf action scan [owner] [kind=x] [stale_days=N] [message_hours=N] [decision_hours=N] [limit=N]');
        break;
      }
      const result = scanActions({
        owner_agent: parsed.ownerAgent,
        kind: parsed.kind,
        stale_days: parsed.staleDays,
        message_hours: parsed.messageHours,
        decision_hours: parsed.decisionHours,
        limit: parsed.limit,
        planner: 'cli',
      });
      if (!result.created.length) {
        console.log(`action scan completed  |  scanned=${result.scanned}  created=0  duplicates=${result.duplicates}${result.cooldown_blocked ? `  cooldown=${result.cooldown_blocked}` : ''}${result.pending_blocked ? `  pending=${result.pending_blocked}` : ''}`);
        break;
      }
      console.log(`action scan completed  |  scanned=${result.scanned}  created=${result.created.length}  duplicates=${result.duplicates}${result.cooldown_blocked ? `  cooldown=${result.cooldown_blocked}` : ''}${result.pending_blocked ? `  pending=${result.pending_blocked}` : ''}`);
      for (const action of result.created) {
        console.log(`- [${action.task_id}] ${action.action_id}  ${action.kind}  owner=${action.owner_agent || '-'}  try=${action.attempt || 1}  priority=${action.priority}  conf=${action.confidence ?? '-'}  risk=${action.policy?.risk_level || '-'}`);
        console.log(`  ${action.summary}`);
      }
      break;
    }

    if (sub === 'list') {
      let taskId = null;
      let ownerAgent = null;
      let statusFilter = null;
      let kind = null;
      let limit = null;
      let invalid = false;

      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('kind=')) {
          kind = normalizeActionKind(part.substring('kind='.length));
          if (!kind) {
            invalid = true;
            break;
          }
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            invalid = true;
            break;
          }
          limit = value;
          continue;
        }
        if (!taskId && readCtx(part)) {
          taskId = part;
          continue;
        }
        if (!ownerAgent) {
          ownerAgent = part;
          continue;
        }
        invalid = true;
        break;
      }

      if (invalid) {
        console.error('用法: atf action list [taskId|owner] [status=x] [kind=x] [limit=N]');
        break;
      }
      if (statusFilter && !ACTION_STATUSES.has(statusFilter)) {
        console.error(`action status: ${[...ACTION_STATUSES].join('|')}`);
        break;
      }

      const actions = collectActions({
        task_id: taskId,
        owner_agent: ownerAgent,
        status: statusFilter,
        kind,
        limit,
      });
      const filterLabel = [
        taskId ? `task=${taskId}` : null,
        ownerAgent ? `owner=${ownerAgent}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        kind ? `kind=${kind}` : null,
        limit ? `limit=${limit}` : null,
      ].filter(Boolean).join('  ');
      if (!actions.length) {
        console.log(filterLabel ? `action list (${filterLabel}) 暂无记录` : '当前暂无动作记录');
        break;
      }
      console.log(`\nAction Queue${filterLabel ? `  |  ${filterLabel}` : ''}\n`);
      for (const action of actions) {
        console.log(`[${action.task_id}] ${action.action_id}  ${action.status}  ${action.kind}`);
        console.log(`  owner=${action.owner_agent || '-'}  try=${action.attempt || 1}  priority=${action.priority}  conf=${action.confidence ?? '-'}  risk=${action.policy?.risk_level || '-'}${action.execution_mode ? `  mode=${action.execution_mode}` : ''}`);
        console.log(`  ${action.summary}`);
      }
      console.log('');
      break;
    }

    if (sub === 'inbox') {
      const [agent, ...filterParts] = restArgs;
      if (!agent) {
        console.error('用法: atf action inbox <agent> [kind=x] [limit=N]');
        break;
      }
      let kind = null;
      let limit = null;
      let invalid = false;
      for (const part of filterParts.filter(Boolean)) {
        if (part.startsWith('kind=')) {
          kind = normalizeActionKind(part.substring('kind='.length));
          if (!kind) {
            invalid = true;
            break;
          }
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            invalid = true;
            break;
          }
          limit = value;
          continue;
        }
        invalid = true;
        break;
      }
      if (invalid) {
        console.error('用法: atf action inbox <agent> [kind=x] [limit=N]');
        break;
      }
      refreshActionIndexes();
      const inbox = loadJson(actionInboxPath(agent));
      let items = (inbox?.items || []).filter(action => action.status === 'pending');
      if (kind) items = items.filter(action => action.kind === kind);
      items = items.slice(0, limit || items.length);
      if (!items.length) {
        console.log(`agent ${agent} 当前没有待执行动作`);
        break;
      }
      console.log(`\n${agent} Action Inbox (${items.length} 条)\n`);
      for (const action of items) {
        console.log(`[${action.task_id}] ${action.action_id}  ${action.kind}  try=${action.attempt || 1}  priority=${action.priority}  conf=${action.confidence ?? '-'}  risk=${action.policy?.risk_level || '-'}`);
        console.log(`  ${action.summary}`);
      }
      console.log('');
      break;
    }

    if (sub === 'rebuild-index') {
      refreshActionIndexes();
      const pending = loadJson(PENDING_ACTIONS_FILE) || { total: 0 };
      console.log(`Action 索引已重建`);
      console.log(`   pending actions: ${pending.total || 0}`);
      console.log(`   global index: ${PENDING_ACTIONS_FILE}`);
      break;
    }

    if (sub === 'runs') {
      let agent = null;
      let statusFilter = null;
      let limit = 10;
      let invalid = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            invalid = true;
            break;
          }
          limit = value;
          continue;
        }
        if (!agent) {
          agent = part;
          continue;
        }
        invalid = true;
        break;
      }
      if (invalid) {
        console.error('用法: atf action runs [agent] [status=completed|failed] [limit=N]');
        break;
      }
      if (statusFilter && !ACTION_WATCHER_RUN_STATUSES.has(statusFilter)) {
        console.error(`watcher run status: ${[...ACTION_WATCHER_RUN_STATUSES].join('|')}`);
        break;
      }
      const runs = readActionWatcherRuns({
        agent,
        status: statusFilter,
        limit,
      });
      const filterLabel = [
        agent ? `agent=${agent}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        limit ? `limit=${limit}` : null,
      ].filter(Boolean).join('  ');
      if (!runs.length) {
        console.log(filterLabel ? `action watcher runs (${filterLabel}) 暂无记录` : '当前暂无 action watcher 运行记录');
        break;
      }
      console.log(`\nAction Watcher Runs${filterLabel ? `  |  ${filterLabel}` : ''}\n`);
      for (const run of runs) {
        console.log(`${run.run_id}  ${run.status}  ${run.completed_at || run.started_at || '-'}`);
        console.log(`  agent=${run.agent || 'all'}  dry_run=${Boolean(run.dryRun)}  eligible=${run.eligibleActions ?? 0}  filtered=${run.filteredActions ?? 0}  executed=${run.executed ?? 0}  skipped=${run.skipped ?? 0}  failed=${run.failed ?? 0}  duration_ms=${run.duration_ms ?? '-'}`);
        if (Array.isArray(run.resultCodes) && run.resultCodes.length) {
          console.log(`  result_codes=${run.resultCodes.map(item => `${item.code}=${item.count}`).join('  ')}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'run-show') {
      const [runId] = restArgs;
      if (!runId) {
        console.error('用法: atf action run-show <runId|latest>');
        break;
      }
      const run = readActionWatcherRun(runId);
      if (!run) {
        console.error(`未找到 watcher run: ${runId}`);
        break;
      }
      console.log(JSON.stringify(run, null, 2));
      break;
    }

    if (sub === 'watcher-status') {
      let agent = null;
      let warnAfterMinutes = 30;
      let limit = 10;
      let json = false;
      let invalid = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part === 'json') {
          json = true;
          continue;
        }
        if (part.startsWith('warn_after_minutes=')) {
          const value = Number(part.substring('warn_after_minutes='.length));
          if (!Number.isInteger(value) || value < 0) {
            invalid = true;
            break;
          }
          warnAfterMinutes = value;
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            invalid = true;
            break;
          }
          limit = value;
          continue;
        }
        if (!agent) {
          agent = part;
          continue;
        }
        invalid = true;
        break;
      }
      if (invalid) {
        console.error('用法: atf action watcher-status [agent] [warn_after_minutes=N] [limit=N] [json]');
        break;
      }
      const status = buildActionWatcherStatus({
        agent,
        warn_after_minutes: warnAfterMinutes,
        limit,
      });
      if (json) {
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      console.log('\nAction Watcher Status\n');
      console.log(`status=${status.status}  code=${status.code}  scope=${status.scope.agent || 'all'}  warn_after=${status.scope.warn_after_minutes}m`);
      if (!status.latest_run) {
        console.log('latest_run=none');
      } else {
        console.log(`latest_run=${status.latest_run.run_id}  ${status.latest_run.status}  age=${status.latest_run.age_minutes ?? '-'}m  completed_at=${status.latest_run.completed_at || status.latest_run.started_at || '-'}`);
        console.log(`latest_effect=eligible:${status.latest_run.eligible_actions}  filtered:${status.latest_run.filtered_actions}  executed:${status.latest_run.executed}  skipped:${status.latest_run.skipped}  failed:${status.latest_run.failed}  dry_run=${status.latest_run.dry_run}`);
      }
      console.log(`recent_runs=total:${status.recent_runs.total}  completed:${status.recent_runs.completed}  failed:${status.recent_runs.failed}`);
      console.log(`pending_actions=total:${status.pending_actions.total}${status.pending_actions.oldest_age_hours !== null ? `  oldest=${status.pending_actions.oldest_age_hours}h` : ''}`);
      if (status.pending_actions.by_agent.length) {
        console.log(`pending_by_agent=${status.pending_actions.by_agent.map(item => `${item.agent}=${item.count}`).join('  ')}`);
      }
      if (status.pending_actions.by_kind.length) {
        console.log(`pending_by_kind=${status.pending_actions.by_kind.map(item => `${item.kind}=${item.count}`).join('  ')}`);
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [taskId, actionId] = restArgs;
      if (!taskId || !actionId) {
        console.error('用法: atf action show <taskId> <actionId>');
        break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) {
        console.error(`❌ 任务不存在: ${taskId}`);
        break;
      }
      const action = readAction(taskId, actionId);
      if (!action) {
        console.error(`❌ Action 不存在: ${actionId}`);
        break;
      }
      console.log(JSON.stringify(action, null, 2));
      break;
    }

    if (sub === 'execute') {
      const [taskId, actionId, ...optionParts] = restArgs;
      if (!taskId || !actionId) {
        console.error('用法: atf action execute <taskId> <actionId> [executor=x] [mode=message|pending_task|noop] [to=agent] [thread=x] [note=x]');
        break;
      }
      const ctx = readCtx(taskId);
      if (!ctx) {
        console.error(`❌ 任务不存在: ${taskId}`);
        break;
      }
      const action = readAction(taskId, actionId);
      if (!action) {
        console.error(`❌ Action 不存在: ${actionId}`);
        break;
      }
      const parsed = parseActionExecuteArgs(optionParts);
      if (parsed.invalid) {
        console.error('用法: atf action execute <taskId> <actionId> [executor=x] [mode=message|pending_task|noop] [to=agent] [thread=x] [note=x]');
        break;
      }
      const executed = executeAction(taskId, action, ctx, {
        executor: parsed.executor,
        mode: parsed.mode,
        note: parsed.note,
        toAgent: parsed.toAgent,
        threadId: parsed.threadId,
      });
      console.log(`${executed.status === 'executed' ? 'Executed' : 'Skipped'} action ${executed.action_id}`);
      console.log(`   mode: ${executed.execution_mode}  |  owner: ${executed.owner_agent || '-'}  |  status: ${executed.status}`);
      if (executed.verification?.preflight) console.log(`   preflight: ${executed.verification.preflight.ok ? 'ok' : 'skip'}  |  ${executed.verification.preflight.code}`);
      if (executed.verification?.postflight) console.log(`   postflight: ${executed.verification.postflight.ok ? 'ok' : 'skip'}  |  ${executed.verification.postflight.code}`);
      if (executed.execution?.artifacts?.message_id) console.log(`   message: ${executed.execution.artifacts.message_id}`);
      if (executed.execution?.artifacts?.message_path) console.log(`   message-path: ${executed.execution.artifacts.message_path}`);
      if (executed.execution?.artifacts?.pending_task_path) console.log(`   pending-task: ${executed.execution.artifacts.pending_task_path}`);
      if (executed.execution?.error?.message) console.log(`   error: ${executed.execution.error.message}`);
      break;
    }

    if (sub === 'execute-pending') {
      const parsed = parseActionExecuteArgs(restArgs);
      if (parsed.invalid) {
        console.error('用法: atf action execute-pending [owner] [kind=x] [limit=N] [executor=x] [mode=message|pending_task|noop] [to=agent] [thread=x] [note=x]');
        break;
      }
      refreshActionIndexes();
      const actions = collectActions({
        owner_agent: parsed.ownerAgent,
        status: 'pending',
        kind: parsed.kind,
        limit: parsed.limit,
      });
      if (!actions.length) {
        console.log('当前没有可执行的 pending actions');
        break;
      }
      const results = [];
      for (const action of actions) {
        const ctx = readCtx(action.task_id);
        if (!ctx) continue;
        const latest = readAction(action.task_id, action.action_id);
        if (!latest || latest.status !== 'pending') continue;
        results.push(executeAction(action.task_id, latest, ctx, {
          executor: parsed.executor,
          mode: parsed.mode,
          note: parsed.note,
          toAgent: parsed.toAgent,
          threadId: parsed.threadId,
        }));
      }
      if (!results.length) {
        console.log('没有成功执行任何 pending actions');
        break;
      }
      const executedCount = results.filter(action => action.status === 'executed').length;
      const skippedCount = results.filter(action => action.status === 'skipped').length;
      console.log(`Processed ${results.length} pending actions  |  executed:${executedCount}  skipped:${skippedCount}`);
      for (const action of results) {
        console.log(`   [${action.task_id}] ${action.action_id}  ${action.kind}  status:${action.status}  mode:${action.execution_mode}`);
        if (action.verification?.preflight) console.log(`      preflight: ${action.verification.preflight.ok ? 'ok' : 'skip'}  ${action.verification.preflight.code}`);
        if (action.verification?.postflight) console.log(`      postflight: ${action.verification.postflight.ok ? 'ok' : 'skip'}  ${action.verification.postflight.code}`);
        if (action.execution?.error?.message) console.log(`      error: ${action.execution.error.message}`);
      }
      break;
    }

    console.error('用法: atf action scan|list|inbox|rebuild-index|runs|run-show|watcher-status|show|execute|execute-pending ...');
    break;
  }

  // =============================================================
  // credits 命令 - 内部积分账本
  // =============================================================
  case 'credits': {
    const [sub, ...restArgs] = args;

    if (sub === 'rebuild') {
      const index = buildCreditsIndex();
      console.log(`✅ credits index 已重建`);
      console.log(`   agents: ${index.total_agents}`);
      console.log(`   file: ${CREDITS_FILE}`);
      break;
    }

    if (sub === 'list') {
      const index = buildCreditsIndex();
      if (!index.agents.length) { console.log('当前暂无 agent credits 数据'); break; }
      console.log(`\nAgent Credits (${index.agents.length} agents)\n`);
      console.log('agent           total   completion  feedback  reviewer  completed  delivered  approved  revision  rejected');
      console.log('─'.repeat(118));
      for (const agent of index.agents) {
        console.log(`${agent.agent.padEnd(15)} ${String(agent.total_credits).padEnd(7)} ${String(agent.role_credits.from_completion).padEnd(11)} ${String(agent.role_credits.as_reviewee).padEnd(9)} ${String(agent.role_credits.as_reviewer).padEnd(9)} ${String(agent.completion_stats.completed).padEnd(10)} ${String(agent.completion_stats.delivered).padEnd(10)} ${String(agent.review_stats.outcomes.approved).padEnd(9)} ${String(agent.review_stats.outcomes.needs_revision).padEnd(9)} ${String(agent.review_stats.outcomes.rejected).padEnd(8)}`);
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [agentName] = restArgs;
      if (!agentName) { console.error('用法: atf credits show <agent>'); break; }
      const index = buildCreditsIndex();
      const agent = index.agents.find(item => item.agent === agentName);
      if (!agent) { console.error(`❌ 未找到 agent credits: ${agentName}`); break; }
      console.log(`\n${agent.agent} Credits\n`);
      console.log(`total_credits: ${agent.total_credits}`);
      console.log(`roles: completion=${agent.role_credits.from_completion}  reviewee=${agent.role_credits.as_reviewee}  reviewer=${agent.role_credits.as_reviewer}`);
      console.log(`completion: completed=${agent.completion_stats.completed}  delivered=${agent.completion_stats.delivered}`);
      console.log(`feedback: approved=${agent.review_stats.outcomes.approved}  needs_revision=${agent.review_stats.outcomes.needs_revision}  rejected=${agent.review_stats.outcomes.rejected}`);
      console.log(`types: task=${agent.review_stats.by_type.task}  delivery=${agent.review_stats.by_type.delivery}  collaboration=${agent.review_stats.by_type.collaboration}`);
      if (agent.recent_events.length) {
        console.log('\nrecent credit events:');
        for (const event of agent.recent_events) {
          const eventLabel = event.event_type === 'completion'
            ? `${event.role}  credits=${event.credits}  ${event.completion_stage}`
            : `${event.role}  credits=${event.credits}  ${event.outcome}`;
          console.log(`- ${event.at}  ${event.event_id}  ${eventLabel}`);
          console.log(`  task=${event.task_id}${event.counterparty ? `  with=${event.counterparty}` : ''}`);
          console.log(`  ${event.summary}`);
        }
      }
      console.log('');
      break;
    }

    console.error('用法: atf credits rebuild|list|show ...');
    break;
  }

  // =============================================================
  // reputation 命令 - Agent 信誉画像与统计
  // =============================================================
  case 'reputation': {
    const [sub, ...restArgs] = args;

    if (sub === 'rebuild') {
      const index = buildReputationIndex();
      console.log(`✅ reputation index 已重建`);
      console.log(`   agents: ${index.total_agents}  |  tasks: ${index.total_tasks}`);
      console.log(`   file: ${SCORES_FILE}`);
      break;
    }

    if (sub === 'list') {
      const index = buildReputationIndex();
      if (!index.agents.length) { console.log('当前暂无 agent reputation 数据'); break; }
      console.log(`\nAgent Reputation (${index.agents.length} agents)\n`);
      console.log('agent           score   tasks  delivered  reviews  avg_review  response');
      console.log('─'.repeat(78));
      for (const agent of index.agents) {
        const score = String(agent.overall_score ?? '-').padEnd(6);
        const tasks = String(agent.task_stats.assigned).padEnd(5);
        const delivered = String(agent.task_stats.delivered).padEnd(9);
        const reviews = String(agent.review_stats.received).padEnd(7);
        const avgReview = String(agent.review_stats.average_scores.overall ?? '-').padEnd(10);
        const response = agent.derived.response_rate === null ? '-' : `${roundNumber(agent.derived.response_rate * 100, 1)}%`;
        console.log(`${agent.agent.padEnd(15)} ${score}  ${tasks}  ${delivered}  ${reviews}  ${avgReview}  ${response}`);
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [agentName] = restArgs;
      if (!agentName) { console.error('用法: atf reputation show <agent>'); break; }
      const index = buildReputationIndex();
      const agent = index.agents.find(item => item.agent === agentName);
      if (!agent) { console.error(`❌ 未找到 agent reputation: ${agentName}`); break; }
      console.log(`\n${agent.agent} Reputation\n`);
      console.log(`overall_score: ${agent.overall_score ?? '-'}`);
      console.log(`tasks: assigned=${agent.task_stats.assigned}  completed=${agent.task_stats.completed}  delivered=${agent.task_stats.delivered}  blocked=${agent.task_stats.blocked}  active=${agent.task_stats.active}  dri=${agent.task_stats.dri_owned}`);
      console.log(`derived: completion=${agent.derived.completion_rate === null ? '-' : `${roundNumber(agent.derived.completion_rate * 100, 1)}%`}  delivery=${agent.derived.delivery_rate === null ? '-' : `${roundNumber(agent.derived.delivery_rate * 100, 1)}%`}  response=${agent.derived.response_rate === null ? '-' : `${roundNumber(agent.derived.response_rate * 100, 1)}%`}  blocked=${agent.derived.blocked_rate === null ? '-' : `${roundNumber(agent.derived.blocked_rate * 100, 1)}%`}`);
      console.log(`collaboration: sent=${agent.collaboration_stats.messages_sent}  received=${agent.collaboration_stats.messages_received}  receipts=${agent.collaboration_stats.receipts_written}  reflections=${agent.collaboration_stats.reflections_authored}  threads=${agent.collaboration_stats.threads_participated}`);
      console.log(`reviews: received=${agent.review_stats.received}  given=${agent.review_stats.given}  approved=${agent.review_stats.outcomes.approved}  needs_revision=${agent.review_stats.outcomes.needs_revision}  rejected=${agent.review_stats.outcomes.rejected}`);
      console.log(`review_scores: overall=${agent.review_stats.average_scores.overall ?? '-'}  quality=${agent.review_stats.average_scores.quality ?? '-'}  timeliness=${agent.review_stats.average_scores.timeliness ?? '-'}  communication=${agent.review_stats.average_scores.communication ?? '-'}  ownership=${agent.review_stats.average_scores.ownership ?? '-'}  reviewers=${agent.review_stats.unique_reviewers}`);
      if (agent.specialization?.task_types?.length) {
        console.log('\nspecialization:');
        for (const bucket of agent.specialization.task_types.slice(0, 5)) {
          console.log(`- ${bucket.type}  score=${bucket.overall_score ?? '-'}  tasks=${bucket.task_stats.assigned}  delivered=${bucket.task_stats.delivered}  reviews=${bucket.review_stats.received}  avg_overall=${bucket.review_stats.average_overall ?? '-'}`);
        }
      }
      if (agent.review_stats.recent_reviews.length) {
        console.log('\nrecent reviews:');
        for (const review of agent.review_stats.recent_reviews) {
          console.log(`- ${review.created_at}  ${review.review_id}  ${review.reviewer}  [${review.review_type}] ${review.outcome}  overall=${review.overall ?? '-'}`);
          console.log(`  ${review.summary}`);
        }
      }
      console.log('');
      break;
    }

    console.error('用法: atf reputation rebuild|list|show ...');
    break;
  }

  // =============================================================
  // stats 命令 - 内部完成度 / 反馈统计
  // =============================================================
  case 'stats': {
    const [sub, ...restArgs] = args;

    if (!sub || sub === 'summary') {
      const tasks = getAllTasks();
      const statusCounts = new Map();
      for (const task of tasks) {
        const status = task.status || 'unknown';
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      }
      const reviewCoverage = buildReviewCoverageStats();
      const pendingReviews = collectPendingReviewTasks();
      const deliveredTasks = tasks.filter(task => getEffectiveTaskReviewStatus(task) === 'delivered').length;
      const completedTasks = tasks.filter(task => isReviewEligibleTaskStatus(getEffectiveTaskReviewStatus(task))).length;
      const reviewedTasks = reviewCoverage.external_reviewed_tasks;
      const reviewCoverageLabel = completedTasks ? `${roundNumber((reviewedTasks / completedTasks) * 100, 1)}%` : '-';
      const oldestPendingAgeDays = pendingReviews.reduce((max, task) => {
        if (!Number.isInteger(task.age_days)) return max;
        return max === null || task.age_days > max ? task.age_days : max;
      }, null);
      const stalePendingReviews = pendingReviews.filter(task => Number.isInteger(task.age_days) && task.age_days >= 4).length;
      const oldestPendingAt = pendingReviews.reduce((oldest, task) => {
        if (!task.updated_at) return oldest;
        return !oldest || task.updated_at < oldest ? task.updated_at : oldest;
      }, null);
      console.log('\nATF Stats Summary\n');
      console.log(`tasks: total=${tasks.length}  completed=${completedTasks}  delivered=${deliveredTasks}  reviewed=${reviewedTasks}  self_reviewed=${reviewCoverage.self_reviewed_tasks}  pending_reviews=${pendingReviews.length}  stale_pending_reviews=${stalePendingReviews}  review_coverage=${reviewCoverageLabel}  external_review_coverage=${formatRate(reviewCoverage.external_review_coverage)}${oldestPendingAgeDays !== null ? `  oldest_pending_age=${oldestPendingAgeDays}d` : ''}`);
      if (statusCounts.size) {
        console.log('\nstatus counts:');
        for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          console.log(`- ${status}: ${count}`);
        }
      }
      if (oldestPendingAt) console.log(`\noldest pending review: ${oldestPendingAt}`);
      console.log('');
      break;
    }

    if (sub === 'digest') {
      let days = 1;
      let staleDays = 4;
      let top = 5;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('days=')) {
          const value = normalizeAgeFilterValue(part.substring('days='.length));
          if (value === undefined) {
            console.error('stats digest days 必须是非负整数');
            invalidArgs = true;
            break;
          }
          days = value ?? 1;
          continue;
        }
        if (part.startsWith('stale_days=')) {
          const value = normalizeAgeFilterValue(part.substring('stale_days='.length));
          if (value === undefined) {
            console.error('stats digest stale_days 必须是非负整数');
            invalidArgs = true;
            break;
          }
          staleDays = value ?? 4;
          continue;
        }
        if (part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('stats digest top 必须是正整数');
            invalidArgs = true;
            break;
          }
          top = value;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf stats digest [days=N] [stale_days=N] [top=N]');
        break;
      }

      const digest = buildOpsDigest({
        days,
        stale_days: staleDays,
        top,
      });
      console.log(`\nATF Ops Digest  |  days=${digest.days}  stale_days=${digest.stale_days}  top=${digest.top}\n`);
      console.log('overview:');
      console.log(`- tasks=${digest.total_tasks}  review_eligible=${digest.review_coverage.eligible_tasks}  reviewed=${digest.review_coverage.reviewed_tasks}  self_reviewed=${digest.review_coverage.self_reviewed_tasks}  pending=${digest.review_coverage.pending_reviews}  stale=${digest.backlog.pending_tasks}`);
      console.log(`- recent_tasks=${digest.recent.total}  completed=${digest.recent.completed}  delivered=${digest.recent.delivered}  reviewed=${digest.recent.reviewed}  pending=${digest.recent.pending}`);
      console.log(`- external_review_coverage=${formatRate(digest.review_coverage.external_review_coverage)}  active_agents=${digest.active_agents}  backlog_agents=${digest.backlog_agents}  unknown_recent_agents=${digest.recent.by_agent.filter(bucket => !bucket.registered && !bucket.unassigned).length}  unknown_backlog_agents=${digest.backlog.by_agent.filter(bucket => !bucket.registered && !bucket.unassigned).length}${digest.backlog.oldest_pending_age_days !== null ? `  oldest_pending_age=${digest.backlog.oldest_pending_age_days}d` : ''}`);
      if (digest.backlog.oldest_pending_at) console.log(`- oldest_pending_at=${digest.backlog.oldest_pending_at}`);

      if (digest.recent.by_agent.length) {
        console.log('\nrecent by agent:');
        for (const bucket of digest.recent.by_agent.slice(0, digest.top)) {
          console.log(`- ${formatAgentDisplay(bucket.agent)}: tasks=${bucket.tasks}  completed=${bucket.completed}  delivered=${bucket.delivered}  reviewed=${bucket.reviewed}  pending=${bucket.pending}  self=${bucket.self_reviewed}`);
        }
      }

      if (digest.backlog.by_agent.length) {
        console.log('\nstale backlog by agent:');
        for (const bucket of digest.backlog.by_agent) {
          console.log(`- ${formatAgentDisplay(bucket.agent)}: pending=${bucket.pending}  self=${bucket.self_reviewed}  completed=${bucket.completed}  delivered=${bucket.delivered}${Number.isInteger(bucket.oldest_age_days) ? `  oldest_age=${bucket.oldest_age_days}d` : ''}${bucket.oldest_updated_at ? `  oldest=${bucket.oldest_updated_at}` : ''}`);
        }
      }

      if (digest.backlog.tasks.length) {
        console.log('\noldest stale tasks:');
        for (const task of digest.backlog.tasks) {
          console.log(`- [${task.task_id}] ${formatAgentDisplay(task.reviewee)}  ${task.status}${task.task_type ? `  type=${task.task_type}` : ''}${Number.isInteger(task.age_days) ? `  age=${task.age_days}d` : ''}${task.self_review_count ? `  self_reviews=${task.self_review_count}` : ''}`);
          console.log(`  ${task.description}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'types') {
      const typeStats = buildTaskTypeStats();
      if (!typeStats.length) { console.log('当前暂无任务类型统计数据'); break; }
      console.log(`\nTask Type Stats (${typeStats.length} types)\n`);
      console.log('type             tasks  completed  delivered  completion  reviews  avg_review  approved  revision  rejected  pending');
      console.log('─'.repeat(121));
      for (const typeStat of typeStats) {
        const completion = typeStat.completion_rate === null ? '-' : `${roundNumber(typeStat.completion_rate * 100, 1)}%`;
        console.log(`${typeStat.type.padEnd(16)} ${String(typeStat.total).padEnd(5)} ${String(typeStat.completed).padEnd(10)} ${String(typeStat.delivered).padEnd(10)} ${String(completion).padEnd(11)} ${String(typeStat.reviews).padEnd(7)} ${String(typeStat.avg_overall ?? '-').padEnd(11)} ${String(typeStat.outcomes.approved).padEnd(9)} ${String(typeStat.outcomes.needs_revision).padEnd(9)} ${String(typeStat.outcomes.rejected).padEnd(9)} ${String(typeStat.pending_reviews).padEnd(7)}`);
      }
      console.log('');
      break;
    }

    if (sub === 'recent') {
      let days = 1;
      let agentFilter = null;
      let typeFilter = null;
      let statusFilter = null;
      let reviewFilter = null;
      let limit = 10;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('days=')) {
          const value = normalizeAgeFilterValue(part.substring('days='.length));
          if (value === undefined) {
            console.error('stats recent days 必须是非负整数');
            invalidArgs = true;
            break;
          }
          days = value ?? 1;
          continue;
        }
        if (part.startsWith('agent=')) {
          agentFilter = part.substring('agent='.length);
          continue;
        }
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('review=')) {
          reviewFilter = String(part.substring('review='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('stats recent limit 必须是正整数');
            invalidArgs = true;
            break;
          }
          limit = value;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf stats recent [days=N] [agent=x] [type=x] [status=x] [review=x] [limit=N]');
        break;
      }
      const recent = buildRecentTaskWindow({
        days,
        agent: agentFilter,
        type: typeFilter,
        status: statusFilter,
        review: reviewFilter,
        limit,
      });
      const filterLabel = [
        `days=${recent.days}`,
        agentFilter ? `agent=${agentFilter}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        reviewFilter ? `review=${reviewFilter}` : null,
        limit ? `limit=${limit}` : null,
      ].filter(Boolean).join('  ');
      console.log(`\nRecent Activity  |  ${filterLabel}\n`);
      console.log(`tasks=${recent.total}  completed=${recent.completed}  delivered=${recent.delivered}  reviewed=${recent.reviewed}  pending=${recent.pending}  self_reviewed=${recent.self_reviewed}`);
      if (recent.status_counts.length) {
        console.log('\nstatus counts:');
        for (const bucket of recent.status_counts) {
          console.log(`- ${bucket.status}: ${bucket.count}`);
        }
      }
      if (recent.feedback_counts.length) {
        console.log('\nfeedback counts:');
        for (const bucket of recent.feedback_counts) {
          console.log(`- ${bucket.state}: ${bucket.count}`);
        }
      }
      if (recent.rows.length) {
        console.log('\nrecent tasks:');
        console.log('task     status      agent           type             feedback        self  age  updated');
        console.log('-'.repeat(108));
        for (const row of recent.rows) {
          console.log(`${row.task_id.padEnd(8)} ${row.status.padEnd(11)} ${formatAgentDisplay(row.assigned_to).padEnd(15)} ${row.type.padEnd(16)} ${row.feedback_state.padEnd(15)} ${String(row.self_review_count || 0).padEnd(5)} ${String(Number.isInteger(row.age_days) ? `${row.age_days}d` : '-').padEnd(4)} ${row.updated_at || '-'}`);
          console.log(`  ${row.description}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'stale') {
      let days = 4;
      let agentFilter = null;
      let typeFilter = null;
      let statusFilter = null;
      let top = 10;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('days=')) {
          const value = normalizeAgeFilterValue(part.substring('days='.length));
          if (value === undefined) {
            console.error('stats stale days 必须是非负整数');
            invalidArgs = true;
            break;
          }
          days = value ?? 4;
          continue;
        }
        if (part.startsWith('agent=')) {
          agentFilter = part.substring('agent='.length);
          continue;
        }
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('stats stale top 必须是正整数');
            invalidArgs = true;
            break;
          }
          top = value;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf stats stale [days=N] [agent=x] [type=x] [status=completed|delivered] [top=N]');
        break;
      }
      if (statusFilter && !['completed', 'delivered'].includes(statusFilter)) {
        console.error('stats stale status 只支持 completed|delivered');
        break;
      }
      const stale = buildStaleBacklogStats({
        days,
        agent: agentFilter,
        type: typeFilter,
        status: statusFilter,
        top,
      });
      const filterLabel = [
        `days=${stale.days}`,
        agentFilter ? `agent=${agentFilter}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        top ? `top=${top}` : null,
      ].filter(Boolean).join('  ');
      console.log(`\nStale Review Backlog  |  ${filterLabel}\n`);
      console.log(`stale_pending=${stale.pending}  eligible=${stale.review_stats.eligible_tasks}  reviewed=${stale.review_stats.reviewed_tasks}  self_reviewed=${stale.review_stats.self_reviewed_tasks}  external_review_coverage=${formatRate(stale.review_stats.external_review_coverage)}${stale.review_stats.oldest_pending_age_days !== null ? `  oldest_age=${stale.review_stats.oldest_pending_age_days}d` : ''}`);
      if (stale.review_stats.by_agent.length) {
        console.log('\nstale by agent:');
        for (const bucket of stale.review_stats.by_agent) {
          console.log(`- ${formatAgentDisplay(bucket.agent)}: pending=${bucket.pending}  completed=${bucket.completed}  delivered=${bucket.delivered}  oldest=${bucket.oldest_updated_at || '-'}`);
        }
      }
      if (stale.review_stats.by_type.length) {
        console.log('\nstale by type:');
        for (const bucket of stale.review_stats.by_type) {
          console.log(`- ${bucket.type}: pending=${bucket.pending}  completed=${bucket.completed}  delivered=${bucket.delivered}`);
        }
      }
      if (stale.tasks.length) {
        console.log('\nstale tasks:');
        console.log('task     age  agent           status      type             updated');
        console.log('-'.repeat(88));
        for (const task of stale.tasks) {
          console.log(`${task.task_id.padEnd(8)} ${String(Number.isInteger(task.age_days) ? `${task.age_days}d` : '-').padEnd(4)} ${formatAgentDisplay(task.reviewee).padEnd(15)} ${task.status.padEnd(11)} ${String(task.task_type || 'untyped').padEnd(16)} ${task.updated_at || '-'}`);
          console.log(`  ${task.description}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'tasks') {
      let agentFilter = null;
      let typeFilter = null;
      let statusFilter = null;
      let reviewFilter = null;
      let minAge = null;
      let maxAge = null;
      let limit = null;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('agent=')) {
          agentFilter = part.substring('agent='.length);
          continue;
        }
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('review=')) {
          reviewFilter = String(part.substring('review='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('min_age=')) {
          const value = normalizeAgeFilterValue(part.substring('min_age='.length));
          if (value === undefined) {
            console.error('stats tasks min_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          minAge = value;
          continue;
        }
        if (part.startsWith('max_age=')) {
          const value = normalizeAgeFilterValue(part.substring('max_age='.length));
          if (value === undefined) {
            console.error('stats tasks max_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          maxAge = value;
          continue;
        }
        if (part.startsWith('limit=')) {
          const value = Number(part.substring('limit='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('stats tasks limit 必须是正整数');
            invalidArgs = true;
            break;
          }
          limit = value;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf stats tasks [agent=x] [type=x] [status=x] [review=all|pending|reviewed|approved|needs_revision|rejected|na] [min_age=N] [max_age=N] [limit=N]');
        break;
      }
      if (statusFilter && !['created', 'assigned', 'confirmed', 'executing', 'paused', 'blocked', 'completed', 'delivered', 'cancelled', 'archived', 'unknown'].includes(statusFilter)) {
        console.error('stats tasks status 不合法');
        break;
      }
      if (reviewFilter && !['all', 'pending', 'reviewed', 'approved', 'needs_revision', 'rejected', 'na', 'n/a'].includes(reviewFilter)) {
        console.error('stats tasks review 只支持 all|pending|reviewed|approved|needs_revision|rejected|na');
        break;
      }
      if (minAge !== null && maxAge !== null && minAge > maxAge) {
        console.error('stats tasks 要求 min_age <= max_age');
        break;
      }
      const rows = collectTaskStatsRows({
        agent: agentFilter,
        type: typeFilter,
        status: statusFilter,
        review: reviewFilter,
        min_age: minAge,
        max_age: maxAge,
        limit,
      });
      const filterLabel = [
        agentFilter ? `agent=${agentFilter}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        reviewFilter ? `review=${reviewFilter}` : null,
        minAge !== null ? `min_age=${minAge}` : null,
        maxAge !== null ? `max_age=${maxAge}` : null,
        limit ? `limit=${limit}` : null,
      ].filter(Boolean).join('  ');
      if (!rows.length) {
        console.log(filterLabel ? `${filterLabel} 暂无任务统计结果` : '当前暂无任务统计结果');
        break;
      }
      console.log(`\nTask Stats (${rows.length}${filterLabel ? `  |  ${filterLabel}` : ''})\n`);
      console.log('task     status      agent           type             feedback        avg   pts  self  age  updated');
      console.log('─'.repeat(119));
      for (const row of rows) {
        console.log(`${row.task_id.padEnd(8)} ${row.status.padEnd(11)} ${formatAgentDisplay(row.assigned_to).padEnd(15)} ${row.type.padEnd(16)} ${row.feedback_state.padEnd(15)} ${String(row.avg_overall ?? '-').padEnd(5)} ${String(row.completion_credits).padEnd(4)} ${String(row.self_review_count || 0).padEnd(5)} ${String(Number.isInteger(row.age_days) ? `${row.age_days}d` : '-').padEnd(4)} ${row.updated_at || '-'}`);
        console.log(`  ${row.description}`);
      }
      console.log('');
      break;
    }

    if (sub === 'reviews') {
      let agentFilter = null;
      let typeFilter = null;
      let statusFilter = null;
      let minAge = null;
      let maxAge = null;
      let top = 5;
      let topSpecified = false;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('agent=')) {
          agentFilter = part.substring('agent='.length);
          continue;
        }
        if (part.startsWith('type=')) {
          typeFilter = normalizeTaskTypeValue(part.substring('type='.length));
          continue;
        }
        if (part.startsWith('status=')) {
          statusFilter = String(part.substring('status='.length) || '').trim().toLowerCase();
          continue;
        }
        if (part.startsWith('min_age=')) {
          const value = normalizeAgeFilterValue(part.substring('min_age='.length));
          if (value === undefined) {
            console.error('stats reviews min_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          minAge = value;
          continue;
        }
        if (part.startsWith('max_age=')) {
          const value = normalizeAgeFilterValue(part.substring('max_age='.length));
          if (value === undefined) {
            console.error('stats reviews max_age 必须是非负整数');
            invalidArgs = true;
            break;
          }
          maxAge = value;
          continue;
        }
        if (part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('stats reviews top 必须是正整数');
            invalidArgs = true;
            break;
          }
          top = value;
          topSpecified = true;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf stats reviews [agent=x] [type=x] [status=completed|delivered] [min_age=N] [max_age=N] [top=N]');
        break;
      }
      if (statusFilter && !['completed', 'delivered'].includes(statusFilter)) {
        console.error('stats reviews status 只支持 completed|delivered');
        break;
      }
      if (minAge !== null && maxAge !== null && minAge > maxAge) {
        console.error('stats reviews 要求 min_age <= max_age');
        break;
      }
      const reviewStats = buildReviewCoverageStats({
        agent: agentFilter,
        type: typeFilter,
        status: statusFilter,
        min_age: minAge,
        max_age: maxAge,
        top,
      });
      const filterLabel = [
        agentFilter ? `agent=${agentFilter}` : null,
        typeFilter ? `type=${typeFilter}` : null,
        statusFilter ? `status=${statusFilter}` : null,
        minAge !== null ? `min_age=${minAge}` : null,
        maxAge !== null ? `max_age=${maxAge}` : null,
        topSpecified ? `top=${top}` : null,
      ].filter(Boolean).join('  ');
      console.log(`\nReview Coverage${filterLabel ? `  |  ${filterLabel}` : ''}\n`);
      console.log(`eligible=${reviewStats.eligible_tasks}  reviewed=${reviewStats.reviewed_tasks}  self_reviewed=${reviewStats.self_reviewed_tasks}  pending=${reviewStats.pending_reviews}  coverage=${formatRate(reviewStats.review_coverage)}  external_review_coverage=${formatRate(reviewStats.external_review_coverage)}${reviewStats.oldest_pending_age_days !== null ? `  oldest_age=${reviewStats.oldest_pending_age_days}d` : ''}`);
      if (reviewStats.oldest_pending_at) console.log(`oldest_pending_at=${reviewStats.oldest_pending_at}`);
      if (reviewStats.by_status.length) {
        console.log('\npending by status:');
        for (const bucket of reviewStats.by_status) {
          console.log(`- ${bucket.status}: ${bucket.count}`);
        }
      }
      if (reviewStats.by_age_bucket.length) {
        console.log('\npending by age:');
        for (const bucket of reviewStats.by_age_bucket) {
          console.log(`- ${bucket.bucket}: ${bucket.count}`);
        }
      }
      if (reviewStats.by_agent.length) {
        console.log('\npending by agent:');
        console.log('agent           pending  completed  delivered  oldest');
        console.log('─'.repeat(72));
        for (const bucket of reviewStats.by_agent) {
          console.log(`${formatAgentDisplay(bucket.agent).padEnd(15)} ${String(bucket.pending).padEnd(7)} ${String(bucket.completed).padEnd(10)} ${String(bucket.delivered).padEnd(10)} ${bucket.oldest_updated_at || '-'}`);
        }
      }
      if (reviewStats.by_type.length) {
        console.log('\npending by type:');
        console.log('type             pending  completed  delivered');
        console.log('─'.repeat(54));
        for (const bucket of reviewStats.by_type) {
          console.log(`${bucket.type.padEnd(16)} ${String(bucket.pending).padEnd(7)} ${String(bucket.completed).padEnd(10)} ${String(bucket.delivered).padEnd(10)}`);
        }
      }
      if (reviewStats.oldest_tasks.length) {
        console.log('\noldest pending tasks:');
        console.log('task     age  agent           status      type             updated');
        console.log('─'.repeat(88));
        for (const task of reviewStats.oldest_tasks) {
          console.log(`${task.task_id.padEnd(8)} ${String(task.age_days ?? '-').padEnd(4)} ${formatAgentDisplay(task.reviewee).padEnd(15)} ${task.status.padEnd(11)} ${task.type.padEnd(16)} ${task.updated_at || '-'}`);
          console.log(`  ${task.description}`);
        }
      }
      console.log('');
      break;
    }

    if (sub === 'agents' || sub === 'list') {
      const index = buildReputationIndex();
      const pendingByAgent = new Map();
      for (const item of collectPendingReviewTasks()) {
        pendingByAgent.set(item.reviewee, (pendingByAgent.get(item.reviewee) || 0) + 1);
      }
      if (!index.agents.length) { console.log('当前暂无 agent 统计数据'); break; }
      console.log(`\nAgent Stats (${index.agents.length} agents)\n`);
      console.log('agent           assigned  completed  delivered  completion  reviews  avg_review  approved  revision  rejected  pending');
      console.log('─'.repeat(122));
      for (const agent of index.agents) {
        const completion = agent.derived.completion_rate === null ? '-' : `${roundNumber(agent.derived.completion_rate * 100, 1)}%`;
        console.log(`${agent.agent.padEnd(15)} ${String(agent.task_stats.assigned).padEnd(8)} ${String(agent.task_stats.completed).padEnd(9)} ${String(agent.task_stats.delivered).padEnd(9)} ${String(completion).padEnd(11)} ${String(agent.review_stats.received).padEnd(7)} ${String(agent.review_stats.average_scores.overall ?? '-').padEnd(11)} ${String(agent.review_stats.outcomes.approved).padEnd(9)} ${String(agent.review_stats.outcomes.needs_revision).padEnd(9)} ${String(agent.review_stats.outcomes.rejected).padEnd(9)} ${String(pendingByAgent.get(agent.agent) || 0).padEnd(7)}`);
      }
      console.log('');
      break;
    }

    if (sub === 'show') {
      const [agentName] = restArgs;
      if (!agentName) { console.error('用法: atf stats show <agent>'); break; }
      const reputationIndex = buildReputationIndex();
      const creditsIndex = buildCreditsIndex();
      const agent = reputationIndex.agents.find(item => item.agent === agentName);
      if (!agent) { console.error(`❌ 未找到 agent: ${agentName}`); break; }
      const credits = findAgentCredits(agentName, creditsIndex);
      const pendingReviews = collectPendingReviewTasks(agentName).length;
      console.log(`\n${agent.agent} Stats\n`);
      console.log(`completion: assigned=${agent.task_stats.assigned}  completed=${agent.task_stats.completed}  delivered=${agent.task_stats.delivered}  blocked=${agent.task_stats.blocked}  active=${agent.task_stats.active}`);
      console.log(`rates: completion=${agent.derived.completion_rate === null ? '-' : `${roundNumber(agent.derived.completion_rate * 100, 1)}%`}  delivery=${agent.derived.delivery_rate === null ? '-' : `${roundNumber(agent.derived.delivery_rate * 100, 1)}%`}  response=${agent.derived.response_rate === null ? '-' : `${roundNumber(agent.derived.response_rate * 100, 1)}%`}  pending_reviews=${pendingReviews}`);
      console.log(`feedback: received=${agent.review_stats.received}  given=${agent.review_stats.given}  approved=${agent.review_stats.outcomes.approved}  needs_revision=${agent.review_stats.outcomes.needs_revision}  rejected=${agent.review_stats.outcomes.rejected}`);
      console.log(`review_scores: overall=${agent.review_stats.average_scores.overall ?? '-'}  quality=${agent.review_stats.average_scores.quality ?? '-'}  timeliness=${agent.review_stats.average_scores.timeliness ?? '-'}  communication=${agent.review_stats.average_scores.communication ?? '-'}  ownership=${agent.review_stats.average_scores.ownership ?? '-'}`);
      if (credits) {
        console.log(`credits: total=${credits.total_credits}  completion=${credits.role_credits.from_completion}  feedback=${credits.role_credits.as_reviewee}  reviewer=${credits.role_credits.as_reviewer}`);
      }
      if (agent.review_stats.recent_reviews.length) {
        console.log('\nrecent feedback:');
        for (const review of agent.review_stats.recent_reviews) {
          console.log(`- ${review.created_at}  ${review.reviewer}  [${review.review_type}] ${review.outcome}  overall=${review.overall ?? '-'}`);
          console.log(`  ${review.summary}`);
        }
      }
      console.log('');
      break;
    }

    console.error('用法: atf stats summary|digest|recent|stale|agents|tasks|reviews|types|show ...');
    break;
  }

  // =============================================================
  // agent 命令 - 注册集 / 脏数据审计 / 安全 remap
  // =============================================================
  case 'agent': {
    const [sub, ...restArgs] = args;

    if (sub === 'list') {
      const registry = loadAgentRegistry({ persistIfMissing: false });
      if (!registry.agents.length) { console.log('当前暂无注册 agent'); break; }
      console.log(`\nRegistered Agents (${registry.agents.length})\n`);
      console.log('agent           enabled  source      workspace');
      console.log('-'.repeat(88));
      for (const entry of registry.agents) {
        console.log(`${entry.agent.padEnd(15)} ${String(entry.enabled !== false).padEnd(8)} ${String(entry.source || '-').padEnd(10)} ${entry.workspace || '-'}`);
      }
      console.log('');
      break;
    }

    if (sub === 'audit') {
      let top = 10;
      let invalidArgs = false;
      for (const part of restArgs.filter(Boolean)) {
        if (part.startsWith('top=')) {
          const value = Number(part.substring('top='.length));
          if (!Number.isInteger(value) || value <= 0) {
            console.error('agent audit top 必须是正整数');
            invalidArgs = true;
            break;
          }
          top = value;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf agent audit [top=N]');
        break;
      }
      const audit = buildAgentAudit(top);
      const unknownReferenceCount = audit.unknown_agents.reduce((sum, item) => sum + item.count, 0);
      console.log(`\nAgent Audit  |  top=${top}\n`);
      console.log(`registered=${audit.registered_agents.length}  observed=${audit.observed_agents.length}  unknown_agents=${audit.unknown_agents.length}  unknown_references=${unknownReferenceCount}`);
      if (audit.registered_agents.length) {
        console.log(`registered_set=${audit.registered_agents.map(entry => entry.agent).join(', ')}`);
      }
      if (!audit.unknown_agents.length) {
        console.log('\nunknown agents: none');
        console.log('');
        break;
      }
      if (audit.unknown_source_counts.length) {
        console.log('\nunknown by source:');
        for (const bucket of audit.unknown_source_counts.slice(0, top)) {
          console.log(`- ${bucket.source}: ${bucket.count}`);
        }
      }
      console.log('\nunknown agents:');
      for (const item of audit.unknown_agents.slice(0, top)) {
        console.log(`- ${formatAgentDisplay(item.agent)}  refs=${item.count}  tasks=${item.task_ids.length}  sources=${item.sources.map(source => `${source.source}:${source.count}`).join(', ')}`);
        if (item.task_ids.length) console.log(`  task_ids=${item.task_ids.slice(0, 5).join(', ')}`);
        if (item.files.length) console.log(`  sample_file=${item.files[0]}`);
      }
      console.log('');
      break;
    }

    if (sub === 'register') {
      const [agentRaw, ...optionParts] = restArgs;
      if (!agentRaw) {
        console.error('用法: atf agent register <agent> [workspace=/path] [source=x] [enabled=true|false]');
        break;
      }
      const agentName = normalizeAgentName(agentRaw);
      if (!agentName) {
        console.error('agent register 要求合法 agent 名');
        break;
      }
      let workspace = null;
      let source = null;
      let enabled;
      let invalidArgs = false;
      for (const part of optionParts.filter(Boolean)) {
        if (part.startsWith('workspace=')) {
          workspace = part.substring('workspace='.length);
          continue;
        }
        if (part.startsWith('source=')) {
          source = part.substring('source='.length);
          continue;
        }
        if (part.startsWith('enabled=')) {
          const value = part.substring('enabled='.length).toLowerCase();
          if (['true', '1', 'yes'].includes(value)) enabled = true;
          else if (['false', '0', 'no'].includes(value)) enabled = false;
          else invalidArgs = true;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf agent register <agent> [workspace=/path] [source=x] [enabled=true|false]');
        break;
      }
      const result = upsertAgentRegistryEntry(agentName, { workspace, source, enabled });
      console.log('\nAgent Register\n');
      console.log(`agent=${result.entry.agent}  created=${result.created}  updated=${result.updated}  enabled=${result.entry.enabled !== false}  source=${result.entry.source || '-'}`);
      console.log(`workspace=${result.entry.workspace || '-'}`);
      console.log(`registry_total=${result.registry.agents.length}`);
      console.log('');
      break;
    }

    if (sub === 'remap') {
      const [fromAgentRaw, toAgentRaw, ...optionParts] = restArgs;
      if (!fromAgentRaw || !toAgentRaw) {
        console.error('用法: atf agent remap <from> <to> [apply=true]');
        break;
      }
      const fromAgent = String(fromAgentRaw).trim();
      const toAgent = String(toAgentRaw).trim();
      if (!isReputationAgent(fromAgent) || !isReputationAgent(toAgent)) {
        console.error('agent remap 要求 from/to 都是合法 agent 名');
        break;
      }
      if (fromAgent === toAgent) {
        console.error('agent remap 要求 from 和 to 不同');
        break;
      }
      let apply = false;
      let invalidArgs = false;
      for (const part of optionParts.filter(Boolean)) {
        if (part === 'apply' || part === '--apply' || part === 'apply=true') {
          apply = true;
          continue;
        }
        if (part === 'apply=false') {
          apply = false;
          continue;
        }
        invalidArgs = true;
        break;
      }
      if (invalidArgs) {
        console.error('用法: atf agent remap <from> <to> [apply=true]');
        break;
      }
      const result = remapAgentReferences(fromAgent, toAgent, { apply });
      console.log(`\nAgent Remap\n`);
      console.log(`from=${result.from_agent}  to=${result.to_agent}  apply=${result.apply}  replacements=${result.replacements}  touched_tasks=${result.touched_tasks.length}  touched_files=${result.touched_files.length}`);
      console.log(`target_registered=${result.target_registered}${result.registry_changed ? '  registry_changed=true' : ''}`);
      if (result.source_counts.length) {
        console.log('\nreplacements by source:');
        for (const bucket of result.source_counts) {
          console.log(`- ${bucket.source}: ${bucket.count}`);
        }
      }
      if (result.field_counts.length) {
        console.log('\nreplacements by field:');
        for (const bucket of result.field_counts) {
          console.log(`- ${bucket.field}: ${bucket.count}`);
        }
      }
      if (result.touched_tasks.length) console.log(`\ntask_ids=${result.touched_tasks.join(', ')}`);
      if (!result.target_registered) console.log('\nwarning: target agent is not in the registered agent set');
      if (!result.apply) console.log('\ndry_run=true  要真正写回请追加 apply=true');
      console.log('');
      break;
    }

    console.error('用法: atf agent list|audit|register|remap ...');
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
      buildReputationIndex();
      buildCreditsIndex();
      fs.unlinkSync(dlqFile);
      // 写 pending-task.json 通知 agent
      const ws = resolveAgentWorkspace(ctx.assigned_to);
      const pending = {
        task_id: ctx.task_id,
        description: ctx.description,
        task_profile: getTaskProfile(ctx),
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
      buildReputationIndex();
      buildCreditsIndex();
      fs.unlinkSync(dlqFile);
      console.log(`✅ ${taskId} 已跳过 (archived)`);
      break;
    }

    // atf dlq cancel <taskId> → cancelled
    if (dlqCmd === 'cancel') {
      const ctx = readCtx(taskId);
      if (ctx) { ctx.status = 'cancelled'; writeCtx(taskId, ctx); }
      buildReputationIndex();
      buildCreditsIndex();
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
    buildReputationIndex();
    buildCreditsIndex();
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
      task_profile: getTaskProfile(ctx),
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
      task_profile: getTaskProfile(ctx),
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
    console.error('用法: atf create|list|status|stats|profile|assign|update|fan-out|focus|trigger|reflect|review|action|credits|reputation|shared|msg|dlq|learnings|delivered|dri|ctx|nextnum|block|decide|revise');
}
