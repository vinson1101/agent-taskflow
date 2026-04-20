/**
 * AgentTaskFlow 测试案例配置
 * Test Case Configuration for AgentTaskFlow
 */

// 测试环境配置 | Test Environment Configuration
const testConfig = {
  // 基础配置 | Basic Configuration
  environment: 'development',
  debug: true,
  logLevel: 'debug',
  
  // 测试数据 | Test Data
  testAgents: [
    {
      id: 'agent_001',
      name: 'Alice',
      skills: ['development', 'design'],
      rating: 4.5,
      availability: true
    },
    {
      id: 'agent_002', 
      name: 'Bob',
      skills: ['development', 'testing'],
      rating: 4.2,
      availability: true
    },
    {
      id: 'agent_003',
      name: 'Charlie',
      skills: ['design', 'marketing'],
      rating: 4.8,
      availability: false
    }
  ],
  
  testTasks: [
    {
      id: 'task_001',
      title: 'Website Development',
      description: 'Build a modern responsive website',
      skills: ['development', 'design'],
      difficulty: 'medium',
      budget: 5000,
      deadline: '2026-02-15',
      timeRange: {
        start: '2026-02-05',
        end: '2026-02-15'
      }
    },
    {
      id: 'task_002',
      title: 'API Testing',
      description: 'Comprehensive API testing suite',
      skills: ['testing', 'development'],
      difficulty: 'high',
      budget: 3000,
      deadline: '2026-02-10',
      timeRange: {
        start: '2026-02-05',
        end: '2026-02-10'
      }
    },
    {
      id: 'task_003',
      title: 'Logo Design',
      description: 'Create a professional logo design',
      skills: ['design'],
      difficulty: 'low',
      budget: 1000,
      deadline: '2026-02-08',
      timeRange: {
        start: '2026-02-05',
        end: '2026-02-08'
      }
    }
  ],
  
  // 测试场景 | Test Scenarios
  scenarios: {
    basicTaskAllocation: {
      name: 'Basic Task Allocation',
      description: '测试基本任务分配功能',
      steps: [
        '创建任务',
        '匹配代理',
        '分配任务',
        '确认分配'
      ]
    },
    
    smartMatching: {
      name: 'Smart Agent Matching',
      description: '测试智能代理匹配算法',
      steps: [
        '分析任务需求',
        '评估代理技能',
        '计算匹配分数',
        '选择最佳代理'
      ]
    },
    
    paymentProcessing: {
      name: 'USDC Payment Processing',
      description: '测试USDC支付系统',
      steps: [
        '任务完成确认',
        '费用计算',
        '支付处理',
        '状态更新'
      ]
    },
    
    collaboration: {
      name: 'Multi-Agent Collaboration',
      description: '测试多代理协作功能',
      steps: [
        '团队组建',
        '任务分配',
        '进度跟踪',
        '质量评估'
      ]
    }
  }
};

// 导出配置 | Export Configuration
module.exports = testConfig;