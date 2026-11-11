import { test } from 'node:test';
import assert from 'node:assert/strict';

test('publishing creates a share link and public books can be added to the local library', async () => {
  const elements = new Map(), saved = {}, calls = [], id = 'a'.repeat(32), other = 'b'.repeat(32), third = 'c'.repeat(32), fourth = 'd'.repeat(32), fifth = 'e'.repeat(32), sixth = 'f'.repeat(32);
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.dataset = {}; this.children = []; this.classList = { toggle() {}, add() {} }; }
    append(...children) { this.children.push(...children); }
    click() { this.dispatchEvent(new Event('click')); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    focus() {}
    closest(selector) { return selector === '[data-category]' && Object.hasOwn(this.dataset, 'category') ? this : null; }
    querySelector() { return this.submit ||= new Element(); }
    set innerHTML(value) {
      this.html = value;
      for (const name of ['typing','article-text','article-translation','word-text','add-public-book','public-back','public-detail-message','public-like','public-comment-form','public-comment','public-name','public-comment-list','public-pending-comments','public-book-ranking','public-stats','public-cover-box','public-cover-button','public-cover-file']) if (value.includes(`id="${name}"`)) elements.set(name, new Element());
    }
    get innerHTML() { return this.html || ''; }
  }
  const ids = ['public-ranking','public-comments','lesson','language','exercise','result','word-mode','article-mode','restart','pause','category','progress','hint','passage-label','passage-mode','section-label','section-mode','source-info','import-form','import-title','import-text','import-translation','import-message','arxiv-form','arxiv-submit','arxiv-message','arxiv-url','word-picker','word-search','word-candidates','selected-words','picker-start','live-time','live-wpm','live-accuracy','live-accuracy-label','live-progress','progress-bar','history-list','delete-lesson','workspace-notice','publish-workbook','nav-practice','nav-import','nav-history','nav-public','view-practice','view-import','view-history','view-public','public-books','public-detail','public-message','public-search','public-sort','public-filters','public-pagination','public-prev','public-next','public-page','unpublish-form','unpublish-id','unpublish-key','unpublish-message'];
  for (const name of ids) elements.set(name, new Element());
  elements.get('public-sort').value = 'likes'; elements.get('language').value = 'zh'; elements.get('passage-mode').value = 'full'; elements.get('lesson').value = '0';
  globalThis.document = { getElementById:name => elements.get(name), createElement:() => new Element(), createTextNode:text => text };
  globalThis.localStorage = { getItem:key => saved[key] ?? null, setItem(key,value) { saved[key] = value; } };
  globalThis.location = { href:'http://localhost:8765/', hash:'' };
  globalThis.history = { replaceState() {} };
  globalThis.confirm = () => true;
  let randomByte = 0xaa;
  Object.defineProperty(globalThis, 'crypto', { configurable:true, value:{ getRandomValues(bytes) { bytes.fill(randomByte); return bytes; } } });
  const workbook = {format:'lingtype-workbook',version:1,lesson:{title:'Shared practice',text:'A gentle breeze.',words:[],translations:{},edited:true,sourceUrl:'https://example.org/article',license:'CC BY',authors:['A <Reader>']}};
  let delayedComment, delayedCommentId, delayedCommunity, delayedRead, delayedDelete, delayedCommentDelete, lostPublish = false, fullPublish = false, commentMode = '', categoryRemoved = false, stallLike = false, stallDelete = false, stallPublish = false, communityHasCover = false, stallCommunity = false, stallShelf = false, stallBook = false;
  const retryPublicationIds = [];
  let shortAttempt, stallAttempt = false, stalledSignal, fallbackStartCalls = 0, releaseStart, fifthAttempt, readRetryCalls = 0;
  const submittedAttemptIds = [];
  const sentCommentIds = [];
  const coverCalls = [], coverResponses = [];
  const response = data => ({ ok:true, json:async () => data });
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options.method || 'GET']);
    if (options.method === 'POST' && url === '/api/workbooks') {
      assert.equal(JSON.parse(saved['lingtype-published-keys'])[options.headers['X-Publication-Id']], options.headers['X-Owner-Key'], 'the owner key is saved before the request');
      if (stallPublish) {
        retryPublicationIds.push(options.headers['X-Publication-Id']);
        if (retryPublicationIds.length === 1) return new Promise(() => {});
      }
      if (lostPublish) throw Error('response lost');
      if (fullPublish) return {ok:false,status:507,json:async () => ({error:'公開練習冊儲存空間已滿。'})};
      return {ok:true,json:async () => ({id:options.headers['X-Publication-Id'],ownerKey:options.headers['X-Owner-Key']})};
    }
    if (url.startsWith('/api/workbooks?') && stallShelf) return new Promise(() => {});
    if (url.startsWith('/api/workbooks?') && categoryRemoved && new URL(url, 'http://localhost').searchParams.get('category') === 'arxiv') return response({total:0,categories:['travel'],books:[],ranking:[],comments:[]});
    if (url.startsWith('/api/workbooks?') && new URL(url, 'http://localhost').searchParams.get('page') === '2') return {ok:true,json:async () => ({total:25,categories:['arxiv','travel'],books:[{id,title:'Second page',createdAt:'2026-10-29'}],ranking:[],comments:[]})};
    if (url.startsWith('/api/workbooks?')) return {ok:true,json:async () => ({total:25,categories:categoryRemoved ? ['travel'] : ['arxiv','travel'],books:[{id:other,title:'Someone else <b>',authors:['A <Reader>'],createdAt:'2026-10-30T00:00:00Z',likes:3,reads:9,starts:4,completions:1,completionRate:25,category:categoryRemoved ? 'travel' : 'arxiv',words:300},{id,title:'Shared practice',createdAt:'2026-10-29T00:00:00Z'}],ranking:[{author:'Fast',wpm:61.4,accuracy:98,bookId:other,title:'Someone else <b>'}],comments:[]})};
    if (url === `/api/workbooks/${id}` && options.method === 'DELETE') {
      assert.equal(options.headers['X-Owner-Key'], 'a'.repeat(64));
      if (stallDelete) return new Promise(() => {});
      if (delayedDelete === true) return new Promise(resolve => { delayedDelete = resolve; });
      return response({ removed:true });
    }
    if (url === `/api/workbooks/${third}` && stallBook) return {ok:true, json:() => new Promise(() => {})};
    if (url === `/api/workbooks/${third}`) return response({ ...workbook, lesson:{ ...workbook.lesson, text:'A' } });
    if (url === `/api/workbooks/${fourth}`) return response({ ...workbook, lesson:{ ...workbook.lesson, text:'AB' } });
    if (url === `/api/workbooks/${fifth}`) return response({ ...workbook, lesson:{ ...workbook.lesson, text:'A' } });
    if (url === `/api/workbooks/${sixth}`) return response(workbook);
    if ([id, other].some(bookId => url === `/api/workbooks/${bookId}`)) return {ok:true,json:async () => workbook};
    if (url === `/api/workbooks/${fourth}/community/start` && options.method === 'POST') {
      fallbackStartCalls++;
      return {ok:fallbackStartCalls > 1, status:fallbackStartCalls > 1 ? 200 : 503, json:async () => ({count:1})};
    }
    if (url === `/api/workbooks/${fifth}/community/start` && options.method === 'POST') return new Promise(resolve => { releaseStart = resolve; });
    if (url === `/api/workbooks/${fifth}/community/attempts` && options.method === 'POST') { fifthAttempt = JSON.parse(options.body); return response({saved:true}); }
    if (url === `/api/workbooks/${third}/community/attempts` && options.method === 'POST') {
      shortAttempt = JSON.parse(options.body);
      submittedAttemptIds.push(shortAttempt.attemptId);
      if (stallAttempt) { stalledSignal = options.signal; return new Promise(() => {}); }
      return response({saved:true});
    }
    if (url.includes('/community?')) {
      if (stallCommunity) return new Promise(() => {});
      if (delayedCommunity === true) return new Promise(resolve => { delayedCommunity = resolve; });
      return response({ likes:0, liked:false, comments:[], ranking:[], hasCover:communityHasCover });
    }
    if (url === `/api/workbooks/${id}/community/read` && delayedRead === true) return new Promise(resolve => { delayedRead = resolve; });
    if (url === `/api/workbooks/${sixth}/community/read` && options.method === 'POST') { readRetryCalls++; return {ok:readRetryCalls > 1, status:readRetryCalls > 1 ? 200 : 503}; }
    if (url.includes('/community/comments/') && options.method === 'DELETE') return new Promise(resolve => { delayedCommentDelete = resolve; });
    if (url.endsWith('/community/comments') && options.method === 'POST') {
      delayedCommentId = JSON.parse(options.body).commentId;
      if (commentMode) {
        sentCommentIds.push(delayedCommentId);
        if (commentMode === 'lost') throw Error('response lost');
        if (commentMode === 'stall') return new Promise(() => {});
        if (commentMode === 'full') return {ok:false, status:507, json:async () => ({error:'書房空間已滿'})};
        if (commentMode === 'removed') return { ok:false, status:410, json:async () => ({error:'這則留言已被移除。'}) };
        return response({ id:delayedCommentId });
      }
      return new Promise(resolve => { delayedComment = resolve; });
    }
    if (url.endsWith('/community/like') && options.method === 'POST') return stallLike ? {ok:true,json:() => new Promise(() => {})} : response({ likes:1 });
    if (url.endsWith('/cover-revision')) return response({revision:0});
    if (url.endsWith('/cover') && options.method === 'POST') {
      coverCalls.push(options.body.name);
      return new Promise(resolve => coverResponses.push(resolve));
    }
    return {ok:false,json:async () => ({error:'offline'})};
  };
  await import('../site/app.mjs');
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'a'.repeat(64));
  assert.match(elements.get('workspace-notice').children[0].href, new RegExp(`#book-${id}$`));
  elements.get('nav-public').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const shelf = elements.get('public-books').innerHTML;
  assert.match(shelf, /Shared practice/);
  assert.match(shelf, /A &lt;Reader&gt;/);
  // Requests or response bodies that never finish show a recoverable error,
  // rather than leaving the shelf or a shared link loading forever.
  const shelfSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => shelfSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    stallShelf = true;
    elements.get('nav-public').click();
    await new Promise(resolve => shelfSetTimeout(resolve, 30));
    assert.match(elements.get('public-message').textContent, /無法載入/);
    stallShelf = false;
    elements.get('nav-public').click();
    await new Promise(resolve => shelfSetTimeout(resolve, 0));
    assert.match(elements.get('public-books').innerHTML, /Shared practice/);
    stallBook = true;
    elements.get('public-books').dataset.bookId = third;
    elements.get('public-books').click();
    await new Promise(resolve => shelfSetTimeout(resolve, 30));
    assert.match(elements.get('public-message').textContent, /無法載入/);
    stallBook = false;
    elements.get('public-books').click();
    await new Promise(resolve => shelfSetTimeout(resolve, 0));
    assert.match(elements.get('public-detail').innerHTML, /Shared practice/);
  } finally { stallShelf = false; stallBook = false; globalThis.setTimeout = shelfSetTimeout; }
  assert.ok(shelf.indexOf('Someone else') < shelf.indexOf('Shared practice'), 'the most liked book comes first');
  assert.match(shelf, /Someone else &lt;b&gt;/);
  assert.match(shelf, /9 人閱讀/);
  assert.match(shelf, /完成率 25%/);
  assert.match(shelf, /論文 · A &lt;Reader&gt; · 約 10 分鐘/);
  assert.match(shelf, /還沒有人開始/);
  assert.match(elements.get('public-ranking').innerHTML, /Fast[\s\S]*61 WPM/);
  elements.get('public-next').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-books').innerHTML, /Second page/);
  assert.match(elements.get('public-page').textContent, /2／2/);
  elements.get('public-prev').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-search').value = 'old book';
  elements.get('public-search').dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(calls.some(([url]) => url.includes('query=old+book') && url.includes('page=1')));

  // Another reader removes the last book in the selected category.
  elements.get('public-search').value = '';
  elements.get('public-filters').dataset.category = 'arxiv';
  elements.get('public-filters').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  categoryRemoved = true;
  const beforeRefresh = calls.length;
  elements.get('nav-public').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const refreshCalls = calls.slice(beforeRefresh).map(([url]) => url);
  assert.ok(refreshCalls.some(url => url.includes('category=arxiv')));
  assert.ok(refreshCalls.some(url => url.includes('category=&')), 'clearing a removed category refetches all books');
  assert.match(elements.get('public-books').innerHTML, /Shared practice/);
  assert.equal(elements.get('public-message').textContent, '');
  assert.equal(elements.get('public-filters').hidden, false, 'a single named category remains selectable alongside All');
  categoryRemoved = false;

  // A shared link can point to a book outside the current shelf page.
  // The later community response supplies its cover metadata.
  communityHasCover = true;
  elements.get('public-books').dataset.bookId = third;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-cover-box').innerHTML, new RegExp(`/api/workbooks/${third}/cover`));
  communityHasCover = false;

  // A temporary read failure is retried without reopening the book.
  const readSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => readSetTimeout(callback, delay === 60000 ? 15 : delay, ...args);
  try {
    elements.get('public-books').dataset.bookId = sixth;
    elements.get('public-books').click();
    await new Promise(resolve => readSetTimeout(resolve, 50));
    assert.equal(readRetryCalls, 2);
    assert.ok(!JSON.parse(saved['lingtype-public-progress']).reads.some(item => item.bookId === sixth));
  } finally { globalThis.setTimeout = readSetTimeout; }

  // A stalled social detail can be retried without reopening the book.
  const socialSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => socialSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    stallCommunity = true;
    elements.get('public-books').click();
    await new Promise(resolve => socialSetTimeout(resolve, 35));
    assert.equal(elements.get('public-like').disabled, false);
    assert.match(elements.get('public-like').textContent, /重試/);
    assert.match(elements.get('public-detail-message').textContent, /無法載入/);
    stallCommunity = false;
    elements.get('public-like').click();
    await new Promise(resolve => socialSetTimeout(resolve, 0));
    assert.equal(elements.get('public-like').disabled, false);
    assert.match(elements.get('public-like').textContent, /♡/);
    assert.equal(elements.get('public-detail-message').textContent, '');
  } finally { stallCommunity = false; globalThis.setTimeout = socialSetTimeout; }

  // Each explicitly chosen publication gets its own copy, even if this reader
  // shared a built-in lesson. Reopening it must reuse the existing copy.
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail').innerHTML, /A gentle breeze/);
  assert.match(elements.get('public-detail').innerHTML, /A &lt;Reader&gt;/);
  assert.match(elements.get('public-detail').innerHTML, /編輯版/);
  assert.match(elements.get('public-detail').innerHTML, /CC BY/);
  assert.match(elements.get('public-detail').innerHTML, /href="https:\/\/example\.org\/article"/);
  const cover = elements.get('public-cover-file');
  cover.files = [{name:'first.png', size:100, type:'image/png'}];
  cover.dispatchEvent(new Event('change'));
  cover.files = [{name:'second.png', size:100, type:'image/png'}];
  cover.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(coverCalls, ['first.png'], 'the later cover waits for the first upload');
  coverResponses[0](response({saved:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(coverCalls, ['first.png', 'second.png']);
  coverResponses[1](response({saved:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail-message').textContent, /封面已更新/);
  const coverSetTimeout = globalThis.setTimeout;
  const coverAbortController = globalThis.AbortController;
  globalThis.setTimeout = (callback, delay, ...args) => coverSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  globalThis.AbortController = undefined;
  try {
    cover.files = [{name:'stalled.png', size:100, type:'image/png'}];
    cover.dispatchEvent(new Event('change'));
    cover.files = [{name:'next.png', size:100, type:'image/png'}];
    cover.dispatchEvent(new Event('change'));
    await new Promise(resolve => coverSetTimeout(resolve, 30));
    assert.deepEqual(coverCalls.slice(-2), ['stalled.png', 'next.png']);
    coverResponses[3](response({saved:true}));
    await new Promise(resolve => coverSetTimeout(resolve, 0));
    coverResponses[2]({ok:false,status:409,json:async () => ({error:'changed'})});
    await new Promise(resolve => coverSetTimeout(resolve, 0));
    assert.equal(coverCalls.length, 4, 'a late conflict after timeout does not start another old upload even without AbortController');
  } finally { globalThis.setTimeout = coverSetTimeout; globalThis.AbortController = coverAbortController; }
  cover.files = [{name:'conflict.png', size:100, type:'image/png'}];
  cover.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  coverResponses[4]({ok:false,status:409,json:async () => ({error:'changed'})});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(coverCalls.slice(-2), ['conflict.png', 'conflict.png'], 'a confirmed conflict reads the revision and retries');
  coverResponses[5](response({saved:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  const firstCopy = JSON.parse(saved['lingtype-custom-lessons']);
  assert.equal(firstCopy.length, 1);
  assert.equal(firstCopy[0].publicId, id);
  randomByte = 0x99;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-custom-lessons'])[0].publicId, id, 'sharing an existing public copy must not relabel its source or progress');
  randomByte = 0xaa;
  elements.get('typing').value = 'A';
  elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  assert.equal(JSON.parse(saved['lingtype-custom-lessons']).length, 1);
  // Someone else's book is added once, remembering where it came from.
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.some(([url, method]) => url === `/api/workbooks/${other}/community/read` && method === 'POST'));
  elements.get('add-public-book').click();
  const added = JSON.parse(saved['lingtype-custom-lessons']);
  assert.equal(added.length, 2);
  assert.equal(added[1].title, 'Shared practice');
  assert.equal(added[1].publicId, other);
  assert.notEqual(added[0].id, added[1].id);
  elements.get('typing').value = 'A g';
  elements.get('typing').dispatchEvent(new Event('input'));
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  assert.equal(elements.get('typing').value, 'A', 'share A keeps its own unfinished progress');
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  assert.equal(elements.get('typing').value, 'A g', 'share B keeps its separate unfinished progress');

  // A failed save must not switch to an existing copy or create a new one.
  const lessonBeforeFailure = elements.get('lesson').value;
  const oldSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = function(key, value) {
    if (key === 'lingtype-progress') throw Error('storage full');
    return oldSetItem.call(this, key, value);
  };
  for (const target of [id, third]) {
    elements.get('public-books').dataset.bookId = target;
    elements.get('public-books').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    elements.get('add-public-book').click();
    assert.equal(elements.get('lesson').value, lessonBeforeFailure);
    assert.equal(elements.get('typing').value, 'A g');
    assert.equal(JSON.parse(saved['lingtype-custom-lessons']).length, 2);
    assert.match(elements.get('public-detail-message').textContent, /儲存/);
  }
  globalThis.localStorage.setItem = oldSetItem;

  // Removing one local copy leaves the other intact; reopening creates a fresh
  // copy of the removed share rather than resurrecting its old snapshot.
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  elements.get('delete-lesson').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(saved['lingtype-custom-lessons']).map(item => item.publicId), [other]);
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  const afterReadd = JSON.parse(saved['lingtype-custom-lessons']);
  assert.equal(afterReadd.length, 2);
  assert.notEqual(afterReadd.find(item => item.publicId === id).id, firstCopy[0].id);
  assert.equal(elements.get('typing').value, '');
  assert.equal(afterReadd.find(item => item.publicId === other).id, added[1].id);
  assert.ok(calls.some(([url, method]) => url === '/api/workbooks' && method === 'POST'));

  // A stalled read counter must not block the social detail; when it resolves
  // after changing books it must not invalidate the new book's pending load.
  delayedRead = true;
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-like').disabled, false, 'social details load even while read is pending');
  delayedCommunity = true;
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const priorAReads = calls.filter(([url]) => url.startsWith(`/api/workbooks/${id}/community?`)).length;
  delayedRead(response({count:1}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([url]) => url.startsWith(`/api/workbooks/${id}/community?`)).length, priorAReads, 'an old read does not refresh a different detail');
  delayedCommunity(response({ likes:0, liked:false, comments:[], ranking:[] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-like').disabled, false, 'new detail is not invalidated');

  delayedRead = true;
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const previousRead = delayedRead;
  delayedRead = false; delayedCommunity = true;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const callsBeforeReopen = calls.filter(([url]) => url.startsWith(`/api/workbooks/${id}/community?`)).length;
  previousRead(response({count:1}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([url]) => url.startsWith(`/api/workbooks/${id}/community?`)).length, callsBeforeReopen, 'an old read cannot refresh a reopened detail');
  delayedCommunity(response({ likes:0, liked:false, comments:[], ranking:[] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-like').disabled, false);

  // A double click on one delete button is one server request, even when the
  // first response is slow. An unconfirmed response releases the control.
  const commentId = 'f'.repeat(32), commentList = elements.get('public-comment-list');
  commentList.dataset.removeComment = commentId;
  const deletesBefore = calls.filter(([url, method]) => url.endsWith(`/community/comments/${commentId}`) && method === 'DELETE').length;
  commentList.click(); commentList.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([url, method]) => url.endsWith(`/community/comments/${commentId}`) && method === 'DELETE').length, deletesBefore + 1);
  delayedCommentDelete(response({removed:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  const commentDeleteSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => commentDeleteSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    commentList.click();
    await new Promise(resolve => commentDeleteSetTimeout(resolve, 30));
    assert.match(elements.get('public-detail-message').textContent, /無法確認留言是否刪除/);
    commentList.click();
    await new Promise(resolve => commentDeleteSetTimeout(resolve, 0));
    assert.equal(calls.filter(([url, method]) => url.endsWith(`/community/comments/${commentId}`) && method === 'DELETE').length, deletesBefore + 3);
    delayedCommentDelete(response({removed:true}));
    await new Promise(resolve => commentDeleteSetTimeout(resolve, 0));
  } finally { globalThis.setTimeout = commentDeleteSetTimeout; delete commentList.dataset.removeComment; }

  // A response to the previous name must not clear a new draft that happens
  // to contain the same text but has since been assigned a different name.
  elements.get('public-name').value = 'Before';
  elements.get('public-comment').value = 'Same text';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-name').value = 'After';
  elements.get('public-detail-message').textContent = 'Newer notice';
  delayedComment(response({id:delayedCommentId}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-comment').value, 'Same text');
  assert.equal(elements.get('public-name').value, 'After');
  assert.equal(elements.get('public-detail-message').textContent, 'Newer notice');

  // Late responses from one detail view must not erase a draft in another view.
  elements.get('public-books').dataset.bookId = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-comment').value = 'First draft';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-comment').value = 'Second draft';
  delayedComment(response({id:delayedCommentId}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-comment').value, 'Second draft');

  // A stale refresh must not replace the result of a newer like action.
  delayedCommunity = true;
  elements.get('public-comment').value = 'A comment';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  delayedComment(response({id:delayedCommentId}));
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('public-like').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-like').attributes['aria-pressed'], 'true');
  delayedCommunity(response({ likes:0, liked:false, comments:[], ranking:[] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.get('public-like').attributes['aria-pressed'], 'true');
  // A lost response may already have been committed on the server: retry the
  // same draft with the same ID, but a later intentional post gets a new ID.
  randomByte = 0x11; commentMode = 'lost';
  elements.get('public-comment').value = 'Retry me';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail-message').textContent, /無法確認留言是否送出/);
  elements.get('public-books').dataset.bookId = other;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-pending-comments').innerHTML, /Retry me/);
  elements.get('public-pending-comments').dataset.pendingComment = sentCommentIds[0];
  elements.get('public-comment').value = 'Unsent draft';
  globalThis.confirm = () => false;
  elements.get('public-pending-comments').click();
  assert.equal(elements.get('public-comment').value, 'Unsent draft', 'restoring a pending comment cannot overwrite an unrelated draft without confirmation');
  globalThis.confirm = () => true;
  elements.get('public-pending-comments').click();
  assert.equal(elements.get('public-comment').value, 'Retry me');
  randomByte = 0x22; commentMode = 'success';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sentCommentIds[0], sentCommentIds[1]);
  assert.doesNotMatch(elements.get('public-pending-comments').innerHTML, /Retry me/, 'confirmed comments disappear from the pending list');
  elements.get('public-comment').value = 'Retry me';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(sentCommentIds[1], sentCommentIds[2]);
  randomByte = 0x33; commentMode = 'removed';
  elements.get('public-comment').value = 'Removed comment';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail-message').textContent, /已被移除/);
  assert.equal(elements.get('public-comment').value, 'Removed comment', 'do not silently repost or clear the draft');
  randomByte = 0x44; commentMode = 'success';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(sentCommentIds[3], sentCommentIds[4], 'only a deliberate new submission receives a fresh ID');
  randomByte = 0x55; commentMode = 'lost';
  elements.get('public-comment').value = 'Earlier uncertain comment';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  randomByte = 0x66; commentMode = 'success';
  elements.get('public-comment').value = 'Edited comment';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  randomByte = 0x77;
  elements.get('public-comment').value = 'Earlier uncertain comment';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(sentCommentIds[5], sentCommentIds[6], 'edited content is a new submission');
  assert.equal(sentCommentIds[5], sentCommentIds[7], 'reverting after posting another comment retries the original ID');
  randomByte = 0x79; commentMode = 'full';
  elements.get('public-comment').value = 'Capacity';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('public-detail-message').textContent, /書房空間已滿/, 'a definite capacity rejection remains actionable');
  // A reader may explicitly stop tracking an uncertain submission without
  // deleting any comment on the server or accidentally sending it again.
  randomByte = 0x78; commentMode = 'lost';
  elements.get('public-comment').value = 'Do not track';
  elements.get('public-comment-form').dispatchEvent(new Event('submit', {cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  const forgottenId = sentCommentIds.at(-1), pendingBox = elements.get('public-pending-comments');
  assert.match(pendingBox.innerHTML, /Do not track/);
  pendingBox.dataset.forgetComment = forgottenId;
  globalThis.confirm = () => false;
  pendingBox.click();
  assert.match(pendingBox.innerHTML, /Do not track/);
  globalThis.confirm = () => true;
  const sentBeforeForgetting = sentCommentIds.length;
  pendingBox.click();
  assert.doesNotMatch(pendingBox.innerHTML, /Do not track/);
  assert.equal(sentCommentIds.length, sentBeforeForgetting);
  assert.match(elements.get('public-detail-message').textContent, /已發表的留言不受影響/);
  delete pendingBox.dataset.forgetComment;
  // Both a stalled request and a stalled response body must release their UI.
  const interactionSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => interactionSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    randomByte = 0x88; commentMode = 'stall';
    elements.get('public-comment').value = 'Stalled draft';
    elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
    await new Promise(resolve => interactionSetTimeout(resolve, 30));
    assert.equal(elements.get('public-comment-form').querySelector().disabled, false);
    assert.match(elements.get('public-detail-message').textContent, /無法確認留言是否送出/);
    assert.equal(elements.get('public-comment').value, 'Stalled draft');
    randomByte = 0x99; commentMode = 'success';
    elements.get('public-comment-form').dispatchEvent(new Event('submit', { cancelable:true }));
    await new Promise(resolve => interactionSetTimeout(resolve, 0));
    assert.equal(sentCommentIds.at(-2), sentCommentIds.at(-1), 'retry keeps the uncertain comment ID');
    assert.equal(elements.get('public-detail-message').textContent, '', 'a confirmed retry clears the stale uncertainty notice');
    stallLike = true;
    elements.get('public-like').click();
    await new Promise(resolve => interactionSetTimeout(resolve, 30));
    assert.equal(elements.get('public-like').disabled, false);
    stallLike = false;
    elements.get('public-like').click();
    await new Promise(resolve => interactionSetTimeout(resolve, 0));
    assert.equal(elements.get('public-like').disabled, false);
  } finally { globalThis.setTimeout = interactionSetTimeout; }
  commentMode = ''; randomByte = 0xaa;
  // An uncertain publication retries with the same identity. A hung removal
  // keeps the key and tells the reader to check whether it took effect.
  const managementSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => managementSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    stallPublish = true;
    elements.get('publish-workbook').click();
    await new Promise(resolve => managementSetTimeout(resolve, 35));
    assert.deepEqual(retryPublicationIds, [id, id]);
    assert.equal(elements.get('publish-workbook').disabled, false);
    stallPublish = false; stallDelete = true;
    elements.get('unpublish-id').value = id;
    elements.get('unpublish-key').value = '';
    elements.get('unpublish-form').dispatchEvent(new Event('submit', { cancelable:true }));
    await new Promise(resolve => managementSetTimeout(resolve, 30));
    assert.match(elements.get('unpublish-message').textContent, /無法確認/);
    assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'a'.repeat(64));
    elements.get('public-books').dataset.removeBook = id;
    elements.get('public-books').click();
    await new Promise(resolve => managementSetTimeout(resolve, 30));
    assert.match(elements.get('public-message').textContent, /無法確認/);
    assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'a'.repeat(64));
    delete elements.get('public-books').dataset.removeBook;
  } finally { stallPublish = false; stallDelete = false; globalThis.setTimeout = managementSetTimeout; }
  fullPublish = true;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(elements.get('hint').textContent, /儲存空間已滿/);
  fullPublish = false;
  lostPublish = true;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], 'a'.repeat(64));
  assert.match(elements.get('hint').textContent, new RegExp(id));
  lostPublish = false; delayedDelete = true;
  elements.get('unpublish-id').value = id;
  elements.get('unpublish-key').value = '';
  elements.get('unpublish-form').dispatchEvent(new Event('submit', { cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  randomByte = 0xcc;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  delayedDelete(response({removed:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], undefined);
  assert.equal(JSON.parse(saved['lingtype-published-keys'])['c'.repeat(32)], 'c'.repeat(64), 'form removal preserves a concurrently published owner key');

  // The bookshelf removal button has the same delayed-response risk.
  randomByte = 0xaa;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  delayedDelete = true;
  elements.get('public-books').dataset.removeBook = id;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  randomByte = 0xdd;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  delayedDelete(response({removed:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  delete elements.get('public-books').dataset.removeBook;
  assert.equal(JSON.parse(saved['lingtype-published-keys'])[id], undefined);
  assert.equal(JSON.parse(saved['lingtype-published-keys'])['d'.repeat(32)], 'd'.repeat(64), 'shelf removal preserves a concurrently published owner key');
  const before = calls.filter(([url, method]) => url === '/api/workbooks' && method === 'POST').length;
  randomByte = 0xee;
  globalThis.localStorage.setItem = (key, value) => { if (key === 'lingtype-published-keys') throw Error('quota'); saved[key] = value; };
  lostPublish = false;
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([url, method]) => url === '/api/workbooks' && method === 'POST').length, before, 'do not publish if the removal key cannot be saved');
  globalThis.localStorage.setItem = () => {};
  elements.get('publish-workbook').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([url, method]) => url === '/api/workbooks' && method === 'POST').length, before, 'also reject storage that silently discards writes');

  // The first and last input of a one-character lesson can share the same
  // timer tick. Completion must still be reported without a ranking speed.
  globalThis.localStorage.setItem = oldSetItem;
  Object.defineProperty(globalThis, 'performance', { configurable:true, value:{now:() => 1000} });
  elements.get('public-books').dataset.bookId = third;
  elements.get('public-books').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  elements.get('add-public-book').click();
  elements.get('typing').value = 'A';
  elements.get('typing').dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(shortAttempt?.completionOnly, true);
  assert.equal(shortAttempt?.accuracy, 100);

  // A stalled request cannot hold the app's entire outbox forever.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay === 20000 ? 15 : delay, ...args);
  try {
    randomByte = 0x31; stallAttempt = true;
    elements.get('restart').click();
    elements.get('typing').value = 'A';
    elements.get('typing').dispatchEvent(new Event('input'));
    await new Promise(resolve => realSetTimeout(resolve, 40));
    assert.equal(stalledSignal?.aborted, true);
    const stalledId = JSON.parse(saved['lingtype-public-progress']).outbox[0].attemptId;
    randomByte = 0x32; stallAttempt = false;
    elements.get('restart').click();
    elements.get('typing').value = 'A';
    elements.get('typing').dispatchEvent(new Event('input'));
    await new Promise(resolve => realSetTimeout(resolve, 20));
    assert.ok(submittedAttemptIds.filter(id => id === stalledId).length >= 2, 'the same attempt is retried');
    assert.equal(JSON.parse(saved['lingtype-public-progress']).outbox.length, 0);
  } finally { globalThis.setTimeout = realSetTimeout; }

  // The first keystroke starts a request; completing while it is still
  // pending must not hold the score behind that unrelated request.
  elements.get('public-books').dataset.bookId = fifth;
  elements.get('public-books').click();
  await new Promise(resolve => realSetTimeout(resolve, 0));
  elements.get('add-public-book').click();
  elements.get('typing').value = 'A';
  elements.get('typing').dispatchEvent(new Event('input'));
  await new Promise(resolve => realSetTimeout(resolve, 0));
  assert.equal(typeof releaseStart, 'function');
  assert.ok(fifthAttempt, 'the completion is sent while start is still pending');
  assert.equal(JSON.parse(saved['lingtype-public-progress']).outbox.length, 0);
  releaseStart(response({count:1}));
  await new Promise(resolve => realSetTimeout(resolve, 0));

  // If persistent storage silently drops the queue write, do not send one
  // start request per keystroke; retry the failed request in this session.
  globalThis.localStorage.setItem = function(key, value) {
    if (key !== 'lingtype-public-progress') return oldSetItem.call(this, key, value);
  };
  globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay === 60000 ? 25 : delay, ...args);
  try {
    elements.get('public-books').dataset.bookId = fourth;
    elements.get('public-books').click();
    await new Promise(resolve => realSetTimeout(resolve, 0));
    elements.get('add-public-book').click();
    elements.get('typing').value = 'A';
    elements.get('typing').dispatchEvent(new Event('input'));
    elements.get('typing').value = 'AB';
    elements.get('typing').dispatchEvent(new Event('input'));
    await new Promise(resolve => realSetTimeout(resolve, 5));
    assert.equal(fallbackStartCalls, 1);
    await new Promise(resolve => realSetTimeout(resolve, 40));
    assert.equal(fallbackStartCalls, 2);
  } finally {
    globalThis.localStorage.setItem = oldSetItem;
    globalThis.setTimeout = realSetTimeout;
  }

  // If the pending-comment identity cannot be stored, disclose that a page
  // reload would lose the safe retry, while retaining it for this session.
  elements.get('public-books').dataset.bookId = fourth;
  elements.get('public-books').click();
  await new Promise(resolve => realSetTimeout(resolve, 0));
  globalThis.localStorage.setItem = function(key, value) {
    if (key !== 'lingtype-pending-comments') return oldSetItem.call(this, key, value);
  };
  try {
    commentMode = 'lost'; randomByte = 0x81;
    elements.get('public-comment').value = 'Unsaved identity';
    elements.get('public-comment-form').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(resolve => realSetTimeout(resolve, 0));
    assert.match(elements.get('public-detail-message').textContent, /無法保存待確認留言/);
    randomByte = 0x82; commentMode = 'success';
    elements.get('public-comment-form').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(resolve => realSetTimeout(resolve, 0));
    assert.equal(sentCommentIds.at(-2), sentCommentIds.at(-1));
    assert.match(elements.get('public-detail-message').textContent, /無法保存留言確認狀態/);
  } finally { globalThis.localStorage.setItem = oldSetItem; }

  // A directly opened book need not be present on the current shelf page.
  // Replacing its cover must retain the title from its detail data.
  const keys = JSON.parse(saved['lingtype-published-keys']);
  keys[third] = 'c'.repeat(64);
  oldSetItem.call(globalThis.localStorage, 'lingtype-published-keys', JSON.stringify(keys));
  elements.get('public-books').dataset.bookId = third;
  elements.get('public-books').click();
  await new Promise(resolve => realSetTimeout(resolve, 0));
  const directCover = elements.get('public-cover-file');
  directCover.files = [{name:'direct.png', size:100, type:'image/png'}];
  directCover.dispatchEvent(new Event('change'));
  await new Promise(resolve => realSetTimeout(resolve, 0));
  coverResponses.at(-1)(response({saved:true}));
  await new Promise(resolve => realSetTimeout(resolve, 0));
  assert.match(elements.get('public-cover-box').innerHTML, /Shared practice/);
  assert.match(elements.get('public-cover-box').innerHTML, new RegExp(`/api/workbooks/${third}/cover`));
});
