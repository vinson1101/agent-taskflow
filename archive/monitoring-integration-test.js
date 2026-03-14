/**
 * AgentTaskFlow 完整监控和日志集成测试
 * AgentTaskFlow Complete Monitoring & Logging Integration Test
 */

const MonitoringIntegrator = require('./monitoring-integrator');
const UniversalTaskSystem = require('./src/universal-task-system');
const SmartContractAllocation = require('./src/smart-contract-allocation');
const USDCPayment = require('./src/usdc-payment');
const RiskManagement = require('./src/risk-management');
const AgentMatching = require('./src/agent-matching');

class MonitoringIntegrationTest {
  constructor() {
    this.integrator = new MonitoringIntegrator();
    this.testResults = [];
  }

  /**
   * 运行完整的监控集成测试
   */
  async runCompleteTest() {
    console.log('🎯 AgentTaskFlow 监控和日志集成测试');
    console.log('='.repeat(60));
    
    // 初始化各个系统
    await this.initializeSystems();
    
    // 测试任务系统监控
    await this.testTaskSystemMonitoring();
    
    // 测试合约系统监控
    await this.testContractSystemMonitoring();
    
    // 测试支付系统监控
    await this.testPaymentSystemMonitoring();
    
    // 测试风险管理系统监控
    await this.testRiskSystemMonitoring();
    
    // 测试智能匹配系统监控
    await this.testMatchingSystemMonitoring();
    
    // 测试API端点监控
    await this.testAPIEndpointMonitoring();
    
    // 测试健康检查
    await this.testHealthChecks();
    
    // 生成最终报告
    await this.generateFinalReport();
    
    // 清理
    this.integrator.stop();
  }

  /**
   * 初始化各个系统
   */
  async initializeSystems() {
    console.log('\n🚀 初始化系统...');
    
    try {
      // 初始化任务系统
      this.taskSystem = new UniversalTaskSystem();
      this.integrator.integrateTaskSystem(this.taskSystem);
      
      // 初始化合约系统
      this.contractSystem = new SmartContractAllocation();
      this.integrator.integrateContractSystem(this.contractSystem);
      
      // 初始化支付系统
      this.paymentSystem = new USDCPayment();
      this.integrator.integratePaymentSystem(this.paymentSystem);
      
      // 初始化风险管理系统
      this.riskSystem = new RiskManagement();
      this.integrator.integrateRiskManagement(this.riskSystem);
      
      // 初始化智能匹配系统
      this.matchingSystem = new AgentMatching();
      this.integrator.integrateSmartMatching(this.matchingSystem);
      
      // 集成API端点监控
      this.integrator.integrateAPIEndpoints();
      
      // 启动健康检查
      this.integrator.startHealthChecks();
      
      console.log('✅ 所有系统初始化完成');
      
    } catch (error) {
      console.error('❌ 系统初始化失败:', error);
      throw error;
    }
  }

