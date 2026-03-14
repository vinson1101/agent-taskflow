const AgentTaskFlowSkill = require('./bot-integration.js');

// 创建Bot实例
const taskBot = new AgentTaskFlowSkill();

// 模拟OpenClaw上下文
const mockContext = {
  user: { id: 'user_123', name: 'Vinson' },
  channel: 'telegram',
  timestamp: new Date()
};

// Bot使用示例
async function botDemo() {
  console.log('🤖 AgentTaskFlow Bot 演示\n');
  
  // 1. 注册代理
  console.log('1️⃣ 注册代理...');
  const agent1 = await taskBot.execute('agent.register', 
    { name: '张三', capabilities: 'javascript,前端', rate: 80 }, mockContext);
  console.log(agent1);
  
  const agent2 = await taskBot.execute('agent.register', 
    { name: '李四', capabilities: 'python,后端', rate: 75 }, mockContext);
  console.log(agent2);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 2. 创建任务
  console.log('2️⃣ 创建任务...');
  const task1 = await taskBot.execute('task.create', 
    { description: '开发用户登录功能', priority: 'high', hours: 8 }, mockContext);
  console.log(task1);
  
  const task2 = await taskBot.execute('task.create', 
    { description: '设计数据库架构', priority: 'medium', hours: 6 }, mockContext);
  console.log(task2);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 3. 分配任务
  console.log('3️⃣ 分配任务...');
  const assign1 = await taskBot.execute('task.assign', 
    { taskId: 'task_1', agentId: 'agent_1' }, mockContext);
  console.log(assign1);
  
  const assign2 = await taskBot.execute('task.assign', 
    { taskId: 'task_2', agentId: 'agent_2' }, mockContext);
  console.log(assign2);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 4. 完成任务
  console.log('4️⃣ 完成任务...');
  const complete1 = await taskBot.execute('task.complete', 
    { taskId: 'task_1', quality: 90, notes: '高质量实现，包含响应式设计' }, mockContext);
  console.log(complete1);
  
  const complete2 = await taskBot.execute('task.complete', 
    { taskId: 'task_2', quality: 85, notes: '数据库设计合理，性能优化良好' }, mockContext);
  console.log(complete2);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 5. 处理支付
  console.log('5️⃣ 处理支付...');
  const payment1 = await taskBot.execute('payment.process', 
    { taskId: 'task_1' }, mockContext);
  console.log(payment1);
  
  const payment2 = await taskBot.execute('payment.process', 
    { taskId: 'task_2' }, mockContext);
  console.log(payment2);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 6. 查看统计
  console.log('6️⃣ 查看统计...');
  const stats = await taskBot.execute('task.stats', {}, mockContext);
  console.log(stats);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 7. 排行榜
  console.log('7️⃣ 排行榜...');
  const leaderboard = await taskBot.execute('ranking.leaderboard', {}, mockContext);
  console.log(leaderboard);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 8. 帮助信息
  console.log('8️⃣ 帮助信息...');
  const help = taskBot.getHelp();
  console.log(help);
  
  console.log('\n🎉 Bot演示完成！');
}

// 运行演示
botDemo().catch(console.error);