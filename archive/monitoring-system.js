/**
 * AgentTaskFlow 监控和日志系统
 * AgentTaskFlow Monitoring and Logging System
 * 
 * 实现系统监控、日志记录和性能跟踪
 */

const fs = require('fs');
const path = require('path');

class MonitoringSystem {
  constructor() {
    this.logFile = './logs/monitoring.log';
    this.performanceLog = './logs/performance.log';
    this.errorLog = './logs/errors.log';
    this.metrics = {
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      contractsCreated: 0,
      paymentsProcessed: 0,
      riskAssessments: 0,
      activeConnections: 0
    };
    
    // 确保日志目录存在
    this.ensureLogDirectory();
    
    // 性能监控
    this.performanceData = [];
    
    // 错误跟踪
    this.errors = [];
    
    // 系统健康检查
    this.healthChecks = {
      database: { status: 'healthy', lastCheck: Date.now() },
      payment: { status: 'healthy', lastCheck: Date.now() },
      contract: { status: 'healthy', lastCheck: Date.now() },
      api: { status: 'healthy', lastCheck: Date.now() }
    };
  }

  /**
   * 确保日志目录存在
   */
  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * 记录信息日志
   */
  log(message, level = 'INFO', context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      context: context,
      metrics: { ...this.metrics }
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    // 写入主日志文件
    fs.appendFileSync(this.logFile, logLine);
    
    // 根据日志级别写入不同文件
    if (level === 'ERROR') {
      fs.appendFileSync(this.errorLog, logLine);
      this.metrics.errors++;
    }
    
    console.log(`[${level}] ${message}`);
  }

  /**
   * 记录性能数据
   */
  logPerformance(operation, duration, details = {}) {
    const performanceEntry = {
      timestamp: new Date().toISOString(),
      operation: operation,
      duration: duration,
      details: details,
      metrics: { ...this.metrics }
    };
    
    this.performanceData.push(performanceEntry);
    
    // 写入性能日志
    const perfLine = JSON.stringify(performanceEntry) + '\n';
    fs.appendFileSync(this.performanceLog, perfLine);
    
    // 记录慢操作
    if (duration > 1000) { // 超过1秒的操作
      this.log(`慢操作检测: ${operation} 耗时 ${duration}ms`, 'WARN', { operation, duration });
    }
  }

  /**
   * 记录错误
   */
  logError(error, context = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      context: context,
      metrics: { ...this.metrics }
    };
    
    this.errors.push(errorEntry);
    
    // 写入错误日志
    const errorLine = JSON.stringify(errorEntry) + '\n';
    fs.appendFileSync(this.errorLog, errorLine);
    