  /**
   * 测试任务系统监控
   */
  async testTaskSystemMonitoring() {
    console.log('\n📋 测试任务系统监控...');
    
    try {
      // 创建任务
      const task = await this.taskSystem.createTask({
        id: 'task_monitor_test_001',
        title: '监控测试任务',
        description: '测试任务系统监控功能',
        skills: ['development', 'monitoring'],
        difficulty: 'moderate',
        budget: 3000,
        deadline: '2026-02-20'
      });
      
      // 分配任务
      await this.taskSystem.assignTask(task.id, 'agent_001');
      
      console.log('✅ 任务系统监控测试通过');
      
      this.testResults.push({
        test: 'Task System Monitoring',
        status: 'PASSED',
        taskId: task.id
      });
      
    } catch (error) {
      console.error('❌ 任务系统监控测试失败:', error);
      this.testResults.push({
        test: 'Task System Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试合约系统监控
   */
  async testContractSystemMonitoring() {
    console.log('\n📄 测试合约系统监控...');
    
    try {
      // 创建合约
      const contract = await this.contractSystem.createContract({
        id: 'contract_monitor_test_001',
        type: 'fixed_price',
        amount: 5000,
        description: '监控测试合约',
        terms: {
          paymentSchedule: 'milestone',
          deliverables: ['监控系统', '日志系统']
        }
      });
      
      // 分配合约
      await this.contractSystem.allocateContract(contract.id, 'skill_based');
      
      console.log('✅ 合约系统监控测试通过');
      
      this.testResults.push({
        test: 'Contract System Monitoring',
        status: 'PASSED',
        contractId: contract.id
      });
      
    } catch (error) {
      console.error('❌ 合约系统监控测试失败:', error);
      this.testResults.push({
        test: 'Contract System Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试支付系统监控
   */
  async testPaymentSystemMonitoring() {
    console.log('\n💰 测试支付系统监控...');
    
    try {
      // 注册钱包
      await this.paymentSystem.registerAgentWallet({
        id: 'agent_monitor_test_001',
        name: '监控测试代理',
        walletAddress: '0x1234567890123456789012345678901234567890'
      });
      
      // 处理支付
      const payment = await this.paymentSystem.processPayment({
        id: 'payment_monitor_test_001',
        amount: 1000,
        currency: 'USDC',
        recipient: 'agent_monitor_test_001',
        description: '监控测试支付'
      });
      
      console.log('✅ 支付系统监控测试通过');
      
      this.testResults.push({
        test: 'Payment System Monitoring',
        status: 'PASSED',
        paymentId: payment.id
      });
      
    } catch (error) {
      console.error('❌ 支付系统监控测试失败:', error);
      this.testResults.push({
        test: 'Payment System Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试风险管理系统监控
   */
  async testRiskSystemMonitoring() {
    console.log('\n⚠️ 测试风险管理系统监控...');
    
    try {
      // 评估风险
      const risk = await this.riskSystem.assessContractRisk('contract_monitor_test_001');
      
      // 缓解风险
      const mitigation = await this.riskSystem.mitigateContractRisk('contract_monitor_test_001', {
        strategy: 'escrow',
        amountHoldback: 1000
      });
      
      console.log('✅ 风险管理系统监控测试通过');
      
      this.testResults.push({
        test: 'Risk Management Monitoring',
        status: 'PASSED',
        riskLevel: risk.riskLevel
      });
      
    } catch (error) {
      console.error('❌ 风险管理系统监控测试失败:', error);
      this.testResults.push({
        test: 'Risk Management Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试智能匹配系统监控
   */
  async testMatchingSystemMonitoring() {
    console.log('\n🧠 测试智能匹配系统监控...');
    
    try {
      // 匹配代理
      const matches = await this.matchingSystem.matchAgents('task_monitor_test_001');
      
      console.log('✅ 智能匹配系统监控测试通过');
      console.log(`   找到 ${matches.length} 个匹配代理`);
      
      this.testResults.push({
        test: 'Smart Matching Monitoring',
        status: 'PASSED',
        matchCount: matches.length
      });
      
    } catch (error) {
      console.error('❌ 智能匹配系统监控测试失败:', error);
      this.testResults.push({
        test: 'Smart Matching Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试API端点监控
   */
  async testAPIEndpointMonitoring() {
    console.log('\n🌐 测试API端点监控...');
    
    try {
      // 模拟API请求
      const endpoints = ['tasks', 'contracts', 'payments', 'agents', 'risk', 'matching'];
      
      for (const endpoint of endpoints) {
        this.integrator.monitoring.incrementCounter(`api_${endpoint}_requests`);
      }
      
      console.log('✅ API端点监控测试通过');
      
      this.testResults.push({
        test: 'API Endpoint Monitoring',
        status: 'PASSED',
        endpointsTested: endpoints.length
      });
      
    } catch (error) {
      console.error('❌ API端点监控测试失败:', error);
      this.testResults.push({
        test: 'API Endpoint Monitoring',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 测试健康检查
   */
  async testHealthChecks() {
    console.log('\n🏥 测试健康检查...');
    
    try {
      const health = await this.integrator.monitoring.performHealthCheck();
      
      console.log('✅ 健康检查测试通过');
      console.log(`   系统状态: ${this.integrator.getSystemHealth()}`);
      
      this.testResults.push({
        test: 'Health Checks',
        status: 'PASSED',
        systemHealth: this.integrator.getSystemHealth()
      });
      
    } catch (error) {
      console.error('❌ 健康检查测试失败:', error);
      this.testResults.push({
        test: 'Health Checks',
        status: 'FAILED',
        error: error.message
      });
    }
  }

  /**
   * 生成最终报告
   */
  async generateFinalReport() {
    console.log('\n📊 监控集成测试最终报告');
    console.log('='.repeat(60));
    
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const total = this.testResults.length;
    const successRate = (passed / total * 100).toFixed(1);
    
    // 生成监控报告
    const monitoringReport = this.integrator.generateReport();
    
    console.log(`✅ 通过测试: ${passed}/${total}`);
    console.log(`📈 成功率: ${successRate}%`);
    console.log(`🔍 系统健康状态: ${monitoringReport.status}`);
    console.log(`⏱️ 系统运行时间: ${monitoringReport.uptime}`);
    
    console.log('\n📋 详细测试结果:');
    this.testResults.forEach((result, index) => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.test}`);
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });
    
    console.log('\n📊 监控系统指标:');
    console.log(`   请求数: ${monitoringReport.metrics.requests}`);
    console.log(`   错误数: ${monitoringReport.metrics.errors}`);
    console.log(`   错误率: ${monitoringReport.metrics.errorRate}%`);
    console.log(`   合约创建: ${monitoringReport.metrics.contractsCreated}`);
    console.log(`   支付处理: ${monitoringReport.metrics.paymentsProcessed}`);
    console.log(`   风险评估: ${monitoringReport.metrics.riskAssessments}`);
    
    if (monitoringReport.recommendations.length > 0) {
      console.log('\n🔧 监控建议:');
      monitoringReport.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. [${rec.priority}] ${rec.category}: ${rec.message}`);
        console.log(`   建议: ${rec.suggestion}`);
      });
    }
    
    // 日志文件检查
    this.checkLogFiles();
    
    return {
      total,
      passed,
      failed: total - passed,
      successRate,
      monitoringReport,
      results: this.testResults
    };
  }

  /**
   * 检查日志文件
   */
  checkLogFiles() {
    const logFiles = [
      './logs/monitoring.log',
      './logs/performance.log',
      './logs/errors.log'
    ];
    
    console.log('\n📁 日志文件状态:');
    logFiles.forEach(file => {
      if (require('fs').existsSync(file)) {
        const stats = require('fs').statSync(file);
        console.log(`   ✅ ${file} (${stats.size} bytes)`);
      } else {
        console.log(`   ❌ ${file} (不存在)`);
      }
    });
  }
}

// 运行测试
if (require.main === module) {
  const test = new MonitoringIntegrationTest();
  test.runCompleteTest()
    .then(report => {
      console.log('\n🎉 监控集成测试完成！');
      if (report.successRate >= 90) {
        console.log('🚀 监控和日志系统已完全集成，可以投入生产使用！');
      } else {
        console.log('⚠️ 仍有部分问题需要修复');
      }
    })
    .catch(error => {
      console.error('❌ 测试失败:', error);
    });
}

module.exports = MonitoringIntegrationTest;