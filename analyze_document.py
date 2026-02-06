#!/usr/bin/env python3
import re

# 读取参赛文档
with open('SUBMISSION.md', 'r', encoding='utf-8') as f:
    content = f.read()

print("=== 📊 文档分析报告 ===")

# 1. 基本统计
lines = content.split('\n')
word_count = len(content.split())
char_count = len(content)
print(f"总行数: {len(lines)}")
print(f"总字数: {word_count}")
print(f"总字符数: {char_count}")

# 2. 结构分析
sections = []
current_section = ""
for line in lines:
    if line.startswith('# '):
        if current_section:
            sections.append(current_section)
        current_section = line[2:].strip()
    elif line.startswith('## '):
        if current_section:
            sections.append(current_section)
        current_section = line[3:].strip()
    elif line.startswith('### '):
        if current_section:
            sections.append(current_section)
        current_section = line[4:].strip()

sections.append(current_section)

print(f"\n📋 文档结构 ({len(sections)}个主要部分):")
for i, section in enumerate(sections[:8]):
    print(f"  {i+1}. {section}")

# 3. 代码块分析
code_blocks = re.findall(r'```(.*?)\n(.*?)\n```', content, re.DOTALL)
print(f"\n💻 代码块分析:")
print(f"  总代码块数量: {len(code_blocks)}")

if code_blocks:
    languages = {}
    total_lines = 0
    for lang, code in code_blocks:
        lang = lang.strip()
        languages[lang] = languages.get(lang, 0) + 1
        total_lines += len(code.split('\n'))
    
    print(f"  总代码行数: {total_lines}")
    print("  代码语言分布:")
    for lang, count in languages.items():
        print(f"    {lang}: {count}个块")

# 4. 技术关键词分析
tech_keywords = {
    'OpenClaw': 'OpenClaw框架',
    '智能合约': 'Smart Contract',
    'USDC': 'USDC支付',
    '区块链': 'Blockchain',
    '任务分配': 'Task Assignment',
    '多智能体': 'Multi-Agent',
    '协作': 'Collaboration',
    '支付系统': 'Payment System',
    '监控': 'Monitoring',
    '智能匹配': 'Smart Matching'
}

print(f"\n🔧 技术关键词分析:")
for keyword, english in tech_keywords.items():
    count = content.lower().count(keyword.lower())
    if count > 0:
        print(f"  {keyword} ({english}): {count}次")

# 5. 文档质量评估
print(f"\n📈 文档质量评估:")
print(f"  ✅ 结构完整性: {'优秀' if len(sections) > 5 else '良好'}")
print(f"  ✅ 代码完整性: {'优秀' if len(code_blocks) > 0 else '需要改进'}")
print(f"  ✅ 技术深度: {'优秀' if '```solidity' in content else '良好'}")
print(f"  ✅ 实用性: {'优秀' if '部署' in content else '良好'}")

# 6. 可读性评估
paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
avg_paragraph_length = sum(len(p.split()) for p in paragraphs) / len(paragraphs)

print(f"\n📖 可读性评估:")
print(f"  总段落数: {len(paragraphs)}")
print(f"  平均段落长度: {avg_paragraph_length:.1f}词")
print(f"  列表项数量: {content.count('- ') + content.count('* ')}")

# 7. 推荐改进
print(f"\n💡 改进建议:")
if len(code_blocks) < 3:
    print("  - 建议增加更多实际代码示例")
if '测试' not in content:
    print("  - 建议添加测试用例说明")
if '性能' not in content:
    print("  - 建议添加性能基准测试数据")

print("\n=== 分析完成 ===")