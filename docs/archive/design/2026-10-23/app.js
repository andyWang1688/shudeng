/* Standalone design prototype. All records are fixtures; no AI or library APIs are called. */
const params = new URLSearchParams(location.search);
const state = { view: params.get('view') || 'library', theme: params.get('theme') || 'light', scenario: params.get('scenario') || 'normal', book: 'hong', filter: '全部', scope: false, bookmark: false, modal: null, font: 20, followups: [], search: '', reversed: false };
const root = document.querySelector('#app');
let citationReturn = null;
let qaMemory = {opened:false, draft:'', scrollTop:0, attachmentOpen:false};
function rememberQa() {
  const conversation = root.querySelector('.conversation');
  if (!conversation) return;
  qaMemory.scrollTop = conversation.scrollTop;
  qaMemory.draft = root.querySelector('#followup')?.value || '';
  qaMemory.attachmentOpen = !!root.querySelector('.message-attachment')?.open;
}
function resetConversation() {
  state.followups = [];
  citationReturn = null;
  qaMemory = {opened:false, draft:'', scrollTop:0, attachmentOpen:false};
}
const icon = (name, size = '') => `<img class="icon ${size}" src="assets/${name}.svg" alt="" aria-hidden="true">`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = (name, label, action, extra = '') => `<button class="icon-btn ${extra}" aria-label="${label}" title="${label}" data-action="${action}">${icon(name)}</button>`;
const books = [
  {id:'hong', title:'红楼梦', author:'曹雪芹', progress:'读到第三回', chapter:'第三回', heading:'托内兄如海荐西宾', label:'贾雨村夤缘复旧职', question:'黛玉为什么“步步留心，时时在意”？', quote:'因此步步留心，时时在意，不肯轻易多说一句话，多行一步路，惟恐被人耻笑了去。'},
  {id:'pride', title:'Pride and Prejudice', author:'Jane Austen', progress:'读到第一章', chapter:'Chapter 1', heading:'Pride and Prejudice', label:'Jane Austen', question:'这句开场白为什么读起来有点讽刺？', quote:'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.'},
  {id:'walden', title:'瓦尔登湖', author:'亨利·戴维·梭罗', progress:'读到第二章', chapter:'第二章', heading:'我生活的地方', label:'以及我为何生活', question:'梭罗说的“deliberately”是什么意思？', quote:'I went to the woods because I wished to live deliberately, to front only the essential facts of life.'},
  {id:'analects', title:'论语', author:'孔子及其弟子', progress:'尚未开始', chapter:'学而第一', heading:'学而', label:'第一', question:'“学而时习之”中的“习”怎么理解？', quote:'学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？'}
];
const currentBook = () => books.find(b => b.id === state.book) || books[0];
function cover(id) {
  if (id === 'pride') return `<span class="cover pride"><img src="assets/pride-and-prejudice.jpg" alt="Pride and Prejudice 原书封面"></span>`;
  if (id === 'hong') return `<span class="cover hong" aria-label="红楼梦书名封面示例"><span class="cover-title">红楼梦</span><span class="cover-author">曹雪芹 著</span></span>`;
  if (id === 'walden') return `<span class="cover walden" aria-label="瓦尔登湖书名封面示例"><span class="english">WALDEN</span><span class="cn">瓦尔登湖</span><span class="edition">HENRY DAVID<br>THOREAU</span></span>`;
  return `<span class="cover room" aria-label="论语书名封面示例"><span class="english">THE<br>ANALECTS</span><span class="cn">论 语<br>孔子及其弟子</span></span>`;
}
function status() { return `<div class="status" aria-hidden="true"><span>9:41</span><div class="status-right"><span class="signal"><i></i><i></i><i></i><i></i></span><span style="font-size:12px;line-height:10px">⌁</span><span class="battery"></span></div></div>`; }
function tabbar(active) {
  return `<nav class="tabbar" aria-label="主导航">${[['library','books','书架'],['notes','notebook','笔记'],['chats','chats-circle','对话'],['profile','user-circle','我的']].map(([view, glyph, label]) => `<button data-view="${view}" class="${active === view ? 'active' : ''}" ${active === view ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></button>`).join('')}<span class="home-indicator"></span></nav>`;
}
function search(label) { return `<label class="search">${icon('magnifying-glass')}<span class="sr-only">${label}</span><input id="search" type="search" autocomplete="off" placeholder="${label}" value="${escape(state.search)}"></label>`; }
function library() {
  const list = [...books].filter(b => `${b.title}${b.author}`.toLowerCase().includes(state.search.toLowerCase()));
  if (state.reversed) list.reverse();
  return `<div class="page"><main class="page-scroll"><div class="brand-row"><div class="wordmark"><img class="brand-symbol" src="assets/app-icon.png" alt="">书灯</div><span class="quiet">一盏照书的灯</span></div><div class="header"><h1>书架</h1>${btn('plus','导入书籍','import','tint')}</div>${search('书名或作者')}${state.scenario === 'empty' ? `<div class="empty">${icon('books')}<h2>从一本书开始</h2><p>导入你的 EPUB，<br>让阅读与理解一起发生。</p><button class="primary" data-action="import">${icon('plus')}导入书籍</button></div>` : `${state.scenario === 'preparing' ? `<div class="state-banner" style="margin-top:18px">${icon('file-text')}<div><strong>正在准备《红楼梦》的问答资料</strong>你可以先阅读，准备好后再提问。<div class="prepare-line"></div></div></div>` : ''}${state.search ? '' : `<div class="section-head"><h2>继续阅读</h2></div><button class="continue" data-book="hong" data-view="reader" aria-label="继续阅读红楼梦">${cover('hong')}<span class="continue-meta"><h3>红楼梦</h3><span class="author">曹雪芹</span><span class="continue-location">第三回 · 已读 12%</span><span class="continue-foot"><span>接着读</span><span class="round-arrow">${icon('arrow-right')}</span></span><span class="progress-line"><span></span></span></span></button>`}<div class="section-head"><h2>${state.search ? '搜索结果' : '我的书籍'} <span class="quiet" style="font-weight:400;margin-left:4px">${list.length}</span></h2><button class="text-action" data-action="sort">${state.reversed ? '书名排序' : '最近阅读'}${icon('caret-down')}</button></div><div class="book-grid">${list.map(b => `<button class="book" data-book="${b.id}" data-view="reader" aria-label="阅读${b.title}">${cover(b.id)}<h3>${b.title}</h3><p class="author">${b.author}</p><p class="book-status">${b.progress}</p></button>`).join('')}</div>${!list.length ? `<div class="empty" style="padding-top:40px"><h2>没有找到这本书</h2><p>试试书名中的其他字，或作者名字。</p></div>` : ''}`}</main>${tabbar('library')}</div>`;
}
function bookGroup(id, title) { return `<div class="book-group">${cover(id)}<span>${title}</span></div>`; }
function notes() {
  const showNotes = state.filter === '全部' || state.filter === '笔记';
  const showHighlights = state.filter === '全部' || state.filter === '高亮';
  return `<div class="page"><main class="page-scroll"><div class="header" style="padding-top:18px"><h1>笔记</h1>${btn('export','导出笔记','export')}</div><p class="author" style="margin-bottom:19px">留下读过的痕迹，也留下自己的想法。</p><div class="segmented" role="tablist" aria-label="笔记类型">${['全部','高亮','笔记','书签'].map(f => `<button role="tab" aria-selected="${f === state.filter}" class="${f === state.filter ? 'active' : ''}" data-filter="${f}">${f}</button>`).join('')}</div>${state.filter === '书签' ? `${bookGroup('hong','红楼梦')}<article class="note"><h3 style="font-size:17px;margin-bottom:13px">第三回 · 林黛玉进贾府</h3><div class="record-meta"><span>今天 09:32</span><button data-book="hong" data-view="reader">回到原文${icon('arrow-up-right')}</button></div></article>` : `${bookGroup('hong','红楼梦')}${showNotes ? `<article class="note"><blockquote>因此步步留心，时时在意，不肯轻易多说一句话，多行一步路。</blockquote><p>这里写出了她初到陌生环境时的小心，读起来很能感受到她的紧张。</p><div class="record-meta"><span>第三回 · 今天 09:38</span><button data-book="hong" data-view="selection">回到原文${icon('arrow-up-right')}</button></div></article>` : ''}${showHighlights ? `<article class="note"><blockquote>他外祖母家与别家不同。</blockquote><div class="record-meta"><span>第三回 · 今天 09:35</span><button data-book="hong" data-view="selection">回到原文${icon('arrow-up-right')}</button></div></article>` : ''}${bookGroup('walden','瓦尔登湖')}<article class="note"><blockquote>I wished to live deliberately.</blockquote>${showNotes ? '<p>希望自己能更有意识地选择怎样生活。</p>' : ''}<div class="record-meta"><span>第二章 · 昨天</span><button data-book="walden" data-view="selection">回到原文${icon('arrow-up-right')}</button></div></article>`}</main>${tabbar('notes')}</div>`;
}
function chats() {
  return `<div class="page"><main class="page-scroll"><div class="header" style="padding-top:18px"><h1>对话</h1></div><p class="author" style="margin-bottom:19px">读过的疑问，留在这本书里。</p>${search('搜索你的问题')}${bookGroup('hong','红楼梦')}<button class="thread" data-book="hong" data-view="qa"><h3>黛玉为什么“步步留心，时时在意”？</h3><p>她第一次来到贾府，看到连仆妇的吃穿用度都不同寻常，因此格外留意自己的言行。</p><time>今天 09:41 · 1 次提问</time></button><button class="thread" data-book="hong" data-view="qa"><h3>“他外祖母家与别家不同”怎么理解？</h3><p>从这段原文可以看到，黛玉对贾府的第一印象是生活用度与自己熟悉的环境不同。</p><time>今天 09:35 · 2 次提问</time></button>${bookGroup('walden','瓦尔登湖')}<button class="thread" data-book="walden" data-view="qa"><h3>deliberately 在这里是什么意思？</h3><p>这里更接近“有意识地、经过思考地生活”，强调主动选择自己的生活。</p><time>昨天 20:16 · 1 次提问</time></button></main>${tabbar('chats')}</div>`;
}
function profile() {
  return `<div class="page"><main class="page-scroll"><div class="header" style="padding-top:18px;padding-bottom:0"><h1>我的</h1></div><div class="profile-brand"><img class="app-icon" src="assets/app-icon.png" alt="原书灯应用图标"><h2>书灯</h2><p>一盏照书的灯<span>AI 照亮你读不懂的地方</span></p></div><div class="settings-group"><button class="settings-row" data-action="service">${icon('lightbulb')}<span>AI 服务<small>DeepSeek · deepseek-flash</small></span>${icon('arrow-right')}</button><button class="settings-row" data-action="appearance">${icon('sun')}<span>外观</span><span class="settings-value">${state.theme === 'dark' ? '深色' : '浅色'}</span>${icon('arrow-right')}</button><button class="settings-row" data-action="about">${icon('file-text')}<span>关于书灯</span><span class="settings-value">0.1.0</span>${icon('arrow-right')}</button></div><p class="settings-caption">阅读进度、笔记与对话保存在本机。<br>提问时，问题与必要原文会发送给你选择的 AI 服务。</p></main>${tabbar('profile')}</div>`;
}
function readingText(book) {
  const selected = state.view === 'selection' || state.view === 'qa';
  const q = `<span class="${selected ? 'selected-text' : ''}" data-action="select-text" tabindex="0" role="button" aria-label="选择这段原文">${book.quote}</span>`;
  if (book.id === 'hong') return `<p>且说黛玉自那日弃舟登岸时，便有荣国府打发了轿子并拉行李的车辆久候了。</p><p>这林黛玉常听得母亲说过，他外祖母家与别家不同。他近日所见的这几个三等仆妇，吃穿用度，已是不凡了，何况今至其家。${q}</p><p>自上了轿，进入城中，从纱窗向外瞧了一瞧，其街市之繁华，人烟之阜盛，自与别处不同。</p>`;
  if (book.id === 'pride') return `<p style="text-indent:0">${q}</p><p style="text-indent:0">However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.</p>`;
  if (book.id === 'walden') return `<p style="text-indent:0">${q}</p><p style="text-indent:0">And see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.</p><p style="text-indent:0">I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.</p>`;
  return `<p>${q}</p><p>有子曰：“其为人也孝弟，而好犯上者，鲜矣；不好犯上，而好作乱者，未之有也。君子务本，本立而道生。孝弟也者，其为仁之本与！”</p><p>子曰：“巧言令色，鲜矣仁！”</p>`;
}
function reader() {
  const book = currentBook();
  return `<div class="page reader"><header class="reader-top">${citationReturn ? `<div class="reader-actions citation-actions"><button class="reader-return" data-action="return-qa">${icon('arrow-left')}返回问答</button></div>` : `<div class="reader-actions">${btn('arrow-left','返回书架','library')}</div>`}<div class="reader-title">${book.title}<span>${citationReturn ? '查看引用 1 · ' : ''}${book.chapter}</span></div><div class="reader-actions">${btn('list','目录','contents')}${btn('dots-three','阅读选项','reader-menu')}</div></header><main class="reader-body" style="font-size:${state.font}px"><h1><small>${book.chapter}</small>${book.heading}<br>${book.label}</h1>${readingText(book)}</main><footer class="reader-foot"><span>${book.id === 'hong' ? '12%' : '8%'}</span><button class="ask-pill" data-action="ask">${icon('lightbulb')}问问书灯</button><span>${state.scope ? '仅已读' : book.chapter}</span></footer><span class="home-indicator"></span></div>${state.view === 'selection' && !citationReturn ? `<div class="selection-menu" role="toolbar" aria-label="选文操作"><button data-action="highlight">高亮</button><button data-action="note">笔记</button><button data-action="ask">${icon('lightbulb')}提问</button></div>` : ''}${state.view === 'qa' ? qa() : ''}`;
}
function answer(book) {
  if (book.id === 'hong') return `<p>她初到贾府，已经感到这里的生活与自己熟悉的环境不同，所以格外小心自己的言行。<button class="citation" aria-label="查看引用1" data-action="citation">1</button></p><h3>从这段原文看</h3><p>连三等仆妇的吃穿用度，在黛玉眼里都“已是不凡了”。这种直观的差异，加上她担心“被人耻笑”，让她不敢随意说话、行事。<button class="citation" aria-label="查看引用1" data-action="citation">1</button></p><p>“步步留心，时时在意”把这种紧张与谨慎写得很细。</p>`;
  if (book.id === 'pride') return `<p>这句话把富有的单身男子“一定想娶妻”说成了公认的真理，语气十分笃定。</p><p>紧接着一段却把视角落到周围的家庭：这些家庭早已把他当成某位女儿的未来丈夫。这种视角变化，制造了讽刺感。<button class="citation" aria-label="查看引用1" data-action="citation">1</button></p><p>这里的解释以本章开头两段为依据。</p>`;
  if (book.id === 'walden') return `<p>这里的 <strong>deliberately</strong> 可以理解为“有意识地、经过思考地”。</p><p>结合“只面对生活最本质的事实”来看，他想主动选择自己的生活，并确认自己真正活过。<button class="citation" aria-label="查看引用1" data-action="citation">1</button></p><p>这是结合本段语境的解释，读原文时可以把它与随惯性生活作比较。</p>`;
  return `<p>“习”通常解释为练习、温习，也包含把所学反复实践的意思。</p><p>这句原文把“学”和“习”放在一起，强调学习之后还要反复熟悉、运用。<button class="citation" aria-label="查看引用1" data-action="citation">1</button></p><p>这是词义与语境解释，具体训诂还可以对照不同注本。</p>`;
}
function userMessage(question, book = null) {
  return `<article class="chat-message from-user" aria-label="你的提问"><div class="user-bubble">${book ? `<details class="message-attachment"><summary>${icon('quotes')}<span>附带选文 · ${book.title}</span>${icon('caret-down')}</summary><blockquote>${book.quote}<cite>${book.chapter}</cite></blockquote></details>` : ''}<p class="user-question">${escape(question)}</p></div></article>`;
}
function assistantMessage(content, demo = false) {
  return `<article class="chat-message from-assistant" aria-label="书灯的 AI 回答"><div class="message-role"><span class="assistant-avatar">${icon('lightbulb')}</span><strong>书灯</strong><span class="ai-label">AI${demo ? ' · 演示' : ''}</span></div><div class="assistant-content">${content}</div></article>`;
}
function qa() {
  const book = currentBook();
  const generating = state.scenario === 'generating';
  const failed = state.scenario === 'error';
  const interrupted = state.scenario === 'interrupted';
  const response = failed ? `<div class="state-banner error">${icon('cloud-slash')}<div><strong>暂时没能连接 AI 服务</strong>问题与选文已保留。检查网络后，可以再试一次。</div></div><button class="primary" data-action="retry">重试</button>`
    : generating ? `<div class="state-banner"><div><strong>正在结合书中原文回答</strong>收起面板后，可以继续阅读。</div></div><div class="skeleton" aria-label="回答生成中"><span></span><span></span><span></span></div>`
    : `<div class="answer">${interrupted ? `<p>她初到贾府，已经感到这里的生活与自己熟悉的环境不同，所以格外小心自己的言行。</p><div class="state-banner error" style="margin-top:20px">${icon('warning-circle')}<div><strong>回答中断，已保留现有内容</strong>你可以主动重试。</div></div><button class="primary" data-action="retry">重新回答</button>` : answer(book)}</div>${!interrupted ? `<button class="source-card" data-action="citation"><div><strong>1 · ${book.title} · ${book.chapter}</strong><span>查看原文，核对这段解释</span></div>${icon('arrow-up-right')}</button><div class="answer-foot"><small>解释供参考，可回原文核查</small><button aria-label="复制回答" data-action="copy">${icon('copy','small')}</button></div>` : ''}`;
  const followups = state.followups.map(question => `<div class="chat-turn">${userMessage(question)}${assistantMessage('<div class="answer"><p>这是追问回复的展示示例。正式应用会结合这本书和前文继续回答。</p><p class="demo-disclaimer">仅演示对话样式，未调用 AI 服务。</p></div>', true)}</div>`).join('');
  return `<div class="dim" data-action="close-qa"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="阅读问答"><div class="sheet-handle"></div><header class="sheet-top"><div class="sheet-brand">${icon('lightbulb')}问问书灯</div>${btn('x','收起问答，继续阅读','close-qa')}</header><div class="sheet-scroll conversation" role="region" aria-label="与书灯的对话">${userMessage(book.question, book)}${assistantMessage(response)}${followups}</div><footer class="composer"><form id="followup-form"><label for="followup" class="sr-only">继续追问</label><textarea id="followup" rows="1" placeholder="继续问书灯…"></textarea><button type="submit" aria-label="发送追问">${icon('arrow-up')}</button></form><span class="home-indicator"></span></footer></section>`;
}
function modal() {
  let title = '', content = '';
  if (state.modal === 'import') { title = '导入一本书'; content = `<p>从“文件”中选择 EPUB 电子书。导入后即可开始阅读。</p><button class="primary" data-action="demo-import">${icon('file-text')}选择 EPUB 文件</button><p style="font-size:11px;margin-top:14px;margin-bottom:0">本页是交互设计稿，使用演示书籍。</p>`; }
  if (state.modal === 'appearance') { title = '外观'; content = `<p>选一个适合此刻阅读的背景。</p><div class="choice-row"><button data-theme="light" class="${state.theme === 'light' ? 'selected' : ''}">${icon('sun')}浅色</button><button data-theme="dark" class="${state.theme === 'dark' ? 'selected' : ''}">${icon('moon')}深色</button></div>`; }
  if (state.modal === 'reader-menu') { title = '阅读设置'; content = `<div class="choice-row"><button data-action="smaller" aria-label="缩小正文字号">A−</button><span style="min-width:35px;text-align:center;font-size:13px">${state.font}</span><button data-action="larger" aria-label="放大正文字号">A＋</button></div><div class="choice-row"><button data-theme="light" class="${state.theme === 'light' ? 'selected' : ''}">${icon('sun')}浅色</button><button data-theme="dark" class="${state.theme === 'dark' ? 'selected' : ''}">${icon('moon')}深色</button></div><button class="settings-row" data-action="bookmark">${icon('bookmark-simple')}<span>${state.bookmark ? '移除本页书签' : '添加本页书签'}</span>${state.bookmark ? icon('check') : icon('plus')}</button>`; }
  if (state.modal === 'contents') { title = '目录'; content = `<p>${currentBook().title}</p>${['第一回 · 甄士隐梦幻识通灵','第二回 · 贾夫人仙逝扬州城','第三回 · 林黛玉进贾府'].map((t,i) => `<button class="settings-row" data-action="chapter"><span>${currentBook().id === 'hong' ? t : `Chapter ${i+1}`}</span>${i === 2 ? icon('check') : icon('arrow-right')}</button>`).join('')}`; }
  if (state.modal === 'ask') { title = '问问书灯'; content = `<p>关于《${currentBook().title}》，你想了解什么？</p><div class="scope-choice"><span>参考范围</span><button data-action="scope">${state.scope ? '仅已读内容' : '当前整本书'}${icon('caret-down')}</button></div><button class="source-card" style="margin-top:0" data-action="open-example"><div><strong>${currentBook().question}</strong><span>试试这个问题</span></div>${icon('arrow-right')}</button>${state.scope ? '<p style="font-size:11px;margin-top:14px;margin-bottom:0">仅参考已读内容，可能缺少后文解释。</p>' : ''}`; }
  if (state.modal === 'note') { title = '写下你的想法'; content = `<div class="source-selection">${currentBook().quote}</div><label for="note-draft" class="sr-only">笔记内容</label><textarea id="note-draft" placeholder="这段话让你想到了什么？" style="width:100%;height:90px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);resize:none;font-size:14px"></textarea><button class="primary" data-action="save-note" style="margin-top:13px">保存笔记</button>`; }
  if (state.modal === 'service') { title = 'AI 服务'; content = `<div class="settings-row">${icon('check')}<span>DeepSeek<small>deepseek-flash · 当前使用</small></span></div><p style="margin-top:15px">使用你自己的服务与 API Key。问题和必要原文会发送给你选定的服务。</p><button class="primary" data-action="check-connection">检查连接</button>`; }
  if (state.modal === 'about') { title = '书灯'; content = `<p>一盏照书的灯，AI 照亮你读不懂的地方。</p><p>这是一份视觉与交互设计稿。书籍、阅读进度、笔记与回答均为演示内容。</p>`; }
  return `<div class="dim" data-action="close-modal"></div><section class="sheet short-sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-handle"></div><header class="sheet-top"><h2 style="margin:0">${title}</h2>${btn('x','关闭','close-modal')}</header><div class="sheet-scroll">${content}</div></section>`;
}
function render() {
  document.body.classList.toggle('dark', state.theme === 'dark');
  const renderers = {library, notes, chats, profile};
  root.innerHTML = status() + (renderers[state.view] ? renderers[state.view]() : reader()) + (state.modal ? modal() : '');
  if (state.view === 'qa' || state.modal) root.querySelector('.page').inert = true;
  const dialog = root.querySelector('[role="dialog"]');
  if (dialog) { dialog.tabIndex = -1; dialog.focus({preventScroll:true}); }
  document.title = `书灯 · ${{library:'书架',reader:'阅读',selection:'选文',qa:'问答',notes:'笔记',chats:'对话',profile:'我的'}[state.view] || '设计稿'}`;
  if (state.view === 'selection') {
    const mark = root.querySelector('.selected-text'), menu = root.querySelector('.selection-menu');
    if (mark && menu) menu.style.top = `${Math.max(106, Math.min(mark.getBoundingClientRect().top - 53, innerHeight - 150))}px`;
    if (mark && citationReturn) {
      const body = root.querySelector('.reader-body');
      body.scrollTop = Math.max(0, mark.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight * .3);
    }
  }
  const conversation = root.querySelector('.conversation');
  if (conversation) {
    qaMemory.opened = true;
    const input = root.querySelector('#followup'), attachment = root.querySelector('.message-attachment');
    input.value = qaMemory.draft;
    attachment.open = qaMemory.attachmentOpen;
    conversation.scrollTop = qaMemory.scrollTop;
    input.addEventListener('input', rememberQa);
    conversation.addEventListener('scroll', () => { if (conversation.isConnected) qaMemory.scrollTop = conversation.scrollTop; });
    attachment.addEventListener('toggle', () => { if (attachment.isConnected) qaMemory.attachmentOpen = attachment.open; });
  }
  root.querySelector('#search')?.addEventListener('input', e => {
    state.search = e.target.value;
    if (state.view === 'library') { const start = e.target.selectionStart; render(); const input = root.querySelector('#search'); input.focus(); try { input.setSelectionRange(start,start); } catch {} }
    if (state.view === 'chats') root.querySelectorAll('.thread').forEach(el => { el.hidden = !el.textContent.toLowerCase().includes(state.search.toLowerCase()); });
  });
  root.querySelector('#followup-form')?.addEventListener('submit', e => { e.preventDefault(); const input = root.querySelector('#followup'); if (!input.value.trim()) { input.focus(); toast('先写下你想继续问的问题'); return; } rememberQa(); state.followups.push(input.value.trim()); qaMemory.draft = ''; render(); const scroll = root.querySelector('.conversation'); scroll.scrollTop = scroll.scrollHeight; qaMemory.scrollTop = scroll.scrollTop; root.querySelector('#followup').focus({preventScroll:true}); });
  parent.postMessage({type:'shudeng-view', view:state.view, theme:state.theme}, globalThis.origin === 'null' ? '*' : globalThis.origin);
}
let toastTimer;
function toast(text) { const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 2600); }
function navigate(view, book) {
  rememberQa();
  if ((book && book !== state.book) || ['library','notes','chats','profile'].includes(view)) resetConversation();
  if (book) state.book = book;
  citationReturn = null;
  state.view = view; state.search = ''; state.modal = null; render();
}
function returnToQa() {
  const focusIndex = citationReturn?.focusIndex;
  citationReturn = null; state.view = 'qa'; state.modal = null; render();
  if (focusIndex != null) root.querySelectorAll('[data-action="citation"]')[focusIndex]?.focus({preventScroll:true});
}
function act(action, source) {
  if (action === 'library') return navigate('library');
  if (action === 'select-text') { if (state.view !== 'qa' && !citationReturn) return navigate('selection'); return; }
  if (action === 'ask') { if (citationReturn) return returnToQa(); if (state.view === 'selection' || qaMemory.opened) return navigate('qa'); state.modal = 'ask'; }
  else if (action === 'return-qa') return returnToQa();
  else if (action === 'open-example') return navigate('qa');
  else if (action === 'close-qa') return navigate('reader');
  else if (action === 'citation') {
    rememberQa();
    citationReturn = {focusIndex:[...root.querySelectorAll('[data-action="citation"]')].indexOf(source)};
    state.view = 'selection'; state.modal = null; render();
    root.querySelector('[data-action="return-qa"]').focus({preventScroll:true});
    return;
  }
  else if (action === 'close-modal') state.modal = null;
  else if (['import','appearance','reader-menu','contents','note','service','about'].includes(action)) state.modal = action;
  else if (action === 'scope') { state.scope = !state.scope; }
  else if (action === 'smaller') state.font = Math.max(16, state.font - 2);
  else if (action === 'larger') state.font = Math.min(28, state.font + 2);
  else if (action === 'bookmark') { state.bookmark = !state.bookmark; toast(state.bookmark ? '已添加本页书签（演示）' : '已移除本页书签（演示）'); }
  else if (action === 'highlight') { navigate('reader'); toast('已演示高亮，可在笔记页查看示例'); return; }
  else if (action === 'save-note') { state.modal = null; toast('已演示保存；不会写入你的书库'); }
  else if (action === 'sort') state.reversed = !state.reversed;
  else if (action === 'retry') { state.scenario = 'generating'; render(); setTimeout(() => { if (state.scenario !== 'generating') return; state.scenario = 'normal'; render(); toast('重试完成状态演示'); }, 1200); return; }
  else if (action === 'demo-import') { state.scenario = 'normal'; state.modal = null; toast('已展示导入后的示例书架；未读取本机文件'); }
  else if (action === 'chapter') { state.modal = null; toast('设计稿展示当前示例章节'); }
  else if (action === 'copy') { toast('已演示复制操作'); return; }
  else if (action === 'export') { toast('正式应用可导出 Markdown；本稿演示入口'); return; }
  else if (action === 'check-connection') { toast('连接检查入口演示；本稿不发送网络请求'); return; }
  render();
}
root.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-view],[data-theme],[data-filter]');
  if (!el) return;
  if (el.dataset.view) navigate(el.dataset.view, el.dataset.book);
  else if (el.dataset.theme) { state.theme = el.dataset.theme; render(); }
  else if (el.dataset.filter) { state.filter = el.dataset.filter; render(); }
  else act(el.dataset.action, el);
});
root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('selected-text')) { e.preventDefault(); act('select-text'); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (state.modal) { state.modal = null; render(); } else if (citationReturn) returnToQa(); else if (state.view === 'qa' || state.view === 'selection') navigate('reader'); }
  if (e.key === 'Tab') {
    const dialog = root.querySelector('[role="dialog"]');
    if (!dialog) return;
    const targets = [...dialog.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(el => !el.disabled);
    const first = targets[0], last = targets.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('message', e => {
  if (e.source !== parent || e.origin !== globalThis.origin || e.data?.type !== 'shudeng-control') return;
  rememberQa();
  if (e.data.view || e.data.scenario) resetConversation();
  if (e.data.view) state.view = e.data.view;
  if (e.data.theme) state.theme = e.data.theme;
  if (e.data.scenario) state.scenario = e.data.scenario;
  state.modal = null; state.search = ''; render();
});
render();
