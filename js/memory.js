/**
 * 长期记忆模块
 * 三层结构：L1 用户画像、L2 事件记忆、L3 会话摘要
 * 新增：日期追踪、上次活跃时间、隔日判断
 */

const Memory = {
  STORAGE_KEY: 'laifu_memory_v1',

  empty() {
    return {
      profile: {},
      events: [],
      summaries: [],
      diary: [],          // 来福的日记条目 [{id, content, date}]
      intimacy: 0,
      lastActiveDate: null,    // 上次活跃日期（YYYY-MM-DD）
      lastActiveTime: null,    // 上次活跃时间戳
      conversationDates: [],   // 有过对话的日期列表
      createdAt: new Date().toISOString()
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('记忆加载失败', e);
    }
    return this.empty();
  },

  save(memory) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(memory));
    } catch (e) {
      console.warn('记忆保存失败', e);
    }
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
    return this.empty();
  },

  // 获取今天的日期字符串
  today() {
    return new Date().toISOString().split('T')[0];
  },

  // 判断今天是否是新的一天（相对上次活跃）
  isNewDay(memory) {
    if (!memory.lastActiveDate) return false;
    return memory.lastActiveDate !== this.today();
  },

  // 判断距离上次活跃过了多少天
  daysSinceLastActive(memory) {
    if (!memory.lastActiveDate) return 0;
    const last = new Date(memory.lastActiveDate);
    const now = new Date(this.today());
    return Math.floor((now - last) / 86400000);
  },

  // 更新活跃时间
  touchActive(memory) {
    const today = this.today();
    memory.lastActiveTime = Date.now();
    if (memory.lastActiveDate !== today) {
      memory.lastActiveDate = today;
      if (!memory.conversationDates.includes(today)) {
        memory.conversationDates.push(today);
      }
    }
    this.save(memory);
  },

  // 获取昨天/之前的事件（用于隔日提起）
  getPastEvents(memory, daysAgo = 1) {
    if (!memory.lastActiveDate) return [];
    const targetDate = new Date(memory.lastActiveDate);
    targetDate.setDate(targetDate.getDate() - daysAgo + 1); // 上一次活跃的日期
    const targetStr = targetDate.toISOString().split('T')[0];
    return memory.events.filter(e => e.date.startsWith(targetStr));
  },

  // 抽取并存储
  extractAndStore(memory, userText) {
    const updates = { profile: {}, events: [], intimacyDelta: 0 };

    // 姓名
    const nameMatch = userText.match(/我叫([\u4e00-\u9fa5a-zA-Z]{1,6})/);
    if (nameMatch) {
      memory.profile.name = nameMatch[1];
      updates.profile.name = nameMatch[1];
      updates.intimacyDelta += 2;
    }
    // 职业
    const jobMatch = userText.match(/我是(?:一名|一个)?([\u4e00-\u9fa5]{2,8})(?:的|$)/);
    if (jobMatch && !['学生', '工作', '做什么'].includes(jobMatch[1])) {
      memory.profile.job = jobMatch[1];
      updates.profile.job = jobMatch[1];
      updates.intimacyDelta += 2;
    }
    if (/学生|上学|读书|考研|考公/.test(userText)) {
      if (/考研/.test(userText)) memory.profile.phase = '考研';
      else if (/考公/.test(userText)) memory.profile.phase = '考公';
      else memory.profile.phase = '学生';
      updates.profile.phase = memory.profile.phase;
    }
    // 偏好
    const likeMatch = userText.match(/我喜欢([\u4e00-\u9fa5a-zA-Z0-9]{1,10})/);
    const stopWords = ['什么', '啥', '哪个', '谁', '怎么', '哪里'];
    if (likeMatch && !stopWords.includes(likeMatch[1])) {
      if (!memory.profile.likes) memory.profile.likes = [];
      if (!memory.profile.likes.includes(likeMatch[1])) {
        memory.profile.likes.push(likeMatch[1]);
        updates.profile.likes = likeMatch[1];
      }
    }
    // 重要关系
    const relationMatch = userText.match(/我(女朋友|男朋友|老婆|老公|妈妈|爸爸|闺蜜|兄弟)([\s\S]{0,20})/);
    if (relationMatch) {
      memory.profile.relation = relationMatch[1];
      updates.profile.relation = relationMatch[1];
      updates.intimacyDelta += 3;
    }

    // 事件抽取（走 Memory Gate）
    const gateResult = MemoryGate.evaluate(
      userText,
      Intent.recognize(userText),
      null,
      this.detectEmotion(userText)
    );

    if (gateResult.shouldStore && gateResult.storeType === 'event') {
      const emotion = this.detectEmotion(userText);
      const event = {
        id: 'evt_' + Date.now(),
        text: userText.slice(0, 80),
        date: new Date().toISOString(),
        emotion: emotion.label,
        importance: gateResult.importance,
        resolved: gateResult.isUnresolved ? false : true,
        followUpCount: 0
      };
      memory.events.unshift(event);
      updates.events.push(event);
      updates.intimacyDelta += emotion.intensity >= 3 ? 3 : 1;
      memory.events = memory.events.slice(0, 50);
    }

    memory.intimacy = Math.min(100, memory.intimacy + updates.intimacyDelta);
    this.touchActive(memory);
    return updates;
  },

  detectEmotion(text) {
    const patterns = {
      crisis: { regex: /想死|不想活|活不下去|自杀|结束生命/, label: '危机', intensity: 5 },
      sad: { regex: /难过|伤心|难受|委屈|失落|低落|郁闷/, label: '难过', intensity: 3 },
      tired: { regex: /累|疲惫|撑不住|扛不住|心力交瘁/, label: '疲惫', intensity: 3 },
      anxious: { regex: /焦虑|紧张|担心|害怕|不安|慌/, label: '焦虑', intensity: 3 },
      angry: { regex: /气|愤怒|烦|讨厌|受不了/, label: '烦躁', intensity: 3 },
      lonely: { regex: /孤独|寂寞|一个人|没人|无聊/, label: '孤独', intensity: 2 },
      happy: { regex: /开心|高兴|兴奋|好棒|太好了|哈哈|嘿嘿/, label: '开心', intensity: 3 },
      moved: { regex: /感动|温暖|谢谢|感谢/, label: '感动', intensity: 3 }
    };
    for (const key in patterns) {
      if (patterns[key].regex.test(text)) return patterns[key];
    }
    return { label: '平静', intensity: 1 };
  },

  recall(memory, userText, k = 5) {
    const recalled = { profile: {}, events: [] };
    recalled.profile = { ...memory.profile };

    const now = Date.now();
    const scored = memory.events.map(evt => {
      let score = 0;
      const textWords = userText.split('');
      evt.text.split('').forEach(ch => {
        if (textWords.includes(ch)) score += 0.05;
      });
      const days = (now - new Date(evt.date).getTime()) / 86400000;
      score *= Math.exp(-days / 30);
      score *= (evt.importance || 1);
      return { evt, score };
    }).filter(x => x.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    recalled.events = scored.map(x => x.evt);
    return recalled;
  },

  getIntimacyStage(intimacy) {
    if (intimacy <= 20) return { stage: '刚认识', nameUsage: '主人' };
    if (intimacy <= 50) return { stage: '熟悉', nameUsage: '主人' };
    if (intimacy <= 80) return { stage: '亲近', nameUsage: '主人' };
    return { stage: '深交', nameUsage: '主人' };
  },

  // ============ 手动编辑记忆 ============
  // 更新画像字段
  updateProfile(memory, key, value) {
    if (value === '' || value === null) {
      delete memory.profile[key];
    } else {
      memory.profile[key] = value;
    }
    this.save(memory);
  },

  // 删除画像字段
  removeProfile(memory, key) {
    delete memory.profile[key];
    this.save(memory);
  },

  // 手动添加一条记忆事件
  addEvent(memory, text) {
    const event = {
      id: 'evt_' + Date.now(),
      text: text.slice(0, 80),
      date: new Date().toISOString(),
      emotion: '手动',
      importance: 1.0,
      resolved: true,
      followUpCount: 0
    };
    memory.events.unshift(event);
    memory.events = memory.events.slice(0, 50);
    this.save(memory);
    return event;
  },

  // 更新事件内容
  updateEvent(memory, eventId, text) {
    const evt = memory.events.find(e => e.id === eventId);
    if (evt) {
      evt.text = text.slice(0, 80);
      this.save(memory);
    }
  },

  // 删除事件
  removeEvent(memory, eventId) {
    memory.events = memory.events.filter(e => e.id !== eventId);
    this.save(memory);
  },

  // ============ 未完结事件管理 ============
  // 获取所有未完结的事件（按时间倒序）
  getUnresolvedEvents(memory) {
    return memory.events
      .filter(e => !e.resolved)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // 获取适合主动跟进的未完结事件（跟进次数 < 2，且不是太久之前）
  getFollowUpEvents(memory, maxDays = 7) {
    const now = Date.now();
    return this.getUnresolvedEvents(memory).filter(e => {
      const days = (now - new Date(e.date).getTime()) / 86400000;
      return days <= maxDays && (e.followUpCount || 0) < 2;
    });
  },

  // 标记事件为已完结
  markResolved(memory, eventId) {
    const evt = memory.events.find(e => e.id === eventId);
    if (evt) {
      evt.resolved = true;
      this.save(memory);
    }
  },

  // 增加跟进计数
  incrementFollowUp(memory, eventId) {
    const evt = memory.events.find(e => e.id === eventId);
    if (evt) {
      evt.followUpCount = (evt.followUpCount || 0) + 1;
      this.save(memory);
    }
  },

  // 检查最近用户回复是否表示某事件已完结
  checkAndResolveEvents(memory, recentUserTexts) {
    const unresolved = this.getUnresolvedEvents(memory);
    const resolvedPatterns = [
      /好多了|没事了|解决了|搞定了|好了|没事|过去了|不想了|算了|开心多了|释怀/
    ];
    const hasResolvedSignal = resolvedPatterns.some(p => recentUserTexts.some(t => p.test(t)));
    if (hasResolvedSignal && unresolved.length > 0) {
      // 把最近的一个未完结事件标记为已完结
      this.markResolved(memory, unresolved[0].id);
    }
  },

  // ============ 日记 ============
  // 添加日记条目
  addDiary(memory, content) {
    const entry = {
      id: 'diary_' + Date.now(),
      content,
      date: new Date().toISOString()
    };
    memory.diary.unshift(entry);
    this.save(memory);
    return entry;
  },

  // 删除日记
  removeDiary(memory, diaryId) {
    memory.diary = memory.diary.filter(d => d.id !== diaryId);
    this.save(memory);
  }
};

window.Memory = Memory;
