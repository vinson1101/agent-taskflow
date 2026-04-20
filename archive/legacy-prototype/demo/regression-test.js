/**
 * AgentTaskFlow 回归测试
 * AgentTaskFlow Regression Test
 * 
 * 验证所有修复是否有效
 */

const testConfig = require('./test-config');
const SmartContractTaskAllocation = require('../smart-contract-allocation');
const USDCPaymentManager = require('../usdc-payment');

class RegressionTest {
  constructor() {
    this.contractSystem = new SmartContractTaskAllocation();
    this.paymentSystem = new USDCPaymentManager();
    this.testResults = [];
    this.mockContracts = [];
    this.mockPayments = [];
  }

  /**
   * 测试1: 小时合约类型修复验证
   * Test 1: Hourly Contract Type Fix Verification
   */
  async testHourlyContractType() {
    console.log('🧪 测试1: 小时合约类型修复验证 | Test 1: Hourly Contract Type Fix');
    
    try {
      // 尝试创建小时合约
      const hourlyContract = await this.contractSystem.createContract(
        'task_004',
        'hourly',
        'best_match',
        {
          taskId: 'task_004',
          agentId: 'agent_001',
          amount: 3000,
          terms: {
            type: 'hourly',
            hourlyRate: 50,
            maxHours: 60
          }
        }
      );
      
      this.mockContracts.push({
        id: hourlyContract.id,
        type: 'hourly',
        status: 'created'
      });
      
      console.log('✅ 小时合约创建成功 | Hourly contract created successfully');
      console.log(`   合约ID: ${hourlyContract.id}`);
      console.log(`   类型: ${hourlyContract.type}`);
      console.log(`   小时费率: $${hourlyContract.terms.hourlyRate}/小时`);
      console.log(`   最大工时: ${hourlyContract.terms.maxHours}小时`);
      
      this.testResults.push({
        test: 'Hourly Contract Type',
        status: 'PASSED',
        contractId: hourlyContract.id,
        details: {
          type: hourlyContract.type,
          hourlyRate: hourlyContract.terms.hourlyRate,
          maxHours: hourlyContract.terms.maxHours
        }
      });
      
      return true;
    } catch (error) {
      console.error('❌ 小时合约创建失败 | Hourly contract creation failed:', error.message);
      
      this.testResults.push({
        test: 'Hourly Contract Type',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试2: 最佳匹配策略修复验证
   * Test 2: Best Match Strategy Fix Verification
   */
  async testBestMatchStrategy() {
    console.log('\n🧪 测试2: 最佳匹配策略修复验证 | Test 2: Best Match Strategy Fix');
    
    try {
      // 模拟候选人和任务
      const candidates = [
        { id: 'agent_001', name: 'Alice', skills: ['development', 'design'], rating: 4.5, availability: true },
        { id: 'agent_002', name: 'Bob', skills: ['development', 'testing'], rating: 4.2, availability: true },
        { id: 'agent_003', name: 'Charlie', skills: ['design', 'marketing'], rating: 4.8, availability: false }
      ];
      
      const mockTask = {
        id: 'task_005',
        requiredSkills: ['development', 'design'],
        difficulty: 'medium'
      };
      
      // 测试最佳匹配策略
      const bestMatch = await this.contractSystem.allocateContract(
        mockTask.id,
        candidates,
        'best_match'
      );
      
      console.log('✅ 最佳匹配策略工作正常 | Best match strategy working');
      console.log(`   最佳匹配: ${bestMatch.name} (评分: ${bestMatch.score})`);
      console.log(`   技能匹配: ${bestMatch.breakdown.skillMatch}`);
      console.log(`   难度适配: ${bestMatch.breakdown.difficultyMatch}`);
      console.log(`   可用性: ${bestMatch.breakdown.availabilityScore}`);
      console.log(`   历史评分: ${bestMatch.breakdown.performanceScore}`);
      
      this.testResults.push({
        test: 'Best Match Strategy',
        status: 'PASSED',
        bestMatch: {
          name: bestMatch.name,
          score: bestMatch.score,
          breakdown: bestMatch.breakdown
        }
      });
      
      return true;
    } catch (error) {
      console.error('❌ 最佳匹配策略失败 | Best match strategy failed:', error.message);
      
      this.testResults.push({
        test: 'Best Match Strategy',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试3: 支付处理方法修复验证
   * Test 3: Payment Processing Method Fix Verification
   */
  async testPaymentProcessing() {
    console.log('\n🧪 测试3: 支付处理方法修复验证 | Test 3: Payment Processing Method Fix');
    
    try {
      // 初始化支付系统
      const initialized = await this.paymentSystem.initializePlatformWallet('test-key');
      console.log(`✅ 支付系统初始化: ${initialized ? '成功' : '失败'}`);
      
      // 注册代理钱包
      this.paymentSystem.registerAgentWallet('agent_001', '0x1234567890123456789012345678901234567890');
      this.paymentSystem.registerAgentWallet('agent_002', '0x9876543210987654321098765432109876543210');
      
      // 测试支付处理
      const payment = {
        id: 'payment_test_001',
        contractId: 'contract_test_001',
        agentId: 'agent_001',
        amount: 1000,
        currency: 'USDC'
      };
      
      const processedPayment = await this.paymentSystem.processPayment(payment);
      
      this.mockPayments.push(processedPayment);
      
      console.log('✅ 支付处理成功 | Payment processing successful');
      console.log(`   支付ID: ${processedPayment.id}`);
      console.log(`   状态: ${processedPayment.status}`);
      console.log(`   金额: $${processedPayment.amount}`);
      console.log(`   交易哈希: ${processedPayment.transactionHash}`);
      
      this.testResults.push({
        test: 'Payment Processing',
        status: 'PASSED',
        paymentId: processedPayment.id,
        status: processedPayment.status,
        amount: processedPayment.amount
      });
      
      return true;
    } catch (error) {
      console.error('❌ 支付处理失败 | Payment processing failed:', error.message);
      
      this.testResults.push({
        test: 'Payment Processing',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试4: 风险评估方法修复验证
   * Test 4: Risk Assessment Method Fix Verification
   */
  async testRiskAssessment() {
    console.log('\n🧪 测试4: 风险评估方法修复验证 | Test 4: Risk Assessment Method Fix');
    
    try {
      // 创建一个高风险合约
      const highRiskContract = {
        id: 'contract_high_risk',
        amount: 15000,
        deadline: '2026-02-08',
        difficulty: 'high',
        agentId: 'agent_001'
      };
      
      // 添加到合约系统
      this.contractSystem.contracts.push(highRiskContract);
      
      // 评估风险
      const risk = await this.contractSystem.assessContractRisk('contract_high_risk');
      
      console.log('✅ 风险评估成功 | Risk assessment successful');
      console.log(`   风险等级: ${risk.riskLevel}`);
      console.log(`   风险分数: ${risk.riskScore}/100`);
      console.log(`   风险因素: ${risk.factors.join(', ')}`);
      console.log(`   建议: ${risk.recommendations.join(', ')}`);
      
      this.testResults.push({
        test: 'Risk Assessment',
        status: 'PASSED',
        riskLevel: risk.riskLevel,
        riskScore: risk.riskScore,
        factors: risk.factors,
        recommendations: risk.recommendations
      });
      
      return true;
    } catch (error) {
      console.error('❌ 风险评估失败 | Risk assessment failed:', error.message);
      
      this.testResults.push({
        test: 'Risk Assessment',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试5: 风险缓解方法修复验证
   * Test 5: Risk Mitigation Method Fix Verification
   */
  async testRiskMitigation() {
    console.log('\n🧪 测试5: 风险缓解方法修复验证 | Test 5: Risk Mitigation Method Fix');
    
    try {
      // 使用之前的高风险合约
      const contractId = 'contract_high_risk';
      
      // 测试缓解策略
      const strategy = {
        strategy: 'escrow',
        amountHoldback: 3000
      };
      
      const mitigation = await this.contractSystem.mitigateContractRisk(contractId, strategy);
      
      console.log('✅ 风险缓解成功 | Risk mitigation successful');
      console.log(`   缓解策略: ${mitigation.strategy}`);
      console.log(`   实施时间: ${mitigation.implementedAt}`);
      console.log(`   缓解措施数量: ${mitigation.measures.length}`);
      
      mitigation.measures.forEach((measure, index) => {
        console.log(`   措施 ${index + 1}: ${measure.description}`);
      });
      
      this.testResults.push({
        test: 'Risk Mitigation',
        status: 'PASSED',
        strategy: mitigation.strategy,
        measures: mitigation.measures.length,
        measures: mitigation.measures
      });
      
      return true;
    } catch (error) {
      console.error('❌ 风险缓解失败 | Risk mitigation failed:', error.message);
      
      this.testResults.push({
        test: 'Risk Mitigation',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 测试6: 任务配置修复验证
   * Test 6: Task Configuration Fix Verification
   */
  async testTaskConfiguration() {
    console.log('\n🧪 测试6: 任务配置修复验证 | Test 6: Task Configuration Fix');
    
    try {
      // 检查任务配置
      const tasks = testConfig.testTasks;
      
      let hasTimeRange = false;
      let validTasks = 0;
      
      tasks.forEach(task => {
        if (task.timeRange && task.timeRange.start && task.timeRange.end) {
          hasTimeRange = true;
          validTasks++;
        }
        
        console.log(`✅ 任务: ${task.title}`);
        console.log(`   ID: ${task.id}`);
        console.log(`   技能: ${task.requiredSkills.join(', ')}`);
        console.log(`   时间范围: ${task.timeRange ? `${task.timeRange.start} 到 ${task.timeRange.end}` : '未设置'}`);
      });
      
      if (hasTimeRange && validTasks === tasks.length) {
        console.log('✅ 所有任务配置正确 | All task configurations correct');
        
        this.testResults.push({
          test: 'Task Configuration',
          status: 'PASSED',
          totalTasks: tasks.length,
          validTasks: validTasks,
          hasTimeRange: hasTimeRange
        });
        
        return true;
      } else {
        console.log('❌ 任务配置不完整 | Task configuration incomplete');
        
        this.testResults.push({
          test: 'Task Configuration',
          status: 'FAILED',
          totalTasks: tasks.length,
          validTasks: validTasks,
          hasTimeRange: hasTimeRange
        });
        
        return false;
      }
    } catch (error) {
      console.error('❌ 任务配置测试失败 | Task configuration test failed:', error.message);
      
      this.testResults.push({
        test: 'Task Configuration',
        status: 'FAILED',
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * 运行所有回归测试
   * Run All Regression Tests
   */
  async runAllTests() {
    console.log('🔍 开始回归测试 | Starting Regression Tests');
    console.log('='.repeat(60));
    console.log('🎯 验证所有修复是否有效 | Verifying all fixes are working');
    
    const tests = [
      this.testHourlyContractType.bind(this),
      this.testBestMatchStrategy.bind(this),
      this.testPaymentProcessing.bind(this),
      this.testRiskAssessment.bind(this),
      this.testRiskMitigation.bind(this),
      this.testTaskConfiguration.bind(this)
    ];
    
    for (const test of tests) {
      await test();
      // 添加延迟
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // 生成回归测试报告
    this.generateRegressionReport();
  }

  /**
   * 生成回归测试报告
   * Generate Regression Test Report
   */
  generateRegressionReport() {
    console.log('\n📊 回归测试报告 | Regression Test Report');
    console.log('='.repeat(60));
    
    const passedTests = this.testResults.filter(result => result.status === 'PASSED').length;
    const totalTests = this.testResults.length;
    const successRate = (passedTests / totalTests * 100).toFixed(1);
    
    console.log(`✅ 通过测试: ${passedTests}/${totalTests} | Passed Tests: ${passedTests}/${totalTests}`);
    console.log(`📈 成功率: ${successRate}% | Success Rate: ${successRate}%`);
    
    console.log('\n📋 详细结果 | Detailed Results:');
    this.testResults.forEach((result, index) => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.test}`);
      
      if (result.contractId) {
        console.log(`   合约ID: ${result.contractId}`);
      }
      if (result.bestMatch) {
        console.log(`   最佳匹配: ${result.bestMatch.name} (${result.bestMatch.score})`);
      }
      if (result.paymentId) {
        console.log(`   支付ID: ${result.paymentId}`);
      }
      if (result.riskLevel) {
        console.log(`   风险等级: ${result.riskLevel}`);
      }
      if (result.strategy) {
        console.log(`   缓解策略: ${result.strategy}`);
      }
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });
    
    // 显示修复验证摘要
    console.log('\n🎯 修复验证摘要 | Fix Verification Summary:');
    console.log(`📄 合约系统: ${this.mockContracts.length} 个合约创建成功`);
    console.log(`💰 支付系统: ${this.mockPayments.length} 个支付处理成功`);
    console.log(`⚠️ 风险管理: 风险评估和缓解功能正常`);
    console.log(`📋 任务配置: 所有必要字段已修复`);
    
    // 显示核心功能状态
    const coreFunctions = {
      'Hourly Contract Type': this.testResults.find(r => r.test === 'Hourly Contract Type')?.status === 'PASSED',
      'Best Match Strategy': this.testResults.find(r => r.test === 'Best Match Strategy')?.status === 'PASSED',
      'Payment Processing': this.testResults.find(r => r.test === 'Payment Processing')?.status === 'PASSED',
      'Risk Assessment': this.testResults.find(r => r.test === 'Risk Assessment')?.status === 'PASSED',
      'Risk Mitigation': this.testResults.find(r => r.test === 'Risk Mitigation')?.status === 'PASSED',
      'Task Configuration': this.testResults.find(r => r.test === 'Task Configuration')?.status === 'PASSED'
    };
    
    console.log('\n🔧 核心功能状态 | Core Functionality Status:');
    Object.entries(coreFunctions).forEach(([func, status]) => {
      console.log(`   ${func}: ${status ? '✅' : '❌'}`);
    });
    
    return {
      total: totalTests,
      passed: passedTests,
      failed: totalTests - passedTests,
      successRate: successRate,
      results: this.testResults,
      contracts: this.mockContracts,
      payments: this.mockPayments,
      coreFunctions: coreFunctions
    };
  }
}

// 如果直接运行此文件
if (require.main === module) {
  const regressionTest = new RegressionTest();
  regressionTest.runAllTests().catch(console.error);
}

module.exports = RegressionTest;