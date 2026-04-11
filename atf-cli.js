#!/usr/bin/env node
/**
 * ATF CLI v2 - 统一任务仓库
 * 所有任务存储在 /root/.openclaw/atf-tasks/
 * 每个任务目录包含: ctx.json, latest.json, README.md, progress.md, research/, notifications/
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 统一配置
// ============================================================
const TASKS_DIR = '/root/.openclaw/atf-tasks';
const DLQ_DIR    = '/root/.openclaw/atf-tasks/dlq';
const DATA_DIR  = '/root/.openclaw/workspace/agent-taskflow/data';
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE  = `${DATA_DIR}/tasks.json`;
const SCORES_FILE = `${DATA_DIR}/scores.json`;

if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR,   { recursive: true });

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
  const subdirs = ['research', 'implementation', 'notes', 'notifications'];
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
  saveJson(`${TASKS_DIR}/${taskId}/notifications/history.json`, []);
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
    ctx.status = status; writeCtx(taskId, ctx);
    const hist = loadJson(`${TASKS_DIR}/${taskId}/notifications/history.json`) || [];
    hist.push({ event: 'status_change', status, at: new Date().toISOString() });
    saveJson(`${TASKS_DIR}/${taskId}/notifications/history.json`, hist.slice(-50));
    console.log(`✅ ${taskId} → ${status}`);
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
      const ws = ctx.assigned_to === 'f0x'
        ? '/root/.openclaw/workspace-f0x'
        : '/root/.openclaw/workspace-acestock';
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
    const WORKSPACES = [
      '/root/.openclaw/workspace',
      '/root/.openclaw/workspace-f0x',
      '/root/.openclaw/workspace-acestock',
    ];
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
      const { execSync } = require('child_process');
      const out = execSync(`node /root/.openclaw/workspace/bin/learnings-promote.cjs --promote`, { encoding:'utf-8' });
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
    const pdPath = '/root/.openclaw/workspace/pending-decisions.md';
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
    const pdJsonPath = '/root/.openclaw/workspace/pending-decisions.json';
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
    const pdJsonPath = '/root/.openclaw/workspace/pending-decisions.json';
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
    console.error('用法: atf create|list|status|assign|update|fan-out|dlq|learnings|delivered|dri|ctx|nextnum|block|decide|revise');
}
