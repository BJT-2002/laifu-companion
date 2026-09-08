# 来福 🐶

> 狗狗变成人的虚拟陪伴原型 —— 一个能记住你、理解你、主动关心你的 AI 伙伴。

## ✨ 特性

- **完整 Agent 闭环**：意图识别 → 情绪识别 → 陪伴需求识别 → 记忆检索 → 人格加载 → 关系判断 → 回复规划 → 安全门控 → 记忆写入门控
- **可编辑记忆**：主人画像、记住的事、日记均可手动增删改
- **人格稳定**：来福始终是那只忠诚粘人的狗狗，语气可调整但核心身份不变
- **情绪适配**：先判断你需要陪伴、倾听、建议还是分散注意力，再回复
- **主动陪伴**：沉默达到阈值（默认 6 小时）后主动联系，优先跟进未完结的烦心事
- **暖心日记**：连接 API 且聊天记录 ≥ 5 轮后，以来福视角生成暖心日记

## 🚀 在线预览

**https://bjt-2002.github.io/laifu-companion/**

## 🛠️ 本地运行

```bash
cd prototype
node server.js
```

然后打开 http://localhost:8765

## 📁 项目结构

```
├── index.html              # 主页面
├── server.js               # 本地静态服务器
├── css/style.css           # 样式
├── js/
│   ├── character.js        # 来福人设定义
│   ├── memory.js           # 记忆存储与检索
│   ├── cognition.js        # 认知层：意图/需求/规划/记忆门控
│   ├── dialogue.js         # 对话生成（Mock + API）
│   ├── safety.js           # 安全门控
│   └── app.js              # UI 与事件
└── assets/bg.png           # 背景图
```

## 🔧 API 配置

在设置面板填入 OpenAI 兼容的 API Endpoint、Key、Model，即可切换到真实大模型模式。不配置时使用内置 Mock 模式。

## 📄 License

MIT
