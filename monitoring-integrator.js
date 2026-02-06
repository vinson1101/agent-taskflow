/**
 * AgentTaskFlow 监控和日志系统集成器
 * AgentTaskFlow Monitoring & Logging System Integrator
 * 
 * 将监控系统集成到所有核心模块中
 */

const { MonitoringSystem, performanceMonitor } = require('./monitoring-system');

class MonitoringIntegrator {
  constructor() {
    this.monitoring = new MonitoringSystem();
    this.globalMonitoring = this.monitoring;
    this.initializeMonitoring();
  }

  /**
   * 初始化监控系统
   */
  initializeMonitoring() {
    // 设置全局监控实例
    global.monitoringSystem = this.monitoring;
    
    // 初始化监控
    this.monitoring.start();
    
    console.log('🔍 监控系统已启动 | Monitoring system started');
  }

  /**
   * 为任务系统添加监控
   */
  integrateTaskSystem(taskSystem) {
    // 包装任务创建方法
    const originalCreateTask = taskSystem.createTask;
    taskSystem.createTask = function(taskData) {
      this.monitoring.incrementCounter('requests');
      this.monitoring.incrementCounter('tasksCreated');
      
      const startTime = Date.now();
      
      try {
        const result = originalCreateTask.call(this, taskData);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('task_creation', duration, { 
          success: true, 
          taskId: result.id,
          taskType: taskData.type 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('task_creation', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'task_creation' });
        
        throw error;
      }
    }.bind(this);

    // 包装任务分配方法
    const originalAssignTask = taskSystem.assignTask;
    taskSystem.assignTask = function(taskId, agentId) {
      this.monitoring.incrementCounter('taskAssignments');
      
      const startTime = Date.now();
      
      try {
        const result = originalAssignTask.call(this, taskId, agentId);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('task_assignment', duration, { 
          success: true, 
          taskId,
          agentId 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('task_assignment', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'task_assignment' });
        
        throw error;
      }
    }.bind(this);

    console.log('📋 任务系统监控已集成 | Task system monitoring integrated');
  }

  /**
   * 为合约系统添加监控
   */
  integrateContractSystem(contractSystem) {
    // 包装合约创建方法
    const originalCreateContract = contractSystem.createContract;
    contractSystem.createContract = function(contractData) {
      this.monitoring.incrementCounter('contractsCreated');
      
      const startTime = Date.now();
      
      try {
        const result = originalCreateContract.call(this, contractData);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('contract_creation', duration, { 
          success: true, 
          contractId: result.id,
          contractType: contractData.type 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('contract_creation', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'contract_creation' });
        
        throw error;
      }
    }.bind(this);

    // 包装合约分配方法
    const originalAllocateContract = contractSystem.allocateContract;
    contractSystem.allocateContract = function(contractId, strategy) {
      this.monitoring.incrementCounter('contractAllocations');
      
      const startTime = Date.now();
      
      try {
        const result = originalAllocateContract.call(this, contractId, strategy);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('contract_allocation', duration, { 
          success: true, 
          contractId,
          strategy 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('contract_allocation', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'contract_allocation' });
        
        throw error;
      }
    }.bind(this);

    console.log('📄 合约系统监控已集成 | Contract system monitoring integrated');
  }

  /**
   * 为支付系统添加监控
   */
  integratePaymentSystem(paymentSystem) {
    // 包装支付处理方法
    const originalProcessPayment = paymentSystem.processPayment;
    paymentSystem.processPayment = function(paymentData) {
      this.monitoring.incrementCounter('paymentsProcessed');
      
      const startTime = Date.now();
      
      try {
        const result = originalProcessPayment.call(this, paymentData);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('payment_processing', duration, { 
          success: true, 
          paymentId: result.id,
          amount: paymentData.amount 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('payment_processing', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'payment_processing' });
        
        throw error;
      }
    }.bind(this);

    // 包装钱包注册方法
    const originalRegisterWallet = paymentSystem.registerAgentWallet;
    paymentSystem.registerAgentWallet = function(agentData) {
      this.monitoring.incrementCounter('walletRegistrations');
      
      const startTime = Date.now();
      
      try {
        const result = originalRegisterWallet.call(this, agentData);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('wallet_registration', duration, { 
          success: true, 
          agentId: agentData.id 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('wallet_registration', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'wallet_registration' });
        
        throw error;
      }
    }.bind(this);

    console.log('💰 支付系统监控已集成 | Payment system monitoring integrated');
  }

  /**
   * 为风险管理系统添加监控
   */
  integrateRiskManagement(riskSystem) {
    // 包装风险评估方法
    const originalAssessRisk = riskSystem.assessContractRisk;
    riskSystem.assessContractRisk = function(contractId) {
      this.monitoring.incrementCounter('riskAssessments');
      
      const startTime = Date.now();
      
      try {
        const result = originalAssessRisk.call(this, contractId);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('risk_assessment', duration, { 
          success: true, 
          contractId,
          riskLevel: result.riskLevel 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('risk_assessment', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'risk_assessment' });
        
        throw error;
      }
    }.bind(this);

    // 包装风险缓解方法
    const originalMitigateRisk = riskSystem.mitigateContractRisk;
    riskSystem.mitigateContractRisk = function(contractId, strategy) {
      this.monitoring.incrementCounter('riskMitigations');
      
      const startTime = Date.now();
      
      try {
        const result = originalMitigateRisk.call(this, contractId, strategy);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('risk_mitigation', duration, { 
          success: true, 
          contractId,
          strategy: strategy.strategy 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('risk_mitigation', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'risk_mitigation' });
        
        throw error;
      }
    }.bind(this);

    console.log('⚠️ 风险管理系统监控已集成 | Risk management monitoring integrated');
  }

  /**
   * 为智能匹配系统添加监控
   */
  integrateSmartMatching(matchingSystem) {
    // 包装匹配方法
    const originalMatchAgents = matchingSystem.matchAgents;
    matchingSystem.matchAgents = function(taskId) {
      this.monitoring.incrementCounter('agentMatches');
      
      const startTime = Date.now();
      
      try {
        const result = originalMatchAgents.call(this, taskId);
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('agent_matching', duration, { 
          success: true, 
          taskId,
          matches: result.length 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.monitoring.logPerformance('agent_matching', duration, { 
          success: false, 
          error: error.message 
        });
        this.monitoring.logError(error, { operation: 'agent_matching' });
        
        throw error;
      }
    }.bind(this);

    console.log('🧠 智能匹配系统监控已集成 | Smart matching monitoring integrated');
  }

  /**
   * 添加API端点监控
   */
  integrateAPIEndpoints() {
    // 模拟API端点监控
    const apiEndpoints = [
      'tasks',
      'contracts', 
      'payments',
      'agents',
      'risk',
      'matching'
    ];

    apiEndpoints.forEach(endpoint => {
      this.monitoring.incrementCounter(`api_${endpoint}_requests`);
    });

    console.log('🌐 API端点监控已集成 | API endpoints monitoring integrated');
  }

  /**
   * 启动定期健康检查
   */
  startHealthChecks() {
    // 每30秒执行一次健康检查
    setInterval(() => {
      this.monitoring.performHealthCheck()
        .then(health => {
          console.log('🏥 系统健康检查完成:', health);
        })
        .catch(error => {
          console.error('❌ 健康检查失败:', error);
        });
    }, 30000);

    console.log('🏥 定期健康检查已启动 | Health checks started');
  }

  /**
   * 生成监控报告
   */
  generateReport() {
    const metrics = this.monitoring.getMetrics();
    const recommendations = this.monitoring.generateRecommendations(metrics);
    
    return {
      timestamp: new Date().toISOString(),
      metrics,
      recommendations,
      uptime: metrics.uptimeFormatted,
      status: this.monitoring.getSystemHealth()
    };
  }

  /**
   * 获取系统健康状态
   */
  getSystemHealth() {
    const metrics = this.monitoring.getMetrics();
    const errorRate = parseFloat(metrics.errorRate);
    
    if (errorRate > 10) return 'critical';
    if (errorRate > 5) return 'warning';
    if (errorRate > 2) return 'degraded';
    return 'healthy';
  }

  /**
   * 停止监控系统
   */
  stop() {
    this.monitoring.stop();
    console.log('🔍 监控系统已停止 | Monitoring system stopped');
  }
}

// 如果直接运行此文件
if (require.main === module) {
  const integrator = new MonitoringIntegrator();
  
  // 模拟一些操作
  setTimeout(() => {
    console.log('\n📊 监控报告:');
    console.log(JSON.stringify(integrator.generateReport(), null, 2));
  }, 3000);
  
  setTimeout(() => {
    integrator.stop();
  }, 10000);
}

module.exports = MonitoringIntegrator;