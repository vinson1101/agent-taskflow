/**
 * AgentTaskFlow 测试运行器
 * AgentTaskFlow Test Runner
 * 
 * 这个文件用于运行所有的测试案例
 * This file is used to run all test cases
 */

const BasicFunctionalityTests = require('./demo/basic-functionality-tests');
const SmartMatchingTests = require('./demo/smart-matching-tests');
const ContractPaymentVerificationTests = require('./demo/contract-payment-verification-tests');

class TestRunner {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * 运行所有测试
   * Run All Tests
   */
  async runAllTests() {
    console.log('🚀 AgentTaskFlow 测试套件 | AgentTaskFlow Test Suite');
    console.log('='.repeat(60));
    console.log('开始时间 | Start Time:', new Date().toISOString());
    this.startTime = Date.now();
    
    try {
      // 运行基础功能测试 | Run Basic Functionality Tests
      console.log('\n📋 第一阶段: 基础功能测试 | Phase 1: Basic Functionality Tests');
      console.log('-'.repeat(50));
      
      const basicTests = new BasicFunctionalityTests();
      const basicResults = await basicTests.runAllTests();
      this.results.push({
        suite: 'Basic Functionality',
        ...basicResults
      });

      // 运行智能匹配测试 | Run Smart Matching Tests
      console.log('\n📋 第二阶段: 智能匹配测试 | Phase 2: Smart Matching Tests');
      console.log('-'.repeat(50));
      
      const smartTests = new SmartMatchingTests();
      const smartResults = await smartTests.runAllTests();
      this.results.push({
        suite: 'Smart Matching',
        ...smartResults
      });

      // 运行合约和支付验证测试 | Run Contract and Payment Verification Tests
      console.log('\n📋 第三阶段: 合约和支付验证测试 | Phase 3: Contract and Payment Verification Tests');
      console.log('-'.repeat(50));
      
      const contractTests = new ContractPaymentVerificationTests();
      const contractResults = await contractTests.runAllTests();
      this.results.push({
        suite: 'Contract and Payment Verification',
        ...contractResults
      });

      // 生成最终报告 | Generate Final Report
      this.generateFinalReport();
      
    } catch (error) {
      console.error('❌ 测试运行失败 | Test execution failed:', error);
      this.generateErrorReport(error);
    }
  }

  /**
   * 生成最终测试报告
   * Generate Final Test Report
   */
  generateFinalReport() {
    this.endTime = Date.now();
    const totalTime = this.endTime - this.startTime;
    
    console.log('\n📊 最终测试报告 | Final Test Report');
    console.log('='.repeat(60));
    console.log(`⏱️ 总耗时 | Total Time: ${this.formatTime(totalTime)}`);
    console.log(`📅 开始时间 | Start Time: ${new Date(this.startTime).toISOString()}`);
    console.log(`📅 结束时间 | End Time: ${new Date(this.endTime).toISOString()}`);
    
    // 汇总结果 | Summary Results
    const totalSuites = this.results.length;
    const passedSuites = this.results.filter(result => result.passed === result.total).length;
    const failedSuites = totalSuites - passedSuites;
    
    console.log('\n📈 测试套件汇总 | Test Suite Summary:');
    console.log(`✅ 通过套件: ${passedSuites}/${totalSuites} | Passed Suites: ${passedSuites}/${totalSuites}`);
    console.log(`❌ 失败套件: ${failedSuites}/${totalSuites} | Failed Suites: ${failedSuites}/${totalSuites}`);
    
    // 详细每个套件的结果 | Detailed results for each suite
    this.results.forEach((suite, index) => {
      console.log(`\n📋 套件 ${index + 1}: ${suite.suite}`);
      console.log(`   总测试数 | Total Tests: ${suite.total}`);
      console.log(`   通过数 | Passed: ${suite.passed}`);
      console.log(`   失败数 | Failed: ${suite.failed}`);
      console.log(`   成功率 | Success Rate: ${suite.successRate}%`);
      
      if (suite.results) {
        suite.results.forEach(test => {
          const status = test.status === 'PASSED' ? '✅' : '❌';
          console.log(`   ${status} ${test.test}`);
        });
      }
    });
    
    // 整体成功率 | Overall Success Rate
    const totalTests = this.results.reduce((sum, suite) => sum + suite.total, 0);
    const totalPassed = this.results.reduce((sum, suite) => sum + suite.passed, 0);
    const overallSuccessRate = (totalPassed / totalTests * 100).toFixed(1);
    
    console.log(`\n🎯 整体成功率 | Overall Success Rate: ${overallSuccessRate}%`);
    console.log(`📊 总测试数 | Total Tests: ${totalTests}`);
    console.log(`✅ 总通过数 | Total Passed: ${totalPassed}`);
    console.log(`❌ 总失败数 | Total Failed: ${totalTests - totalPassed}`);
    
    // 建议 | Recommendations
    this.generateRecommendations();
  }

