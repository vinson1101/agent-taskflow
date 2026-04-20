const USDCPaymentManager = require('./usdc-payment');
// const AgentCollaborationSystem = require('./agent-collaboration');
// const ContributionScoringSystem = require('./contribution-scoring');

class AgentTaskFlow {
  constructor() {
    this.tasks = new Map();
    this.agents = new Map();
    this.payments = new Map();
    this.taskIdCounter = 1;
    this.agentIdCounter = 1;
    
    // Initialize subsystems
    this.paymentManager = new USDCPaymentManager();
    this.collaborationSystem = null;
    this.contributionScoring = null;
  }

  // Task Management
  createTask(description, priority = 'medium', estimatedHours = 1) {
    const taskId = `task_${this.taskIdCounter++}`;
    const task = {
      id: taskId,
      description,
      priority,
      estimatedHours,
      status: 'pending',
      createdAt: new Date(),
      assignedTo: null,
      completedAt: null,
      paymentStatus: 'pending'
    };
    
    this.tasks.set(taskId, task);
    return task;
  }

  assignTask(taskId, agentId) {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    
    if (!task || !agent) {
      throw new Error('Task or agent not found');
    }
    
    task.assignedTo = agentId;
    task.status = 'assigned';
    return task;
  }

  updateTaskProgress(taskId, progress, status) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    task.progress = progress;
    task.status = status;
    
    if (status === 'completed') {
      task.completedAt = new Date();
    }
    
