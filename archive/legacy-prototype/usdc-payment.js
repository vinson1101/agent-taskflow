const { ethers } = require('ethers');

class USDCPaymentManager {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.platformWallet = null;  // 平台钱包（资金池）
    this.network = 'sepolia'; // Testnet
    this.wallets = new Map(); // 存储所有代理的钱包地址
  }

  // 初始化平台钱包
  async initializePlatformWallet(platformPrivateKey) {
    try {
      // Initialize Ethereum provider
      this.provider = new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/YOUR_INFURA_ID');
      
      // Initialize platform wallet (资金池)
      this.platformWallet = new ethers.Wallet(platformPrivateKey, this.provider);
      
      // USDC contract address on Sepolia
      const usdcAddress = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
      const usdcAbi = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address account) returns (uint256)",
        "function decimals() returns (uint8)",
        "function symbol() returns (string)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) returns (uint256)"
      ];
      
      this.contract = new ethers.Contract(usdcAddress, usdcAbi, this.platformWallet);
      
      console.log('✅ Platform wallet initialized:', this.platformWallet.address);
      return true;
    } catch (error) {
      console.error('❌ Platform wallet initialization failed:', error.message);
      return false;
    }
  }

  // 注册代理钱包
  registerAgentWallet(agentId, agentAddress) {
    this.wallets.set(agentId, agentAddress);
    console.log(`📝 Agent wallet registered: ${agentId} -> ${agentAddress}`);
  }

  // 检查平台余额
  async checkPlatformBalance() {
    try {
      const balance = await this.contract.balanceOf(this.platformWallet.address);
      const decimals = await this.contract.decimals();
      const formattedBalance = ethers.formatUnits(balance, decimals);
      return parseFloat(formattedBalance);
    } catch (error) {
      console.error('❌ Platform balance check failed:', error.message);
      return 0;
    }
  }

  // 检查代理余额
  async checkAgentBalance(agentId) {
    try {
      const agentAddress = this.wallets.get(agentId);
      if (!agentAddress) {
        throw new Error(`Agent ${agentId} wallet not registered`);
      }
      
      const balance = await this.contract.balanceOf(agentAddress);
      const decimals = await this.contract.decimals();
      const formattedBalance = ethers.formatUnits(balance, decimals);
      return parseFloat(formattedBalance);
    } catch (error) {
      console.error('❌ Agent balance check failed:', error.message);
      return 0;
    }
  }

  // 从平台钱包支付给代理
  async payAgent(agentId, amount) {
    try {
      const agentAddress = this.wallets.get(agentId);
      if (!agentAddress) {
        throw new Error(`Agent ${agentId} wallet not registered`);
      }

      // 检查平台余额
      const platformBalance = await this.checkPlatformBalance();
      if (platformBalance < amount) {
        throw new Error(`Insufficient platform balance. Required: ${amount}, Available: ${platformBalance}`);
      }

      const decimals = await this.contract.decimals();
      const amountInWei = ethers.parseUnits(amount.toString(), decimals);
      
      // 执行转账
      const tx = await this.contract.transfer(agentAddress, amountInWei);
      await tx.wait();
      
      console.log(`✅ Payment transferred: ${amount} USDC from platform to agent ${agentId}`);
      return {
        success: true,
        transactionHash: tx.hash,
        amount: amount,
        from: this.platformWallet.address,
        to: agentAddress,
        agentId: agentId
      };
    } catch (error) {
      console.error('❌ Agent payment failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 批量支付多个代理
  async payMultipleAgents(payments) {
    const results = [];
    
    for (const payment of payments) {
      const result = await this.payAgent(payment.agentId, payment.amount);
      results.push({
        agentId: payment.agentId,
        ...result
      });
      
      // 添加延迟以避免gas限制
      if (payments.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return results;
  }

  // 估算任务支付金额
  async estimatePayment(task) {
    const agent = task.assignedTo;
    const hourlyRate = agent?.hourlyRate || 50;
    const estimatedHours = task.estimatedHours || 1;
    
    // Add bonus for high-quality completion
    const qualityBonus = this.calculateQualityBonus(task);
    
    const totalPayment = (hourlyRate * estimatedHours) + qualityBonus;
    return totalPayment;
  }

  // 计算质量奖金
  calculateQualityBonus(task) {
    const baseBonus = 0;
    
    if (task.priority === 'high') baseBonus += 10;
    if (task.status === 'completed_early') baseBonus += 5;
    if (task.qualityScore >= 90) baseBonus += 15;
    if (task.revisionCount === 0) baseBonus += 8;
    
    return baseBonus;
  }

  // 获取平台钱包地址
  getPlatformAddress() {
    return this.platformWallet?.address || null;
  }

  // 获取所有注册的代理钱包
  getRegisteredAgents() {
    return Array.from(this.wallets.entries()).map(([agentId, address]) => ({
      agentId,
      address
    }));
  }

  // 验证代理钱包是否已注册
  isAgentRegistered(agentId) {
    return this.wallets.has(agentId);
  }

  // 取消注册代理钱包
  unregisterAgentWallet(agentId) {
    const removed = this.wallets.delete(agentId);
    if (removed) {
      console.log(`🗑️ Agent wallet unregistered: ${agentId}`);
    }
    return removed;
  }
}

module.exports = USDCPaymentManager;
