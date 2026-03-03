#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/root/.openclaw/workspace/agent-taskflow/data';
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE = `${DATA_DIR}/tasks.json`;
const SCORES_FILE = `${DATA_DIR}/scores.json`;

// 任务目录配置
const TASKS_DIR = '/root/.openclaw/workspace/ATF-TASKS';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 数据加载/保存
function loadAgents() {
  try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch { return {}; }
}
function saveAgents(a) { fs.writeFileSync(AGENTS_FILE, JSON.stringify(a, null, 2)); }
function loadTasks() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return []; }
}
function saveTasks(t) { fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2)); }
function loadScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch { return {}; }
}
function saveScores(s) { fs.writeFileSync(SCORES_FILE, JSON.stringify(s, null, 2)); }

function generateId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

// 创建任务目录
function createTaskDir(taskId, description, taskNum = null) {
  if (!fs.existsSync(TASKS_DIR)) {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
  }
  
  // 清理描述中的非法字符
  const safeDesc = description
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  
  // 目录名格式: 序号-任务名 或 task_xxx-任务名
  const dirName = taskNum ? `${taskNum}-${safeDesc}` : `${taskId}-${safeDesc}`;
  const taskPath = path.join(TASKS_DIR, dirName);
  
  if (!fs.existsSync(taskPath)) {
    fs.mkdirSync(taskPath, { recursive: true });
    
    // 创建 README.md
    const readmeContent = `# ${taskNum ? taskNum + ' - ' : ''}${description}

## 任务描述
${description}

## 状态
pending

## Agent
未分配

## 创建时间
${new Date().toISOString()}

## 关联任务 ID
${taskId}
`;
    fs.writeFileSync(path.join(taskPath, 'README.md'), readmeContent);
    
    // 创建子目录结构
    fs.mkdirSync(path.join(taskPath, 'research'), { recursive: true });
    fs.mkdirSync(path.join(taskPath, 'implementation'), { recursive: true });
    fs.mkdirSync(path.join(taskPath, 'notes'), { recursive: true });
    
    // 创建 progress.md
    const progressContent = `# 进度记录

**最后更新**: ${new Date().toISOString().replace('T', ' ').split('.')[0]} GMT+8

## 待办
- [ ] 

## 进行中
- [ ] 

## 完成
- [ ] 

## 记录
| 日期 | 更新内容 | 更新人 |
|------|----------|--------|
|      |          |        |
`;
    fs.writeFileSync(path.join(taskPath, 'progress.md'), progressContent);
    
    // 创建 evaluation.md
    const evalContent = `# 考核评分

## 评分维度
- 完成度 (40%)
- 质量 (30%)
- 效率 (20%)
- 创新 (10%)

## 评分记录
| 日期 | 评分 | 评语 | 评分人 |
|------|------|------|--------|
|      |      |      |        |
`;
    fs.writeFileSync(path.join(taskPath, 'evaluation.md'), evalContent);
    
    // 创建 incentives.md
    const incentContent = `# 激励方案

## 物质激励
- USDC 奖励
- CLAW 代币

## 精神激励
- 称号升级
- 优先选择任务

## 激励记录
| 日期 | 激励类型 | 金额/内容 | 原因 |
|------|----------|----------|------|
|      |          |          |      |
`;
    fs.writeFileSync(path.join(taskPath, 'incentives.md'), incentContent);
    
    // 创建 .env.example
    const envContent = `# 环境变量模板
# 复制为 .env 并填入真实值

# 示例变量
# API_KEY=xxx
# API_SECRET=xxx
`;
    fs.writeFileSync(path.join(taskPath, '.env.example'), envContent);
    
    return { dirName, taskPath };
  }
  return { dirName, taskPath, exists: true };
}

// 获取任务序号 (最大序号+1)
function getNextTaskNum() {
  if (!fs.existsSync(TASKS_DIR)) return 1;
  const dirs = fs.readdirSync(TASKS_DIR);
  let maxNum = 0;
  dirs.forEach(d => {
    const match = d.match(/^(\d+)-/);
    if (match) {
      const num = parseInt(match[1]);
      if (num > maxNum) maxNum = num;
    }
  });
  return maxNum + 1;
}

