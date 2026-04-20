#!/usr/bin/env node

const AgentTaskFlow = require('./index.js');

// Initialize the skill
const taskFlow = new AgentTaskFlow();

// OpenClaw CLI Interface
class TaskFlowCLI {
  constructor() {
    this.commands = {
      'create': this.createTask.bind(this),
      'assign': this.assignTask.bind(this),
      'auto-assign': this.autoAssignTask.bind(this),
      'update': this.updateTask.bind(this),
      'register': this.registerAgent.bind(this),
      'pay': this.processPayment.bind(this),
      'list': this.listTasks.bind(this),
      'stats': this.showStats.bind(this),
      'help': this.showHelp.bind(this)
    };
  }

  async execute(command, args) {
    const cmd = this.commands[command];
    if (!cmd) {
      console.error(`Unknown command: ${command}`);
      this.showHelp();
      return;
    }

    try {
      await cmd(args);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  async createTask(args) {
    const description = args.join(' ');
    if (!description) {
      console.error('Please provide task description');
      return;
    }

    const task = taskFlow.createTask(description);
    console.log(`✅ Task created: ${task.id}`);
    console.log(`   Description: ${task.description}`);
    console.log(`   Priority: ${task.priority}`);
    console.log(`   Estimated hours: ${task.estimatedHours}`);
  }

  async assignTask(args) {
    if (args.length < 2) {
      console.error('Usage: assign <taskId> <agentId>');
      return;
    }

    const [taskId, agentId] = args;
    const task = taskFlow.assignTask(taskId, agentId);
    console.log(`✅ Task ${taskId} assigned to ${agentId}`);
    console.log(`   Status: ${task.status}`);
  }

  async autoAssignTask(args) {
    if (args.length < 1) {
      console.error('Usage: auto-assign <taskId>');
      return;
    }

    const taskId = args[0];
    const task = taskFlow.autoAssignTask(taskId);
    console.log(`✅ Task ${taskId} auto-assigned to ${task.assignedTo}`);
    console.log(`   Status: ${task.status}`);
  }

  async updateTask(args) {
    if (args.length < 3) {
      console.error('Usage: update <taskId> <progress> <status>');
      return;
    }

    const [taskId, progress, status] = args;
    const task = taskFlow.updateTaskProgress(taskId, parseInt(progress), status);
    console.log(`✅ Task ${taskId} updated:`);
    console.log(`   Progress: ${task.progress}%`);
    console.log(`   Status: ${task.status}`);
  }

  async registerAgent(args) {
    if (args.length < 2) {
      console.error('Usage: register <name> <capabilities> [hourlyRate]');
      return;
    }

    const [name, capabilitiesStr, hourlyRate = 50] = args;
    const capabilities = capabilitiesStr.split(',').map(c => c.trim());
    
    const agent = taskFlow.registerAgent(name, capabilities, parseInt(hourlyRate));
    console.log(`✅ Agent registered: ${agent.id}`);
    console.log(`   Name: ${agent.name}`);
    console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
    console.log(`   Hourly rate: ${agent.hourlyRate}`);
  }

  async processPayment(args) {
    if (args.length < 1) {
      console.error('Usage: pay <taskId>');
      return;
    }

    const taskId = args[0];
    const payment = await taskFlow.processPayment(taskId);
    console.log(`✅ Payment processed: ${payment.id}`);
    console.log(`   Task: ${payment.taskId}`);
    console.log(`   Amount: ${payment.amount} USDC`);
    console.log(`   Status: ${payment.status}`);
  }

  async listTasks(args) {
    const status = args[0] || 'all';
    let tasks;

    if (status === 'all') {
      tasks = taskFlow.getAllTasks();
    } else {
      tasks = taskFlow.getTasksByStatus(status);
    }

    console.log(`\n📋 Tasks (${tasks.length}):`);
    tasks.forEach(task => {
      console.log(`  ${task.id}: ${task.description}`);
      console.log(`     Status: ${task.status} | Priority: ${task.priority}`);
      console.log(`     Assigned: ${task.assignedTo || 'None'}`);
      console.log(`     Payment: ${task.paymentStatus}`);
      console.log('');
    });
  }

  async showStats() {
    const stats = taskFlow.getTaskStatistics();
    console.log('\n📊 Task Statistics:');
    console.log(`  Total tasks: ${stats.total}`);
    console.log(`  Pending: ${stats.pending}`);
    console.log(`  Assigned: ${stats.assigned}`);
    console.log(`  In Progress: ${stats.inProgress}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Paid: ${stats.paid}`);
  }

  showHelp() {
    console.log('\n🎯 AgentTaskFlow CLI Commands:');
    console.log('  create <description>     - Create a new task');
    console.log('  assign <taskId> <agentId> - Assign task to agent');
    console.log('  auto-assign <taskId>     - Auto-assign task to best agent');
    console.log('  update <taskId> <progress> <status> - Update task progress');
    console.log('  register <name> <capabilities> [rate] - Register new agent');
    console.log('  pay <taskId>             - Process payment for task');
    console.log('  list [status]           - List tasks (all/pending/assigned/progress/completed)');
    console.log('  stats                   - Show task statistics');
    console.log('  help                    - Show this help');
  }
}

// CLI execution
const cli = new TaskFlowCLI();
const command = process.argv[2];
const args = process.argv.slice(3);

if (command) {
  cli.execute(command, args);
} else {
  cli.showHelp();
}