// Run with the local server started: node test/backup-browser.mjs
import assert from 'node:assert/strict';
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';
const browser = await Browser.launch();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const first = await browser.newPage();
  await first.goto('http://127.0.0.1:8765/', {settleMs:1000});
  assert.equal(await first.eval(`!!document.getElementById('backup-file')`), true);
  const second = await browser.newPage();
  await second.goto('http://127.0.0.1:8765/', {settleMs:1000});
  assert.match(await second.eval(`document.body.textContent`), /另一個分頁/);
  await second.close();
  const backup = {format:'lingtype-backup',version:1,data:{
    'lingtype-custom-lessons':JSON.stringify([{id:'restored',custom:true,title:'Restored lesson',text:'Hello world.',words:[],translations:{}}]),
    'lingtype-notebook':JSON.stringify([{word:'hello',translations:{},sentences:[],added:1,practiced:0,missed:0}]),
    'lingtype-language':'zh'
  }};
  await first.eval(`(() => { window.confirm=()=>true; const input=document.getElementById('backup-file'); const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(JSON.stringify(backup))}],'backup.json',{type:'application/json'})); input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  let done = false;
  for (let i=0; i<80; i++) {
    await pause(250);
    if (await first.eval(`document.getElementById('backup-message')?.textContent === '資料已還原。'`)) { done = true; break; }
  }
  assert.equal(done, true, 'restore completes after reload');
  assert.equal(await first.eval(`Array.from(document.querySelectorAll('#lesson option')).some(o => o.textContent === 'Restored lesson')`), true);
  assert.equal(await first.eval(`JSON.parse(localStorage.getItem('lingtype-notebook'))[0].word`), 'hello');
  await first.eval(`document.getElementById('nav-history').click()`);
  await first.screenshot({path:'.taste-skill/check-e2e/backup-screen.jpg', fullPage:true});
  await first.close();
  process.stdout.write('Browser backup restore and tab protection passed\n');
} finally { await browser.close(); }
