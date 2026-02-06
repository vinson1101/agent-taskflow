class UniversalTaskSystem {
  constructor() {
    this.tasks = new Map();
    this.taskTypes = new Map();
    this.skills = new Map();
    this.categories = new Map();
    this.difficultyLevels = {
      'trivial': { multiplier: 0.5, timeRange: [1, 3] },
      'simple': { multiplier: 1, timeRange: [2, 8] },
      'moderate': { multiplier: 1.5, timeRange: [4, 16] },
      'complex': { multiplier: 2, timeRange: [8, 24] },
      'expert': { multiplier: 3, timeRange: [16, 48] }
    };
    
    this.initializeUniversalTaskTypes();
  }

  // 初始化通用任务类型
  initializeUniversalTaskTypes() {
    // 内容创作类
    this.addTaskType('article', '文章撰写', {
      skills: ['写作', '研究', '编辑'],
      categories: ['content'],
      basePay: 50,
      qualityFactors: ['原创性', '深度', '可读性', '结构']
    });

    this.addTaskType('video', '视频制作', {
      skills: ['拍摄', '剪辑', '脚本', '后期'],
      categories: ['media'],
      basePay: 100,
      qualityFactors: ['创意', '技术质量', '内容价值', '观看体验']
    });

    this.addTaskType('design', '设计创作', {
      skills: ['设计', '创意', '软件'],
      categories: ['creative'],
      basePay: 80,
      qualityFactors: ['美观度', '功能性', '用户体验', '创新性']
    });

    // 研究分析类
    this.addTaskType('research', '市场研究', {
      skills: ['研究', '分析', '数据'],
      categories: ['analysis'],
      basePay: 70,
      qualityFactors: ['数据准确性', '分析方法', '结论深度', '实用性']
    });

    this.addTaskType('analysis', '数据分析', {
      skills: ['统计', '分析', '工具'],
      categories: ['analysis'],
      basePay: 90,
      qualityFactors: ['数据质量', '分析深度', '结论准确性', '可视化']
    });

    // 教育培训类
    this.addTaskType('course', '课程开发', {
      skills: ['教学', '设计', '内容'],
      categories: ['education'],
      basePay: 120,
      qualityFactors: ['教学效果', '内容质量', '互动性', '实用性']
    });

    this.addTaskType('training', '培训指导', {
      skills: ['教学', '沟通', '专业知识'],
      categories: ['education'],
      basePay: 100,
      qualityFactors: ['教学能力', '内容掌握', '学员反馈', '实用性']
    });

    // 商业服务类
    this.addTaskType('marketing', '营销策划', {
      skills: ['营销', '策划', '创意'],
      categories: ['business'],
      basePay: 85,
      qualityFactors: ['创意性', '可行性', '目标达成', 'ROI']
    });

    this.addTaskType('consulting', '咨询服务', {
      skills: ['专业知识', '分析', '沟通'],
      categories: ['business'],
      basePay: 150,
      qualityFactors: ['专业性', '解决方案', '客户满意度', '实用性']
    });

    // 技术开发类
    this.addTaskType('development', '软件开发', {
      skills: ['编程', '算法', '测试'],
      categories: ['tech'],
      basePay: 100,
      qualityFactors: ['代码质量', '功能实现', '性能', '用户体验']
    });

    this.addTaskType('testing', '质量测试', {
      skills: ['测试', '质量', '工具'],
      categories: ['tech'],
      basePay: 70,
      qualityFactors: ['测试覆盖率', '缺陷发现', '报告质量', '效率']
    });

    // 社区运营类
    this.addTaskType('community', '社区运营', {
      skills: ['沟通', '管理', '内容'],
      categories: ['community'],
      basePay: 60,
      qualityFactors: ['活跃度', '用户满意度', '内容质量', '互动性']
    });

    this.addTaskType('event', '活动组织', {
      skills: ['组织', '策划', '沟通'],
      categories: ['community'],
      basePay: 80,
      qualityFactors: ['参与度', '活动效果', '组织能力', '创新性']
    });

    // 创意设计类
    this.addTaskType('branding', '品牌设计', {
      skills: ['设计', '创意', '营销'],
      categories: ['creative'],
      basePay: 120,
      qualityFactors: ['品牌识别度', '一致性', '创意性', '实用性']
    });

    this.addTaskType('copywriting', '文案写作', {
      skills: ['写作', '创意', '营销'],
      categories: ['content'],
      basePay: 60,
      qualityFactors: ['文案质量', '创意性', '转化率', '品牌一致性']
    });

    // 管理协调类
    this.addTaskType('management', '项目管理', {
      skills: ['管理', '协调', '规划'],
      categories: ['management'],
      basePay: 110,
      qualityFactors: ['项目完成度', '团队协作', '时间控制', '质量']
    });

    this.addTaskType('coordination', '活动协调', {
      skills: ['沟通', '协调', '组织'],
      categories: ['management'],
      basePay: 70,
      qualityFactors: ['协调效率', '沟通质量', '问题解决', '时间管理']
    });
  }

  // 添加任务类型
  addTaskType(id, name, config) {
    this.taskTypes.set(id, {
      id,
      name,
      ...config,
      createdAt: new Date()
    });

    // 初始化技能
    config.skills.forEach(skill => {
      if (!this.skills.has(skill)) {
        this.skills.set(skill, {
          name: skill,
          relatedTasks: [],
          averagePay: 0,
          demandLevel: 'medium'
        });
      }
      this.skills.get(skill).relatedTasks.push(id);
    });

    // 初始化分类
    config.categories.forEach(category => {
      if (!this.categories.has(category)) {
        this.categories.set(category, {
          name: category,
          relatedTasks: [],
          averagePay: 0
        });
      }
      this.categories.get(category).relatedTasks.push(id);
    });
  }

  // 创建通用任务
  createTask(description, taskType, difficulty = 'moderate', customRequirements = {}) {
    const taskConfig = this.taskTypes.get(taskType);
    if (!taskConfig) {
      throw new Error(`Unknown task type: ${taskType}`);
    }

    const difficultyConfig = this.difficultyLevels[difficulty];
    const estimatedHours = this.calculateEstimatedHours(taskConfig, difficultyConfig, customRequirements);
    const basePay = taskConfig.basePay * difficultyConfig.multiplier;
    
    const taskId = this.generateTaskId();
    const task = {
      id: taskId,
      description,
      taskType,
      difficulty,
      category: taskConfig.categories[0],
      estimatedHours,
      basePay,
      status: 'pending',
      requirements: customRequirements,
      skills: taskConfig.skills,
      qualityFactors: taskConfig.qualityFactors,
      createdAt: new Date(),
      assignedTo: null,
      completedAt: null,
      qualityScore: null,
      paymentStatus: 'pending'
    };

    this.tasks.set(taskId, task);
    return task;
  }

  // 创建多样化任务模板
  createDiverseTasks() {
    const templates = [
      // 内容创作
      { description: "撰写一篇关于人工智能发展趋势的深度分析文章", taskType: "article", difficulty: "moderate", requirements: { wordCount: 2000, researchDepth: "deep" } },
      { description: "制作一个3分钟的产品介绍视频", taskType: "video", difficulty: "moderate", requirements: { style: "professional", length: "3min" } },
      { description: "设计一个现代化的品牌LOGO", taskType: "design", difficulty: "simple", requirements: { style: "minimalist", colors: "blue_theme" } },
      
      // 研究分析
      { description: "分析目标市场的竞争格局和机会", taskType: "research", difficulty: "complex", requirements: { scope: "regional", depth: "comprehensive" } },
      { description: "分析用户行为数据并提供优化建议", taskType: "analysis", difficulty: "moderate", requirements: { dataSources: ["web", "mobile"], timeframe: "3months" } },
      
      // 教育培训
      { description: "开发一个Python编程入门课程", taskType: "course", difficulty: "complex", requirements: { level: "beginner", duration: "8weeks", format: "video" } },
      { description: "为新员工提供产品使用培训", taskType: "training", difficulty: "simple", requirements: { duration: "2hours", format: "interactive" } },
      
      // 商业服务
      { description: "策划一个社交媒体营销活动", taskType: "marketing", difficulty: "moderate", requirements: { platforms: ["instagram", "tiktok"], budget: "medium" } },
      { description: "为中小企业提供数字化转型咨询", taskType: "consulting", difficulty: "expert", requirements: { industry: "manufacturing", scope: "comprehensive" } },
      
      // 技术开发
      { description: "开发一个电商网站的后端API", taskType: "development", difficulty: "complex", requirements: { technologies: ["nodejs", "mongodb"], features: ["payment", "inventory"] } },
      { description: "进行移动应用的功能测试", taskType: "testing", difficulty: "moderate", requirements: { devices: ["ios", "android"], coverage: "comprehensive" } },
      
      // 社区运营
      { description: "运营一个技术社区论坛", taskType: "community", difficulty: "moderate", requirements: { size: "1000_members", engagement: "high" } },
      { description: "组织一场线上技术分享会", taskType: "event", difficulty: "simple", requirements: { format: "webinar", duration: "2hours" } },
      
      // 创意设计
      { description: "为新产品设计完整的品牌形象", taskType: "branding", difficulty: "complex", requirements: { deliverables: ["logo", "guidelines", "mockups"] } },
      { description: "撰写产品发布会的宣传文案", taskType: "copywriting", difficulty: "simple", requirements: { tone: "professional", channels: ["email", "social"] } },
      
      // 管理协调
      { description: "管理一个跨部门的项目团队", taskType: "management", difficulty: "expert", requirements: { teamSize: "10people", duration: "6months" } },
      { description: "协调一个国际会议的嘉宾安排", taskType: "coordination", difficulty: "moderate", requirements: { speakers: "international", format: "hybrid" } }
    ];

    return templates.map(template => this.createTask(
      template.description,
      template.taskType,
      template.difficulty,
      template.requirements
    ));
  }

  // 计算预估工时
  calculateEstimatedHours(taskConfig, difficultyConfig, customRequirements) {
    let baseHours = (difficultyConfig.timeRange[0] + difficultyConfig.timeRange[1]) / 2;
    
    // 根据自定义需求调整
    if (customRequirements.wordCount) {
      baseHours *= (customRequirements.wordCount / 1000) * 0.1;
    }
    
    if (customRequirements.duration) {
      const durationMap = { '1hour': 1, '2hours': 2, '3min': 0.05, '8weeks': 40, '6months': 180 };
      if (durationMap[customRequirements.duration]) {
        baseHours = durationMap[customRequirements.duration];
      }
    }
    
    if (customRequirements.scope === 'comprehensive') {
      baseHours *= 1.5;
    }
    
    if (customRequirements.teamSize) {
      baseHours *= Math.min(customRequirements.teamSize / 5, 3);
    }
    
    return Math.round(baseHours);
  }

  // 生成任务ID
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // 智能任务匹配
  matchTaskToAgent(agentSkills, preferences = {}) {
    const suitableTasks = [];
    
    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'pending') continue;
      
      const skillMatch = this.calculateSkillMatch(agentSkills, task.skills);
      const categoryMatch = preferences.categories ? 
        preferences.categories.includes(task.category) ? 1 : 0 : 0.5;
      const difficultyMatch = preferences.difficulty ? 
        task.difficulty === preferences.difficulty ? 1 : 0.5 : 0.5;
      
      const overallMatch = (skillMatch * 0.6) + (categoryMatch * 0.2) + (difficultyMatch * 0.2);
      
      if (overallMatch > 0.5) {
        suitableTasks.push({
          task,
          matchScore: overallMatch,
          skillMatch,
          categoryMatch,
          difficultyMatch
        });
      }
    }
    
    return suitableTasks.sort((a, b) => b.matchScore - a.matchScore);
  }

  // 计算技能匹配度
  calculateSkillMatch(agentSkills, taskSkills) {
    if (!agentSkills || !taskSkills) return 0;
    
    const matchedSkills = agentSkills.filter(skill => taskSkills.includes(skill));
    return matchedSkills.length / taskSkills.length;
  }

  // 获取任务统计
  getTaskStatistics() {
    const stats = {
      total: this.tasks.size,
      byType: {},
      byCategory: {},
      byDifficulty: {},
      byStatus: {},
      averagePay: 0,
      averageHours: 0
    };
    
    let totalPay = 0;
    let totalHours = 0;
    
    for (const task of this.tasks.values()) {
      // 按类型统计
      stats.byType[task.taskType] = (stats.byType[task.taskType] || 0) + 1;
      
      // 按分类统计
      stats.byCategory[task.category] = (stats.byCategory[task.category] || 0) + 1;
      
      // 按难度统计
      stats.byDifficulty[task.difficulty] = (stats.byDifficulty[task.difficulty] || 0) + 1;
      
      // 按状态统计
      stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
      
      // 计算平均值
      totalPay += task.basePay;
      totalHours += task.estimatedHours;
    }
    
    stats.averagePay = Math.round(totalPay / this.tasks.size);
    stats.averageHours = Math.round(totalHours / this.tasks.size);
    
    return stats;
  }

  // 获取技能需求分析
  getSkillDemandAnalysis() {
    const skillStats = new Map();
    
    for (const task of this.tasks.values()) {
      for (const skill of task.skills) {
        if (!skillStats.has(skill)) {
          skillStats.set(skill, {
            skill,
            demandCount: 0,
            totalPay: 0,
            averagePay: 0,
            relatedTasks: []
          });
        }
        
        const stats = skillStats.get(skill);
        stats.demandCount++;
        stats.totalPay += task.basePay;
        stats.averagePay = Math.round(stats.totalPay / stats.demandCount);
        stats.relatedTasks.push(task.id);
      }
    }
    
    return Array.from(skillStats.values()).sort((a, b) => b.demandCount - a.demandCount);
  }

  // 获取分类分析
  getCategoryAnalysis() {
    const categoryStats = new Map();
    
    for (const task of this.tasks.values()) {
      if (!categoryStats.has(task.category)) {
        categoryStats.set(task.category, {
          category: task.category,
          taskCount: 0,
          totalPay: 0,
          averagePay: 0,
          relatedTasks: []
        });
      }
      
      const stats = categoryStats.get(task.category);
      stats.taskCount++;
      stats.totalPay += task.basePay;
      stats.averagePay = Math.round(stats.totalPay / stats.taskCount);
      stats.relatedTasks.push(task.id);
    }
    
    return Array.from(categoryStats.values()).sort((a, b) => b.taskCount - a.taskCount);
  }

  // 生成个性化任务推荐
  generatePersonalizedRecommendations(agentSkills, agentHistory = {}) {
    const recommendations = [];
    
    // 基于技能匹配
    const skillBased = this.matchTaskToAgent(agentSkills);
    
    // 基于历史偏好
    const historyBased = this.getHistoryBasedRecommendations(agentHistory);
    
    // 基于技能发展
    const skillDevelopment = this.getSkillDevelopmentRecommendations(agentSkills);
    
    // 合并推荐
    recommendations.push(...skillBased.slice(0, 5));
    recommendations.push(...historyBased.slice(0, 3));
    recommendations.push(...skillDevelopment.slice(0, 2));
    
    // 去重并排序
    const uniqueRecommendations = this.deduplicateRecommendations(recommendations);
    
    return uniqueRecommendations.slice(0, 10);
  }

  // 基于历史记录的推荐
  getHistoryBasedRecommendations(agentHistory) {
    if (!agentHistory || !agentHistory.completedTasks) return [];
    
    const preferredTypes = new Map();
    const preferredCategories = new Map();
    
    for (const taskId of agentHistory.completedTasks) {
      const task = this.tasks.get(taskId);
      if (task) {
        preferredTypes.set(task.taskType, (preferredTypes.get(task.taskType) || 0) + 1);
        preferredCategories.set(task.category, (preferredCategories.get(task.category) || 0) + 1);
      }
    }
    
    const recommendations = [];
    
    // 推荐相似类型的任务
    for (const [taskType, count] of preferredTypes) {
      const tasks = Array.from(this.tasks.values()).filter(task => 
        task.taskType === taskType && task.status === 'pending'
      );
      
      tasks.forEach(task => {
        recommendations.push({
          task,
          matchScore: count * 0.1,
          reason: `基于历史偏好: ${taskType}`,
          type: 'history'
        });
      });
    }
    
    return recommendations;
  }

  // 技能发展推荐
  getSkillDevelopmentRecommendations(agentSkills) {
    const skillGaps = this.identifySkillGaps(agentSkills);
    const recommendations = [];
    
    for (const skillGap of skillGaps) {
      const tasks = Array.from(this.tasks.values()).filter(task => 
        task.skills.includes(skillGap.skill) && task.status === 'pending'
      );
      
      tasks.slice(0, 3).forEach(task => {
        recommendations.push({
          task,
          matchScore: 0.8,
          reason: `技能发展机会: ${skillGap.skill}`,
          type: 'development'
        });
      });
    }
    
    return recommendations;
  }

  // 识别技能差距
  identifySkillGaps(agentSkills) {
    const allSkills = Array.from(this.skills.keys());
    const missingSkills = allSkills.filter(skill => !agentSkills.includes(skill));
    
    return missingSkills.map(skill => ({
      skill,
      demand: this.skills.get(skill)?.demandCount || 0
    })).sort((a, b) => b.demand - a.demand);
  }

  // 去重推荐
  deduplicateRecommendations(recommendations) {
    const seen = new Set();
    const unique = [];
    
    for (const rec of recommendations) {
      const key = rec.task.id;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rec);
      }
    }
    
    return unique;
  }
}

module.exports = UniversalTaskSystem;