class ContributionScoringSystem {
  constructor() {
    this.scores = new Map();
    this.metrics = new Map();
    this.achievements = new Map();
    this.leaderboard = [];
  }

  // Initialize agent scoring
  initializeAgent(agentId) {
    if (!this.scores.has(agentId)) {
      this.scores.set(agentId, {
        agentId,
        totalScore: 0,
        taskScore: 0,
        collaborationScore: 0,
        qualityScore: 0,
        reliabilityScore: 0,
        innovationScore: 0,
        lastUpdated: new Date()
      });
      
      this.metrics.set(agentId, {
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
        initiativeScore: 0
      });
    }
  }

  // Task-based scoring
  scoreTaskCompletion(agentId, task, qualityScore, completionTime, wasOnTime) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    // Base task completion score
    let taskScore = 100;
    
    // Quality bonus/penalty
    if (qualityScore >= 95) taskScore += 50;  // Excellent
    else if (qualityScore >= 85) taskScore += 25;  // Good
    else if (qualityScore >= 75) taskScore += 10;  // Satisfactory
    else if (qualityScore < 60) taskScore -= 30;   // Poor
    
    // Timeliness bonus
    if (wasOnTime) {
      taskScore += 20;
      metrics.tasksOnTime++;
    } else {
      taskScore -= 15;
      metrics.tasksLate++;
    }
    
    // Quick completion bonus
    if (completionTime < task.estimatedHours * 0.8) {
      taskScore += 15;
    }
    
    // Update scores
    score.taskScore += taskScore;
    score.qualityScore = ((score.qualityScore * metrics.tasksCompleted) + qualityScore) / (metrics.tasksCompleted + 1);
    score.totalScore += taskScore;
    
    // Update metrics
    metrics.tasksCompleted++;
    metrics.averageQuality = score.qualityScore;
    
