const UniversalTaskSystem = require('./universal-task-system.js');

// 通用任务系统演示
async function universalTaskDemo() {
  console.log('🌍 通用任务系统演示\n');
  
  // 初始化系统
  const taskSystem = new UniversalTaskSystem();
  
  console.log('📋 1. 系统初始化和任务类型...');
  
  // 显示可用的任务类型
  console.log('🎯 可用任务类型:');
  for (const [typeId, typeInfo] of taskSystem.taskTypes) {
    console.log(`  ${typeId}: ${typeInfo.name}`);
    console.log(`    技能要求: ${typeInfo.skills.join(', ')}`);
    console.log(`    分类: ${typeInfo.categories.join(', ')}`);
    console.log(`    基础报酬: $${typeInfo.basePay}`);
    console.log('');
  }
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 2. 创建多样化任务...');
  
  // 创建多样化任务
  const tasks = taskSystem.createDiverseTasks();
  
  console.log(`✅ 创建了 ${tasks.length} 个多样化任务:\n`);
  
  tasks.forEach((task, index) => {
    console.log(`${index + 1}. ${task.id}`);
    console.log(`   描述: ${task.description}`);
    console.log(`   类型: ${task.taskType} (${task.difficulty})`);
    console.log(`   分类: ${task.category}`);
    console.log(`   预估工时: ${task.estimatedHours}小时`);
    console.log(`   基础报酬: $${task.basePay}`);
    console.log(`   技能要求: ${task.skills.join(', ')}`);
    console.log(`   质量因素: ${task.qualityFactors.join(', ')}`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('👥 3. 创建多样化代理...');
  
  // 创建不同类型的代理
  const agents = [
    {
      id: 'content_creator',
      name: '内容创作者',
      skills: ['写作', '研究', '编辑', '创意'],
      preferences: { categories: ['content', 'media'], difficulty: 'moderate' }
    },
    {
      id: 'tech_specialist',
      name: '技术专家',
      skills: ['编程', '算法', '测试', '工具'],
      preferences: { categories: ['tech'], difficulty: 'complex' }
    },
    {
      id: 'business_consultant',
      name: '商业顾问',
      skills: ['专业知识', '分析', '沟通', '策划'],
      preferences: { categories: ['business', 'analysis'], difficulty: 'expert' }
    },
    {
      id: 'designer',
      name: '设计师',
      skills: ['设计', '创意', '软件', '品牌'],
      preferences: { categories: ['creative'], difficulty: 'moderate' }
    },
    {
      id: 'community_manager',
      name: '社区经理',
      skills: ['沟通', '管理', '内容', '组织'],
      preferences: { categories: ['community'], difficulty: 'simple' }
    }
  ];
  
  agents.forEach(agent => {
    console.log(`👤 ${agent.name} (${agent.id})`);
    console.log(`   技能: ${agent.skills.join(', ')}`);
    console.log(`   偏好: ${agent.preferences.categories.join(', ')} | 难度: ${agent.preferences.difficulty}`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 4. 智能任务匹配...');
  
  // 为每个代理进行智能匹配
  agents.forEach(agent => {
    const matches = taskSystem.matchTaskToAgent(agent.skills, agent.preferences);
    
    console.log(`🎯 ${agent.name} 的任务匹配:`);
    if (matches.length === 0) {
      console.log('   暂无合适任务');
    } else {
      matches.slice(0, 3).forEach((match, index) => {
        console.log(`   ${index + 1}. ${match.task.description}`);
        console.log(`      匹配度: ${(match.matchScore * 100).toFixed(1)}%`);
        console.log(`      技能匹配: ${(match.skillMatch * 100).toFixed(1)}%`);
        console.log(`      分类匹配: ${(match.categoryMatch * 100).toFixed(1)}%`);
        console.log(`      难度匹配: ${(match.difficultyMatch * 100).toFixed(1)}%`);
        console.log(`      报酬: $${match.task.basePay}`);
        console.log('');
      });
    }
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('📊 5. 系统统计分析...');
  
  // 任务统计
  const taskStats = taskSystem.getTaskStatistics();
  console.log('📊 任务统计:');
  console.log(`   总任务数: ${taskStats.total}`);
  console.log(`   平均报酬: $${taskStats.averagePay}`);
  console.log(`   平均工时: ${taskStats.averageHours}小时`);
  console.log('');
  
  console.log('📊 按类型分布:');
  for (const [type, count] of Object.entries(taskStats.byType)) {
    console.log(`   ${type}: ${count}个任务`);
  }
  console.log('');
  
  console.log('📊 按分类分布:');
  for (const [category, count] of Object.entries(taskStats.byCategory)) {
    console.log(`   ${category}: ${count}个任务`);
  }
  console.log('');
  
  console.log('📊 按难度分布:');
  for (const [difficulty, count] of Object.entries(taskStats.byDifficulty)) {
    console.log(`   ${difficulty}: ${count}个任务`);
  }
  console.log('');
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🔍 6. 技能需求分析...');
  
  const skillDemand = taskSystem.getSkillDemandAnalysis();
  console.log('🔍 技能需求排行:');
  skillDemand.slice(0, 10).forEach((skill, index) => {
    console.log(`${index + 1}. ${skill.skill}`);
    console.log(`   需求次数: ${skill.demandCount}`);
    console.log(`   平均报酬: $${skill.averagePay}`);
    console.log(`   相关任务: ${skill.relatedTasks.length}个`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('📈 7. 分类分析...');
  
  const categoryAnalysis = taskSystem.getCategoryAnalysis();
  console.log('📈 分类分析:');
  categoryAnalysis.forEach((category, index) => {
    console.log(`${index + 1}. ${category.category}`);
    console.log(`   任务数量: ${category.taskCount}`);
    console.log(`   平均报酬: $${category.averagePay}`);
    console.log(`   相关任务: ${category.relatedTasks.length}个`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 8. 个性化任务推荐...');
  
  // 为每个代理生成个性化推荐
  agents.forEach(agent => {
    const recommendations = taskSystem.generatePersonalizedRecommendations(
      agent.skills,
      { completedTasks: [] } // 简化演示，无历史记录
    );
    
    console.log(`🎯 ${agent.name} 的个性化推荐:`);
    if (recommendations.length === 0) {
      console.log('   暂无推荐任务');
    } else {
      recommendations.slice(0, 3).forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec.task.description}`);
        console.log(`      匹配度: ${(rec.matchScore * 100).toFixed(1)}%`);
        console.log(`      推荐原因: ${rec.reason}`);
        console.log(`      报酬: $${rec.task.basePay}`);
        console.log('');
      });
    }
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🌟 9. 应用场景示例...');
  
  // 模拟不同应用场景
  const scenarios = [
    {
      name: '自由职业平台',
      description: '连接自由职业者和客户',
      tasks: ['article', 'design', 'development', 'marketing'],
      agents: ['content_creator', 'designer', 'tech_specialist', 'business_consultant']
    },
    {
      name: '创意工作室',
      description: '提供创意设计和内容服务',
      tasks: ['design', 'video', 'branding', 'copywriting'],
      agents: ['designer', 'content_creator']
    },
    {
      name: '技术社区',
      description: '技术学习和项目协作',
      tasks: ['development', 'testing', 'course', 'community'],
      agents: ['tech_specialist', 'community_manager']
    },
    {
      name: '咨询公司',
      description: '提供专业咨询服务',
      tasks: ['consulting', 'research', 'analysis', 'management'],
      agents: ['business_consultant', 'tech_specialist']
    }
  ];
  
  scenarios.forEach((scenario, index) => {
    console.log(`🌟 ${index + 1}. ${scenario.name}`);
    console.log(`   描述: ${scenario.description}`);
    console.log(`   支持任务类型: ${scenario.tasks.join(', ')}`);
    console.log(`   适用代理: ${scenario.agents.join(', ')}`);
    console.log('');
    
    // 为场景生成推荐任务
    const scenarioTasks = tasks.filter(task => scenario.tasks.includes(task.taskType));
    scenarioTasks.slice(0, 2).forEach(task => {
      console.log(`   推荐任务: ${task.description}`);
      console.log(`   报酬: $${task.basePay} | 工时: ${task.estimatedHours}h`);
    });
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎉 通用任务系统演示完成！');
  console.log('✅ 支持15种不同类型的任务');
  console.log('✅ 适用于各种协作场景');
  console.log('✅ 智能任务匹配和推荐');
  console.log('✅ 全面的统计分析');
  console.log('✅ 个性化推荐系统');
}

// 运行演示
universalTaskDemo().catch(console.error);