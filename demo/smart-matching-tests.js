/**
 * AgentTaskFlow 智能匹配测试案例
 * Smart Matching Test Cases for AgentTaskFlow
 */

const testConfig = require('./test-config');

class SmartMatchingTests {
  constructor() {
    this.testResults = [];
    this.simulatedMatches = [];
  }

  /**
   * 模拟智能匹配算法
   * Simulate Smart Matching Algorithm
   */
  simulateSmartMatching(task, agents) {
    console.log(`🎯 任务: ${task.title}`);
    console.log(`📋 所需技能: ${task.skills.join(', ')}`);
    console.log(`👥 可用代理: ${agents.length} 人`);
    
    const matches = agents.map(agent => {
      let score = 0;
      let matchDetails = [];
      
      // 技能匹配度 | Skill Matching
      const skillMatch = this.calculateSkillMatch(task.skills, agent.skills);
      score += skillMatch.score * 0.4; // 40% 权重
      matchDetails.push(`技能匹配: ${skillMatch.score} (${skillMatch.matchedSkills}/${task.skills.length})`);
      
      // 难度适配 | Difficulty Adaptation
      const difficultyScore = this.calculateDifficultyScore(task.difficulty, agent.rating);
      score += difficultyScore * 0.3; // 30% 权重
      matchDetails.push(`难度适配: ${difficultyScore}`);
      
      // 可用性 | Availability
      const availabilityScore = agent.availability ? 1.0 : 0.0;
      score += availabilityScore * 0.2; // 20% 权重
      matchDetails.push(`可用性: ${availabilityScore ? '可用' : '不可用'}`);
      
      // 历史评分 | Historical Rating
      const ratingScore = agent.rating / 5.0; // 标准化到0-1
      score += ratingScore * 0.1; // 10% 权重
      matchDetails.push(`历史评分: ${agent.rating}/5.0`);
      
      return {
        agent: agent,
        score: Math.round(score * 100) / 100,
        details: matchDetails,
        rank: 0 // 将在后面计算排名
      };
    });
    
    // 按分数排序 | Sort by score
    matches.sort((a, b) => b.score - a.score);
    
    // 分配排名 | Assign ranks
    matches.forEach((match, index) => {
      match.rank = index + 1;
    });
    
    return matches;
  }

  /**
   * 计算技能匹配度
   * Calculate Skill Matching
   */
  calculateSkillMatch(requiredSkills, agentSkills) {
    const matchedSkills = requiredSkills.filter(skill => 
      agentSkills.some(agentSkill => 
        agentSkill.toLowerCase().includes(skill.toLowerCase()) || 
        skill.toLowerCase().includes(agentSkill.toLowerCase())
      )
    );
    
    const score = matchedSkills.length / requiredSkills.length;
    
    return {
      score: score,
      matchedSkills: matchedSkills.length,
      totalSkills: requiredSkills.length
    };
  }

  /**
   * 计算难度适配分数
   * Calculate Difficulty Adaptation Score
   */
  calculateDifficultyScore(taskDifficulty, agentRating) {
    const difficultyMap = {
      'low': 1,
      'medium': 2,
      'high': 3
    };
    
    const difficulty = difficultyMap[taskDifficulty] || 2;
    const expectedRating = difficulty * 1.5; // 难度越高，期望评分越高
    
    if (agentRating >= expectedRating) {
      return 1.0; // 完全胜任
    } else if (agentRating >= expectedRating * 0.8) {
      return 0.8; // 基本胜任
    } else if (agentRating >= expectedRating * 0.6) {
      return 0.6; // 勉强胜任
    } else {
      return 0.3; // 不太胜任
    }
  }

