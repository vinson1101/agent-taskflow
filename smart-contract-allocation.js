class SmartContractTaskAllocation {
  constructor() {
    this.contracts = new Map();
    this.contractTemplates = new Map();
    this.activeContracts = new Map();
    this.contractHistory = new Map();
    this.allocationStrategies = {
      'skill_based': this.skillBasedAllocation.bind(this),
      'performance_based': this.performanceBasedAllocation.bind(this),
      'collaboration_based': this.collaborationBasedAllocation.bind(this),
      'hybrid': this.hybridAllocation.bind(this)
    };
    
    this.initializeContractTemplates();
  }

  // 初始化智能合约模板
  initializeContractTemplates() {
    // 固定价格合约
    this.addContractTemplate('fixed_price', '固定价格合约', {
      type: 'fixed',
      paymentStructure: 'upfront',
      riskLevel: 'low',
      requirements: ['明确任务范围', '固定交付物', '验收标准明确'],
      disputeResolution: 'mediation'
    });

    // 时间材料合约
    this.addContractTemplate('time_materials', '时间材料合约', {
      type: 'time_materials',
      paymentStructure: 'hourly',
      riskLevel: 'medium',
      requirements: ['工时记录', '进度报告', '定期沟通'],
      disputeResolution: 'arbitration'
    });

    // 里程碑合约
    this.addContractTemplate('milestone', '里程碑合约', {
      type: 'milestone',
      paymentStructure: 'deliverable',
      riskLevel: 'medium',
      requirements: ['里程碑定义', '验收标准', '进度跟踪'],
      disputeResolution: 'escrow'
    });

    // 竞标合约
    this.addContractTemplate('auction', '竞标合约', {
      type: 'auction',
      paymentStructure: 'competitive',
      riskLevel: 'high',
      requirements: ['竞标规则', '资质审核', '价格评估'],
      disputeResolution: 'arbitration'
    });

    // 合作伙伴合约
    this.addContractTemplate('partnership', '合作伙伴合约', {
      type: 'partnership',
      paymentStructure: 'profit_sharing',
      riskLevel: 'medium',
      requirements: ['长期合作', '利益共享', '风险共担'],
      disputeResolution: 'consensus'
    });

    // 风险投资合约
    this.addContractTemplate('venture', '风险投资合约', {
      type: 'venture',
      paymentStructure: 'equity_based',
      riskLevel: 'high',
      requirements: ['项目潜力评估', '股权分配', '退出机制'],
      disputeResolution: 'arbitration'
    });
  }

  // 添加合约模板
  addContractTemplate(id, name, config) {
    this.contractTemplates.set(id, {
      id,
      name,
      ...config,
      createdAt: new Date(),
      usageCount: 0
    });
  }

  // 创建智能合约
  createContract(taskId, contractType, allocationStrategy, terms = {}) {
    const template = this.contractTemplates.get(contractType);
    if (!template) {
      throw new Error(`Unknown contract type: ${contractType}`);
    }

    const contractId = this.generateContractId();
    const contract = {
      id: contractId,
      taskId,
      contractType,
      allocationStrategy,
      terms: {
        ...template,
        ...terms,
        createdAt: new Date(),
        status: 'draft',
        parties: [],
        deliverables: [],
        milestones: [],
        paymentSchedule: [],
        penalties: [],
        incentives: []
      }
    };

    this.contracts.set(contractId, contract);
    return contract;
  }

  // 智能合约分配
  async allocateContract(contractId, candidates, strategy = 'hybrid') {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error('Contract not found');
    }

    const allocationFunction = this.allocationStrategies[strategy];
    if (!allocationFunction) {
      throw new Error(`Unknown allocation strategy: ${strategy}`);
    }

    const allocationResult = await allocationFunction(contract, candidates);
    
    // 创建合约实例
    const activeContract = {
      ...contract,
      allocationResult,
      status: 'active',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天后过期
      arbitration: {
        enabled: true,
        neutralParty: null,
        disputeCount: 0,
        resolutionTime: 0
      }
    };

    this.activeContracts.set(contractId, activeContract);
    this.contractHistory.set(contractId, []);
    
    return activeContract;
  }

  // 基于技能的分配
  async skillBasedAllocation(contract, candidates) {
    console.log('🎯 基于技能的智能合约分配');
    
    const task = this.getTaskById(contract.taskId);
    const skillWeights = this.calculateSkillWeights(task.skills);
    
    const scoredCandidates = candidates.map(candidate => {
      const skillScore = this.calculateCandidateSkillScore(candidate, task.skills, skillWeights);
      const experienceScore = this.calculateExperienceScore(candidate, task.taskType);
      const availabilityScore = this.calculateAvailabilityScore(candidate);
      
      const totalScore = (skillScore * 0.5) + (experienceScore * 0.3) + (availabilityScore * 0.2);
      
      return {
        candidate: candidate,
        score: totalScore,
        breakdown: {
          skillScore,
          experienceScore,
          availabilityScore
        },
        recommendation: this.generateSkillRecommendation(candidate, task, skillScore)
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'skill_based',
      topCandidate: scoredCandidates[0] || null,
      ranking: scoredCandidates,
      confidence: scoredCandidates[0]?.score || 0,
      reasoning: this.generateSkillAllocationReasoning(scoredCandidates, task)
    };
  }

  // 基于绩效的分配
  async performanceBasedAllocation(contract, candidates) {
    console.log('📊 基于绩效的智能合约分配');
    
    const scoredCandidates = candidates.map(candidate => {
      const performanceScore = this.calculatePerformanceScore(candidate);
      const reliabilityScore = this.calculateReliabilityScore(candidate);
      const qualityScore = this.calculateQualityScore(candidate);
      
      const totalScore = (performanceScore * 0.4) + (reliabilityScore * 0.3) + (qualityScore * 0.3);
      
      return {
        candidate: candidate,
        score: totalScore,
        breakdown: {
          performanceScore,
          reliabilityScore,
          qualityScore
        },
        recommendation: this.generatePerformanceRecommendation(candidate, totalScore)
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'performance_based',
      topCandidate: scoredCandidates[0] || null,
      ranking: scoredCandidates,
      confidence: scoredCandidates[0]?.score || 0,
      reasoning: this.generatePerformanceAllocationReasoning(scoredCandidates)
    };
  }

  // 基于协作的分配
  async collaborationBasedAllocation(contract, candidates) {
    console.log('🤝 基于协作的智能合约分配');
    
    const task = this.getTaskById(contract.taskId);
    const collaborationScores = this.calculateCollaborationScores(candidates, task);
    
    const scoredCandidates = candidates.map(candidate => {
      const collaborationScore = collaborationScores.get(candidate.id) || 0;
      const teamFitScore = this.calculateTeamFitScore(candidate, task);
      const communicationScore = this.calculateCommunicationScore(candidate);
      
      const totalScore = (collaborationScore * 0.5) + (teamFitScore * 0.3) + (communicationScore * 0.2);
      
      return {
        candidate: candidate,
        score: totalScore,
        breakdown: {
          collaborationScore,
          teamFitScore,
          communicationScore
        },
        recommendation: this.generateCollaborationRecommendation(candidate, totalScore)
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'collaboration_based',
      topCandidate: scoredCandidates[0] || null,
      ranking: scoredCandidates,
      confidence: scoredCandidates[0]?.score || 0,
      reasoning: this.generateCollaborationAllocationReasoning(scoredCandidates, task)
    };
  }

  // 混合分配策略
  async hybridAllocation(contract, candidates) {
    console.log('🔄 混合智能合约分配');
    
    const skillResult = await this.skillBasedAllocation(contract, candidates);
    const performanceResult = await this.performanceBasedAllocation(contract, candidates);
    const collaborationResult = await this.collaborationBasedAllocation(contract, candidates);
    
    const hybridScores = candidates.map(candidate => {
      const skillScore = skillResult.ranking.find(r => r.candidate.id === candidate.id)?.score || 0;
      const performanceScore = performanceResult.ranking.find(r => r.candidate.id === candidate.id)?.score || 0;
      const collaborationScore = collaborationResult.ranking.find(r => r.candidate.id === candidate.id)?.score || 0;
      
      const totalScore = (skillScore * 0.4) + (performanceScore * 0.3) + (collaborationScore * 0.3);
      
      return {
        candidate: candidate,
        score: totalScore,
        breakdown: {
          skillScore,
          performanceScore,
          collaborationScore
        },
        recommendation: this.generateHybridRecommendation(candidate, totalScore)
      };
    });

    hybridScores.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'hybrid',
      topCandidate: hybridScores[0] || null,
      ranking: hybridScores,
      confidence: hybridScores[0]?.score || 0,
      reasoning: this.generateHybridAllocationReasoning(hybridScores, {
        skill: skillResult,
        performance: performanceResult,
        collaboration: collaborationResult
      })
    };
  }

  // 辅助方法
  calculateSkillWeights(skills) {
    const weights = {};
    const totalSkills = skills.length;
    
    skills.forEach((skill, index) => {
      // 后续技能权重递减
      weights[skill] = Math.max(0.3, 1 - (index * 0.1));
    });
    
    return weights;
  }

  calculateCandidateSkillScore(candidate, requiredSkills, skillWeights) {
    if (!candidate.skills || !requiredSkills) return 0;
    
    let totalScore = 0;
    let maxPossibleScore = 0;
    
    requiredSkills.forEach(skill => {
      const weight = skillWeights[skill] || 0.5;
      const hasSkill = candidate.skills.includes(skill);
      
      if (hasSkill) {
        totalScore += weight;
      }
      maxPossibleScore += weight;
    });
    
    return maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
  }

  calculateExperienceScore(candidate, taskType) {
    if (!candidate.experience || !candidate.experience[taskType]) return 50;
    
    const experience = candidate.experience[taskType];
    const baseScore = 50;
    const experienceBonus = Math.min(experience.years * 10, 50);
    const projectBonus = Math.min(experience.projects * 5, 30);
    
    return baseScore + experienceBonus + projectBonus;
  }

  calculateAvailabilityScore(candidate) {
    if (!candidate.availability) return 75;
    
    const availability = candidate.availability;
    const baseScore = 75;
    
    if (availability.immediate) return baseScore + 25;
    if (availability.withinWeek) return baseScore + 15;
    if (availability.withinMonth) return baseScore;
    return baseScore - 25;
  }

  calculatePerformanceScore(candidate) {
    if (!candidate.performance) return 75;
    
    const performance = candidate.performance;
    const baseScore = 75;
    
    const completionRate = (performance.tasksCompleted / performance.tasksAssigned) * 100;
    const onTimeRate = performance.tasksOnTime / performance.tasksCompleted;
    
    return baseScore + (completionRate * 0.3) + (onTimeRate * 25);
  }

  calculateReliabilityScore(candidate) {
    if (!candidate.reliability) return 75;
    
    const reliability = candidate.reliability;
    const baseScore = 75;
    
    const consistencyScore = (reliability.consistentTasks / reliability.totalTasks) * 100;
    const revisionRate = reliability.revisions / reliability.totalTasks;
    
    return baseScore + (consistencyScore * 0.4) - (revisionRate * 20);
  }

  calculateQualityScore(candidate) {
    if (!candidate.quality) return 75;
    
    const quality = candidate.quality;
    const baseScore = 75;
    
    const qualityScore = (quality.averageScore / 100) * 100;
    const improvementRate = quality.improvementRate || 0;
    
    return baseScore + (qualityScore * 0.5) + (improvementRate * 25);
  }

  calculateCollaborationScores(candidates, task) {
    const scores = new Map();
    
    candidates.forEach(candidate => {
      if (candidate.collaboration) {
        const collaboration = candidate.collaboration;
        const score = (collaboration.helpCount * 2) + 
                     (collaboration.mentorship * 3) + 
                     (collaboration.teamwork * 1.5);
        scores.set(candidate.id, Math.min(score, 100));
      } else {
        scores.set(candidate.id, 50);
      }
    });
    
    return scores;
  }

  calculateTeamFitScore(candidate, task) {
    if (!candidate.personality || !task.requirements) return 75;
    
    const personality = candidate.personality;
    const requirements = task.requirements;
    
    let fitScore = 75;
    
    if (requirements.collaborative && personality.teamOriented) {
      fitScore += 15;
    }
    
    if (requirements.independent && personality.selfDirected) {
      fitScore += 15;
    }
    
    if (requirements.creative && personality.innovative) {
      fitScore += 10;
    }
    
    if (requirements.detailOriented && personality.attentive) {
      fitScore += 10;
    }
    
    return Math.min(fitScore, 100);
  }

  calculateCommunicationScore(candidate) {
    if (!candidate.communication) return 75;
    
    const communication = candidate.communication;
    const baseScore = 75;
    
    const clarityScore = communication.clarity || 75;
    const responsivenessScore = communication.responsiveness || 75;
    const collaborationScore = communication.collaboration || 75;
    
    return baseScore + (clarityScore * 0.3) + (responsivenessScore * 0.3) + (collaborationScore * 0.4);
  }

  // 推荐生成方法
  generateSkillRecommendation(candidate, task, skillScore) {
    if (skillScore >= 90) return `高度匹配：${candidate.name} 完全具备所需技能`;
    if (skillScore >= 70) return `良好匹配：${candidate.name} 具备大部分所需技能`;
    if (skillScore >= 50) return `基本匹配：${candidate.name} 具备部分所需技能`;
    return `需要培训：${candidate.name} 需要额外技能培训`;
  }

  generatePerformanceRecommendation(candidate, totalScore) {
    if (totalScore >= 90) return `优秀表现：${candidate.name} 历史表现卓越`;
    if (totalScore >= 75) return `良好表现：${candidate.name} 历史表现良好`;
    if (totalScore >= 60) return `一般表现：${candidate.name} 历史表现一般`;
    return `需要改进：${candidate.name} 历史表现需要改进`;
  }

  generateCollaborationRecommendation(candidate, totalScore) {
    if (totalScore >= 90) return `优秀协作者：${candidate.name} 团队合作能力极强`;
    if (totalScore >= 75) return `良好协作者：${candidate.name} 团队合作能力强`;
    if (totalScore >= 60) return `基本协作者：${candidate.name} 团队合作能力一般`;
    return `需要改进：${candidate.name} 团队合作能力需要提升`;
  }

  generateHybridRecommendation(candidate, totalScore) {
    if (totalScore >= 90) return `综合优秀：${candidate.name} 在所有方面表现卓越`;
    if (totalScore >= 75) return `综合良好：${candidate.name} 在各方面表现良好`;
    if (totalScore >= 60) return `综合一般：${candidate.name} 在各方面表现一般`;
    return `需要提升：${candidate.name} 在各方面需要提升`;
  }

  // 推理生成方法
  generateSkillAllocationReasoning(ranking, task) {
    const top = ranking[0];
    return `基于技能匹配度：${top.candidate.name} 以 ${top.score.toFixed(1)}% 的技能匹配度排名第一。主要优势在于 ${task.skills.join('、')} 等核心技能的掌握程度。`;
  }

  generatePerformanceAllocationReasoning(ranking) {
    const top = ranking[0];
    return `基于历史绩效：${top.candidate.name} 以 ${top.score.toFixed(1)}% 的综合绩效评分排名第一。在任务完成率、准时率和质量方面均有出色表现。`;
  }

  generateCollaborationAllocationReasoning(ranking, task) {
    const top = ranking[0];
    return `基于协作能力：${top.candidate.name} 以 ${top.score.toFixed(1)}% 的协作评分排名第一。特别适合 ${task.requirements?.collaborative ? '团队协作' : '独立工作'} 的任务需求。`;
  }

  generateHybridAllocationReasoning(ranking, results) {
    const top = ranking[0];
    return `基于综合评估：${top.candidate.name} 以 ${top.score.toFixed(1)}% 的综合评分排名第一。在技能匹配、历史绩效和协作能力三个维度上表现均衡优秀。`;
  }

  // 工具方法
  generateContractId() {
    return `contract_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  getTaskById(taskId) {
    // 这里应该从任务系统获取任务
    // 简化实现
    return {
      id: taskId,
      skills: ['javascript', 'react'],
      taskType: 'web_development',
      requirements: { collaborative: true }
    };
  }

  // 获取合约统计
  getContractStatistics() {
    const stats = {
      total: this.contracts.size,
      active: this.activeContracts.size,
      byType: {},
      byStrategy: {},
      averageConfidence: 0,
      totalValue: 0
    };
    
    let totalConfidence = 0;
    let totalValue = 0;
    
    for (const contract of this.contracts.values()) {
      // 按类型统计
      stats.byType[contract.contractType] = (stats.byType[contract.contractType] || 0) + 1;
      
      // 按策略统计
      stats.byStrategy[contract.allocationStrategy] = (stats.byStrategy[contract.allocationStrategy] || 0) + 1;
      
      // 计算平均值
      if (contract.terms.value) {
        totalValue += contract.terms.value;
      }
    }
    
    stats.averageConfidence = totalConfidence / this.contracts.size;
    stats.totalValue = totalValue;
    
    return stats;
  }
}

module.exports = SmartContractTaskAllocation;
