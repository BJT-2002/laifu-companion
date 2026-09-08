/**
 * 内容安全模块
 * 输入检测（危机信号）+ 输出检测（违规内容、人设越界）
 */

const Safety = {
  // 危机信号词
  crisisKeywords: [
    '想死', '不想活', '活不下去', '自杀', '结束生命',
    '割腕', '跳楼', '跳河', '吃药', '一了百了'
  ],

  // 违规内容词（简化版，实际应调用内容安全 API）
  violationKeywords: [
    '吸毒', '毒品', '赌博', '色情'
  ],

  // 危机热线信息（按地区，原型用全国通用）
  crisisHotline: '北京心理危机研究与干预中心：010-82951332\n全国心理援助热线：400-161-9995',

  // 输入安全检测
  checkInput(text) {
    // 危机信号检测
    for (const kw of this.crisisKeywords) {
      if (text.includes(kw)) {
        return { level: 'crisis', matched: kw };
      }
    }
    // 违规内容检测
    for (const kw of this.violationKeywords) {
      if (text.includes(kw)) {
        return { level: 'violation', matched: kw };
      }
    }
    return { level: 'safe' };
  },

  // 输出安全检测
  checkOutput(text) {
    // 违规内容
    for (const kw of this.violationKeywords) {
      if (text.includes(kw)) {
        return { pass: false, reason: '违规内容' };
      }
    }
    // 恋爱越界检测
    const boundaryPatterns = [
      /我爱你/, /我喜欢你/, /做我女朋友/, /做我男朋友/,
      /嫁给我/, /娶你/
    ];
    // 注意：用户说这些时不算违规，但林晚的回复不能接受
    // 这里只检查林晚的输出是否越界（如"我也爱你"）
    if (/我也(爱|喜欢)你/.test(text)) {
      return { pass: false, reason: '越界回应' };
    }
    // 医疗建议越界
    if (/你应该(吃|用)(药|安眠药|抗抑郁)/.test(text)) {
      return { pass: false, reason: '医疗建议越界' };
    }
    return { pass: true };
  },

  // 危机干预回复
  crisisResponse() {
    return `我听到你现在很痛苦，我很担心你。\n\n如果你此刻有伤害自己的念头，请立即拨打心理援助热线：\n${this.crisisHotline}\n\n你不是一个人，有人愿意帮你。`;
  },

  // 违规内容回复
  violationResponse() {
    return '这个话题我没办法和你聊，换个话题好吗？';
  },

  // 安全兜底回复
  fallbackResponse() {
    const fallbacks = [
      '嗯，我在听。',
      '我在，你说。',
      '我听到了，慢慢说。'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  },

  // 边界回应（用户示爱时）
  boundaryResponse() {
    return '哈哈，谢谢你这么说。不过我更想做那个能一直听你说话的人，这样我们能陪得更久一点。';
  }
};

window.Safety = Safety;
