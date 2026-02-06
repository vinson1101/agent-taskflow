const SmartContractTaskAllocation = require('./smart-contract-allocation.js');

// 智能合约分配系统演示
async function smartContractDemo() {
  console.log('🤖 智能合约任务分配系统演示\n');
  
  // 初始化系统
  const allocationSystem = new SmartContractTaskAllocation();
  
  console.log('📋 1. 合约模板初始化...');
  
  // 显示可用的合约模板
  console.log('📋 可用合约模板:');
  for (const [templateId, template] of allocationSystem.contractTemplates) {
    console.log(`  ${templateId}: ${template.name}`);
    console.log(`    类型: ${template.type}`);
    console.log(`    支付结构: ${template.paymentStructure}`);
    console.log(`    风险等级: ${template.riskLevel}`);
    console.log(`    要求: ${template.requirements.join(', ')}`);
    console.log('');
  }
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 2. 创建智能合约...');
  
  // 创建不同类型的合约
  const contracts = [
    {
      taskId: 'task_1',
      contractType: 'fixed_price',
      allocationStrategy: 'skill_based',
      terms: {
        value: 1000,
        duration: '2weeks',
        deliverables: ['登录页面', '用户管理模块']
      }
    },
    {
      taskId: 'task_2',
      contractType: 'time_materials',
      allocationStrategy: 'performance_based',
      terms: {
        hourlyRate: 80,
        maxHours: 40,
        deliverables: ['API文档', '测试报告']
      }
    },
    {
      taskId: 'task_3',
      contractType: 'milestone',
      allocationStrategy: 'collaboration_based',
      terms: {
        milestones: ['设计稿', '原型', '最终产品'],
        payments: [300, 400, 500],
        duration: '3weeks'
      }
    },
    {
      taskId: 'task_4',
      contractType: 'auction',
      allocationStrategy: 'hybrid',
      terms: {
        budget: 2000,
        deadline: '1week',
        requirements: ['响应式设计', '移动端适配']
      }
    }
  ];
  
  const createdContracts = [];
  contracts.forEach(contractConfig => {
    const contract = allocationSystem.createContract(
      contractConfig.taskId,
      contractConfig.contractType,
      contractConfig.allocationStrategy,
      contractConfig.terms
    );
    createdContracts.push(contract);
    
    console.log(`✅ 创建合约: ${contract.id}`);
    console.log(`   任务: ${contract.taskId}`);
    console.log(`   类型: ${contract.contractType}`);
    console.log(`   策略: ${contract.allocationStrategy}`);
    console.log(`   价值: $${contract.terms.value || 'N/A'}`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('👥 3. 创建候选人池...');
  
  // 创建多样化的候选人
  const candidates = [
    {
      id: 'candidate_1',
      name: '张三',
      skills: ['javascript', 'react', 'css'],
      experience: {
        'web_development': { years: 3, projects: 15 }
      },
      availability: 'immediate',
      performance: {
        tasksCompleted: 20,
        tasksAssigned: 25,
        tasksOnTime: 18
      },
      reliability: {
        consistentTasks: 18,
        totalTasks: 20,
        revisions: 2
      },
      quality: {
        averageScore: 88,
        improvementRate: 0.15
      },
      collaboration: {
        helpCount: 12,
        mentorship: 3,
        teamwork: 8
      },
      personality: {
        teamOriented: true,
        innovative: true,
        attentive: true
      },
      communication: {
        clarity: 85,
        responsiveness: 90,
        collaboration: 88
      }
    },
    {
      id: 'candidate_2',
      name: '李四',
      skills: ['python', 'django', 'sql'],
      experience: {
        'backend_development': { years: 4, projects: 20 }
      },
      availability: 'withinWeek',
      performance: {
        tasksCompleted: 25,
        tasksAssigned: 28,
        tasksOnTime: 23
      },
      reliability: {
        consistentTasks: 22,
        totalTasks: 25,
        revisions: 1
      },
      quality: {
        averageScore: 92,
        improvementRate: 0.20
      },
      collaboration: {
        helpCount: 8,
        mentorship: 5,
        teamwork: 12
      },
      personality: {
        teamOriented: true,
        selfDirected: true,
        attentive: false
      },
      communication: {
        clarity: 90,
        responsiveness: 85,
        collaboration: 92
      }
    },
    {
      id: 'candidate_3',
      name: '王五',
      skills: ['design', 'figma', 'ui'],
      experience: {
        'ui_design': { years: 2, projects: 10 }
      },
      availability: 'withinMonth',
      performance: {
        tasksCompleted: 15,
        tasksAssigned: 18,
        tasksOnTime: 14
      },
      reliability: {
        consistentTasks: 13,
        totalTasks: 15,
        revisions: 3
      },
      quality: {
        averageScore: 85,
        improvementRate: 0.10
      },
      collaboration: {
        helpCount: 15,
        mentorship: 2,
        teamwork: 10
      },
      personality: {
        teamOriented: false,
        innovative: true,
        attentive: true
      },
      communication: {
        clarity: 80,
        responsiveness: 75,
        collaboration: 85
      }
    },
    {
      id: 'candidate_4',
      name: '赵六',
      skills: ['testing', 'qa', 'automation'],
      experience: {
        'testing': { years: 3, projects: 12 }
      },
      availability: 'immediate',
      performance: {
        tasksCompleted: 18,
        tasksAssigned: 20,
        tasksOnTime: 17
      },
      reliability: {
        consistentTasks: 16,
        totalTasks: 18,
        revisions: 1
      },
      quality: {
        averageScore: 90,
        improvementRate: 0.18
      },
      collaboration: {
        helpCount: 10,
        mentorship: 4,
        teamwork: 9
      },
      personality: {
        teamOriented: true,
        selfDirected: true,
        attentive: true
      },
      communication: {
        clarity: 88,
        responsiveness: 92,
        collaboration: 90
      }
    }
  ];
  
  candidates.forEach(candidate => {
    console.log(`👤 ${candidate.name} (${candidate.id})`);
    console.log(`   技能: ${candidate.skills.join(', ')}`);
    console.log(`   经验: ${candidate.experience.web_development?.years || 0}年`);
    console.log(`   可用性: ${candidate.availability}`);
    console.log(`   绩效: ${candidate.performance.tasksCompleted}/${candidate.performance.tasksAssigned} 完成`);
    console.log(`   质量: ${candidate.quality.averageScore}%`);
    console.log(`   协作: 帮助${candidate.collaboration.helpCount}次, 指导${candidate.collaboration.mentorship}次`);
    console.log('');
  });
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 4. 执行智能合约分配...');
  
  // 为每个合约执行不同的分配策略
  for (const contract of createdContracts) {
    console.log(`🎯 合约 ${contract.id} (${contract.contractType}) - ${contract.allocationStrategy} 分配:`);
    console.log('');
    
    try {
      const allocationResult = await allocationSystem.allocateContract(
        contract.id,
        candidates,
        contract.allocationStrategy
      );
      
      if (allocationResult.topCandidate) {
        console.log(`🏆 最佳候选人: ${allocationResult.topCandidate.candidate.name}`);
        console.log(`   综合评分: ${allocationResult.confidence.toFixed(1)}%`);
        console.log(`   分配策略: ${allocationResult.strategy}`);
        console.log(`   推荐理由: ${allocationResult.reasoning}`);
        console.log('');
        
        console.log(`📊 详细评分:`);
        const breakdown = allocationResult.topCandidate.breakdown;
        for (const [key, score] of Object.entries(breakdown)) {
          console.log(`   ${key}: ${score.toFixed(1)}`);
        }
        console.log('');
        
        console.log(`📋 排名前3:`);
        allocationResult.ranking.slice(0, 3).forEach((candidate, index) => {
          console.log(`   ${index + 1}. ${candidate.candidate.name} - ${candidate.score.toFixed(1)}%`);
        });
      } else {
        console.log(`❌ 未找到合适的候选人`);
      }
      console.log('');
      
    } catch (error) {
      console.log(`❌ 分配失败: ${error.message}`);
    }
    
    console.log('='.repeat(40) + '\n');
  }
  
  console.log('='.repeat(60) + '\n');
  
  console.log('📊 5. 合约统计分析...');
  
  const contractStats = allocationSystem.getContractStatistics();
  console.log('📊 合约统计:');
  console.log(`   总合约数: ${contractStats.total}`);
  console.log(`   活跃合约数: ${contractStats.active}`);
  console.log(`   总价值: $${contractStats.totalValue}`);
  console.log(`   平均置信度: ${contractStats.averageConfidence.toFixed(1)}%`);
  console.log('');
  
  console.log('📊 按类型分布:');
  for (const [type, count] of Object.entries(contractStats.byType)) {
    console.log(`   ${type}: ${count}个合约`);
  }
  console.log('');
  
  console.log('📊 按策略分布:');
  for (const [strategy, count] of Object.entries(contractStats.byStrategy)) {
    console.log(`   ${strategy}: ${count}个合约`);
  }
  console.log('');
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🎯 6. 不同策略对比分析...');
  
  // 使用同一任务对比不同策略
  const comparisonTask = {
    taskId: 'comparison_task',
    contractType: 'fixed_price',
    terms: { value: 1500 }
  };
  
  const strategies = ['skill_based', 'performance_based', 'collaboration_based', 'hybrid'];
  
  for (const strategy of strategies) {
    console.log(`🎯 ${strategy} 策略对比:`);
    
    try {
      const contract = allocationSystem.createContract(
        comparisonTask.taskId,
        comparisonTask.contractType,
        strategy,
        comparisonTask.terms
      );
      
      const result = await allocationSystem.allocateContract(
        contract.id,
        candidates,
        strategy
      );
      
      if (result.topCandidate) {
        console.log(`   最佳候选人: ${result.topCandidate.candidate.name}`);
        console.log(`   置信度: ${result.confidence.toFixed(1)}%`);
        console.log(`   推荐理由: ${result.reasoning}`);
      } else {
        console.log(`   ❌ 未找到合适的候选人`);
      }
      console.log('');
      
    } catch (error) {
      console.log(`   ❌ 执行失败: ${error.message}`);
      console.log('');
    }
  }
  
  console.log('='.repeat(60) + '\n');
  
  console.log('🏆 7. 智能合约优势总结...');
  
  console.log('🏆 智能合约分配系统优势:');
  console.log('✅ 基于数据的客观分配');
  console.log('✅ 多维度评估机制');
  console.log('✅ 透明化的决策过程');
  console.log('✅ 自动化合约执行');
  console.log('✅ 风险管理和争议解决');
  console.log('✅ 灵活的分配策略');
  console.log('✅ 实时监控和优化');
  console.log('✅ 合规性和安全性');
  console.log('');
  
  console.log('🎯 分配策略特点:');
  console.log('🎯 基于技能: 适合技术密集型任务');
  console.log('📊 基于绩效: 适合质量要求高的任务');
  console.log('🤝 基于协作: 适合团队协作任务');
  console.log('🔄 混合策略: 适合复杂综合性任务');
  console.log('');
  
  console.log('📈 合约类型选择:');
  console.log('💰 固定价格: 范围明确、风险低');
  console.log('⏱️ 时间材料: 灵活性强、风险中等');
  console.log('🎯 里程碑: 适合大型项目、风险中等');
  console.log('🏷️ 竞标: 价格竞争、风险较高');
  console.log('🤝 合作伙伴: 长期合作、利益共享');
  console.log('🚀 风险投资: 高风险高回报');
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  console.log('🎉 智能合约任务分配系统演示完成！');
  console.log('✅ 支持6种合约类型');
  console.log('✅ 4种分配策略');
  console.log('✅ 多维度评估机制');
  console.log('✅ 自动化合约执行');
  console.log('✅ 风险管理和争议解决');
}

// 运行演示
smartContractDemo().catch(console.error);