    this.metrics.errors++;
    this.log(`错误: ${error.message}`, 'ERROR', context);
  }

  /**
   * 增加计数器
   */
  incrementCounter(name) {
    if (this.metrics[name] !== undefined) {
      this.metrics[name]++;
    } else {
      this.metrics[name] = 1;
    }
    
    this.log(`计数器增加: ${name}`, 'DEBUG', { newValue: this.metrics[name] });
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    const results = {};
    
    // 检查数据库连接
    try {
      // 模拟数据库检查
      results.database = { status: 'healthy', responseTime: Math.random() * 100 };
    } catch (error) {
      results.database = { status: 'unhealthy', error: error.message };
    }
    
    // 检查支付系统
    try {
      // 模拟支付系统检查
      results.payment = { status: 'healthy', responseTime: Math.random() * 200 };
    } catch (error) {
      results.payment = { status: 'unhealthy', error: error.message };
    }
    
    // 检查合约系统
    try {
      // 模拟合约系统检查
      results.contract = { status: 'healthy', responseTime: Math.random() * 150 };
    } catch (error) {
      results.contract = { status: 'unhealthy', error: error.message };
    }
    
    // 检查API服务
    try {
      // 模拟API检查
      results.api = { status: 'healthy', responseTime: Math.random() * 50 };
    } catch (error) {
      results.api = { status: 'unhealthy', error: error.message };
    }
    
    // 更新健康检查状态
    Object.keys(results).forEach(key => {
      this.healthChecks[key] = {
        status: results[key].status,
        lastCheck: Date.now(),
        responseTime: results[key].responseTime
      };
    });
    
    // 记录健康检查结果
    const overallHealth = Object.values(results).every(r => r.status === 'healthy') ? 'healthy' : 'degraded';
    
    this.log(`健康检查完成: ${overallHealth}`, 'INFO', results);
    
    return {
      overall: overallHealth,
      checks: results,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 获取系统指标
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    
    return {
      uptime: uptime,
      uptimeFormatted: this.formatUptime(uptime),
      requests: this.metrics.requests,
      errors: this.metrics.errors,
      contractsCreated: this.metrics.contractsCreated,
      paymentsProcessed: this.metrics.paymentsProcessed,
      riskAssessments: this.metrics.riskAssessments,
      activeConnections: this.metrics.activeConnections,
      errorRate: this.metrics.requests > 0 ? (this.metrics.errors / this.metrics.requests * 100).toFixed(2) : 0,
      healthChecks: this.healthChecks,
      performanceStats: this.getPerformanceStats()
    };
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    if (this.performanceData.length === 0) {
      return { message: '无性能数据' };
    }
    
    const durations = this.performanceData.map(p => p.duration);
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    
    return {
      totalOperations: this.performanceData.length,
      averageDuration: avgDuration.toFixed(2),
      maxDuration: maxDuration,
      minDuration: minDuration,
      slowOperations: this.performanceData.filter(p => p.duration > 1000).length
    };
  }

  /**
   * 格式化运行时间
   */
  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
    } else if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟 ${seconds % 60}秒`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 生成监控报告
   */
  generateReport() {
    const metrics = this.getMetrics();
    
    const report = {
      timestamp: new Date().toISOString(),
      systemHealth: metrics.overall,
      uptime: metrics.uptimeFormatted,
      keyMetrics: {
        totalRequests: metrics.requests,
        totalErrors: metrics.errors,
        errorRate: `${metrics.errorRate}%`,
        contractsCreated: metrics.contractsCreated,
        paymentsProcessed: metrics.paymentsProcessed,
        riskAssessments: metrics.riskAssessments
      },
      performance: metrics.performanceStats,
      healthChecks: metrics.healthChecks,
      recommendations: this.generateRecommendations(metrics)
    };
    
    // 保存报告
    const reportFile = `./logs/monitoring-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    this.log('监控报告已生成', 'INFO', { reportFile });
    
    return report;
  }

  /**
   * 生成改进建议
   */
  generateRecommendations(metrics) {
    const recommendations = [];
    
    // 错误率建议
    if (parseFloat(metrics.errorRate) > 5) {
      recommendations.push({
        priority: 'HIGH',
        category: '错误率',
        message: '错误率过高，需要检查系统稳定性',
        suggestion: '检查日志中的错误模式，考虑增加重试机制'
      });
    }
    
    // 性能建议
    if (metrics.performanceStats.slowOperations > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: '性能',
        message: `检测到 ${metrics.performanceStats.slowOperations} 个慢操作`,
        suggestion: '优化慢操作，考虑增加缓存或数据库索引'
      });
    }
    
    // 健康检查建议
    const unhealthyChecks = Object.values(metrics.healthChecks).filter(h => h.status !== 'healthy');
    if (unhealthyChecks.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: '健康检查',
        message: `${unhealthyChecks.length} 个健康检查失败`,
        suggestion: '立即检查失败的服务，考虑增加冗余'
      });
    }
    
    // 使用率建议
    if (metrics.activeConnections > 100) {
      recommendations.push({
        priority: 'MEDIUM',
        category: '容量',
        message: '连接数较高，接近容量上限',
        suggestion: '考虑水平扩展或优化连接池'
      });
    }
    
    return recommendations;
  }

  /**
   * 清理旧日志
   */
  cleanupOldLogs(days = 30) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const logFiles = ['./logs/monitoring.log', './logs/performance.log', './logs/errors.log'];
    
    logFiles.forEach(file => {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(file);
          this.log(`清理旧日志文件: ${file}`, 'INFO');
        }
      }
    });
  }

  /**
   * 启动监控
   */
  start() {
    this.log('监控系统启动', 'INFO');
    
    // 定期健康检查
    setInterval(() => {
      this.performHealthCheck().catch(error => {
        this.logError(error, { context: 'health_check' });
      });
    }, 30000); // 每30秒检查一次
    
    // 定期生成报告
    setInterval(() => {
      this.generateReport();
    }, 300000); // 每5分钟生成一次报告
    
    // 定期清理日志
    setInterval(() => {
      this.cleanupOldLogs();
    }, 86400000); // 每天清理一次
    
    this.log('监控任务已启动', 'INFO');
  }

  /**
   * 停止监控
   */
  stop() {
    this.log('监控系统停止', 'INFO');
    this.generateReport(); // 生成最终报告
  }
}

// 创建性能监控装饰器
function performanceMonitor(operationName) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        // 记录性能数据
        if (global.monitoringSystem) {
          global.monitoringSystem.logPerformance(operationName, duration, { success: true });
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        // 记录错误性能数据
        if (global.monitoringSystem) {
          global.monitoringSystem.logPerformance(operationName, duration, { success: false, error: error.message });
          global.monitoringSystem.logError(error, { operation: operationName });
        }
        
        throw error;
      }
    };
    
    return descriptor;
  };
}

// 如果直接运行此文件
if (require.main === module) {
  const monitoring = new MonitoringSystem();
  monitoring.start();
  
  // 模拟一些操作
  setTimeout(() => {
    monitoring.incrementCounter('requests');
    monitoring.incrementCounter('contractsCreated');
  }, 1000);
  
  setTimeout(() => {
    monitoring.incrementCounter('paymentsProcessed');
  }, 2000);
  
  setTimeout(() => {
    monitoring.stop();
    console.log('\n📊 监控报告:');
    console.log(JSON.stringify(monitoring.generateReport(), null, 2));
  }, 5000);
}

module.exports = { MonitoringSystem, performanceMonitor };