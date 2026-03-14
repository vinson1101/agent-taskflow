class AutomatedContributionScoring {
  constructor() {
    this.scores = new Map();
    this.metrics = new Map();
    this.achievements = new Map();
    this.leaderboard = [];
    this.scoringRules = {
      // 任务完成评分规则
      task_completion: {
        base_score: 100,
        quality_multiplier: 0.02,
        timeliness_bonus: 20,
        early_completion_bonus: 15,
        revision_penalty: -10
      },
      // 协作评分规则
      collaboration: {
        message_score: 2,
        help_score: 5,
        code_review_score: 8,
        mentorship_score: 12,
        conflict_resolution_score: 15
      },
      // 创新评分规则
      innovation: {
        feature_improvement: 20,
        performance_optimization: 25,
        automation: 30,
        algorithm_optimization: 35,
        new_technology: 40
      },
      // 质量评分规则
      quality: {
        excellent: 95,
        good: 85,
        satisfactory: 75,
        needs_improvement: 65,
        poor: 55
      },
      // 可靠性评分规则
      reliability: {
        on_time_100: 100,
        on_time_95: 95,
        on_time_85: 85,
        on_time_75: 75,
        late_50: 50,
        late_25: 25
      }
    };
  }

  // 自动初始化代理
  initializeAgent(agentId, name, capabilities, hourlyRate) {
    if (!this.scores.has(agentId)) {
      this.scores.set(agentId, {
        agentId,
        name,
        totalScore: 0,
        taskScore: 0,
        collaborationScore: 0,
        qualityScore: 0,
        reliabilityScore: 0,
        innovationScore: 0,
        lastUpdated: new Date()
      });

      this.metrics.set(agentId, {
        agentId,
        name,
        capabilities,
        hourlyRate,
        tasksCompleted: 0,
        tasksOnTime: 0,
        tasksLate: 0,
        revisionsNeeded: 0,
        peerReviews: 0,
        mentorship: 0,
        codeCommits: 0,
        bugFixes: 0,
        featureRequests: 0,
        averageQuality: 0,
        collaborationFrequency: 0,
        initiativeScore: 0,
        messageCount: 0,
        helpCount: 0,
        reviewCount: 0,
        innovationCount: 0,
        lastActive: new Date(),
        streakDays: 0,
        currentStreak: 0
      });
    }
  }

  // 自动任务完成评分
  autoScoreTaskCompletion(agentId, task, completionData) {
    this.initializeAgent(agentId, task.assignedAgentName, task.assignedAgentCapabilities, task.assignedAgentHourlyRate);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    // 计算基础分数
    const rules = this.scoringRules.task_completion;
    let taskScore = rules.base_score;
    
    // 质量加成
    const qualityScore = this.calculateQualityScore(completionData.quality);
    taskScore += Math.round((qualityScore - 75) * rules.quality_multiplier);
    
    // 准时性奖励
    const isOnTime = this.isTaskOnTime(task, completionData);
    if (isOnTime) {
      taskScore += rules.timeliness_bonus;
      metrics.tasksOnTime++;
    } else {
      taskScore -= 15;
      metrics.tasksLate++;
    }
    
    // 提前完成奖励
    if (completionData.completionTime < task.estimatedHours * 0.8) {
      taskScore += rules.early_completion_bonus;
    }
    
    // 修改次数惩罚
    if (completionData.revisions > 0) {
      taskScore += completionData.revisions * rules.revision_penalty;
      metrics.revisionsNeeded += completionData.revisions;
    }
    
    // 更新分数
    score.taskScore += taskScore;
    score.totalScore += taskScore;
    
    // 更新质量平均值
    const newQualityAverage = ((score.qualityScore * metrics.tasksCompleted) + qualityScore) / (metrics.tasksCompleted + 1);
    score.qualityScore = Math.round(newQualityAverage);
    metrics.averageQuality = score.qualityScore;
    
    // 更新任务计数
    metrics.tasksCompleted++;
    
    // 更新可靠性分数
    this.updateReliabilityScore(agentId, isOnTime);
    
    // 更新活动时间
    metrics.lastActive = new Date();
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      taskScore,
      qualityScore,
      totalScore: score.totalScore,
      rank: this.getAgentRank(agentId),
      factors: this.getTaskScoreFactors(task, completionData, isOnTime)
    };
  }

  // 自动协作评分
  autoScoreCollaboration(agentId1, agentId2, action, data = {}) {
    this.initializeAgent(agentId1);
    this.initializeAgent(agentId2);
    
    const score1 = this.scores.get(agentId1);
    const score2 = this.scores.get(agentId2);
    const metrics1 = this.metrics.get(agentId1);
    const metrics2 = this.metrics.get(agentId2);
    
    const rules = this.scoringRules.collaboration;
    let collaborationScore = rules[`${action}_score`] || 2;
    
    // 根据数据调整分数
    if (data.quality) {
      collaborationScore = Math.round(collaborationScore * data.quality);
    }
    
    if (data.impact === 'high') {
      collaborationScore *= 1.5;
    } else if (data.impact === 'low') {
      collaborationScore *= 0.5;
    }
    
    // 更新双方分数
    score1.collaborationScore += collaborationScore;
    score2.collaborationScore += collaborationScore;
    score1.totalScore += collaborationScore;
    score2.totalScore += collaborationScore;
    
    // 更新指标
    metrics1.collaborationFrequency++;
    metrics2.collaborationFrequency++;
    metrics1.messageCount++;
    metrics2.messageCount++;
    
    // 更新特定指标
    if (action === 'help') {
      metrics1.helpCount++;
    } else if (action === 'code_review') {
      metrics1.reviewCount++;
      metrics2.peerReviews++;
    } else if (action === 'mentorship') {
      metrics1.mentorship++;
    }
    
    this.scores.set(agentId1, score1);
    this.scores.set(agentId2, score2);
    this.metrics.set(agentId1, metrics1);
    this.metrics.set(agentId2, metrics2);
    
    return {
      agentId1,
      agentId2,
      action,
      score: collaborationScore,
      totalScore1: score1.totalScore,
      totalScore2: score2.totalScore,
      impact: data.impact || 'normal'
    };
  }

  // 自动创新评分
  autoScoreInnovation(agentId, innovationData) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const rules = this.scoringRules.innovation;
    const baseScore = rules[innovationData.type] || 10;
    
    // 根据影响程度调整
    let innovationScore = baseScore;
    if (innovationData.impact === 'high') {
      innovationScore *= 2;
    } else if (innovationData.impact === 'medium') {
      innovationScore *= 1.5;
    } else if (innovationData.impact === 'low') {
      innovationScore *= 0.8;
    }
    
    // 根据用户反馈调整
    if (innovationData.userFeedback) {
      const feedbackMultiplier = innovationData.userFeedback / 5; // 1-5 scale
      innovationScore *= feedbackMultiplier;
    }
    
    innovationScore = Math.round(innovationScore);
    
    // 更新分数
    score.innovationScore += innovationScore;
    score.totalScore += innovationScore;
    
    // 更新指标
    metrics.innovationCount++;
    if (innovationData.type === 'bug_fixes') {
      metrics.bugFixes++;
    } else if (innovationData.type === 'feature_requests') {
      metrics.featureRequests++;
    }
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      innovationType: innovationData.type,
      score: innovationScore,
      totalScore: score.totalScore,
      impact: innovationData.impact
    };
  }

  // 自动质量评估
  autoAssessQuality(agentId, taskId, assessmentData) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    // 计算综合质量分数
    const qualityFactors = {
      code_quality: assessmentData.codeQuality || 0,
      documentation: assessmentData.documentation || 0,
      testing: assessmentData.testing || 0,
      performance: assessmentData.performance || 0,
      user_experience: assessmentData.userExperience || 0
    };
    
    // 计算加权平均
    const weights = {
      code_quality: 0.3,
      documentation: 0.2,
      testing: 0.2,
      performance: 0.15,
      user_experience: 0.15
    };
    
    let overallQuality = 0;
    for (const [factor, value] of Object.entries(qualityFactors)) {
      overallQuality += value * weights[factor];
    }
    
    overallQuality = Math.round(overallQuality);
    
    // 更新质量分数
    const currentQuality = score.qualityScore;
    const newQuality = ((currentQuality * metrics.tasksCompleted) + overallQuality) / (metrics.tasksCompleted + 1);
    score.qualityScore = Math.round(newQuality);
    metrics.averageQuality = score.qualityScore;
    
    // 更新总分
    const qualityBonus = Math.round((overallQuality - 75) * 0.5);
    score.totalScore += qualityBonus;
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      taskId,
      overallQuality,
      qualityBreakdown: qualityFactors,
      totalScore: score.totalScore
    };
  }

  // 自动活动追踪和连击奖励
  trackAgentActivity(agentId, activityType, data = {}) {
    this.initializeAgent(agentId);
    
    const metrics = this.metrics.get(agentId);
    const score = this.scores.get(agentId);
    
    // 更新活动时间
    metrics.lastActive = new Date();
    
    // 连击系统
    const now = new Date();
    const lastActive = new Date(metrics.lastActive);
    const hoursSinceLastActivity = (now - lastActive) / (1000 * 60 * 60);
    
    if (hoursSinceLastActivity < 24) {
      metrics.currentStreak++;
      metrics.streakDays = Math.max(metrics.streakDays, metrics.currentStreak);
      
      // 连击奖励
      if (metrics.currentStreak >= 7) {
        const streakBonus = 10;
        score.totalScore += streakBonus;
        console.log(`🔥 ${agentId} 连击 ${metrics.currentStreak} 天，获得 ${streakBonus} 分奖励！`);
      }
    } else {
      metrics.currentStreak = 0;
    }
    
    // 主动性评分
    if (activityType === 'initiative') {
      metrics.initiativeScore += data.initiativeValue || 1;
      score.totalScore += data.initiativeValue || 1;
    }
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
  }

  // 自动成就解锁
  autoCheckAchievements(agentId) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const achievements = [];
    const achievementsDB = {
      task_master: {
        name: '任务大师',
        description: '完成10个任务',
        condition: () => metrics.tasksCompleted >= 10,
        points: 100,
        icon: '🏆'
      },
      task_legend: {
        name: '任务传奇',
        description: '完成50个任务',
        condition: () => metrics.tasksCompleted >= 50,
        points: 500,
        icon: '👑'
      },
      quality_excellence: {
        name: '质量卓越',
        description: '质量评分达到90+',
        condition: () => score.qualityScore >= 90,
        points: 200,
        icon: '⭐'
      },
      team_player: {
        name: '团队玩家',
        description: '协作20次',
        condition: () => metrics.collaborationFrequency >= 20,
        points: 150,
        icon: '🤝'
      },
      reliable_agent: {
        name: '可靠代理',
        description: '准时率95%+',
        condition: () => this.getReliabilityPercentage(metrics) >= 95,
        points: 175,
        icon: '🛡️'
      },
      innovator: {
        name: '创新者',
        description: '创新贡献达到200分',
        condition: () => score.innovationScore >= 200,
        points: 300,
        icon: '💡'
      },
      streak_warrior: {
        name: '连击战士',
        description: '连续活动7天',
        condition: () => metrics.currentStreak >= 7,
        points: 120,
        icon: '🔥'
      },
      helper_champion: {
        name: '帮助冠军',
        description: '帮助其他代理30次',
        condition: () => metrics.helpCount >= 30,
        points: 180,
        icon: '❤️'
      },
      code_master: {
        name: '代码大师',
        description: '代码审查50次',
        condition: () => metrics.reviewCount >= 50,
        points: 250,
        icon: '👨‍💻'
      }
    };
    
    for (const [key, achievement] of Object.entries(achievementsDB)) {
      if (achievement.condition() && !this.achievements.has(agentId)) {
        achievements.push({
          ...achievement,
          type: key,
          earnedAt: new Date()
        });
        
        // 更新分数
        score.totalScore += achievement.points;
        
        // 记录成就
        if (!this.achievements.has(agentId)) {
          this.achievements.set(agentId, []);
        }
        this.achievements.get(agentId).push({
          ...achievement,
          earnedAt: new Date()
        });
        
        console.log(`🏆 ${agentId} 解锁成就: ${achievement.name} (+${achievement.points}分)`);
      }
    }
    
    this.scores.set(agentId, score);
    
    return achievements;
  }

  // 辅助方法
  calculateQualityScore(qualityData) {
    if (typeof qualityData === 'number') {
      return qualityData;
    }
    
    const rules = this.scoringRules.quality;
    if (qualityData.excellent) return rules.excellent;
    if (qualityData.good) return rules.good;
    if (qualityData.satisfactory) return rules.satisfactory;
    if (qualityData.needs_improvement) return rules.needs_improvement;
    if (qualityData.poor) return rules.poor;
    
    return 75; // 默认分数
  }

  isTaskOnTime(task, completionData) {
    const estimatedHours = task.estimatedHours || 1;
    const actualHours = completionData.completionTime || estimatedHours;
    return actualHours <= estimatedHours;
  }

  updateReliabilityScore(agentId, isOnTime) {
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const totalTasks = metrics.tasksOnTime + metrics.tasksLate;
    const reliabilityPercentage = totalTasks > 0 ? (metrics.tasksOnTime / totalTasks) * 100 : 100;
    
    const rules = this.scoringRules.reliability;
    let reliabilityScore;
    
    if (reliabilityPercentage >= 100) reliabilityScore = rules.on_time_100;
    else if (reliabilityPercentage >= 95) reliabilityScore = rules.on_time_95;
    else if (reliabilityPercentage >= 85) reliabilityScore = rules.on_time_85;
    else if (reliabilityPercentage >= 75) reliabilityScore = rules.on_time_75;
    else if (reliabilityPercentage >= 50) reliabilityScore = rules.late_50;
    else reliabilityScore = rules.late_25;
    
    score.reliabilityScore = reliabilityScore;
    this.scores.set(agentId, score);
  }

  getReliabilityPercentage(metrics) {
    const totalTasks = metrics.tasksOnTime + metrics.tasksLate;
    return totalTasks > 0 ? (metrics.tasksOnTime / totalTasks) * 100 : 100;
  }

  getTaskScoreFactors(task, completionData, isOnTime) {
    return {
      baseScore: 100,
      qualityBonus: completionData.quality ? Math.round((completionData.quality - 75) * 0.02) : 0,
      timelinessBonus: isOnTime ? 20 : 0,
      earlyCompletionBonus: completionData.completionTime < task.estimatedHours * 0.8 ? 15 : 0,
      revisionPenalty: completionData.revisions ? completionData.revisions * -10 : 0
    };
  }

  getAgentRank(agentId) {
    const allScores = Array.from(this.scores.values());
    allScores.sort((a, b) => b.totalScore - a.totalScore);
    const rank = allScores.findIndex(score => score.agentId === agentId) + 1;
    return rank <= 20 ? rank : null;
  }

  // 获取代理分数
  getAgentScore(agentId) {
    return this.scores.get(agentId);
  }

  // 获取代理指标
  getAgentMetrics(agentId) {
    return this.metrics.get(agentId);
  }

  // 获取排行榜
  getLeaderboard() {
    const allScores = Array.from(this.scores.values());
    allScores.sort((a, b) => b.totalScore - a.totalScore);
    
    return allScores.slice(0, 20).map((score, index) => ({
      rank: index + 1,
      agentId: score.agentId,
      totalScore: score.totalScore,
      taskScore: score.taskScore,
      collaborationScore: score.collaborationScore,
      qualityScore: score.qualityScore,
      reliabilityScore: score.reliabilityScore,
      innovationScore: score.innovationScore
    }));
  }

  // 获取性能分析
  getPerformanceAnalytics() {
    const allScores = Array.from(this.scores.values());
    
    if (allScores.length === 0) {
      return {
        totalAgents: 0,
        averageScore: 0,
        topPerformer: null,
        categoryAverages: {}
      };
    }
    
    const totalScore = allScores.reduce((sum, score) => sum + score.totalScore, 0);
    const averageScore = totalScore / allScores.length;
    
    const topPerformer = allScores.reduce((top, score) => 
      score.totalScore > top.totalScore ? score : top
    );
    
    const categoryAverages = {
      task: allScores.reduce((sum, score) => sum + score.taskScore, 0) / allScores.length,
      collaboration: allScores.reduce((sum, score) => sum + score.collaborationScore, 0) / allScores.length,
      quality: allScores.reduce((sum, score) => sum + score.qualityScore, 0) / allScores.length,
      reliability: allScores.reduce((sum, score) => sum + score.reliabilityScore, 0) / allScores.length,
      innovation: allScores.reduce((sum, score) => sum + score.innovationScore, 0) / allScores.length
    };
    
    return {
      totalAgents: allScores.length,
      averageScore: Math.round(averageScore),
      topPerformer: {
        agentId: topPerformer.agentId,
        totalScore: topPerformer.totalScore
      },
      categoryAverages: categoryAverages
    };
  }
}

module.exports = AutomatedContributionScoring;