    return task;
  }

  // Agent Management
  registerAgent(name, capabilities = [], hourlyRate = 50, walletAddress = null) {
    const agentId = `agent_${this.agentIdCounter++}`;
    const agent = {
      id: agentId,
      name,
      capabilities,
      hourlyRate,
      walletAddress,
      status: 'available',
      currentTask: null
    };
    
    this.agents.set(agentId, agent);
    
    // Register agent wallet with payment system
    if (walletAddress && this.paymentManager) {
      this.paymentManager.registerAgentWallet(agentId, walletAddress);
    }
    
    // Placeholder for collaboration and scoring systems
    // this.collaborationSystem.registerAgent(agent);
    // this.contributionScoring.initializeAgent(agentId);
    
    return agent;
  }

  // Smart Task Assignment
  async autoAssignTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') {
      throw new Error('Task not available for assignment');
    }
    
    // Check if task requires collaboration
    const requiredSkills = this.extractRequiredSkills(task.description);
    const needsCollaboration = requiredSkills.length > 2 || task.priority === 'critical';
    
    if (needsCollaboration) {
      // Use collaborative assignment
      const result = await this.collaborationSystem.assignCollaborativeTask(task);
      return result;
    } else {
      // Use individual assignment
      const suitableAgents = Array.from(this.agents.values())
        .filter(agent => agent.status === 'available')
        .filter(agent => this.hasMatchingCapabilities(task, agent));
      
      if (suitableAgents.length === 0) {
        throw new Error('No suitable agents available');
      }
      
      // Select agent with best match based on score and availability
      const selectedAgent = suitableAgents.reduce((best, agent) => {
        const currentScore = agent.reputation || 50;
        const bestScore = best.reputation || 50;
        return currentScore > bestScore ? agent : best;
      });
      
      return this.assignTask(taskId, selectedAgent.id);
    }
  }

  // Initialize payment system
  async initializePayments(platformPrivateKey) {
    try {
      const success = await this.paymentManager.initializePlatformWallet(platformPrivateKey);
      if (success) {
        console.log('✅ Payment system initialized successfully');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Payment system initialization failed:', error.message);
      return false;
    }
  }

  // Process task payment
  async processTaskPayment(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'completed') {
      throw new Error('Task not completed or not found');
    }
    
    if (!task.assignedTo) {
      throw new Error('Task not assigned to any agent');
    }
    
    const agent = this.agents.get(task.assignedTo);
    if (!agent) {
      throw new Error('Agent not found');
    }
    
    if (!agent.walletAddress) {
      throw new Error('Agent wallet address not registered');
    }
    
    // Calculate payment amount
    const paymentAmount = await this.paymentManager.estimatePayment(task);
    
    // Process payment
    const paymentResult = await this.paymentManager.payAgent(task.assignedTo, paymentAmount);
    
    if (paymentResult.success) {
      task.paymentStatus = 'completed';
      task.paymentTransaction = paymentResult.transactionHash;
      console.log(`✅ Task payment processed: ${paymentAmount} USDC to ${agent.name}`);
      
      return {
        success: true,
        payment: paymentResult,
        agent: agent,
        amount: paymentAmount
      };
    } else {
      task.paymentStatus = 'failed';
      console.error(`❌ Task payment failed: ${paymentResult.error}`);
      
      return {
        success: false,
        error: paymentResult.error,
        agent: agent,
        amount: paymentAmount
      };
    }
  }

  // Batch process payments for multiple tasks
  async batchProcessPayments(taskIds) {
    const results = [];
    
    for (const taskId of taskIds) {
      try {
        const result = await this.processTaskPayment(taskId);
        results.push({
          taskId,
          ...result
        });
        
        // Add delay to avoid gas limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        results.push({
          taskId,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  extractRequiredSkills(description) {
    const skillKeywords = {
      'javascript': ['javascript', 'js', 'node.js', 'frontend'],
      'python': ['python', 'django', 'flask', 'backend'],
      'design': ['design', 'ui', 'ux', 'frontend', 'interface'],
      'blockchain': ['blockchain', 'usdc', 'ethereum', 'web3'],
      'database': ['database', 'sql', 'mongodb', 'postgres'],
      'api': ['api', 'rest', 'graphql', 'endpoint'],
      'testing': ['testing', 'test', 'qa', 'unit'],
      'devops': ['devops', 'docker', 'kubernetes', 'ci/cd']
    };

    const foundSkills = [];
    const descLower = description.toLowerCase();
    
    for (const [skill, keywords] of Object.entries(skillKeywords)) {
      if (keywords.some(keyword => descLower.includes(keyword))) {
        foundSkills.push(skill);
      }
    }
    
    return foundSkills;
  }

  hasMatchingCapabilities(task, agent) {
    // Simple capability matching - in real implementation this would be more sophisticated
    const taskKeywords = this.extractKeywords(task.description);
    return agent.capabilities.some(cap => 
      taskKeywords.some(keyword => keyword.toLowerCase().includes(cap.toLowerCase()))
    );
  }

  extractKeywords(text) {
    return text.toLowerCase().split(/\s+/).filter(word => word.length > 3);
  }

  // USDC Payment Integration (simulated)
  async processPayment(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'completed') {
      throw new Error('Task not completed or not found');
    }
    
    if (task.paymentStatus === 'paid') {
      throw new Error('Task already paid');
    }
    
    // Handle individual vs team payments
    let agentIds = [];
    if (task.assignedTeam) {
      // Team payment - distribute based on contribution
      // const team = this.collaborationSystem.teams.get(task.assignedTeam);
      // agentIds = team.members;
      agentIds = [task.assignedTo]; // Placeholder
    } else {
      // Individual payment
      agentIds = [task.assignedTo];
    }
    
    // Calculate and process payments for each agent
    const payments = [];
    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;
      
      // Calculate payment with bonuses
      const paymentAmount = task.estimatedHours * agent.hourlyRate;
      
      // Simulate USDC payment
      const payment = {
        id: `payment_${Date.now()}_${agentId}`,
        taskId,
        agentId,
        amount: paymentAmount,
        currency: 'USDC',
        status: 'completed',
        processedAt: new Date(),
        transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`
      };
      
      payments.push(payment);
      
      // Update payment status
      task.paymentStatus = 'paid';
    }
    
    this.payments.set(payments[0].id, payments);
    
    return payments;
  }

  // Task Completion with Quality Assessment
  async completeTask(taskId, qualityScore = 80, completionNotes = '') {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    if (task.status === 'completed') {
      throw new Error('Task already completed');
    }
    
    task.status = 'completed';
    task.completedAt = new Date();
    task.qualityScore = qualityScore;
    task.completionNotes = completionNotes;
    
    // Placeholder for scoring system
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        // Update agent reputation based on quality
        const reputationBoost = Math.round((qualityScore - 75) / 5);
        agent.reputation = (agent.reputation || 50) + reputationBoost;
        
        console.log(`🏆 ${agent.name} completed task with ${qualityScore}% quality (+${reputationBoost} reputation)`);
      }
    }
    
    return task;
  }

  calculateCompletionTime(task) {
    if (!task.createdAt || !task.completedAt) {
      return task.estimatedHours;
    }
    
    const start = new Date(task.createdAt);
    const end = new Date(task.completedAt);
    const hoursDiff = (end - start) / (1000 * 60 * 60);
    
    return Math.max(0.1, hoursDiff); // Minimum 0.1 hours
  }

  // Collaboration Features (placeholder)
  async sendMessage(fromAgentId, toAgentId, message, taskId) {
    const communication = {
      id: `msg_${Date.now()}`,
      from: fromAgentId,
      to: toAgentId,
      message,
      taskId,
      timestamp: new Date(),
      type: 'direct_message'
    };
    
    console.log(`💬 Message from ${fromAgentId} to ${toAgentId}: ${message}`);
    return communication;
  }

  async sendTeamMessage(teamId, fromAgentId, message) {
    console.log(`👥 Team message from ${fromAgentId} to team ${teamId}: ${message}`);
    return [{ id: `team_msg_${Date.now()}`, message, timestamp: new Date() }];
  }

  // Contribution and Scoring (placeholder)
  assessTaskQuality(agentId, taskId, assessment) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    const qualityScore = assessment.overall || 80;
    console.log(`📊 Quality assessment for ${agentId}: ${qualityScore}%`);
    
    return { agentId, qualityScore, taskId };
  }

  scoreCollaboration(agentId1, agentId2, action, quality = 1.0) {
    console.log(`🤝 Collaboration scored: ${agentId1} & ${agentId2} - ${action}`);
    return { agentId1, agentId2, action, score: Math.round(10 * quality) };
  }

  scoreInnovation(agentId, innovationType, impact) {
    console.log(`💡 Innovation scored: ${agentId} - ${innovationType} (impact: ${impact})`);
    return { agentId, innovationType, score: Math.round(20 * impact) };
  }

  // Query and Statistics
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status) {
    return this.getAllTasks().filter(task => task.status === status);
  }

  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  getAllAgents() {
    return Array.from(this.agents.values());
  }

  getTaskStatistics() {
    const allTasks = this.getAllTasks();
    const stats = {
      total: allTasks.length,
      pending: allTasks.filter(t => t.status === 'pending').length,
      assigned: allTasks.filter(t => t.status === 'assigned').length,
      inProgress: allTasks.filter(t => t.status === 'in_progress').length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      paid: allTasks.filter(t => t.paymentStatus === 'paid').length,
      teamTasks: allTasks.filter(t => t.assignedTeam).length,
      individualTasks: allTasks.filter(t => !t.assignedTeam).length
    };
    
    return stats;
  }

  // Advanced Analytics (placeholder)
  getCollaborationStats() {
    return {
      totalCollaborations: 0,
      activeTeams: 0,
      topCollaborators: [],
      teamPerformance: []
    };
  }

  getContributionAnalytics() {
    return {
      totalAgents: this.agents.size,
      averageScore: 75,
      topPerformer: null,
      categoryAverages: {
        task: 75,
        collaboration: 70,
        quality: 80,
        reliability: 85,
        innovation: 65
      }
    };
  }

  getLeaderboard() {
    return Array.from(this.agents.values())
      .sort((a, b) => (b.reputation || 50) - (a.reputation || 50))
      .slice(0, 10)
      .map((agent, index) => ({
        rank: index + 1,
        agentId: agent.id,
        totalScore: agent.reputation || 50,
        taskScore: 70,
        collaborationScore: 60,
        qualityScore: 80,
        reliabilityScore: 85,
        innovationScore: 65
      }));
  }

  getTopPerformers(category = 'all', limit = 10) {
    return this.getLeaderboard().slice(0, limit);
  }

  getAgentScore(agentId) {
    const agent = this.agents.get(agentId);
    return {
      agentId,
      totalScore: agent?.reputation || 50,
      taskScore: 70,
      collaborationScore: 60,
      qualityScore: 80,
      reliabilityScore: 85,
      innovationScore: 65
    };
  }

  getAgentMetrics(agentId) {
    return {
      tasksCompleted: 0,
      tasksOnTime: 0,
      tasksLate: 0,
      revisionsNeeded: 0,
      peerReviews: 0,
      mentorship: 0,
      codeCommits: 0,
      bugFixes: 0,
      featureRequests: 0,
      averageQuality: 80,
      collaborationFrequency: 0,
      initiativeScore: 0
    };
  }

  // OpenClaw Interface
  async executeCommand(command, params) {
    switch (command) {
      case 'create_task':
        return this.createTask(params.description, params.priority, params.estimatedHours);
      
      case 'assign_task':
        return this.assignTask(params.taskId, params.agentId);
      
      case 'auto_assign_task':
        return this.autoAssignTask(params.taskId);
      
      case 'update_task':
        return this.updateTaskProgress(params.taskId, params.progress, params.status);
      
      case 'register_agent':
        return this.registerAgent(params.name, params.capabilities, params.hourlyRate);
      
      case 'process_payment':
        return await this.processPayment(params.taskId);
      
      case 'get_task':
        return this.getTask(params.taskId);
      
      case 'get_tasks':
        return this.getAllTasks();
      
      case 'get_tasks_by_status':
        return this.getTasksByStatus(params.status);
      
      case 'get_statistics':
        return this.getTaskStatistics();
      
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
}

module.exports = AgentTaskFlow;