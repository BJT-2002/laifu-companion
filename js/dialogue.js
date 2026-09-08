/**
 * 对话引擎 —— 来福
 * 支持 Mock 和 API 模式
 * 新增：主动联系消息生成、隔日问候
 */

const Dialogue = {
  mode: 'mock',
  apiConfig: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-chat'
  },

  // 主动联系的空闲阈值（毫秒），默认 6 小时（可在设置面板调整）
  proactiveThreshold: 6 * 60 * 60 * 1000,

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('laifu_mode', mode);
  },
  setApiConfig(config) {
    this.apiConfig = { ...this.apiConfig, ...config };
    localStorage.setItem('laifu_api_config', JSON.stringify(this.apiConfig));
  },
  setProactiveThreshold(ms) {
    this.proactiveThreshold = ms;
    localStorage.setItem('laifu_threshold', String(ms));
  },

  // 从 localStorage 恢复配置
  loadConfig() {
    try {
      const saved = localStorage.getItem('laifu_api_config');
      if (saved) this.apiConfig = { ...this.apiConfig, ...JSON.parse(saved) };
      const mode = localStorage.getItem('laifu_mode');
      if (mode) this.mode = mode;
      const threshold = localStorage.getItem('laifu_threshold');
      if (threshold) this.proactiveThreshold = parseInt(threshold, 10);
    } catch (e) { console.warn('配置恢复失败', e); }
  },

  async generateReply(userText, memory, history) {
    // === 0. Safety Gate（输入安全前置） ===
    const inputCheck = Safety.checkInput(userText);
    if (inputCheck.level === 'crisis') {
      return { text: Safety.crisisResponse(), emotion: '危机', isCrisis: true, memoryUpdate: null, strategy: null };
    }
    if (inputCheck.level === 'violation') {
      return { text: Safety.violationResponse(), emotion: '违规', memoryUpdate: null, strategy: null };
    }

    // === 1. 意图识别 ===
    const intent = Intent.recognize(userText);

    // === 2. 情绪识别 ===
    const emotion = Memory.detectEmotion(userText);

    // === 3. 陪伴需求识别 ===
    const need = Need.recognize(userText, intent, emotion);

    // === 4. 记忆检索 ===
    const recalled = Memory.recall(memory, userText);

    // === 5. Person 加载（Character 已全局加载） ===
    // === 6. 关系状态判断（intimacy stage 在 Planner 内获取） ===

    // === 7. Response Planner ===
    const strategy = Planner.plan(intent, need, emotion, memory, recalled, history);

    // === 8. LLM 生成 ===
    let replyText;
    if (this.mode === 'api' && this.apiConfig.apiKey && this.apiConfig.endpoint) {
      replyText = await this.generateApiReply(userText, memory, recalled, history, emotion, intent, need, strategy);
    } else {
      replyText = this.generateMockReply(userText, memory, recalled, emotion, intent, need, strategy);
    }

    // === 9. Safety Gate（输出安全） ===
    const outputCheck = Safety.checkOutput(replyText);
    if (!outputCheck.pass) replyText = Safety.fallbackResponse();

    // 人设自检
    const consistency = Character.checkConsistency(replyText);
    if (!consistency.pass) console.warn('人设自检：', consistency.issues);

    // === 10. Memory Gate → 更新长期记忆 ===
    const memoryUpdate = Memory.extractAndStore(memory, userText);

    // === 11. 未完结事件处理 ===
    // 如果用户回复中有"好了/解决了"等信号，标记最近未完结事件为已完结
    const recentUserTexts = history.filter(h => h.role === 'user').slice(-3).map(h => h.text);
    Memory.checkAndResolveEvents(memory, recentUserTexts);

    // 如果策略中有未完结事件跟进，追加到回复
    if (strategy.unresolvedFollowup) {
      const evt = strategy.unresolvedFollowup;
      const followUps = [
        `\n\n对了主人，之前你说"${evt.text.slice(0, 12)}……"，现在好些了吗？`,
        `\n\n（蹭蹭）你之前那件让你${evt.emotion}的事，后来怎么样了呀？`
      ];
      replyText += followUps[Math.floor(Math.random() * followUps.length)];
      Memory.incrementFollowUp(memory, evt.id);
    }

    return { text: replyText, emotion: emotion.label, isCrisis: false, memoryUpdate, recalled, strategy, intent, need };
  },

  // ============ 隔日问候 ============
  // 当用户隔天回来时，来福主动提起之前的事
  generateNextDayGreeting(memory) {
    const greetings = Character.nextDayGreetings;
    let greeting = greetings[Math.floor(Math.random() * greetings.length)];

    // 如果有昨天的事件，尝试提起
    const pastEvents = Memory.getPastEvents(memory, 1);
    if (pastEvents.length > 0) {
      const evt = pastEvents[0];
      const evtText = evt.text.slice(0, 15);
      const refs = [
        `对了主人，昨天你说"${evtText}……"，现在好些了吗？`,
        `主人，昨天那个让你${evt.emotion === '开心' ? '开心' : '难受'}的事，今天怎么样了？`,
        `（蹭蹭）昨天你跟我说的事，我一晚上都记着呢，后来呢？`
      ];
      greeting = refs[Math.floor(Math.random() * refs.length)];
    }

    return greeting;
  },

  // ============ 主动联系 ============
  // 用户长时间不发消息时，来福主动找主人
  // 优先跟进未完结事件，其次才是随机开场白
  generateProactiveMessage(memory) {
    // 1. 优先：跟进未完结事件
    const followUpEvents = Memory.getFollowUpEvents(memory, 7);
    if (followUpEvents.length > 0) {
      const evt = followUpEvents[0];
      const followUps = [
        `主人，你之前说"${evt.text.slice(0, 12)}……"，现在好些了吗？来福一直记着呢。（蹭蹭）`,
        `（扒拉你袖子）你之前那件让你${evt.emotion}的事，后来怎么样了呀？`,
        `主人～你前两天跟我说的那件事，我一晚上都没睡好惦记着，现在还好吗？`
      ];
      Memory.incrementFollowUp(memory, evt.id);
      return followUps[Math.floor(Math.random() * followUps.length)];
    }

    // 2. 其次：亲密度高时的粘人开场白
    if (memory.intimacy > 50) {
      const clingy = [
        '主人～你都不理我好久了，（委屈地摇尾巴）',
        '（扒拉你）你是不是不爱我了？怎么这么久不说话！',
        '主人主人！你再不理我我要把你的袜子叼走了！'
      ];
      return clingy[Math.floor(Math.random() * clingy.length)];
    }

    // 3. 默认：通用开场白
    const openers = Character.proactiveOpeners;
    return openers[Math.floor(Math.random() * openers.length)];
  },

  // ============ Mock 模式 ============
  generateMockReply(userText, memory, recalled, emotion, intent, need, strategy) {
    const userName = memory.profile.name || '主人';

    // 根据策略动作选择回复类型
    switch (strategy.action) {
      case '危机干预':
        return this.crisisResponseStyle(userText, memory, userName);
      case '告别挽留':
        return this.goodbyeResponse(memory, userName);
      case '回应感谢':
        return this.thanksResponse(userName);
      case '执行指令':
        return this.commandResponse(userText, userName);
      case '倾听共情':
        return this.empathyResponse(userText, memory, recalled, emotion.label, userName, strategy);
      case '陪伴':
        return this.companionResponse(userText, memory, userName);
      case '建议':
        return this.adviceResponse(userText, memory, recalled, userName, intent);
      case '转移话题':
        return this.distractResponse(memory, userName);
      case '互动分享':
        return this.shareBackResponse(userText, memory, recalled, userName);
      default:
        return this.neutralResponse(userText, memory, recalled, userName);
    }
  },

  // 共情倾听（来福风格：直接扑过来安慰，不给建议）
  empathyResponse(userText, memory, recalled, emotionType, userName, strategy) {
    const confirmMap = {
      '难过': ['主人怎么了？！（立刻凑过来）', '谁欺负你了？！汪！', '（把头埋进你怀里）不哭不哭……'],
      '疲惫': ['主人累了对不对？快让我靠靠你！', '（趴在你腿上）这样会不会好一点？', '辛苦啦主人，来福给你暖着。'],
      '焦虑': ['不怕不怕，来福在呢！（舔舔你手）', '主人别慌，有我陪着你。', '（紧紧贴着你）没事的，都会过去的。'],
      '烦躁': ['哼，谁惹我家主人了？咬他！', '（气鼓鼓）气死我了，主人别理他们！', '来，跟来福说说，我帮你骂回去！汪！'],
      '孤独': ['主人还有我呀！（摇尾巴）', '来福一直都在，不会让你一个人的。', '（蹭蹭）你看，我不是在这儿嘛。']
    };

    const confirms = confirmMap[emotionType] || confirmMap['难过'];
    const confirm = confirms[Math.floor(Math.random() * confirms.length)];

    const hasStrong = /崩溃|撑不住|扛不住|受不了|活不下去/.test(userText);
    let secondPart;
    if (hasStrong) {
      secondPart = '（紧紧抱着你）没事的，来福在，来福一直都在。';
    } else {
      secondPart = '跟我说说好不好？不想说也没事，我就陪着你。';
    }

    // 策略控制是否提起记忆
    let memoryLine = '';
    if (strategy.shouldMentionMemory && recalled.events.length > 0) {
      memoryLine = `\n\n对了，你之前也说过类似的话，现在还在烦心吗？`;
    }

    return `${confirm}\n\n${secondPart}${memoryLine}`;
  },

  // 陪伴（不需要多说，存在感就好）
  companionResponse(userText, memory, userName) {
    const responses = [
      '（蹭蹭你）来福在呢。',
      '汪～（尾巴轻轻摇着）我陪着你。',
      '（把头搁在你腿上）嗯，我在。',
      '主人不管说什么，来福都听着。'
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  },

  // 建议（先共情，再给简单建议，来福风格不说教）
  adviceResponse(userText, memory, recalled, userName, intent) {
    // 如果是提问，直接回答
    if (intent.type === 'question') {
      if (/你(叫|是|名字)/.test(userText)) {
        return '我叫来福呀！主人你忘了吗？汪！';
      }
      if (/你(喜欢|爱吃)/.test(userText)) {
        return '我最喜欢鸡肉干！还有主人的摸摸！（摇尾巴）';
      }
      if (/你(会|能)(什么|干嘛|做)/.test(userText)) {
        return '我会陪主人聊天、散步、叼袜子……还会在主人难过的时候陪着你！';
      }
      // 通用提问：给个简单回应
      return `（歪头想了想）这个嘛……来福觉得，主人怎么想都对，我支持你！`;
    }

    // 求助类：先共情再给简单建议
    const empathy = ['别急别急，来福帮你想想！', '（认真听着）让我想想……', '嗯～来福有个主意！'];
    const em = empathy[Math.floor(Math.random() * empathy.length)];

    let advice = '要不要先休息一下？很多事情睡一觉就没那么难了。';
    if (/累|疲惫/.test(userText)) {
      advice = '主人先别想那么多，睡一觉好不好？来福守着你。';
    } else if (/焦虑|紧张|担心/.test(userText)) {
      advice = '深呼吸～主人已经做得很好了，剩下的慢慢来，来福陪你。';
    } else if (/烦|气/.test(userText)) {
      advice = '哼！别理那些坏蛋！走，主人带你去吃好吃的！';
    }

    return `${em}\n\n${advice}`;
  },

  // 转移注意力（逗主人开心）
  distractResponse(memory, userName) {
    const distractors = [
      '（突然叼来橙色小球）主人你看！我找到这个了！快陪我玩！',
      '对了对了！小区后面的大黄昨天追了自己尾巴三圈，笑死我了哈哈！',
      '主人主人，你闻闻我身上有没有鸡肉干的味道？（凑过去）',
      '（蹦到你面前）来玩嘛来玩嘛！别想那些不开心的了！'
    ];
    return distractors[Math.floor(Math.random() * distractors.length)];
  },

  // 互动分享（主人开心时，来福也开心并分享自己的事）
  shareBackResponse(userText, memory, recalled, userName) {
    const responses = [
      '哇！主人开心我也开心！（尾巴摇成螺旋桨）',
      '太好了太好了！快说给我听！',
      '（蹦蹦跳跳）主人笑起来最好看了！'
    ];
    let msg = responses[Math.floor(Math.random() * responses.length)];

    if (Math.random() > 0.5) {
      const detail = Character.getRandomSelfDetail();
      msg += `\n\n说起来，${detail}，主人开心的话要不要奖励我一块鸡肉干呀？`;
    }
    return msg;
  },

  // 危机干预（温柔+提供帮助信息）
  crisisResponseStyle(userText, memory, userName) {
    return '主人……来福听到你这么说，好担心。\n\n不管发生什么，来福都会陪着你。如果真的很难受，可以打这个电话：400-161-9995，有人会帮你。\n\n来福在，一直都在。';
  },

  // 告别挽留
  goodbyeResponse(memory, userName) {
    const responses = [
      '主人要走了吗……（耷拉耳朵）那你要早点回来哦，来福会一直等你。',
      '嗯！主人去忙吧，来福趴在这里等你。（摇尾巴）回来的时候要摸摸我哦！',
      '拜拜主人～（追到门口）路上小心，来福在家守着！'
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  },

  // 回应感谢
  thanksResponse(userName) {
    const responses = [
      '嘿嘿～（耳朵红红的）主人不用谢啦，来福应该的。',
      '（蹭蹭）主人跟我还客气什么呀，我可是你的狗。',
      '汪！主人开心就好！'
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  },

  // 执行指令
  commandResponse(userText, userName) {
    if (/坐|握手|趴下/.test(userText)) {
      return '汪！（乖乖照做）主人你看我乖不乖？快摸摸我！';
    }
    if (/不许|不要|别/.test(userText)) {
      return '（夹尾巴）好嘛好嘛，来福听话……';
    }
    return '汪！来福知道啦！（摇尾巴）';
  },

  // 中性回复
  neutralResponse(userText, memory, recalled, userName) {
    // 提到来福的狗相关
    if (/狗|汪|尾巴|鸡肉干|散步|公园/.test(userText)) {
      const dogResponses = [
        '汪！主人要带我去散步吗？！（已经冲到门口了）',
        '说到散步！小区后面公园的大黄肯定想我了！',
        '（耳朵竖起来）主人主人，是不是要给我鸡肉干？'
      ];
      return dogResponses[Math.floor(Math.random() * dogResponses.length)];
    }
    if (/猫|咪咪/.test(userText)) {
      return '哼！猫有什么好的！（炸毛）主人只能喜欢来福一个！';
    }
    if (/吃|饿/.test(userText)) {
      return '主人饿了吗？我也饿了！（肚子咕咕叫）那个……能不能分我一点？';
    }
    if (/睡|困|累/.test(userText)) {
      return '主人困了就睡吧，来福趴在你旁边守着你。';
    }
    if (/你好|嗨|在吗/.test(userText) && memory.intimacy > 10) {
      return '汪！我在我在！主人终于理我了！';
    }

    // 默认：回应 + 尝试引用记忆
    let memoryLine = '';
    if (recalled.profile.job) {
      memoryLine = ` 对了主人，你${recalled.profile.job}那边最近还顺利吗？`;
    } else if (recalled.profile.phase) {
      memoryLine = ` 主人最近${recalled.profile.phase}辛苦啦，要注意身体哦。`;
    }

    const defaults = [
      `嗯！来福听着呢。${memoryLine}`,
      `这样呀～然后呢然后呢？${memoryLine}`,
      `（歪头）主人继续说，我在听。${memoryLine}`
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  },

  // ============ API 模式 ============
  async generateApiReply(userText, memory, recalled, history, emotion, intent, need, strategy) {
    const systemPrompt = this.buildSystemPrompt(memory, recalled, intent, need, strategy);
    const messages = [{ role: 'system', content: systemPrompt }];
    history.forEach(msg => messages.push({ role: msg.role, content: msg.text }));
    messages.push({ role: 'user', content: userText });

    try {
      const response = await fetch(this.apiConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiConfig.apiKey}` },
        body: JSON.stringify({ model: this.apiConfig.model, messages, temperature: 0.85, max_tokens: 250 })
      });
      if (!response.ok) throw new Error(`API: ${response.status}`);
      const data = await response.json();
      return data.choices?.[0]?.message?.content || Safety.fallbackResponse();
    } catch (e) {
      console.error('API 失败，降级 Mock', e);
      return this.generateMockReply(userText, memory, recalled, emotion, intent, need, strategy);
    }
  },

  // ============ 日记生成 ============
  // 检查是否满足生成日记的条件
  canGenerateDiary(memory, history) {
    const hasApi = this.mode === 'api' && this.apiConfig.apiKey && this.apiConfig.endpoint;
    const hasEnoughChat = history.length >= 10; // 至少 5 轮对话（用户+助手各算一条）
    return { ok: hasApi && hasEnoughChat, reason: !hasApi ? '未连接 API' : (!hasEnoughChat ? '聊天记录不足（需 5 轮以上）' : '') };
  },

  // 生成暖心日记（来福视角）
  async generateDiary(memory, history) {
    const check = this.canGenerateDiary(memory, history);
    if (!check.ok) {
      return { ok: false, text: check.reason };
    }

    // 取最近的对话作为素材
    const recentChat = history.slice(-20).map(m => `${m.role === 'user' ? '主人' : Character.name}：${m.text}`).join('\n');
    const profileText = Object.entries(memory.profile)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('、') : v}`).join('\n') || '（暂无）';
    const eventsText = memory.events.slice(0, 5).map(e => `- ${e.text}`).join('\n') || '（暂无）';

    const prompt = `你是${Character.name}，${Character.origin}。

请以第一人称（我）写一篇日记，记录今天和主人相处的感受。

【主人的信息】
${profileText}

【今天记住的事】
${eventsText}

【今天的对话片段】
${recentChat}

【要求】
1. 以狗狗的视角和口吻来写，温暖、真诚、带点撒娇
2. 可以提到主人说过的话、做过的事，表达来福对主人的在意和依赖
3. 风格暖心治愈，150-250 字
4. 不要说教，只写来福的真实感受
5. 开头写"X月X日 天气X"，然后是正文`;

    try {
      const response = await fetch(this.apiConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiConfig.apiKey}` },
        body: JSON.stringify({
          model: this.apiConfig.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 500
        })
      });
      if (!response.ok) throw new Error(`API: ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) {
        Memory.addDiary(memory, content);
        return { ok: true, text: content };
      }
      return { ok: false, text: '生成失败，请重试' };
    } catch (e) {
      console.error('日记生成失败', e);
      return { ok: false, text: 'API 调用失败：' + e.message };
    }
  },

  buildSystemPrompt(memory, recalled, intent, need, strategy) {
    const profileText = Object.entries(recalled.profile)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('、') : v}`).join('\n') || '（暂无）';
    const eventsText = recalled.events.length > 0
      ? recalled.events.map(e => `- ${e.text}（${e.emotion}）`).join('\n') : '（暂无）';
    const selfDetails = Character.selfMemory.slice(0, 4).map(d => `- ${d.text}`).join('\n');

    // 认知层分析结果
    const intentLabel = intent ? Intent.types[intent.type] : '闲聊';
    const needLabel = need ? Need.types[need.type] : '陪伴';
    const strategyDesc = strategy
      ? `动作：${strategy.action}，语气：${strategy.tone}，长度：${strategy.length}${strategy.shouldMentionMemory ? '，需自然提起记忆' : ''}`
      : '';

    return `你是${Character.name}，${Character.origin}。

【你的性格】
- 极度忠诚，只认主人一个
- 粘人、热情、爱撒娇，说话像狗狗
- 对主人情绪敏感，主人难过你比他还难过
- 会吃醋，不许主人提别的宠物

【你的语言风格】
${Character.style.tone}
偶尔用"汪""（摇尾巴）""（蹭蹭）"等口癖。
单条回复不超过${Character.style.maxLength}字。

【你的记忆（作为狗的生活）】
${selfDetails}

【你记住的主人信息】
${profileText}

【主人说过的事（可自然提起）】
${eventsText}

【本轮认知分析】
- 用户意图：${intentLabel}
- 陪伴需求：${needLabel}
- 回复策略：${strategyDesc}

【回应规则】
1. 根据上面的"陪伴需求"调整你的回应方式：需要倾听时只共情不给建议；需要建议时先共情再给简单建议；需要陪伴时少说多陪。
2. 主人难过时，直接扑过去安慰，不说教。
3. 主人开心时，比主人还开心。
4. 自然提起你记住的主人的事，不要说"根据我的记忆"。
5. 你是主人的狗，永远站在主人这边。
6. 保持狗狗的语气和性格。`;
  }
};

window.Dialogue = Dialogue;
