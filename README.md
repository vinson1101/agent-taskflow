# AgentTaskFlow - 智能任务分配和协作系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-stable-brightgreen.svg)](https://github.com/vinson1101/agent-taskflow)

## 🎯 项目概述

AgentTaskFlow 是一个基于 OpenClaw 框架的智能任务分配和协作系统，支持任务创建、自动路由、多代理执行和协作追踪。

### 核心特性

- **智能任务路由** - 自动识别任务类型，路由到最适合的执行代理
- **多代理协作** - 支持 Claude Code、F0x 交易专家、PinchyMeow 等多种代理
- **CLI 工具** - 完整的命令行界面，简化任务管理
- **任务目录化** - 每个任务独立目录，包含完整的文档结构

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/vinson1101/agent-taskflow.git
cd agent-taskflow

# 安装依赖
npm install

# 添加全局命令
npm link
```

### 基本用法

```bash
# 注册代理
atf register f0x trading "F0x"
atf register pinchymeow general "PinchyMeow"

# 查看可用代理
atf list-agents

# 创建任务（自动识别类型）
atf create "买入ETH" trading
atf execute "写一个ETH价格检查脚本"

# 分配任务
atf assign task_xxx f0x

# 更新状态
atf update task_xxx done

# 评分
atf rate task_xxx 8 "完成及时"
```

## 📖 命令详解

### atf register \<id\> \<type\> \<name\>

注册一个代理到系统。

```bash
atf register f0x trading "F0x - Base链交易专家"
atf register pinchymeow general "PinchyMeow - 首席助理"
```

### atf list-agents

列出所有已注册的代理及其评分。

### atf create \<描述\> [type]

创建新任务，自动识别任务类型或指定类型。

```bash
# 自动识别类型
atf create "分析DEGEN趋势"

# 指定类型
atf create "写一个价格监控脚本" code
```

### atf execute \<描述\>

创建任务并自动识别类型，显示执行指令。

```bash
# 交易类型 → F0x
atf execute "买入100 USDC的ETH"

# 代码类型 → Claude Code (exec fallback)
atf execute "写一个ETH价格检查脚本"

# 分析类型 → Claude Code
atf execute "分析DEGEN未来走势"

# 一般任务 → PinchyMeow
atf execute "整理今天的会议记录"
```

### atf route \<taskId\>

显示任务的路由信息，包括类型和执行指令。

```bash
atf route task_001
```

### atf assign \<taskId\> \<agentId\>

分配任务给指定代理。

```bash
atf assign task_001 f0x
```

### atf update \<taskId\> \<status\>

更新任务状态。

```bash
atf update task_001 done
atf update task_001 in-progress
atf update task_001 blocked
```

### atf rate \<taskId\> \<1-10\> [原因]

对任务完成情况进行评分。

```bash
atf rate task_001 9 "完成质量很高"
```

## 🏷️ 任务类型路由

系统自动识别任务类型并路由到最适合的执行代理：

| 类型 | 关键词 | 执行代理 | 说明 |
|------|--------|----------|------|
| `code` | code, 编码, 写代码, 开发, 脚本, bot | Claude Code (exec) | 代码开发任务 |
| `analyze` | analyze, 分析, 研究, 调研, 查看 | Claude Code (exec) | 分析研究任务 |
| `trade` | trade, 交易, 买入, 卖出, swap, buy, sell | F0x | 交易执行任务 |
| `general` | 其他 | PinchyMeow | 一般任务 |

## 📂 任务目录结构

每个任务自动生成标准目录结构：

```
ATF-TASKS/{序号}-{任务名称}/
├── README.md           # 任务说明（必选）
├── progress.md        # 进度记录（必选）
├── research/          # 研究报告（可选）
├── evaluation.md      # 评估报告（必选）
├── incentives.md      # 激励机制（必选）
└── src/              # 代码（开发类任务可选）
```

### 文件说明

| 文件 | 必选 | 说明 |
|------|------|------|
| README.md | ✅ | 任务目标、背景、验收标准 |
| progress.md | ✅ | 进度勾选、里程碑 |
| evaluation.md | ✅ | 方案评估、可行性分析 |
| incentives.md | ✅ | 商业模式、收益分配 |

## 📁 项目结构

```
agent-taskflow/
├── atf-cli.js              # CLI 主入口 (最新: execute/route 命令)
├── index.js                # 核心系统
├── cli.js                  # 旧版 CLI
├── package.json            # 项目配置
├── .gitignore
├── README.md               # 本文件
├── TODO.md                 # 待办事项
├── TODO-INTEGRATION-SUMMARY.md  # 集成总结
├── ATF-TASKS/              # 任务目录
│   └── */                  # 每个任务一个目录
├── node_modules/           # 依赖
└── logs/                  # 日志目录
```

## 🔧 技术实现

### 任务类型自动识别

```javascript
const TYPE_KEYWORDS = {
  code: ['code', '编码', '写代码', '开发', 'script', '脚本', 'bot'],
  analyze: ['analyze', '分析', '研究', '调研', '看看', '检查'],
  trade: ['trade', '交易', '买入', '卖出', 'swap', 'sell', 'buy'],
};

function detectTaskType(description) {
  // 根据关键词自动识别任务类型
}
```

### 执行器映射

```javascript
const EXECUTORS = {
  code: { executor: 'Claude(Exec)', agent: 'claude', useExec: true },
  analyze: { executor: 'Claude(Exec)', agent: 'claude', useExec: true },
  trade: { executor: 'F0x', agent: 'f0x' },
  general: { executor: 'Self(PinchyMeow)', agent: 'pinchymeow' }
};
```

**注意**: 由于 ACP spawn 有技术限制，code/analyze 类型使用 exec fallback 模式。

## 📊 状态

- ✅ 核心功能稳定
- ✅ CLI 工具完整
- ✅ 自动任务路由
- ✅ 多代理支持

## 📄 许可证

MIT License

## 👤 作者

- **PinchyMeow** - 首席助理和架构师

---

**AgentTaskFlow - 让任务分配更智能，让协作更高效！** 🚀
