// Run with the local server started: node test/backup-browser.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Browser } from './helpers/browser.mjs';
const browser = await Browser.launch();
const base = process.env.LINGTYPE_URL || 'http://127.0.0.1:8765/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const first = await browser.newPage();
  await first.goto(base, {settleMs:1000});
  assert.equal(await first.eval(`!!document.getElementById('backup-file')`), true);
  const second = await browser.newPage();
  await second.goto(base, {settleMs:1000});
  assert.match(await second.eval(`document.body.textContent`), /另一個分頁/);
  await second.close();
  const backup = {format:'lingtype-backup',version:2,pdfs:[{id:'restored',data:Buffer.from('%PDF-1.7\nrestored\n%%EOF').toString('base64')}],data:{
    'lingtype-custom-lessons':JSON.stringify([{id:'restored',custom:true,title:'Restored lesson',text:'Hello world.',words:[],translations:{},figures:[{kind:'page',page:1}]}]),
    'lingtype-notebook':JSON.stringify([{word:'hello',translations:{},sentences:[],added:1,practiced:0,missed:0}]),
    'lingtype-language':'zh'
  }};
  // Do not replace local data while a publish response containing the only owner key is in flight.
  await first.eval(`(() => { window.confirm=message=>{sessionStorage.setItem('backup-test-confirm', message);return true}; const original=window.fetch; window.fetch=(url, options)=>url==='/api/workbooks' && options?.method==='POST' ? new Promise(resolve=>{window.publishHeaders=options.headers; window.finishPublish=resolve;}) : original(url, options); document.getElementById('language').value='zh'; document.getElementById('language').dispatchEvent(new Event('change')); document.getElementById('publish-workbook').click(); document.getElementById('public-share-rights').checked = true; document.getElementById('public-share-form').requestSubmit(); })()`);
  for (let i=0; i<40 && !await first.eval(`typeof window.finishPublish === 'function'`); i++) await pause(50);
  assert.equal(await first.eval(`typeof window.finishPublish === 'function'`), true);
  await first.eval(`document.getElementById('backup-export').click()`);
  assert.match(await first.eval(`document.getElementById('backup-message').textContent`), /分享完成/);
  await first.eval(`(() => { const input=document.getElementById('backup-file'); const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(JSON.stringify(backup))}],'backup.json',{type:'application/json'})); input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  for (let i=0; i<40 && !await first.eval(`document.getElementById('backup-message').textContent.includes('分享完成')`); i++) await pause(50);
  assert.match(await first.eval(`document.getElementById('backup-message').textContent`), /分享完成/);
  for (let i=0; i<40 && !await first.eval(`sessionStorage.getItem('backup-test-confirm')?.includes('舊版備份沒有 PDF')`); i++) await pause(50);
  assert.match(await first.eval(`sessionStorage.getItem('backup-test-confirm')`), /舊版備份沒有 PDF 完整性校驗值/);
  await first.eval(`window.finishPublish({ok:true, json:async()=>({id:window.publishHeaders['X-Publication-Id'],ownerKey:window.publishHeaders['X-Owner-Key']})})`);
  for (let i=0; i<40 && !await first.eval(`!document.getElementById('publish-workbook').disabled && !document.getElementById('share-dialog').open`); i++) await pause(50);
  assert.equal(await first.eval(`JSON.parse(localStorage.getItem('lingtype-published-keys'))[window.publishHeaders['X-Publication-Id']]`), await first.eval(`window.publishHeaders['X-Owner-Key']`));
  const checkedBackup = {...backup, version:3, pdfs:backup.pdfs.map(pdf => ({...pdf, sha256:createHash('sha256').update(Buffer.from(pdf.data, 'base64')).digest('hex')}))};
  await first.eval(`(() => { window.confirm=()=>true; const input=document.getElementById('backup-file'); const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(JSON.stringify(checkedBackup))}],'backup.json',{type:'application/json'})); input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  let done = false;
  for (let i=0; i<80; i++) {
    await pause(250);
    if (await first.eval(`document.getElementById('backup-message')?.textContent === '資料已還原。'`)) { done = true; break; }
  }
  assert.equal(done, true, 'restore completes after reload');
  assert.equal(await first.eval(`Array.from(document.querySelectorAll('#lesson option')).some(o => o.textContent === 'Restored lesson')`), true);
  assert.equal(await first.eval(`JSON.parse(localStorage.getItem('lingtype-notebook'))[0].word`), 'hello');
  assert.equal(await first.eval(`new Promise((resolve,reject)=>{const request=indexedDB.open('lingtype-data'); request.onsuccess=()=>{const db=request.result, get=db.transaction('values').objectStore('values').get('pdf:restored'); get.onsuccess=async()=>{const text=await get.result.text(); db.close(); resolve(text)}; get.onerror=()=>reject(get.error)}; request.onerror=()=>reject(request.error)})`), '%PDF-1.7\nrestored\n%%EOF');
  await first.eval(`document.getElementById('nav-history').click()`);
  await first.screenshot({path:'.taste-skill/check-e2e/backup-screen.jpg', fullPage:true});
  await first.close();
  process.stdout.write('Browser backup restore and tab protection passed\n');
} finally { await browser.close(); }