// 评分系统
function rateTask(taskId, rating, reason = '') {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };
  
  const scores = loadScores();
  if (!scores[task.assignedTo]) {
    scores[task.assignedTo] = {
      agentId: task.assignedTo,
      totalScore: 0,
      tasksCompleted: 0,
      ratings: [],
      avgRating: 0
    };
  }
  
  const agentScore = scores[task.assignedTo];
  agentScore.tasksCompleted++;
  agentScore.ratings.push({ taskId, rating, reason, time: new Date().toISOString() });
  agentScore.totalScore += rating;
  agentScore.avgRating = agentScore.totalScore / agentScore.ratings.length;
  
  task.rating = rating;
  task.ratingReason = reason;
  task.ratedAt = new Date().toISOString();
  
  saveScores(scores);
  saveTasks(tasks);
  
  return { 
    agentId: task.assignedTo, 
    rating, 
    avgRating: agentScore.avgRating.toFixed(1),
    totalScore: agentScore.totalScore
  };
}

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd) {
  console.log(`
🤖 AgentTaskFlow - 任务管理与评分系统

用法: atf <command> [参数]

命令:
  register <id> <type> <name>      注册 Agent
  list-agents                       查看 Agents + 评分
  create <描述> [type]              创建任务 (自动创建目录)
  assign <taskId> <agentId>         分配任务 (自动创建子任务)
  update <taskId> <status>          更新状态
  rate <taskId> <1-10> [原因]       评分
  list                             任务列表
  stats                            统计
  score <agentId>                   查看 Agent 评分
  sync                             同步任务到目录

配置:
  任务目录: ${TASKS_DIR}
  目录格式: 序号-任务名 (如 11-Virtuals-Protocol)

示例:
  atf register f0x trading "F0x"
  atf create "买入ETH" trading
  atf assign task_xxx f0x
  atf update task_xxx done
  atf rate task_xxx 8 "完成及时"
  atf sync
`);
  process.exit(0);
}

// 注册 Agent
if (cmd === 'register') {
  const [agentId, type, name] = args.slice(1);
  const agents = loadAgents();
  agents[agentId] = {
    id: agentId, type, name: name || agentId,
    registeredAt: new Date().toISOString(),
    tasksCompleted: 0
  };
  saveAgents(agents);
  console.log(`✅ 已注册: ${agentId} (${type})`);
}

// 查看 Agents + 评分
else if (cmd === 'list-agents') {
  const agents = loadAgents();
  const scores = loadScores();
  console.log('📋 Agents:\n');
  for (const [id, a] of Object.entries(agents)) {
    const s = scores[id] || {};
    const stars = s.avgRating ? '⭐'.repeat(Math.round(s.avgRating)) : '';
    console.log(`  ${id}: ${a.type} - ${a.name}`);
    if (s.avgRating) {
      console.log(`     评分: ${s.avgRating}/10 ${stars} (${s.tasksCompleted}任务)`);
    }
  }
}

// 创建任务
else if (cmd === 'create') {
  const description = args.slice(1).join(' ');
  const tasks = loadTasks();
  
  // 获取下一个任务序号
  const taskNum = getNextTaskNum();
  const taskId = generateId();
  
  const task = {
    id: taskId,
    shortId: `T-${taskNum.toString().padStart(3, '0')}`,
    taskNum: taskNum,
    description,
    type: 'general',
    status: 'pending',
    createdAt: new Date().toISOString(),
    assignedTo: null,
    startedAt: null,
    completedAt: null
  };
  tasks.push(task);
  saveTasks(tasks);
  
  // 自动创建任务目录
  const { dirName, taskPath } = createTaskDir(taskId, description, taskNum);
  
  console.log(`✅ 任务: ${task.id} [${task.shortId}]`);
  console.log(`   ${task.description}`);
  console.log(`   📁 目录: ${taskPath}`);
}

// 分配任务 (这里返回任务ID，由主会话去 spawn 子任务)
else if (cmd === 'assign') {
  const [taskId, agentId] = args.slice(1);
  const agents = loadAgents();
  if (!agents[agentId]) return console.log(`❌ 未注册: ${agentId}`);
  
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return console.log(`❌ 任务不存在`);
  
  task.assignedTo = agentId;
  task.status = 'assigned';
  task.assignedAt = new Date().toISOString();
  saveTasks(tasks);
  
  console.log(`✅ 已分配: ${taskId} -> ${agentId}`);
  console.log(`   请用 sessions_spawn 创建子任务执行`);
}

