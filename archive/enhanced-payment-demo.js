const AgentTaskFlow = require('./index.js');

// Enhanced demonstration of the corrected USDC payment system
async function enhancedPaymentDemo() {
  console.log('🚀 Enhanced AgentTaskFlow Payment System Demo\n');
  
  // Initialize the system
  const taskFlow = new AgentTaskFlow();
  
  console.log('💰 Step 1: Initialize payment system...');
  
  // Mock platform credential label (placeholder only, not a real key)
  const platformPrivateKey = '<mock-platform-private-key>';
  
  try {
    const paymentInitSuccess = await taskFlow.initializePayments(platformPrivateKey);
    if (paymentInitSuccess) {
      console.log('✅ Payment system initialized successfully');
    } else {
      console.log('❌ Payment system initialization failed');
      return;
    }
  } catch (error) {
    console.log(`❌ Payment system error: ${error.message}`);
    return;
  }
  
  console.log('');
  console.log('👥 Step 2: Register agents with wallet addresses...');
  
  // Register agents with their wallet addresses
  const developer = taskFlow.registerAgent(
    'Senior Developer', 
    ['javascript', 'python', 'blockchain'], 
    85, 
    '0xDeveloperAddress1234567890abcdef1234567890abcdef12345678'
  );
  
  const designer = taskFlow.registerAgent(
    'UI Designer', 
    ['design', 'ui', 'ux'], 
    70, 
    '0xDesignerAddress1234567890abcdef1234567890abcdef12345678'
  );
  
  const backend = taskFlow.registerAgent(
    'Backend Engineer', 
    ['python', 'database', 'api'], 
    75, 
    '0xBackendAddress1234567890abcdef1234567890abcdef12345678'
  );
  
  const tester = taskFlow.registerAgent(
    'QA Engineer', 
    ['testing', 'qa'], 
    60, 
    '0xTesterAddress1234567890abcdef1234567890abcdef12345678'
  );
  
  console.log(`✅ Registered ${taskFlow.getAllAgents().length} agents with wallet addresses`);
  
  // Show registered wallets
  console.log('\n📋 Registered Agent Wallets:');
  taskFlow.paymentManager.getRegisteredAgents().forEach(agent => {
    console.log(`  - ${agent.agentId}: ${agent.address}`);
  });
  
  console.log('');
  console.log('🎯 Step 3: Create tasks and check platform balance...');
  
  // Create tasks
  const tasks = [
    taskFlow.createTask('Implement user authentication UI', 'high', 6),
    taskFlow.createTask('Develop USDC payment integration', 'critical', 16),
    taskFlow.createTask('Build REST API documentation', 'medium', 8),
    taskFlow.createTask('Write unit tests for API', 'medium', 4),
    taskFlow.createTask('Design dashboard mockups', 'high', 10)
  ];
  
  console.log(`✅ Created ${tasks.length} tasks`);
  
  // Check platform balance
  const platformBalance = await taskFlow.paymentManager.checkPlatformBalance();
  console.log(`💰 Platform wallet balance: ${platformBalance} USDC`);
  
  console.log('');
  console.log('📤 Step 4: Assign tasks manually...');
  
  // Assign tasks
  taskFlow.assignTask(tasks[0].id, designer.id);
  taskFlow.assignTask(tasks[1].id, developer.id);
  taskFlow.assignTask(tasks[2].id, backend.id);
  taskFlow.assignTask(tasks[3].id, tester.id);
  taskFlow.assignTask(tasks[4].id, designer.id);
  
  console.log('✅ Tasks assigned to agents');
  
  console.log('');
  console.log('✅ Step 5: Simulate task completion and process payments...');
  
  // Mark tasks as completed
  tasks.forEach(task => {
    taskFlow.updateTaskProgress(task.id, 100, 'completed');
  });
  
  console.log('✅ All tasks marked as completed');
  
  console.log('');
  console.log('💸 Step 6: Process payments for all completed tasks...');
  
  // Process payments for all tasks
  const taskIds = tasks.map(task => task.id);
  const paymentResults = await taskFlow.batchProcessPayments(taskIds);
  
  console.log('\n📊 Payment Results:');
  paymentResults.forEach((result, index) => {
    const task = tasks[index];
    if (result.success) {
      console.log(`  ✅ Task ${task.id}: ${result.amount} USDC paid to ${result.agent.name}`);
      console.log(`     Transaction: ${result.payment.transactionHash}`);
    } else {
      console.log(`  ❌ Task ${task.id}: Payment failed - ${result.error}`);
    }
  });
  
  console.log('');
  console.log('🔍 Step 7: Check final balances...');
  
  // Check final balances
  console.log('\n💰 Final Balances:');
  
  // Platform balance
  const finalPlatformBalance = await taskFlow.paymentManager.checkPlatformBalance();
  console.log(`  Platform: ${finalPlatformBalance} USDC`);
  
  // Agent balances
  for (const agent of [developer, designer, backend, tester]) {
    const agentBalance = await taskFlow.paymentManager.checkAgentBalance(agent.id);
    console.log(`  ${agent.name}: ${agentBalance} USDC`);
  }
  
  console.log('');
  console.log('🎉 Enhanced Payment System Demo Complete!');
  console.log('');
  console.log('📋 Summary:');
  console.log(`  - Total tasks processed: ${tasks.length}`);
  console.log(`  - Successful payments: ${paymentResults.filter(r => r.success).length}`);
  console.log(`  - Failed payments: ${paymentResults.filter(r => !r.success).length}`);
  console.log(`  - Total amount paid: ${paymentResults.filter(r => r.success).reduce((sum, r) => sum + r.amount, 0)} USDC`);
  
  console.log('\n🔐 Security Features:');
  console.log('  - Platform wallet manages the fund pool');
  console.log('  - Agent wallets are pre-registered');
  console.log('  - Balance checks before transfers');
  console.log('  - Transaction hash tracking');
  console.log('  - Batch processing with delays');
}

// Run the enhanced demo
enhancedPaymentDemo().catch(console.error);
