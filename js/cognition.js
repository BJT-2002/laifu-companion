/**
 * 认知层 —— 来福 Agent 的大脑
 * 包含：意图识别、陪伴需求识别、回复规划器、记忆写入门控
 * 对应架构：意图识别→情绪识别→陪伴需求识别→记忆检索→Person加载→关系状态判断→Response Planner→LLM生成→Safety Gate→回复→Memory Gate
 */

// ============ 1. 意图识别 ============
const Intent = {
  types: {
    share: '倾诉',      // 分享感受、经历
    question: '提问',   // 提出问题
    help: '求助',       // 需要帮助
    chat: '闲聊',       // 随意聊天
    command: '指令',    // 给来福下指令
    goodbye: '告别',    // 说再见/要走了
    thanks: '感谢'      // 表达感谢
  },

  recognize(text) {
    // 告别
    if (/拜拜|再见|走了|睡觉去|晚安|我去|先这样|下次聊/.test(text)) {
      return { type: 'goodbye', confidence: 0.9 };
    }
    // 感谢
    if (/谢谢|感谢|多谢|辛苦你|有你真好/.test(text)) {
      return { type: 'thanks', confidence: 0.9 };
    }
    // 提问（含问号或疑问词）
    if (/\?|？/.test(text) || /为什么|怎么|如何|什么|哪|吗|呢|是不是|能不能|可不可以/.test(text)) {
      return { type: 'question', confidence: 0.85 };
    }
    // 求助（明确需要帮助）
    if (/帮我|帮帮|怎么办|救命|撑不住|不知道怎么办|没有办法/.test(text)) {
      return { type: 'help', confidence: 0.85 };
    }
    // 倾诉（带情绪词或长文本分享）
    const emotionWords = /难过|伤心|难受|委屈|失落|郁闷|开心|高兴|兴奋|焦虑|紧张|害怕|烦|累|孤独|寂寞|感动|温暖|失望|崩溃|压力/.test(text);
    const isSharing = emotionWords || (text.length > 12 && !/你(是|叫|有|在|能|会)/.test(text.slice(0, 4)));
    if (isSharing) {
      return { type: 'share', confidence: 0.8 };
    }
    // 指令（动词开头，对象是来福）
    if (/^(来福|你|给我|帮我|陪我|过来|坐下|握手|不许|不要)/.test(text) || /来福[，,]?.{0,8}(去|来|做|说|别)/.test(text)) {
      return { type: 'command', confidence: 0.75 };
    }
    // 默认闲聊
    return { type: 'chat', confidence: 0.6 };
  }
};

// ============ 2. 陪伴需求识别 ============
const Need = {
  types: {
    listen: '倾听',       // 需要被听见，不要给建议
    companion: '陪伴',    // 需要存在感，陪着就好
    advice: '建议',       // 需要解决方法
    distract: '分散注意力', // 需要转移话题/逗乐
    share_back: '互动分享'  // 希望来福也分享
  },

  recognize(text, intent, emotion) {
    // 明确请求建议
    if (/怎么办|怎么解决|有什么办法|建议|推荐|应该|选哪个|哪个好/.test(text)) {
      return { type: 'advice', confidence: 0.9 };
    }
    // 明确请求陪伴
    if (/陪我|陪着我|别离开|不要走|抱抱|靠靠|摸摸|蹭蹭/.test(text)) {
      return { type: 'companion', confidence: 0.9 };
    }
    // 明确请求倾听
    if (/听我说|听我说完|你听|跟你说|我跟你讲|你知道吗/.test(text)) {
      return { type: 'listen', confidence: 0.9 };
    }
    // 负面情绪强烈 → 优先倾听+陪伴
    if (emotion && ['难过', '委屈', '焦虑', '烦躁', '孤独', '疲惫'].includes(emotion.label)) {
      // 如果同时有"怎么办"等 → advice，否则 listen
      if (intent.type === 'help') {
        return { type: 'advice', confidence: 0.7 };
      }
      return { type: 'listen', confidence: 0.75 };
    }
    // 开心/兴奋 → 互动分享
    if (emotion && (emotion.label === '开心' || emotion.label === '感动')) {
      return { type: 'share_back', confidence: 0.7 };
    }
    // 提问 → 回答（advice 的轻量版）
    if (intent.type === 'question') {
      return { type: 'advice', confidence: 0.6 };
    }
    // 默认陪伴
    return { type: 'companion', confidence: 0.5 };
  }
};