    // Update reliability score
    this.updateReliabilityScore(agentId, wasOnTime);
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      taskScore,
      qualityScore,
      totalScore: score.totalScore,
      rank: this.getAgentRank(agentId)
    };
  }

  // Collaboration scoring
  scoreCollaboration(agentId1, agentId2, action, quality = 1.0) {
    this.initializeAgent(agentId1);
    this.initializeAgent(agentId2);
    
    const score1 = this.scores.get(agentId1);
    const score2 = this.scores.get(agentId2);
    const metrics1 = this.metrics.get(agentId1);
    const metrics2 = this.metrics.get(agentId2);
    
    const actionScores = {
      'peer_review': 15,
      'code_help': 20,
      'mentorship': 30,
      'knowledge_sharing': 10,
      'innovation_contribution': 25,
      'conflict_resolution': 35
    };
    
    const baseScore = actionScores[action] || 5;
    const collaborationScore = Math.round(baseScore * quality);
    
    // Update both agents
    score1.collaborationScore += collaborationScore;
    score2.collaborationScore += collaborationScore;
    score1.totalScore += collaborationScore;
    score2.totalScore += collaborationScore;
    
    // Update metrics
    metrics1.collaborationFrequency++;
    metrics2.collaborationFrequency++;
    
    if (action === 'peer_review') {
      metrics1.peerReviews++;
      metrics2.peerReviews++;
    }
    
    if (action === 'mentorship') {
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
      totalScore2: score2.totalScore
    };
  }

  // Quality assessment
  assessTaskQuality(agentId, task, assessment) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const qualityFactors = {
      'code_quality': 0.4,
      'documentation': 0.2,
      'testing': 0.2,
      'performance': 0.1,
      'user_experience': 0.1
    };
    
    let overallQuality = 0;
    
    for (const [factor, weight] of Object.entries(qualityFactors)) {
      const factorScore = assessment[factor] || 0;
      overallQuality += factorScore * weight;
    }
    
    // Update quality score with weighted average
    const currentQuality = score.qualityScore;
    const newQuality = ((currentQuality * metrics.tasksCompleted) + overallQuality) / (metrics.tasksCompleted + 1);
    
    score.qualityScore = newQuality;
    score.totalScore += Math.round((overallQuality - 75) * 2); // Bonus/penalty
    
    metrics.averageQuality = newQuality;
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      overallQuality: Math.round(overallQuality),
      qualityScore: Math.round(newQuality),
      rank: this.getAgentRank(agentId)
    };
  }

  // Reliability scoring
  updateReliabilityScore(agentId, wasOnTime) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const onTimeRatio = metrics.tasksOnTime / (metrics.tasksOnTime + metrics.tasksLate);
    
    // Calculate reliability score (0-100)
    let reliabilityScore = Math.round(onTimeRatio * 100);
    
    // Bonus for consistent performance
    if (onTimeRatio >= 0.95) reliabilityScore += 10;
    else if (onTimeRatio >= 0.85) reliabilityScore += 5;
    else if (onTimeRatio < 0.7) reliabilityScore -= 15;
    
    score.reliabilityScore = reliabilityScore;
    
    this.scores.set(agentId, score);
  }

  // Innovation scoring
  scoreInnovation(agentId, innovationType, impact) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const innovationScores = {
      'new_feature': 30,
      'performance_improvement': 25,
      'algorithm_optimization': 35,
      'automation': 40,
      'creative_solution': 45
    };
    
    const baseScore = innovationScores[innovationType] || 10;
    const impactMultiplier = Math.max(0.5, Math.min(2.0, impact));
    
    const innovationScore = Math.round(baseScore * impactMultiplier);
    
    score.innovationScore += innovationScore;
    score.totalScore += innovationScore;
    
    metrics.featureRequests++;
    
    this.scores.set(agentId, score);
    this.metrics.set(agentId, metrics);
    
    return {
      agentId,
      innovationType,
      score: innovationScore,
      totalScore: score.totalScore
    };
  }

  // Achievement system
  checkAchievements(agentId) {
    this.initializeAgent(agentId);
    
    const score = this.scores.get(agentId);
    const metrics = this.metrics.get(agentId);
    
    const achievements = [];
    
    // Task completion achievements
    if (metrics.tasksCompleted >= 10) {
      achievements.push({
        type: 'task_master',
        name: 'Task Master',
        description: 'Completed 10 tasks',
        points: 100
      });
    }
    
    if (metrics.tasksCompleted >= 50) {
      achievements.push({
        type: 'task_legend',
        name: 'Task Legend',
        description: 'Completed 50 tasks',
        points: 500
      });
    }
    
    // Quality achievements
    if (score.qualityScore >= 90) {
      achievements.push({
        type: 'quality_excellence',
        name: 'Quality Excellence',
        description: 'Maintained 90%+ quality score',
        points: 200
      });
    }
    
    // Collaboration achievements
    if (metrics.collaborationFrequency >= 20) {
      achievements.push({
        type: 'team_player',
        name: 'Team Player',
        description: 'Collaborated 20 times',
        points: 150
      });
    }
    
    // Reliability achievements
    if (score.reliabilityScore >= 95) {
      achievements.push({
        type: 'reliable_agent',
        name: 'Reliable Agent',
        description: '95%+ on-time completion',
        points: 175
      });
    }
    
    // Innovation achievements
    if (score.innovationScore >= 200) {
      achievements.push({
        type: 'innovator',
        name: 'Innovator',
        description: 'Significant innovation contributions',
        points: 300
      });
    }
    
    // Award achievements
    achievements.forEach(achievement => {
      if (!this.achievements.has(agentId) || 
          !this.achievements.get(agentId).some(a => a.type === achievement.type)) {
        
        score.totalScore += achievement.points;
        
        if (!this.achievements.has(agentId)) {
          this.achievements.set(agentId, []);
        }
        
        this.achievements.get(agentId).push({
          ...achievement,
          earnedAt: new Date()
        });
        
        console.log(`🏆 Achievement unlocked: ${achievement.name} (+${achievement.points} points)`);
      }
    });
    
    this.scores.set(agentId, score);
    
    return achievements;
  }

  // Leaderboard management
  updateLeaderboard() {
    const allScores = Array.from(this.scores.values());
    
    this.leaderboard = allScores
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((score, index) => ({
        rank: index + 1,
        agentId: score.agentId,
        totalScore: score.totalScore,
        taskScore: score.taskScore,
        collaborationScore: score.collaborationScore,
        qualityScore: score.qualityScore,
        reliabilityScore: score.reliabilityScore,
        innovationScore: score.innovationScore
      }))
      .slice(0, 20); // Top 20
  }

  getAgentRank(agentId) {
    const agent = this.leaderboard.find(a => a.agentId === agentId);
    return agent ? agent.rank : null;
  }

  getAgentScore(agentId) {
    return this.scores.get(agentId);
  }

  getAgentMetrics(agentId) {
    return this.metrics.get(agentId);
  }

  getLeaderboard() {
    this.updateLeaderboard();
    return this.leaderboard;
  }

  getTopPerformers(category = 'all', limit = 10) {
    let performers = Array.from(this.scores.values());
    
    if (category !== 'all') {
      performers = performers.filter(score => score[category + 'Score']);
      performers.sort((a, b) => b[category + 'Score'] - a[category + 'Score']);
    } else {
      performers.sort((a, b) => b.totalScore - a.totalScore);
    }
    
    return performers.slice(0, limit);
  }

  // Performance analytics
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

module.exports = ContributionScoringSystem;