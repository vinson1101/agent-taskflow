const AgentTaskFlow = require('./index.js');

class AgentTaskFlowSkill {
  constructor() {
    this.taskFlow = new AgentTaskFlow();
    this.commands = {
      'task': {
        create: this.createTask.bind(this),
        assign: this.assignTask.bind(this),
        complete: this.completeTask.bind(this),
        list: this.listTasks.bind(this),
        stats: this.showStats.bind(this)
      },
      'agent': {
        register: this.registerAgent.bind(this),
        list: this.listAgents.bind(this)
      },
      'payment': {
        process: this.processPayment.bind(this),
        history: this.paymentHistory.bind(this)
      },
      'collaboration': {
        message: this.sendMessage.bind(this),
        team: this.createTeam.bind(this)
      },
      'ranking': {
        leaderboard: this.showLeaderboard.bind(this),
        performance: this.showPerformance.bind(this)
      }
    };
  }

  // OpenClaw技能入口
  async execute(command, params, context) {
    try {
      const [category, action] = command.split('.');
      const handler = this.commands[category]?.[action];
      
      if (!handler) {
        return `❌ 未知命令: ${command}. 使用 'help' 查看可用命令。`;
      }

      return await handler(params, context);
    } catch (error) {
      return `❌ 执行错误: ${error.message}`;
    }
  }

  // 任务管理命令
  async createTask(params, context) {
    const { description, priority = 'medium', hours = 1 } = params;
    
    if (!description) {
      return '❌ 请提供任务描述。用法: task.create "任务描述" [priority] [hours]';
    }

    const task = this.taskFlow.createTask(description, priority, hours);
    
    return `✅ 任务创建成功！\n📋 任务ID: ${task.id}\n📝 描述: ${task.description}\n⭐ 优先级: ${task.priority}\n⏱️ 预估工时: ${hours}小时`;
  }

  async assignTask(params, context) {
    const { taskId, agentId } = params;
    
    if (!taskId || !agentId) {
      return '❌ 请提供任务ID和代理ID。用法: task.assign task_id agent_id';
    }

    const task = this.taskFlow.assignTask(taskId, agentId);
    
    return `✅ 任务分配成功！\n📋 任务: ${task.id}\n👤 分配给: ${agentId}\n📊 状态: ${task.status}`;
  }

  async completeTask(params, context) {
    const { taskId, quality = 80, notes = '' } = params;
    
    if (!taskId) {
      return '❌ 请提供任务ID。用法: task.complete task_id [quality] [notes]';
    }

    const task = await this.taskFlow.completeTask(taskId, quality, notes);
    
    return `🎉 任务完成！\n📋 任务: ${task.id}\n⭐ 质量评分: ${quality}%\n📝 备注: ${notes}\n💰 待支付: ${task.estimatedHours * (task.assignedTo ? this.taskFlow.getAgent(task.assignedTo)?.hourlyRate || 50 : 0)} USDC`;
  }

  async listTasks(params, context) {
    const { status = 'all' } = params;
    
    let tasks;
    if (status === 'all') {
      tasks = this.taskFlow.getAllTasks();
    } else {
      tasks = this.taskFlow.getTasksByStatus(status);
    }

    if (tasks.length === 0) {
      return '📋 暂无任务。';
    }

    let response = `📋 任务列表 (${tasks.length}个):\n\n`;
    tasks.forEach(task => {
      response += `🎯 ${task.id}: ${task.description}\n`;
      response += `   状态: ${task.status} | 优先级: ${task.priority}\n`;
      response += `   分配: ${task.assignedTo || '未分配'} | 支付: ${task.paymentStatus}\n\n`;
    });

    return response;
  }

  async showStats(params, context) {
    const stats = this.taskFlow.getTaskStatistics();
    
    let response = `📊 任务统计:\n\n`;
    response += `📈 总任务数: ${stats.total}\n`;
    response += `⏳ 待处理: ${stats.pending}\n`;
    response += `👥 已分配: ${stats.assigned}\n`;
    response += `🔄 进行中: ${stats.inProgress}\n`;
    response += `✅ 已完成: ${stats.completed}\n`;
    response += `💰 已支付: ${stats.paid}\n`;
    
    return response;
  }

  // 代理管理命令
  async registerAgent(params, context) {
    const { name, capabilities, rate = 50 } = params;
    
    if (!name || !capabilities) {
      return '❌ 请提供代理名称和能力。用法: agent.register "姓名" "能力1,能力2" [时薪]';
    }

    const agent = this.taskFlow.registerAgent(name, capabilities.split(','), rate);
    
    return `👤 代理注册成功！\n🆔 ID: ${agent.id}\n👤 姓名: ${agent.name}\n🛠️ 能力: ${capabilities}\n💰 时薪: $${rate}/小时`;
  }

  async listAgents(params, context) {
    const agents = this.taskFlow.getAllAgents();
    
    if (agents.length === 0) {
      return '👥 暂无代理。';
    }

    let response = `👥 代理列表 (${agents.length}个):\n\n`;
    agents.forEach(agent => {
      response += `👤 ${agent.id}: ${agent.name}\n`;
      response += `   能力: ${agent.capabilities.join(', ')}\n`;
      response += `   时薪: $${agent.hourlyRate}/小时\n`;
      response += `   状态: ${agent.status}\n\n`;
    });

    return response;
  }