  /**
   * 测试1: 基本匹配测试
   * Test 1: Basic Matching Test
   */
  async testBasicMatching() {
    console.log('\n🧪 测试1: 基本匹配测试 | Test 1: Basic Matching Test');
    
    try {
      const task = testConfig.testTasks[0]; // Website Development
      const agents = testConfig.testAgents;
      
      const matches = this.simulateSmartMatching(task, agents);
      
      console.log('\n📊 匹配结果 | Matching Results:');
      matches.forEach((match, index) => {
        console.log(`${index + 1}. ${match.agent.name} (评分: ${match.agent.rating})`);
        console.log(`   总分: ${match.score}/1.0`);
        console.log(`   排名: ${match.rank}`);
        match.details.forEach(detail => {
          console.log(`   - ${detail}`);
        });
        console.log('');
      });
      
      this.testResults.push({
        test: 'Basic Matching',
        status: 'PASSED',
        matches: matches.length,
        bestMatch: matches[0]
      });
      
      return true;
    } catch (error) {
      console.error('❌ 基本匹配测试失败:', error.message);
      
      this.testResults.push({
        test: 'Basic Matching',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试2: 高难度任务匹配
   * Test 2: High Difficulty Task Matching
   */
  async testHighDifficultyMatching() {
    console.log('\n🧪 测试2: 高难度任务匹配 | Test 2: High Difficulty Task Matching');
    
    try {
      const highDifficultyTask = {
        ...testConfig.testTasks[1], // API Testing (high difficulty)
        difficulty: 'high'
      };
      
      const agents = testConfig.testAgents;
      
      const matches = this.simulateSmartMatching(highDifficultyTask, agents);
      
      console.log('\n📊 高难度任务匹配结果 | High Difficulty Task Results:');
      matches.forEach((match, index) => {
        console.log(`${index + 1}. ${match.agent.name} (评分: ${match.agent.rating})`);
        console.log(`   总分: ${match.score}/1.0`);
        console.log(`   排名: ${match.rank}`);
        match.details.forEach(detail => {
          console.log(`   - ${detail}`);
        });
        console.log('');
      });
      
      // 验证是否有足够的高评分代理
      const highScoreAgents = matches.filter(match => match.score >= 0.8);
      console.log(`🎯 符合要求的高评分代理: ${highScoreAgents.length} 人`);
      
      this.testResults.push({
        test: 'High Difficulty Matching',
        status: 'PASSED',
        matches: matches.length,
        highScoreAgents: highScoreAgents.length
      });
      
      return true;
    } catch (error) {
      console.error('❌ 高难度任务匹配测试失败:', error.message);
      
      this.testResults.push({
        test: 'High Difficulty Matching',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试3: 技能特定匹配
   * Test 3: Skill-Specific Matching
   */
  async testSkillSpecificMatching() {
    console.log('\n🧪 测试3: 技能特定匹配 | Test 3: Skill-Specific Matching');
    
    try {
      const designTask = {
        ...testConfig.testTasks[2], // Logo Design
        skills: ['design']
      };
      
      const agents = testConfig.testAgents;
      
      const matches = this.simulateSmartMatching(designTask, agents);
      
      console.log('\n📊 设计任务匹配结果 | Design Task Results:');
      matches.forEach((match, index) => {
        console.log(`${index + 1}. ${match.agent.name} (评分: ${match.agent.rating})`);
        console.log(`   总分: ${match.score}/1.0`);
        console.log(`   排名: ${match.rank}`);
        match.details.forEach(detail => {
          console.log(`   - ${detail}`);
        });
        console.log('');
      });
      
      // 验证设计技能匹配
      const designAgents = matches.filter(match => 
        match.agent.skills.some(skill => skill.toLowerCase().includes('design'))
      );
      
      console.log(`🎨 具有设计技能的代理: ${designAgents.length} 人`);
      
      this.testResults.push({
        test: 'Skill-Specific Matching',
        status: 'PASSED',
        matches: matches.length,
        designAgents: designAgents.length
      });
      
      return true;
    } catch (error) {
      console.error('❌ 技能特定匹配测试失败:', error.message);
      
      this.testResults.push({
        test: 'Skill-Specific Matching',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试4: 多任务分配
   * Test 4: Multi-Task Allocation
   */
  async testMultiTaskAllocation() {
    console.log('\n🧪 测试4: 多任务分配 | Test 4: Multi-Task Allocation');
    
    try {
      const tasks = testConfig.testTasks;
      const agents = testConfig.testAgents;
      
      const allocationResults = {};
      
      tasks.forEach(task => {
        const matches = this.simulateSmartMatching(task, agents);
        allocationResults[task.id] = {
          task: task,
          bestMatch: matches[0],
          allMatches: matches
        };
      });
      
      console.log('\n📊 多任务分配结果 | Multi-Task Allocation Results:');
      Object.entries(allocationResults).forEach(([taskId, result]) => {
        console.log(`\n🎯 任务: ${result.task.title}`);
        console.log(`👑 最佳匹配: ${result.bestMatch.agent.name} (评分: ${result.bestMatch.score})`);
        console.log(`💰 预算: $${result.task.budget}`);
        console.log(`⏰ 截止日期: ${result.task.deadline}`);
      });
      
      // 检查代理负载均衡 | Check agent load balancing
      const agentWorkload = {};
      Object.values(allocationResults).forEach(result => {
        const agentName = result.bestMatch.agent.name;
        agentWorkload[agentName] = (agentWorkload[agentName] || 0) + 1;
      });
      
      console.log('\n📊 代理工作负载 | Agent Workload:');
      Object.entries(agentWorkload).forEach(([agentName, workload]) => {
        console.log(`${agentName}: ${workload} 个任务`);
      });
      
      this.testResults.push({
        test: 'Multi-Task Allocation',
        status: 'PASSED',
        tasksAllocated: Object.keys(allocationResults).length,
        workload: agentWorkload
      });
      
      return true;
    } catch (error) {
      console.error('❌ 多任务分配测试失败:', error.message);
      
      this.testResults.push({
        test: 'Multi-Task Allocation',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 运行所有智能匹配测试
   * Run All Smart Matching Tests
   */
  async runAllTests() {
    console.log('🧠 开始智能匹配测试 | Starting Smart Matching Tests');
    console.log('='.repeat(50));
    
    const tests = [
      this.testBasicMatching.bind(this),
      this.testHighDifficultyMatching.bind(this),
      this.testSkillSpecificMatching.bind(this),
      this.testMultiTaskAllocation.bind(this)
    ];
    
    for (const test of tests) {
      await test();
      // 添加延迟 | Add delay between tests
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // 生成测试报告 | Generate test report
    this.generateTestReport();
  }

  /**
   * 生成测试报告
   * Generate Test Report
   */
  generateTestReport() {
    console.log('\n📊 智能匹配测试报告 | Smart Matching Test Report');
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
      if (result.matches) {
        console.log(`   匹配数量: ${result.matches}`);
      }
      if (result.bestMatch) {
        console.log(`   最佳匹配: ${result.bestMatch.agent.name} (${result.bestMatch.score})`);
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
  const tests = new SmartMatchingTests();
  tests.runAllTests().catch(console.error);
}

module.exports = SmartMatchingTests;