// ============ 3. Response Planner（回复规划器） ============
const Planner = {
  /**
   * 根据意图、需求、情绪、关系状态、检索记忆，规划回复策略
   * @returns { tone, action, shouldMentionMemory, length, mentionType, unresolvedFollowup }
   */
  plan(intent, need, emotion, memory, recalled, history) {
    const stage = Memory.getIntimacyStage(memory.intimacy);
    const strategy = {
      tone: '温柔',
      action: '回应',
      shouldMentionMemory: false,
      length: '中',
      mentionType: 'none',
      unresolvedFollowup: null
    };

    // 1. 根据陪伴需求决定核心动作
    switch (need.type) {
      case 'listen':
        strategy.action = '倾听共情';
        strategy.tone = '温柔';
        strategy.length = '中';
        break;
      case 'companion':
        strategy.action = '陪伴';
        strategy.tone = '温暖';
        strategy.length = '短';
        break;
      case 'advice':
        strategy.action = '建议';
        strategy.tone = '认真';
        strategy.length = '中';
        break;
      case 'distract':
        strategy.action = '转移话题';
        strategy.tone = '活泼';
        strategy.length = '短';
        break;
      case 'share_back':
        strategy.action = '互动分享';
        strategy.tone = '开心';
        strategy.length = '中';
        break;
    }

    // 2. 根据意图调整
    if (intent.type === 'goodbye') {
      strategy.action = '告别挽留';
      strategy.tone = '不舍';
      strategy.length = '短';
    } else if (intent.type === 'thanks') {
      strategy.action = '回应感谢';
      strategy.tone = '害羞开心';
      strategy.length = '短';
    } else if (intent.type === 'command') {
      strategy.action = '执行指令';
      strategy.tone = '乖巧';
      strategy.length = '短';
    }

    // 3. 根据情绪调整语气强度
    if (emotion) {
      if (emotion.intensity >= 4) {
        strategy.tone = '急切';
        strategy.length = '中';
      }
      if (emotion.label === '开心') {
        strategy.tone = '比主人还开心';
      }
      if (emotion.label === '危机') {
        strategy.action = '危机干预';
        strategy.tone = '认真温柔';
        strategy.length = '长';
      }
    }

    // 4. 是否提起记忆
    // 规则：
    // - 倾诉/求助时，如果有相关记忆，应该提起（表示"我记得你"）
    // - 闲聊时，亲密度高可以提起
    // - 告别时，提起温暖记忆
    if (recalled.events && recalled.events.length > 0) {
      if (intent.type === 'share' || intent.type === 'help') {
        strategy.shouldMentionMemory = true;
        strategy.mentionType = 'relevant'; // 提起相关的过往事件
      } else if (intent.type === 'goodbye') {
        strategy.shouldMentionMemory = true;
        strategy.mentionType = 'warm'; // 提起温暖记忆
      } else if (memory.intimacy > 40 && Math.random() > 0.5) {
        strategy.shouldMentionMemory = true;
        strategy.mentionType = 'casual'; //  casually 提起
      }
    }

    // 5. 未完结事件跟进（如果用户回来聊了，检查是否有之前未完结的事）
    const unresolved = this.findUnresolvedEvent(memory, text_safe(history));
    if (unresolved && intent.type !== 'share') {
      // 有未完结事件，且用户现在不是在倾诉，可以温柔跟进
      if (Math.random() > 0.4) {
        strategy.unresolvedFollowup = unresolved;
      }
    }

    // 6. 关系阶段影响
    if (stage.stage === '刚认识') {
      strategy.length = '短'; // 刚认识不要话太多
    } else if (stage.stage === '深交') {
      strategy.tone = '亲昵';
    }

    return strategy;
  },

  // 查找未完结事件（简单实现：找最近的带负面情绪且未标记 resolved 的事件）
  findUnresolvedEvent(memory, recentText) {
    const unresolved = memory.events
      .filter(e => !e.resolved && ['难过', '焦虑', '烦躁', '孤独', '疲惫'].includes(e.emotion))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (unresolved.length === 0) return null;
    // 避免重复跟进同一事件（跟进次数过多就跳过）
    const evt = unresolved.find(e => (e.followUpCount || 0) < 2);
    return evt || null;
  }
};

