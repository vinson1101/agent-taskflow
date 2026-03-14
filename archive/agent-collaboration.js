class AgentCollaborationSystem {
  constructor() {
    this.agents = new Map();
    this.teams = new Map();
    this.communications = new Map();
    this.collaborationHistory = [];
  }

  // Agent Management
  registerAgent(agent) {
    this.agents.set(agent.id, {
      ...agent,
      availability: 'available',
      currentCollaborations: [],
      skills: agent.capabilities || [],
      reputation: 100,
      collaborationScore: 0,
      lastActive: new Date()
    });
    return agent;
  }

  // Team Formation
  createTeam(name, memberIds) {
    const teamId = `team_${Date.now()}`;
    const team = {
      id: teamId,
      name,
      members: memberIds,
      createdAt: new Date(),
      activeProjects: [],
      completedProjects: []
    };
    
    this.teams.set(teamId, team);
    
    // Update agent collaboration status
    memberIds.forEach(agentId => {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.currentCollaborations.push(teamId);
      }
    });
    
    return team;
  }

  // Smart Task Assignment
  async assignCollaborativeTask(task) {
    const requiredSkills = this.extractRequiredSkills(task.description);
    const availableAgents = this.findAvailableAgents(requiredSkills);
    
    if (availableAgents.length === 0) {
      throw new Error('No suitable agents available for collaborative task');
    }

    // Form optimal team based on skill match and collaboration history
    const team = this.formOptimalTeam(task, availableAgents);
    
    // Assign task to team
    task.assignedTeam = team.id;
    task.status = 'assigned';
    
    // Notify team members
    await this.notifyTeamMembers(team, task);
    
    return {
      team,
      task,
      message: `Task assigned to team ${team.name}`
    };
  }

  extractRequiredSkills(description) {
    // Extract skills from task description using NLP-like approach
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

  findAvailableAgents(requiredSkills) {
    return Array.from(this.agents.values())
      .filter(agent => agent.availability === 'available')
      .filter(agent => 
        requiredSkills.some(skill => 
          agent.skills.some(agentSkill => 
            agentSkill.toLowerCase().includes(skill.toLowerCase())
          )
        )
      )
      .sort((a, b) => {
        // Sort by reputation and collaboration score
        const scoreA = a.reputation + a.collaborationScore;
        const scoreB = b.reputation + b.collaborationScore;
        return scoreB - scoreA;
      });
  }

  formOptimalTeam(task, availableAgents) {
    const teamSize = Math.min(3, availableAgents.length); // Max 3 agents per team
    const selectedAgents = availableAgents.slice(0, teamSize);
    
    const teamName = `Team-${task.id.slice(-4)}`;
    const team = this.createTeam(teamName, selectedAgents.map(a => a.id));
    
    return team;
  }

  async notifyTeamMembers(team, task) {
    const notifications = [];
    
    for (const agentId of team.members) {
      const agent = this.agents.get(agentId);
      const notification = {
        id: `notif_${Date.now()}_${agentId}`,
        agentId,
        taskId: task.id,
        message: `New task assigned to team ${team.name}: ${task.description}`,
        timestamp: new Date(),
        read: false
      };
      
      this.communications.set(notification.id, notification);
      notifications.push(notification);
    }
    
    return notifications;
  }

  // Real-time Communication
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
    
    this.communications.set(communication.id, communication);
    
    // Update collaboration metrics
    await this.updateCollaborationMetrics(fromAgentId, toAgentId, 'communication');
    
    return communication;
  }

  async sendTeamMessage(teamId, fromAgentId, message) {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');
    
    const communications = [];
    
    for (const memberId of team.members) {
      if (memberId !== fromAgentId) {
        const communication = await this.sendMessage(fromAgentId, memberId, message, null);
        communications.push(communication);
      }
    }
    
    return communications;
  }

  // Collaboration Metrics
  async updateCollaborationMetrics(agentId1, agentId2, action) {
    const collaborationKey = `${agentId1}_${agentId2}`;
    
    // Record collaboration
    this.collaborationHistory.push({
      agent1: agentId1,
      agent2: agentId2,
      action,
      timestamp: new Date()
    });
    
    // Update collaboration scores
    const agent1 = this.agents.get(agentId1);
    const agent2 = this.agents.get(agentId2);
    
    if (agent1 && agent2) {
      const scoreIncrement = this.getActionScore(action);
      
      agent1.collaborationScore += scoreIncrement;
      agent2.collaborationScore += scoreIncrement;
      
      // Update reputation based on successful collaboration
      if (action === 'successful_completion') {
        agent1.reputation += 2;
        agent2.reputation += 2;
      }
    }
  }

  getActionScore(action) {
    const scores = {
      'communication': 1,
      'task_help': 3,
      'successful_completion': 5,
      'code_review': 2,
      'mentorship': 4
    };
    return scores[action] || 0;
  }

  // Collaboration Analytics
  getCollaborationStats() {
    const stats = {
      totalCollaborations: this.collaborationHistory.length,
      activeTeams: Array.from(this.teams.values()).filter(t => t.activeProjects.length > 0).length,
      topCollaborators: this.getTopCollaborators(),
      teamPerformance: this.getTeamPerformance()
    };
    
    return stats;
  }

  getTopCollaborators() {
    return Array.from(this.agents.values())
      .sort((a, b) => b.collaborationScore - a.collaborationScore)
      .slice(0, 5)
      .map(agent => ({
        id: agent.id,
        name: agent.name,
        collaborationScore: agent.collaborationScore,
        reputation: agent.reputation
      }));
  }

  getTeamPerformance() {
    return Array.from(this.teams.values()).map(team => {
      const completionRate = team.completedProjects.length / 
                            (team.completedProjects.length + team.activeProjects.length);
      
      return {
        id: team.id,
        name: team.name,
        completionRate: completionRate,
        memberCount: team.members.length,
        activeProjects: team.activeProjects.length,
        completedProjects: team.completedProjects.length
      };
    });
  }

  // Task Completion and Quality Assessment
  async completeCollaborativeTask(teamId, taskId, qualityScore) {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');
    
    // Update team project history
    team.completedProjects.push(taskId);
    
    // Update agent metrics
    for (const agentId of team.members) {
      const agent = this.agents.get(agentId);
      if (agent) {
        await this.updateCollaborationMetrics(agentId, agentId, 'successful_completion');
        
        // Update quality-based reputation
        if (qualityScore >= 90) {
          agent.reputation += 5;
        } else if (qualityScore >= 80) {
          agent.reputation += 2;
        }
      }
    }
    
    return {
      teamId,
      taskId,
      qualityScore,
      message: 'Collaborative task completed successfully'
    };
  }
}

module.exports = AgentCollaborationSystem;