  /**
   * 生成错误报告
   * Generate Error Report
   */
  generateErrorReport(error) {
    console.log('\n❌ 测试运行错误 | Test Execution Error');
    console.log('='.repeat(60));
    console.log(`错误信息 | Error: ${error.message}`);
    console.log(`错误堆栈 | Stack: ${error.stack}`);
    
    console.log('\n🔧 调试建议 | Debugging Suggestions:');
    console.log('1. 检查依赖包是否正确安装 | Check if dependencies are properly installed');
    console.log('2. 验证配置文件是否正确 | Verify configuration files are correct');
    console.log('3. 检查网络连接 | Check network connection');
    console.log('4. 查看详细日志 | Check detailed logs');
  }

  /**
   * 生成建议
   * Generate Recommendations
   */
  generateRecommendations() {
    console.log('\n💡 改进建议 | Improvement Suggestions');
    console.log('='.repeat(60));
    
    const failedSuites = this.results.filter(suite => suite.failed > 0);
    
    if (failedSuites.length > 0) {
      console.log('🔴 需要关注的领域 | Areas Needing Attention:');
      failedSuites.forEach(suite => {
        console.log(`• ${suite.suite}: ${suite.failed} 个测试失败`);
      });
    } else {
      console.log('🟢 所有测试都通过了！ | All tests passed!');
    }
    
    console.log('\n📈 优化建议 | Optimization Suggestions:');
    console.log('1. 考虑添加更多边界测试 | Consider adding more edge case tests');
    console.log('2. 实现自动化测试报告 | Implement automated test reporting');
    console.log('3. 添加性能测试 | Add performance tests');
    console.log('4. 考虑集成测试 | Consider integration tests');
    
    console.log('\n🚀 下一步 | Next Steps:');
    console.log('1. 修复失败的测试 | Fix failed tests');
    console.log('2. 优化匹配算法 | Optimize matching algorithms');
    console.log('3. 添加更多测试用例 | Add more test cases');
    console.log('4. 准备生产环境部署 | Prepare for production deployment');
  }

  /**
   * 格式化时间
   * Format Time
   */
  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 运行特定测试套件
   * Run Specific Test Suite
   */
  async runSpecificTest(suiteName) {
    console.log(`🎯 运行特定测试套件: ${suiteName}`);
    console.log('='.repeat(50));
    
    switch (suiteName.toLowerCase()) {
      case 'basic':
        const basicTests = new BasicFunctionalityTests();
        await basicTests.runAllTests();
        break;
      case 'smart':
        const smartTests = new SmartMatchingTests();
        await smartTests.runAllTests();
        break;
      case 'contract':
        const contractTests = new ContractPaymentVerificationTests();
        await contractTests.runAllTests();
        break;
      default:
        console.log(`❌ 未知的测试套件: ${suiteName}`);
        console.log('可用的套件: basic, smart, contract');
    }
  }
}

// 命令行参数处理 | Command Line Argument Processing
const args = process.argv.slice(2);
const runner = new TestRunner();

// 如果指定了测试套件 | If test suite is specified
if (args.length > 0) {
  const suiteName = args[0];
  runner.runSpecificTest(suiteName).catch(console.error);
} else {
  // 运行所有测试 | Run all tests
  runner.runAllTests().catch(console.error);
}

module.exports = TestRunner;