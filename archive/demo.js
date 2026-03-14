const AgentTaskFlow = require('./index.js');

// Initialize the skill
const taskFlow = new AgentTaskFlow();

// Register some sample agents
const developer = taskFlow.registerAgent('Developer', ['javascript', 'python', 'openclaw'], 75);
const designer = taskFlow.registerAgent('Designer', ['ui', 'ux', 'design'], 60);
const writer = taskFlow.registerAgent('Writer', ['content', 'documentation', 'writing'], 50);

console.log('✅ AgentTaskFlow skill initialized');
console.log('📋 Sample agents registered:');
console.log(`- ${developer.name} (${developer.id})`);
console.log(`- ${designer.name} (${designer.id})`);
console.log(`- ${writer.name} (${writer.id})`);

// Example usage
const task1 = taskFlow.createTask('Develop OpenClaw skill integration', 'high', 8);
const task2 = taskFlow.createTask('Design user interface mockups', 'medium', 4);
const task3 = taskFlow.createTask('Write documentation for API', 'low', 2);

console.log('\n🎯 Created sample tasks:');
console.log(`- ${task1.id}: ${task1.description}`);
console.log(`- ${task2.id}: ${task2.description}`);
console.log(`- ${task3.id}: ${task3.description}`);

// Auto-assign tasks
try {
  const assignedTask1 = taskFlow.autoAssignTask(task1.id);
  console.log(`\n✅ Auto-assigned ${task1.id} to ${assignedTask1.assignedTo}`);
  
  const assignedTask2 = taskFlow.autoAssignTask(task2.id);
  console.log(`✅ Auto-assigned ${task2.id} to ${assignedTask2.assignedTo}`);
  
  const assignedTask3 = taskFlow.autoAssignTask(task3.id);
  console.log(`✅ Auto-assigned ${task3.id} to ${assignedTask3.assignedTo}`);
  
  // Update task progress
  taskFlow.updateTaskProgress(task1.id, 50, 'in_progress');
  taskFlow.updateTaskProgress(task2.id, 75, 'in_progress');
  taskFlow.updateTaskProgress(task3.id, 100, 'completed');
  
  // Process payment for completed task
  const payment = taskFlow.processPayment(task3.id);
  console.log(`\n💰 Processing payment for ${task3.id}: ${payment.amount} USDC`);
  
  // Show statistics
  const stats = taskFlow.getTaskStatistics();
  console.log('\n📊 Task Statistics:');
  console.log(JSON.stringify(stats, null, 2));
  
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\n🎉 AgentTaskFlow skill demonstration complete!');