  // 支付管理命令
  async processPayment(params, context) {
    const { taskId } = params;
    
    if (!taskId) {
      return '❌ 请提供任务ID。用法: payment.process task_id';
    }

    const payments = await this.taskFlow.processPayment(taskId);
    
    let response = `💰 支付处理成功！\n\n`;
    payments.forEach(payment => {
      response += `💳 交易ID: ${payment.id}\n`;
      response += `📋 任务: ${payment.taskId}\n`;
      response += `👤 代理: ${payment.agentId}\n`;
      response += `💵 金额: ${payment.amount} USDC\n`;
      response += `📊 状态: ${payment.status}\n\n`;
    });

    return response;
  }

  async paymentHistory(params, context) {
    const payments = Array.from(this.taskFlow.payments.values());
    
    if (payments.length === 0) {
      return '💳 暂无支付记录。';
    }

    let response = `💳 支付历史 (${payments.length}笔):\n\n`;
    payments.forEach(payment => {
      response += `💳 ${payment.id}: ${payment[0]?.amount || 0} USDC\n`;
      response += `   任务: ${payment[0]?.taskId || 'N/A'}\n`;
      response += `   时间: ${new Date(payment[0]?.processedAt).toLocaleString()}\n\n`;
    });

    return response;
  }

  // 协作命令
  async sendMessage(params, context) {
    const { from, to, message, taskId } = params;
    
    if (!from || !to || !message) {
      return '❌ 请提供完整信息。用法: collaboration.message from_id to_id "消息内容" [task_id]';
    }

    const result = await this.taskFlow.sendMessage(from, to, message, taskId);
    
    return `💬 消息发送成功！\n📨 从: ${from}\n📩 到: ${to}\n💬 内容: ${message}\n📋 任务: ${taskId || '无'}`;
  }

  async createTeam(params, context) {
    const { name, members } = params;
    
    if (!name || !members) {
      return '❌ 请提供团队名称和成员。用法: collaboration.team "团队名" "member1,member2"';
    }

    const team = this.taskFlow.collaborationSystem.createTeam(name, members.split(','));
    
    return `👥 团队创建成功！\n🆔 ID: ${team.id}\n🏷️ 名称: ${team.name}\n👥 成员: ${members}`;
  }

  // 排行榜命令
  async showLeaderboard(params, context) {
    const leaderboard = this.taskFlow.getLeaderboard();
    
    if (leaderboard.length === 0) {
      return '🏆 暂无排行榜数据。';
    }

    let response = `🏆 排行榜 (Top 10):\n\n`;
    leaderboard.slice(0, 10).forEach((agent, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
      response += `${medal} 第${agent.rank}名: ${agent.agentId} (${agent.totalScore}分)\n`;
      response += `   📊 任务: ${agent.taskScore} | 🤝 协作: ${agent.collaborationScore}\n`;
      response += `   ⭐ 质量: ${agent.qualityScore} | 🛡️ 可靠: ${agent.reliabilityScore}\n\n`;
    });

    return response;
  }

  async showPerformance(params, context) {
    const analytics = this.taskFlow.getContributionAnalytics();
    
    let response = `📈 性能分析:\n\n`;
    response += `👥 总代理数: ${analytics.totalAgents}\n`;
    response += `📊 平均分数: ${analytics.averageScore}\n`;
    response += `🏆 最佳代理: ${analytics.topPerformer?.agentId || 'N/A'} (${analytics.topPerformer?.totalScore || 0}分)\n\n`;
    
    response += `📊 各维度平均分:\n`;
    response += `   📋 任务: ${analytics.categoryAverages.task}\n`;
    response += `   🤝 协作: ${analytics.categoryAverages.collaboration}\n`;
    response += `   ⭐ 质量: ${analytics.categoryAverages.quality}\n`;
    response += `   🛡️ 可靠: ${analytics.categoryAverages.reliability}\n`;
    response += `   💡 创新: ${analytics.categoryAverages.innovation}\n`;

    return response;
  }

  // 帮助命令
  getHelp() {
    return `🤖 AgentTaskFlow Bot 帮助:

📋 任务管理:
  task.create "描述" [priority] [hours]    - 创建任务
  task.assign task_id agent_id             - 分配任务
  task.complete task_id [quality] [notes]   - 完成任务
  task.list [status]                      - 列出任务
  task.stats                              - 任务统计

👥 代理管理:
  agent.register "姓名" "能力" [时薪]       - 注册代理
  agent.list                              - 列出代理

💰 支付管理:
  payment.process task_id                 - 处理支付
  payment.history                         - 支付历史

🤝 协作功能:
  collaboration.message from to "消息" [task] - 发送消息
  collaboration.team "名称" "成员"          - 创建团队

🏆 排行榜:
  ranking.leaderboard                     - 排行榜
  ranking.performance                     - 性能分析

💡 使用示例:
  task.create "开发登录功能" high 8
  agent.register "张三" "javascript,前端" 80
  task.assign task_1 agent_1
  task.complete task_1 90 "高质量实现"
  payment.process task_1
`;
  }
}

module.exports = AgentTaskFlowSkill;