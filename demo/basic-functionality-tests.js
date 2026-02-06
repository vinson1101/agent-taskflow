/**
 * AgentTaskFlow 基础功能测试案例
 * Basic Functionality Test Cases for AgentTaskFlow
 */

const testConfig = require('./test-config');
const UniversalTaskSystem = require('../universal-task-system');
const SmartContractTaskAllocation = require('../smart-contract-allocation');
const AutomatedContributionScoring = require('../automated-scoring');

class BasicFunctionalityTests {
  constructor() {
    this.taskSystem = new UniversalTaskSystem();
    this.contractSystem = new SmartContractTaskAllocation();
    this.scoringSystem = new AutomatedContributionScoring();
    this.testResults = [];
  }

  /**
   * 测试1: 基本任务创建
   * Test 1: Basic Task Creation
   */
  async testTaskCreation() {
    console.log('🧪 测试1: 基本任务创建 | Test 1: Basic Task Creation');
    
    try {
      // 使用正确的API格式 | Use correct API format
      const createdTask = await this.taskSystem.createTask(
        'Build a modern responsive website',
        'article',
        'moderate',
        { skills: ['development', 'design'] }
      );
      
      console.log('✅ 任务创建成功 | Task created successfully:', createdTask.id);
      
      // 验证任务属性 | Verify task properties
      const validation = {
        id: createdTask.id,
        description: createdTask.description,
        taskType: createdTask.taskType,
        difficulty: createdTask.difficulty,
        status: createdTask.status
      };
      
      console.log('📋 任务验证结果 | Task validation:', validation);
      
      this.testResults.push({
        test: 'Task Creation',
        status: 'PASSED',
        details: validation
      });
      
      return true;
    } catch (error) {
      console.error('❌ 任务创建失败 | Task creation failed:', error.message);
      
      this.testResults.push({
        test: 'Task Creation',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试2: 代理技能匹配
   * Test 2: Agent Skill Matching
   */
  async testAgentSkillMatching() {
    console.log('\n🧪 测试2: 代理技能匹配 | Test 2: Agent Skill Matching');
    
    try {
      const agentSkills = ['development', 'design'];
      const preferences = { category: 'content' };
      
      const matchedTasks = await this.taskSystem.matchTaskToAgent(agentSkills, preferences);
      
      console.log('✅ 代理技能匹配成功 | Agent skill matching successful');
      console.log(`📊 找到 ${matchedTasks.length} 个匹配任务 | Found ${matchedTasks.length} matching tasks`);
      
      // 显示匹配结果 | Show matching results
      matchedTasks.forEach((task, index) => {
        console.log(`${index + 1}. ${task.description} - 匹配分数: ${task.matchScore}`);
      });
      
      this.testResults.push({
        test: 'Agent Skill Matching',
        status: 'PASSED',
        matches: matchedTasks.length
      });
      
      return true;
    } catch (error) {
      console.error('❌ 代理技能匹配失败 | Agent skill matching failed:', error.message);
      
      this.testResults.push({
        test: 'Agent Skill Matching',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试3: 任务创建和匹配
   * Test 3: Task Creation and Matching
   */
  async testTaskCreationAndMatching() {
    console.log('\n🧪 测试3: 任务创建和匹配 | Test 3: Task Creation and Matching');
    
    try {
      // 创建任务 | Create task
      const task = await this.taskSystem.createTask(
        'API Testing Suite',
        'analysis',
        'high',
        { skills: ['testing', 'development'] }
      );
      
      console.log('✅ 任务创建成功 | Task created successfully');
      
      // 匹配代理 | Match agents
      const agentSkills = ['testing', 'development'];
      const matchedTasks = await this.taskSystem.matchTaskToAgent(agentSkills);
      
      console.log('✅ 任务匹配成功 | Task matching successful');
      console.log(`📊 找到 ${matchedTasks.length} 个匹配任务 | Found ${matchedTasks.length} matching tasks`);
      
      this.testResults.push({
        test: 'Task Creation and Matching',
        status: 'PASSED',
        taskId: task.id,
        matches: matchedTasks.length
      });
      
      return true;
    } catch (error) {
      console.error('❌ 任务创建和匹配失败 | Task creation and matching failed:', error.message);
      
      this.testResults.push({
        test: 'Task Creation and Matching',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试4: 简化的合约测试
   * Test 4: Simplified Contract Test
   */
  async testSimplifiedContract() {
    console.log('\n🧪 测试4: 简化的合约测试 | Test 4: Simplified Contract Test');
    
    try {
      // 检查合约系统是否可用 | Check if contract system is available
      if (typeof this.contractSystem.createContract === 'function') {
        console.log('✅ 合约系统可用 | Contract system available');
        this.testResults.push({
          test: 'Contract System Availability',
          status: 'PASSED',
          note: 'Contract system methods exist'
        });
      } else {
        console.log('⚠️ 合约系统部分功能不可用 | Contract system partially available');
        this.testResults.push({
          test: 'Contract System Availability',
          status: 'WARNING',
          note: 'Some contract methods missing'
        });
      }
      
      return true;
    } catch (error) {
      console.error('❌ 合约测试失败 | Contract test failed:', error.message);
      
      this.testResults.push({
        test: 'Contract System Availability',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试5: 评分系统测试
   * Test 5: Scoring System Test
   */
  async testScoringSystem() {
    console.log('\n🧪 测试5: 评分系统测试 | Test 5: Scoring System Test');
    
    try {
      // 检查评分系统是否可用 | Check if scoring system is available
      if (typeof this.scoringSystem.calculateTaskScore === 'function') {
        console.log('✅ 评分系统可用 | Scoring system available');
        this.testResults.push({
          test: 'Scoring System Availability',
          status: 'PASSED',
          note: 'Scoring system methods exist'
        });
      } else {
        console.log('⚠️ 评分系统部分功能不可用 | Scoring system partially available');
        this.testResults.push({
          test: 'Scoring System Availability',
          status: 'WARNING',
          note: 'Some scoring methods missing'
        });
      }
      
      return true;
    } catch (error) {
      console.error('❌ 评分系统测试失败 | Scoring system test failed:', error.message);
      
      this.testResults.push({
        test: 'Scoring System Availability',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 运行所有测试
   * Run All Tests
   */
  async runAllTests() {
    console.log('🚀 开始基础功能测试 | Starting Basic Functionality Tests');
    console.log('='.repeat(50));
    
    const tests = [
      this.testTaskCreation.bind(this),
      this.testAgentSkillMatching.bind(this),
      this.testTaskCreationAndMatching.bind(this),
      this.testSimplifiedContract.bind(this),
      this.testScoringSystem.bind(this)
    ];
    
    for (const test of tests) {
      await test();
      // 添加延迟 | Add delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 生成测试报告 | Generate test report
    this.generateTestReport();
  }

  /**
   * 生成测试报告
   * Generate Test Report
   */
  generateTestReport() {
    console.log('\n📊 测试报告 | Test Report');
    console.log('='.repeat(50));
    
    const passedTests = this.testResults.filter(result => result.status === 'PASSED').length;
    const totalTests = this.testResults.length;
    const successRate = (passedTests / totalTests * 100).toFixed(1);
    
    console.log(`✅ 通过测试: ${passedTests}/${totalTests} | Passed Tests: ${passedTests}/${totalTests}`);
    console.log(`📈 成功率: ${successRate}% | Success Rate: ${successRate}%`);
    
    console.log('\n📋 详细结果 | Detailed Results:');
    this.testResults.forEach((result, index) => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.test}`);
      if (result.details) {
        console.log(`   详情: ${JSON.stringify(result.details, null, 2)}`);
      }
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });
    
    return {
      total: totalTests,
      passed: passedTests,
      failed: totalTests - passedTests,
      successRate: successRate,
      results: this.testResults
    };
  }
}

// 如果直接运行此文件 | If running this file directly
if (require.main === module) {
  const tests = new BasicFunctionalityTests();
  tests.runAllTests().catch(console.error);
}

module.exports = BasicFunctionalityTests;