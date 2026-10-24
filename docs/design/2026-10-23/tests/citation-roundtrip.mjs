// Run: ego-browser nodejs < docs/design/2026-10-23/tests/citation-roundtrip.mjs
// Each invocation deliberately reloads fixtures to replay the same regression.
const task = await taskSpace('书灯引用往返回归 2026-10-23');
const page = task.page('p1');
console.log({spaceId:task.spaceId});
await page.goto('file:///Users/wangxinxin/work/projects_pycharm/shudeng/docs/design/2026-10-23/standalone.html');
await page.click('#interaction-mode');
await page.click('[data-screen="qa"]');
await page.waitForFunction(() => { const document = window.document.querySelector('#prototype').contentDocument; return document?.querySelector('.citation') && document.getAnimations().every(animation => animation.playState === 'finished'); });
const point = await page.evaluate(() => {
  const frame = document.querySelector('#prototype');
  const bounds = frame.getBoundingClientRect();
  const target = frame.contentDocument.querySelector('.citation').getBoundingClientRect();
  const scale = bounds.width / frame.contentWindow.innerWidth;
  return {x:bounds.x + (target.x + target.width / 2) * scale, y:bounds.y + (target.y + target.height / 2) * scale};
});
await page.mouse.click(point.x, point.y, {label:'查看回答引用'});
await page.waitForFunction(() => document.querySelector('#prototype').contentDocument.title === '书灯 · 选文');
const result = await page.evaluate(() => {
  const document = window.document.querySelector('#prototype').contentDocument;
  return {returnAvailable:!!document.querySelector('[data-action="return-qa"]'), highlighted:!!document.querySelector('.selected-text')};
});
console.log(result);
if (!result.returnAvailable) throw new Error('引用跳到原文后，没有返回问答入口');
const back = await page.evaluate(() => {
  const frame = document.querySelector('#prototype'), bounds = frame.getBoundingClientRect();
  const target = frame.contentDocument.querySelector('[data-action="return-qa"]').getBoundingClientRect();
  const scale = bounds.width / frame.contentWindow.innerWidth;
  return {x:bounds.x + (target.x + target.width / 2) * scale, y:bounds.y + (target.y + target.height / 2) * scale};
});
await page.mouse.click(back.x, back.y, {label:'返回原先问答'});
await page.waitForFunction(() => document.querySelector('#prototype').contentDocument.title === '书灯 · 问答');
console.log({roundtrip:true});

async function framePoint(selector) {
  return page.evaluate(selector => {
    const frame = document.querySelector('#prototype');
    frame.scrollIntoView({block:'center'});
    const target = frame.contentDocument.querySelector(selector);
    target.scrollIntoView({block:'nearest'});
    const bounds = frame.getBoundingClientRect(), rect = target.getBoundingClientRect();
    const scale = bounds.width / frame.contentWindow.innerWidth;
    return {x:bounds.x + (rect.x + rect.width / 2) * scale, y:bounds.y + (rect.y + rect.height / 2) * scale};
  }, selector);
}
async function clickFrame(selector) {
  const point = await framePoint(selector);
  await page.mouse.click(point.x, point.y);
}
async function qaState() {
  return page.evaluate(() => {
    const document = window.document.querySelector('#prototype').contentDocument;
    return {questions:[...document.querySelectorAll('.user-question')].map(node => node.textContent), draft:document.querySelector('#followup').value, scrollTop:document.querySelector('.conversation').scrollTop, attachmentOpen:document.querySelector('.message-attachment').open};
  });
}
function assertSame(before, after) {
  if (JSON.stringify(before.questions) !== JSON.stringify(after.questions) || before.draft !== after.draft || before.attachmentOpen !== after.attachmentOpen || Math.abs(before.scrollTop - after.scrollTop) > 1) throw new Error('往返丢失对话状态：' + JSON.stringify({before, after}));
}
for (const question of ['她对贾府的第一印象是什么？', '她为什么这么小心？']) {
  await page.fill('#followup', question);
  await clickFrame('[aria-label="发送追问"]');
}
await page.fill('#followup', '尚未发送的追问草稿');
await clickFrame('.message-attachment summary');
const checks = [];
for (const size of ['standard','small']) {
  await page.selectOption('#device-size', size);
  for (const theme of ['light','dark']) {
    await page.click('[data-theme="' + theme + '"]');
    for (const selector of ['.citation','.source-card']) {
      const point = await framePoint(selector), before = await qaState();
      if (before.questions.length !== 3 || before.draft !== '尚未发送的追问草稿') throw new Error('测试前对话已丢失');
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(() => !!document.querySelector('#prototype').contentDocument.querySelector('[data-action="return-qa"]'));
      const quote = await page.evaluate(() => {
        const frame = document.querySelector('#prototype'), preview = frame.contentDocument;
        const body = preview.querySelector('.reader-body').getBoundingClientRect(), mark = preview.querySelector('.selected-text').getBoundingClientRect();
        const back = preview.querySelector('[data-action="return-qa"]').getBoundingClientRect();
        return {highlightVisible:mark.bottom > body.top && mark.top < body.bottom, returnVisible:back.top >= 0 && back.bottom <= frame.contentWindow.innerHeight, noSelectionMenu:!preview.querySelector('.selection-menu'), overflow:preview.documentElement.scrollWidth > frame.contentWindow.innerWidth};
      });
      if (!quote.highlightVisible || !quote.returnVisible || !quote.noSelectionMenu || quote.overflow) throw new Error('引用界面异常：' + JSON.stringify(quote));
      if (selector === '.citation') await clickFrame('[data-action="return-qa"]'); else await page.keyboard.press('Escape');
      await page.waitForFunction(() => !!document.querySelector('#prototype').contentDocument.querySelector('.conversation'));
      assertSame(before, await qaState());
      checks.push({size, theme, selector, ...quote, conversationRestored:true});
    }
  }
}
const beforeClose = await qaState();
await clickFrame('[data-action="close-qa"]');
if (await page.evaluate(() => !!document.querySelector('#prototype').contentDocument.querySelector('[data-action="return-qa"]'))) throw new Error('普通阅读错误保留引用返回点');
await clickFrame('.ask-pill');
await page.waitForFunction(() => !!document.querySelector('#prototype').contentDocument.querySelector('.conversation'));
assertSame(beforeClose, await qaState());
await clickFrame('.citation');
const fs = await import('node:fs/promises');
const clip = await page.evaluate(() => {const rect = document.querySelector('#interaction .device').getBoundingClientRect(); return {x:rect.x + scrollX, y:rect.y + scrollY, width:rect.width, height:rect.height, scale:1};});
const shot = await page.cdp('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip});
await fs.writeFile('/Users/wangxinxin/work/projects_pycharm/shudeng/docs/design/2026-10-23/evidence/citation-return.png', Buffer.from(shot.data, 'base64'));
const evidence = {checks, closeAndReopenRestoresConversation:true};
await fs.writeFile('/Users/wangxinxin/work/projects_pycharm/shudeng/docs/design/2026-10-23/evidence/citation-roundtrip.json', JSON.stringify(evidence, null, 2));
console.log({combinations:checks.length, messages:beforeClose.questions.length, draftPreserved:true, scrollRestored:true, closeAndReopen:true});
await task.finish({keep:[]});
