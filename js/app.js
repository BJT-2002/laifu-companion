/**
 * 主应用逻辑 —— 来福
 * 主动联系定时器 + 隔日问候 + 记忆面板
 */

const App = {
  memory: null,
  history: [],
  isTyping: false,
  proactiveTimer: null,
  lastUserActionTime: 0,

  el: {},

  init() {
    this.cacheElements();
    Dialogue.loadConfig();       // 恢复 API 配置（endpoint/key/model/mode/threshold）
    this.memory = Memory.load();
    this.bindEvents();
    this.renderMemoryPanel();
    this.renderModeStatus();
    // 同步设置面板里的 mode 开关状态
    this.el.modeToggle.checked = Dialogue.mode === 'api';

    // 隔日检测：如果今天是新的一天，先发隔日问候
    if (this.memory.lastActiveDate && Memory.isNewDay(this.memory)) {
      const greeting = Dialogue.generateNextDayGreeting(this.memory);
      this.addMessage('assistant', greeting);
      this.history.push({ role: 'assistant', text: greeting });
    } else if (this.memory.intimacy === 0) {
      // 首次使用
      this.addMessage('assistant', Character.intro);
    }

    // 启动主动联系定时器
    this.resetProactiveTimer();
  },

  cacheElements() {
    this.el = {
      chatMessages: document.getElementById('chat-messages'),
      userInput: document.getElementById('user-input'),
      sendBtn: document.getElementById('send-btn'),
      modeToggle: document.getElementById('mode-toggle'),
      modeStatus: document.getElementById('mode-status'),
      memoryPanel: document.getElementById('memory-panel'),
      clearMemoryBtn: document.getElementById('clear-memory'),
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      saveSettings: document.getElementById('save-settings'),
      testApi: document.getElementById('test-api'),
      apiEndpoint: document.getElementById('api-endpoint'),
      apiKey: document.getElementById('api-key'),
      apiModel: document.getElementById('api-model'),
      thresholdInput: document.getElementById('threshold-input'),
      simulateNextDay: document.getElementById('simulate-next-day'),
      intimacyBar: document.getElementById('intimacy-bar'),
      intimacyLabel: document.getElementById('intimacy-label'),
      lastActiveLabel: document.getElementById('last-active-label'),
      // 日记相关
      diaryModal: document.getElementById('diary-modal'),
      diaryClose: document.getElementById('diary-close'),
      diaryList: document.getElementById('diary-list'),
      generateDiaryBtn: document.getElementById('generate-diary'),
      diaryHint: document.getElementById('diary-hint'),
      // 选项菜单
      optionsMenu: document.getElementById('options-menu'),
      drawerToggle: document.getElementById('drawer-toggle'),
      memoryDrawer: document.getElementById('memory-drawer')
    };
  },

  bindEvents() {
    this.el.sendBtn.addEventListener('click', () => this.sendMessage());
    this.el.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    // 用户输入时也重置计时器（表示还活着）
    this.el.userInput.addEventListener('input', () => this.resetProactiveTimer());

    this.el.modeToggle.addEventListener('change', (e) => {
      Dialogue.setMode(e.target.checked ? 'api' : 'mock');
      this.renderModeStatus();
    });

    this.el.clearMemoryBtn.addEventListener('click', () => {
      if (confirm('确定要清除来福的所有记忆吗？他会忘了你……')) {
        this.memory = Memory.clear();
        this.history = [];
        this.el.chatMessages.innerHTML = '';
        this.addMessage('assistant', Character.intro);
        this.renderMemoryPanel();
        this.resetProactiveTimer();
      }
    });

    this.el.settingsBtn.addEventListener('click', () => {
      this.el.apiEndpoint.value = Dialogue.apiConfig.endpoint;
      this.el.apiKey.value = Dialogue.apiConfig.apiKey;
      this.el.apiModel.value = Dialogue.apiConfig.model;
      this.el.thresholdInput.value = Dialogue.proactiveThreshold / (1000 * 60 * 60);
      this.el.settingsModal.classList.add('open');
    });

    this.el.saveSettings.addEventListener('click', () => {
      Dialogue.setApiConfig({
        endpoint: this.el.apiEndpoint.value.trim(),
        apiKey: this.el.apiKey.value.trim(),
        model: this.el.apiModel.value.trim() || 'deepseek-chat'
      });
      const hours = parseFloat(this.el.thresholdInput.value) || 6;
      Dialogue.setProactiveThreshold(hours * 60 * 60 * 1000);
      this.el.settingsModal.classList.remove('open');
      this.renderModeStatus();
      this.resetProactiveTimer();
    });

    // 测试 API 连接
    this.el.testApi.addEventListener('click', async () => {
      const endpoint = this.el.apiEndpoint.value.trim();
      const apiKey = this.el.apiKey.value.trim();
      const model = this.el.apiModel.value.trim() || 'deepseek-chat';
      if (!endpoint || !apiKey) {
        alert('请先填写 API Endpoint 和 API Key');
        return;
      }
      const btn = this.el.testApi;
      const original = btn.textContent;
      btn.textContent = '测试中...';
      btn.disabled = true;
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: '你好' }], max_tokens: 10 })
        });
        if (resp.ok) {
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content || '';
          alert(`✅ 连接成功！\n模型回复：${reply.slice(0, 50)}`);
        } else {
          const err = await resp.json().catch(() => ({}));
          alert(`❌ 连接失败\n状态码：${resp.status}\n${err.error?.message || resp.statusText}`);
        }
      } catch (e) {
        alert(`❌ 请求失败\n${e.message}`);
      } finally {
        btn.textContent = original;
        btn.disabled = false;
      }
    });

    this.el.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.el.settingsModal) this.el.settingsModal.classList.remove('open');
    });

    // 模拟隔天：把上次活跃日期设为昨天
    this.el.simulateNextDay.addEventListener('click', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      this.memory.lastActiveDate = yesterday.toISOString().split('T')[0];
      Memory.save(this.memory);
      alert('已模拟到明天！刷新页面后来福会提起昨天的事。');
    });

    // 日记弹窗关闭
    this.el.diaryClose.addEventListener('click', () => this.el.diaryModal.classList.remove('open'));
    this.el.diaryModal.addEventListener('click', (e) => {
      if (e.target === this.el.diaryModal) this.el.diaryModal.classList.remove('open');
    });

    // 生成日记
    this.el.generateDiaryBtn.addEventListener('click', () => this.generateDiary());

    // 记忆抽屉手柄点击
    document.getElementById('drawer-handle').addEventListener('click', () => {
      this.el.memoryDrawer.classList.toggle('open');
    });
  },

  async sendMessage() {
    const text = this.el.userInput.value.trim();
    if (!text || this.isTyping) return;

    this.el.userInput.value = '';
    this.addMessage('user', text);
    this.history.push({ role: 'user', text });
    this.resetProactiveTimer();

    this.showTypingIndicator();
    this.isTyping = true;

    try {
      const result = await Dialogue.generateReply(text, this.memory, this.history);
      this.hideTypingIndicator();
      this.addMessage('assistant', result.text, result.emotion);
      this.history.push({ role: 'assistant', text: result.text });
      this.renderMemoryPanel();
    } catch (e) {
      this.hideTypingIndicator();
      this.addMessage('assistant', Safety.fallbackResponse());
      console.error(e);
    } finally {
      this.isTyping = false;
    }
  },

  // 重置主动联系计时器
  resetProactiveTimer() {
    this.lastUserActionTime = Date.now();
    if (this.proactiveTimer) clearTimeout(this.proactiveTimer);
    this.proactiveTimer = setTimeout(() => this.proactiveContact(), Dialogue.proactiveThreshold);
  },

  // 来福主动联系主人
  async proactiveContact() {
    if (this.isTyping) {
      this.resetProactiveTimer();
      return;
    }
    // 确认用户确实超过阈值没操作
    if (Date.now() - this.lastUserActionTime < Dialogue.proactiveThreshold * 0.9) return;

    const msg = Dialogue.generateProactiveMessage(this.memory);
    this.addMessage('assistant', msg);
    this.history.push({ role: 'assistant', text: msg });

    // 主动联系后重置计时器，避免连续轰炸
    this.resetProactiveTimer();
  },

  addMessage(role, text, emotion = '') {
    const bubble = document.createElement('div');
    bubble.className = `message ${role}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = role === 'user' ? '你' : Character.name;
    if (emotion && role === 'assistant') {
      const tag = document.createElement('span');
      tag.className = 'emotion-tag';
      tag.textContent = emotion;
      meta.appendChild(tag);
    }
    bubble.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    bubble.appendChild(content);

    this.el.chatMessages.appendChild(bubble);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message assistant typing';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
      <div class="message-meta">${Character.name}</div>
      <div class="message-content">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>`;
    this.el.chatMessages.appendChild(indicator);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  hideTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  },

  renderMemoryPanel() {
    const m = this.memory;
    let html = '';

    // 主人信息（可编辑）
    html += '<div class="memory-section"><h4>主人信息</h4>';
    if (Object.keys(m.profile).length === 0) {
      html += '<p class="empty">来福还不太了解主人，多聊聊吧</p>';
    } else {
      for (const [k, v] of Object.entries(m.profile)) {
        const val = Array.isArray(v) ? v.join('、') : v;
        html += `<div class="memory-edit-row" data-key="${k}">
          <span class="k">${this.getProfileLabel(k)}</span>
          <span class="v" data-key="${k}">${val}</span>
          <button class="edit-btn" data-key="${k}">编辑</button>
          <button class="del-btn" data-key="${k}">删</button>
        </div>`;
      }
    }
    // 添加画像字段
    html += `<button class="add-memory-btn" id="add-profile-btn">+ 添加信息</button>`;
    html += '</div>';

    // 来福记住的事（可增删）
    html += '<div class="memory-section"><h4>来福记住的事</h4>';
    if (m.events.length === 0) {
      html += '<p class="empty">暂无</p>';
    } else {
      m.events.slice(0, 10).forEach(e => {
        const date = new Date(e.date).toLocaleDateString('zh-CN');
        html += `<div class="memory-edit-row" data-evt="${e.id}">
          <span class="date">${date}</span>
          <span class="v" data-evt="${e.id}">${e.text.slice(0, 30)}${e.text.length > 30 ? '…' : ''}</span>
          <button class="del-btn" data-evt="${e.id}">删</button>
        </div>`;
      });
    }
    html += `<button class="add-memory-btn" id="add-event-btn">+ 添加一件事</button>`;
    html += '</div>';

    this.el.memoryPanel.innerHTML = html;

    // 绑定编辑事件
    this.bindMemoryEditEvents();

    // 亲密度
    const stage = Memory.getIntimacyStage(m.intimacy);
    this.el.intimacyBar.style.width = m.intimacy + '%';
    this.el.intimacyLabel.textContent = `${m.intimacy}/100 · ${stage.stage}`;

    // 上次活跃
    if (m.lastActiveDate) {
      const days = Memory.daysSinceLastActive(m);
      if (days === 0) this.el.lastActiveLabel.textContent = '今天活跃';
      else this.el.lastActiveLabel.textContent = `${days} 天前活跃`;
    } else {
      this.el.lastActiveLabel.textContent = '首次见面';
    }
  },

  // 绑定记忆编辑事件
  bindMemoryEditEvents() {
    // 编辑画像字段
    this.el.memoryPanel.querySelectorAll('.edit-btn[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const valEl = this.el.memoryPanel.querySelector(`.v[data-key="${key}"]`);
        if (valEl.getAttribute('contenteditable') === 'true') {
          // 保存
          const newVal = valEl.textContent.trim();
          Memory.updateProfile(this.memory, key, newVal);
          valEl.removeAttribute('contenteditable');
          valEl.style.background = '';
          btn.textContent = '编辑';
        } else {
          // 进入编辑
          valEl.setAttribute('contenteditable', 'true');
          valEl.focus();
          btn.textContent = '保存';
          valEl.addEventListener('blur', () => {
            if (valEl.getAttribute('contenteditable') === 'true') {
              const newVal = valEl.textContent.trim();
              Memory.updateProfile(this.memory, key, newVal);
              valEl.removeAttribute('contenteditable');
              btn.textContent = '编辑';
            }
          }, { once: true });
        }
      });
    });

    // 删除画像字段
    this.el.memoryPanel.querySelectorAll('.del-btn[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (confirm(`确定删除「${this.getProfileLabel(key)}」吗？`)) {
          Memory.removeProfile(this.memory, key);
          this.renderMemoryPanel();
        }
      });
    });

    // 删除事件
    this.el.memoryPanel.querySelectorAll('.del-btn[data-evt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const evtId = btn.dataset.evt;
        Memory.removeEvent(this.memory, evtId);
        this.renderMemoryPanel();
      });
    });

    // 添加画像字段
    const addProfileBtn = document.getElementById('add-profile-btn');
    if (addProfileBtn) {
      addProfileBtn.addEventListener('click', () => {
        const key = prompt('输入信息名称（如：称呼、职业、喜好）');
        if (!key) return;
        const val = prompt(`输入「${key}」的内容`);
        if (val !== null) {
          Memory.updateProfile(this.memory, key.trim(), val.trim());
          this.renderMemoryPanel();
        }
      });
    }

    // 添加事件
    const addEventBtn = document.getElementById('add-event-btn');
    if (addEventBtn) {
      addEventBtn.addEventListener('click', () => {
        const text = prompt('输入来福要记住的事');
        if (text && text.trim()) {
          Memory.addEvent(this.memory, text.trim());
          this.renderMemoryPanel();
        }
      });
    }
  },

  // ============ 日记 ============
  renderDiaryList() {
    const m = this.memory;
    // 更新提示
    const check = Dialogue.canGenerateDiary(m, this.history);
    if (check.ok) {
      this.el.diaryHint.textContent = '可以生成日记啦';
      this.el.generateDiaryBtn.disabled = false;
      this.el.generateDiaryBtn.style.opacity = '1';
    } else {
      this.el.diaryHint.textContent = check.reason;
      this.el.generateDiaryBtn.disabled = true;
      this.el.generateDiaryBtn.style.opacity = '0.5';
    }

    // 渲染日记列表
    if (!m.diary || m.diary.length === 0) {
      this.el.diaryList.innerHTML = '<p class="empty">还没有日记，连接 API 并聊够 5 轮后，来福会为你写日记</p>';
      return;
    }

    let html = '';
    m.diary.forEach(d => {
      const date = new Date(d.date).toLocaleString('zh-CN');
      html += `<div class="diary-entry">
        <div class="diary-entry-date">${date}</div>
        <div class="diary-entry-content">${d.content}</div>
        <button class="diary-entry-delete" data-id="${d.id}">删除这篇日记</button>
      </div>`;
    });
    this.el.diaryList.innerHTML = html;

    // 绑定删除
    this.el.diaryList.querySelectorAll('.diary-entry-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('确定删除这篇日记吗？')) {
          Memory.removeDiary(this.memory, btn.dataset.id);
          this.renderDiaryList();
        }
      });
    });
  },

  async generateDiary() {
    const check = Dialogue.canGenerateDiary(this.memory, this.history);
    if (!check.ok) {
      this.el.diaryHint.textContent = check.reason;
      return;
    }

    this.el.generateDiaryBtn.disabled = true;
    this.el.generateDiaryBtn.textContent = '来福正在写日记…';
    this.el.diaryList.innerHTML = '<div class="diary-loading">来福正在认真写日记，稍等一下…（摇尾巴）</div>';

    const result = await Dialogue.generateDiary(this.memory, this.history);

    this.el.generateDiaryBtn.disabled = false;
    this.el.generateDiaryBtn.textContent = '生成今日日记';

    if (result.ok) {
      this.renderDiaryList();
    } else {
      this.el.diaryHint.textContent = result.text;
      this.renderDiaryList();
    }
  },

  getProfileLabel(key) {
    const map = { name: '称呼', job: '职业', phase: '当前阶段', likes: '喜好', relation: '重要关系' };
    return map[key] || key;
  },

  renderModeStatus() {
    const isApi = Dialogue.mode === 'api';
    this.el.modeStatus.textContent = isApi
      ? (Dialogue.apiConfig.apiKey ? 'API' : 'API(未配置)')
      : 'Mock';
    this.el.modeStatus.className = 'mode-status ' + (isApi ? 'api' : 'mock');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