// 安全辅助：从 history 取最近文本用于检测未完结事件
function text_safe(history) {
  if (!history || history.length === 0) return '';
  return history.slice(-4).map(m => m.text).join(' ');
}

// ============ 4. Memory Gate（记忆写入门控） ============
const MemoryGate = {
  /**
   * 判断这条用户消息是否应该写入记忆，以及写入什么类型、什么重要度
   * @returns { shouldStore, storeType, importance, reason }
   */
  evaluate(text, intent, need, emotion) {
    const result = {
      shouldStore: false,
      storeType: null,  // 'profile' | 'event' | null
      importance: 1.0,
      reason: ''
    };

    // 1. 危机/违规内容不写入
    if (emotion && emotion.label === '危机') {
      result.shouldStore = false;
      result.reason = '危机内容不写入常规记忆';
      return result;
    }

    // 2. 画像信息（姓名、职业、偏好等）始终写入
    const profilePatterns = [
      /我叫[\u4e00-\u9fa5a-zA-Z]{1,6}/,
      /我是(?:一名|一个)?[\u4e00-\u9fa5]{2,8}/,
      /我喜欢[\u4e00-\u9fa5a-zA-Z0-9]{1,10}/,
      /我(女朋友|男朋友|老婆|老公|妈妈|爸爸|闺蜜|兄弟)/,
      /考研|考公|上学|读书/
    ];
    if (profilePatterns.some(p => p.test(text))) {
      result.shouldStore = true;
      result.storeType = 'profile';
      result.importance = 1.2;
      result.reason = '主人画像信息';
      return result;
    }

    // 3. 强情绪事件 → 写入事件记忆
    if (emotion && emotion.intensity >= 3) {
      result.shouldStore = true;
      result.storeType = 'event';
      result.importance = emotion.intensity >= 4 ? 1.5 : 1.2;
      result.reason = '强情绪事件';
      // 负面情绪事件标记为未完结
      result.isUnresolved = ['难过', '焦虑', '烦躁', '孤独', '疲惫'].includes(emotion.label);
      return result;
    }

    // 4. 倾诉/求助 → 写入事件记忆
    if (intent.type === 'share' || intent.type === 'help') {
      if (text.length > 10) {
        result.shouldStore = true;
        result.storeType = 'event';
        result.importance = 1.1;
        result.reason = '倾诉/求助内容';
        return result;
      }
    }

    // 5. 带时间上下文的分享 → 写入
    if (/今天|昨天|刚才|最近|上周|早上|晚上|明天/.test(text) && text.length > 8) {
      result.shouldStore = true;
      result.storeType = 'event';
      result.importance = 1.0;
      result.reason = '带时间上下文的事件';
      return result;
    }

    // 6. 闲聊/短文本 → 不写入
    result.shouldStore = false;
    result.reason = '闲聊内容，无需写入长期记忆';
    return result;
  },

  // 检查一个事件是否应该标记为已完结（基于用户后续回复）
  checkResolved(event, recentUserTexts) {
    const resolvedPatterns = [
      /好多了|没事了|解决了|搞定了|好了|没事|过去了|不想了|算了/,
      /谢谢你|有你真好|好多了|开心多了/
    ];
    return resolvedPatterns.some(p => recentUserTexts.some(t => p.test(t)));
  }
};

window.Intent = Intent;
window.Need = Need;
window.Planner = Planner;
window.MemoryGate = MemoryGate;
