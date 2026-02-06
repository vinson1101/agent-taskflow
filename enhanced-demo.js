const AgentTaskFlow = require('./index.js');

// Enhanced demonstration of the complete AgentTaskFlow system
async function enhancedDemo() {
  console.log('🚀 Enhanced AgentTaskFlow Demo\n');
  
  // Initialize the skill
  const taskFlow = new AgentTaskFlow();
  
  // Register agents with different capabilities
  console.log('📋 Registering agents...');
  const developer = taskFlow.registerAgent('Senior Developer', ['javascript', 'python', 'blockchain', 'api'], 85);
  const designer = taskFlow.registerAgent('UI Designer', ['design', 'ui', 'ux', 'frontend'], 70);
  const backend = taskFlow.registerAgent('Backend Engineer', ['python', 'database', 'api', 'devops'], 75);
  const tester = taskFlow.registerAgent('QA Engineer', ['testing', 'qa', 'automation'], 60);
  
  // Set wallet addresses for USDC payments
  developer.walletAddress = '0x1234567890123456789012345678901234567890';
  designer.walletAddress = '0x2345678901234567890123456789012345678901';
  backend.walletAddress = '0x3456789012345678901234567890123456789012';
  tester.walletAddress = '0x4567878901234567890123456789012345678903';
  
  console.log(`✅ Agents registered:`);
  console.log(`  - ${developer.name} (${developer.id}) - $${developer.hourlyRate}/hr`);
  console.log(`  - ${designer.name} (${designer.id}) - $${designer.hourlyRate}/hr`);
  console.log(`  - ${backend.name} (${backend.id}) - $${backend.hourlyRate}/hr`);
  console.log(`  - ${tester.name} (${tester.id}) - $${tester.hourlyRate}/hr\n`);
  
  // Create various types of tasks
  console.log('🎯 Creating diverse tasks...');
  
  // Individual task
  const frontendTask = taskFlow.createTask('Implement user authentication UI', 'high', 6);
  console.log(`✅ Created: ${frontendTask.id} - ${frontendTask.description}`);
  
  // Complex collaborative task
  const blockchainTask = taskFlow.createTask('Develop USDC payment integration with smart contracts', 'critical', 16);
  console.log(`✅ Created: ${blockchainTask.id} - ${blockchainTask.description}`);
  
  // Team task
  const apiTask = taskFlow.createTask('Build REST API with comprehensive documentation', 'high', 12);
  console.log(`✅ Created: ${apiTask.id} - ${apiTask.description}`);
  
  console.log('');
  
  // Auto-assign tasks
  console.log('🤖 Auto-assigning tasks...');
  
  try {
    // Individual assignment
    const assignedFrontend = await taskFlow.autoAssignTask(frontendTask.id);
    console.log(`✅ ${frontendTask.id} assigned to ${assignedFrontend.assignedTo || assignedFrontend.team}`);
    
    // Complex task gets team assignment
    const assignedBlockchain = await taskFlow.autoAssignTask(blockchainTask.id);
    console.log(`✅ ${blockchainTask.id} assigned to team ${assignedBlockchain.team.name}`);
    
    // API task to team
    const assignedApi = await taskFlow.autoAssignTask(apiTask.id);
    console.log(`✅ ${apiTask.id} assigned to team ${assignedApi.team.name}`);
    
  } catch (error) {
    console.log(`❌ Assignment error: ${error.message}`);
  }
  
  console.log('');
  
  // Simulate collaboration
  console.log('💬 Simulating collaboration...');
  
  // Developer helps designer
  await taskFlow.sendMessage(developer.id, designer.id, 'I can help you with the authentication flow design', frontendTask.id);
  
  // Team communication
  const blockchainTeam = taskFlow.collaborationSystem.teams.get(blockchainTask.assignedTeam);
  if (blockchainTeam) {
    await taskFlow.sendTeamMessage(blockchainTeam.id, developer.id, 'Let\'s review the smart contract security');
  }
  
  // Score collaboration
  taskFlow.scoreCollaboration(developer.id, designer.id, 'code_help', 1.0);
  console.log('✅ Collaboration scored: Developer helped Designer');
  
  console.log('');
  
  // Complete tasks with quality assessment
  console.log('🏆 Completing tasks with quality assessment...');
  
  // Complete frontend task
  await taskFlow.completeTask(frontendTask.id, 92, 'Excellent UI implementation with responsive design');
  console.log(`✅ ${frontendTask.id} completed with quality score 92%`);
  
  // Complete blockchain task
  await taskFlow.completeTask(blockchainTask.id, 88, 'Smart contracts implemented with security best practices');
  console.log(`✅ ${blockchainTask.id} completed with quality score 88%`);
  
  // Complete API task
  await taskFlow.completeTask(apiTask.id, 95, 'Comprehensive API with full documentation and testing');
  console.log(`✅ ${apiTask.id} completed with quality score 95%`);
  
  console.log('');
  
  // Process USDC payments
  console.log('💰 Processing USDC payments...');
  
  try {
    const frontendPayment = await taskFlow.processPayment(frontendTask.id);
    console.log(`✅ Payment processed for ${frontendTask.id}: ${frontendPayment[0]?.amount || 0} USDC`);
    
    const blockchainPayment = await taskFlow.processPayment(blockchainTask.id);
    console.log(`✅ Team payment processed for ${blockchainTask.id}: ${blockchainPayment[0]?.amount || 0} USDC total`);
    
    const apiPayment = await taskFlow.processPayment(apiTask.id);
    console.log(`✅ Team payment processed for ${apiTask.id}: ${apiPayment[0]?.amount || 0} USDC total`);
    
  } catch (error) {
    console.log(`❌ Payment error: ${error.message}`);
  }
  
  console.log('');
  
  // Show analytics
  console.log('📊 Analytics Dashboard');
  console.log('='.repeat(50));
  
  // Task statistics
  const taskStats = taskFlow.getTaskStatistics();
  console.log('\n📈 Task Statistics:');
  console.log(`  Total tasks: ${taskStats.total}`);
  console.log(`  Completed: ${taskStats.completed}`);
  console.log(`  Team tasks: ${taskStats.teamTasks}`);
  console.log(`  Individual tasks: ${taskStats.individualTasks}`);
  
  // Collaboration stats
  const collabStats = taskFlow.getCollaborationStats();
  console.log('\n🤝 Collaboration Statistics:');
  console.log(`  Total collaborations: ${collabStats.totalCollaborations}`);
  console.log(`  Active teams: ${collabStats.activeTeams}`);
  
  // Leaderboard
  const leaderboard = taskFlow.getLeaderboard();
  console.log('\n🏆 Top Performers:');
  leaderboard.slice(0, 5).forEach((agent, index) => {
    console.log(`  ${index + 1}. ${agent.agentId} - ${agent.totalScore} points`);
    console.log(`     Task: ${agent.taskScore} | Collaboration: ${agent.collaborationScore} | Quality: ${agent.qualityScore}`);
  });
  
  // Individual agent scores
  console.log('\n📋 Individual Agent Scores:');
  [developer, designer, backend, tester].forEach(agent => {
    const score = taskFlow.getAgentScore(agent.id);
    if (score) {
      console.log(`  ${agent.name}: ${score.totalScore} points`);
      console.log(`    Task Score: ${score.taskScore} | Collaboration: ${score.collaborationScore} | Quality: ${score.qualityScore}`);
      console.log(`    Reliability: ${score.reliabilityScore} | Innovation: ${score.innovationScore}`);
    }
  });
  
  // Check achievements
  console.log('\n🎯 Achievements Unlocked:');
  [developer, designer, backend, tester].forEach(agent => {
    const achievements = taskFlow.contributionScoring.checkAchievements(agent.id);
    if (achievements.length > 0) {
      console.log(`  ${agent.name}:`);
      achievements.forEach(achievement => {
        console.log(`    🏆 ${achievement.name} (+${achievement.points} points)`);
      });
    }
  });
  
  console.log('\n🎉 Enhanced AgentTaskFlow demonstration complete!');
  console.log('✅ All features demonstrated: USDC payments, collaboration, scoring, achievements');
}

// Run the enhanced demo
enhancedDemo().catch(console.error);