// 更新状态
else if (cmd === 'update') {
  const [taskId, status] = args.slice(1);
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return console.log(`❌ 任务不存在`);
  
  task.status = status;
  if (status === 'done' || status === 'failed') {
    task.completedAt = new Date().toISOString();
  }
  saveTasks(tasks);
  console.log(`✅ ${taskId}: ${status}`);
}

// 评分
else if (cmd === 'rate') {
  const [taskId, rating, ...reason] = args.slice(1);
  const r = parseInt(rating);
  if (r < 1 || r > 10) return console.log('评分 1-10');
  
  const result = rateTask(taskId, r, reason.join(' '));
  if (result.error) return console.log(`❌ ${result.error}`);
  
  console.log(`✅ 评分: ${r}/10`);
  console.log(`   Agent: ${result.agentId}`);
  console.log(`   平均: ${result.avgRating}/10`);
}

// 任务列表
else if (cmd === 'list') {
  const tasks = loadTasks();
  const statusIcon = { pending: '⏳', assigned: '📤', running: '🔄', done: '✅', failed: '❌' };
  console.log('📋 任务:\n');
  for (const t of tasks) {
    const icon = statusIcon[t.status] || '❓';
    console.log(`${icon} [${t.status}] ${t.id}`);
    console.log(`   ${t.description}`);
    if (t.assignedTo) console.log(`   -> ${t.assignedTo}`);
    if (t.rating) console.log(`   ⭐ ${t.rating}/10`);
    console.log('');
  }
}

// 统计
else if (cmd === 'stats') {
  const tasks = loadTasks();
  const scores = loadScores();
  const byStatus = {};
  tasks.forEach(t => byStatus[t.status] = (byStatus[t.status] || 0) + 1);
  
  console.log('📊 统计:\n');
  console.log(`  总任务: ${tasks.length}`);
  console.log(`  待处理: ${byStatus.pending || 0}`);
  console.log(`  进行中: ${byStatus.running || 0}`);
  console.log(`  已完成: ${byStatus.done || 0}`);
  console.log(`  失败: ${byStatus.failed || 0}`);
  console.log(`  Agents: ${Object.keys(scores).length}`);
}

// 查看评分
else if (cmd === 'score') {
  const agentId = args[1];
  const scores = loadScores();
  const s = scores[agentId];
  if (!s) return console.log('无评分记录');
  
  console.log(`📊 ${agentId} 评分:\n`);
  console.log(`  总分: ${s.totalScore}`);
  console.log(`  任务: ${s.tasksCompleted}`);
  console.log(`  平均: ${s.avgRating.toFixed(1)}/10`);
  console.log(`\n历史:`);
  s.ratings.forEach(r => {
    console.log(`  ⭐${r.rating}: ${r.reason || '(无评语)'}`);
  });
}

else {
  console.log(`未知命令: ${cmd}`);
}

// 同步任务到目录
if (cmd === 'sync') {
  const tasks = loadTasks();
  console.log(`📂 同步任务到 ${TASKS_DIR}\n`);
  
  let count = 0;
  tasks.forEach(task => {
    // 如果任务有 taskNum，使用它；否则根据创建时间估算
    const taskNum = task.taskNum || null;
    const result = createTaskDir(task.id, task.description, taskNum);
    if (!result.exists) {
      console.log(`  ✅ ${result.dirName}`);
      count++;
    }
  });
  
  console.log(`\n已创建 ${count} 个任务目录`);
  console.log(`\n目录结构:`);
  
  // 列出所有目录
  if (fs.existsSync(TASKS_DIR)) {
    const dirs = fs.readdirSync(TASKS_DIR).sort();
    dirs.forEach(d => {
      const taskPath = path.join(TASKS_DIR, d);
      if (fs.statSync(taskPath).isDirectory()) {
        const files = fs.readdirSync(taskPath);
        console.log(`  📁 ${d}/ (${files.length} 文件)`);
      }
    });
  }
}
