// A PDF can have 2,000 pages and long pages may split into multiple sections.
export const MAX_WORKBOOK_SECTIONS = 4000;

export const lessons = [
  { id:'morning', title:'A quieter morning', category:'日常生活', text:'The city was still quiet when Mia opened her window. A gentle breeze carried the scent of rain, and for a moment she simply watched the morning unfold.', translations:{zh:'城市仍然安靜時，Mia 打開了窗戶。微風帶來雨的氣息，有那麼一刻，她只是靜靜看著早晨展開。',ja:'街がまだ静かなうちに、ミアは窓を開けました。そよ風が雨の香りを運び、彼女はしばらく朝の始まりを眺めていました。',ko:'도시가 아직 조용할 때 미아는 창문을 열었습니다. 산들바람이 비 냄새를 실어 왔고, 그녀는 잠시 아침이 펼쳐지는 모습을 바라보았습니다.'}, words:[['gentle','溫和的','穏やかな','부드러운'],['breeze','微風','そよ風','산들바람'],['scent','氣味','香り','향기'],['unfold','展開','展開する','펼쳐지다']] },
  { id:'garden', title:'A small garden', category:'自然與生活', text:'Every weekend, Noah tends a small garden behind his home. The seedlings grow slowly, but their progress reminds him that patience can be rewarding.', translations:{zh:'每個週末，Noah 都會照料家後方的小花園。幼苗長得很慢，但它們的成長提醒他，耐心是會有回報的。',ja:'毎週末、ノアは家の裏にある小さな庭の世話をします。苗はゆっくり育ちますが、その成長は忍耐が報われることを彼に思い出させます。',ko:'매주 주말 노아는 집 뒤의 작은 정원을 가꿉니다. 모종은 천천히 자라지만, 그 성장은 인내가 보람을 줄 수 있다는 것을 일깨워 줍니다.'}, words:[['tends','照料','世話をする','돌보다'],['seedlings','幼苗','苗','모종'],['progress','進展','成長','진전'],['patience','耐心','忍耐','인내'],['rewarding','有回報的','やりがいのある','보람 있는']] },
  { id:'journey', title:'The long way home', category:'小小旅程', text:'Instead of rushing home, Lina chose a different path through the neighborhood. She discovered a tiny bookstore and promised herself to return on a rainy afternoon.', translations:{zh:'Lina 沒有急著回家，而是選了一條穿過街區的不同路線。她發現了一間小書店，並答應自己要在雨天的午後再回來。',ja:'リナは急いで帰る代わりに、近所を通る別の道を選びました。小さな本屋を見つけ、雨の午後にまた来ようと自分に約束しました。',ko:'리나는 서둘러 집에 가는 대신 동네를 가로지르는 다른 길을 택했습니다. 작은 서점을 발견한 그녀는 비 오는 오후에 다시 오기로 마음먹었습니다.'}, words:[['rushing','匆忙','急ぐこと','서두르기'],['neighborhood','街區','近所','동네'],['discovered','發現','発見した','발견했다'],['promised','承諾','約束した','약속했다']] },
  { id:'inner-voice', title:'Your inner voice', category:'影片主題改寫', source:'依 Ethan Kross 的 TED 演講主題改寫，非影片逐字稿', sourceUrl:'https://www.youtube.com/watch?v=xb0nLpdWttA', text:'Our inner voice can help us reflect and plan. Sometimes, however, it can lead us into a loop of negative thoughts. Taking a step back may help us find a calmer perspective.', translations:{zh:'內心的聲音可以幫助我們反思與規劃。不過有時候，它也會讓我們陷入負面思緒的循環。退一步看，或許能幫助我們用更平靜的角度思考。',ja:'内なる声は、振り返ったり計画を立てたりする助けになります。しかし時には、否定的な考えのループに陥ることもあります。一歩引いて考えると、より落ち着いた視点が見つかるかもしれません。',ko:'마음속 목소리는 우리가 돌아보고 계획하는 데 도움을 줄 수 있습니다. 하지만 때로는 부정적인 생각의 고리에 빠지게 할 수도 있습니다. 한 걸음 물러서면 더 차분한 관점을 찾는 데 도움이 될 수 있습니다.'}, words:[['reflect','反思','振り返る','돌아보다'],['negative','負面的','否定的な','부정적인'],['thoughts','思緒','考え','생각'],['perspective','觀點','視点','관점']] },
  { id:'coffee', title:'At the coffee shop', category:'日常對話', text:'Could I have a cup of coffee, please? I would like it with milk. Thank you for your help.', translations:{zh:'請給我一杯咖啡，好嗎？我想加牛奶。謝謝你的幫忙。',ja:'コーヒーを一杯いただけますか。ミルクを入れてください。ありがとうございます。',ko:'커피 한 잔 주시겠어요? 우유를 넣어 주세요. 도와주셔서 감사합니다.'}, words:[['coffee','咖啡','コーヒー','커피'],['please','請','お願いします','부탁합니다'],['milk','牛奶','牛乳','우유']] },
  { id:'meeting', title:'A better meeting', category:'工作英文', text:'Before the meeting, we shared a short agenda. Everyone asked questions, and we agreed on the next step.', translations:{zh:'會議前，我們分享了一份簡短議程。大家提出問題，並同意下一步的做法。',ja:'会議の前に短い議題を共有しました。全員が質問し、次のステップに合意しました。',ko:'회의 전에 짧은 의제를 공유했습니다. 모두 질문했고 다음 단계에 동의했습니다.'}, words:[['meeting','會議','会議','회의'],['shared','分享了','共有した','공유했다'],['agenda','議程','議題','의제'],['agreed','同意','合意した','동의했다']] },
  { id:'library', title:'A new book', category:'興趣閱讀', text:'At the library, Sam found a book about the ocean. The photographs inspired him to learn more about marine life.', translations:{zh:'在圖書館裡，Sam 找到一本關於海洋的書。書中的照片啟發他進一步認識海洋生物。',ja:'図書館でサムは海についての本を見つけました。写真を見て、海の生き物についてもっと学びたくなりました。',ko:'도서관에서 샘은 바다에 관한 책을 찾았습니다. 사진을 보고 해양 생물에 대해 더 배우고 싶어졌습니다.'}, words:[['library','圖書館','図書館','도서관'],['ocean','海洋','海洋','바다'],['inspired','啟發','刺激を与えた','영감을 주었다'],['marine','海洋的','海洋の','해양의']] }
];
lessons.forEach(lesson => { lesson.source ??= '原創教材'; lesson.license = '專案原創內容'; });

// Long imported passages are bounded even when the source has no paragraph breaks.
// Keep every character, preferring paragraph, sentence, then word boundaries.
function splitLongText(text, size = 6000, figures = []) {
  const protectedSpans = [];
  let figureFrom = 0;
  for (const figure of figures || []) {
    const anchor = typeof figure?.anchor === 'string' ? figure.anchor.trim() : '';
    if (!anchor || anchor.length > 200) continue;
    let found = text.indexOf(anchor, figureFrom);
    if (found < 0) found = text.indexOf(anchor);
    if (found >= 0) { protectedSpans.push([found, found + anchor.length]); figureFrom = found + 1; }
  }
  const parts = []; let from = 0;
  while (text.length - from > size) {
    const window = text.slice(from, from + size);
    const boundary = pattern => {
      let end = 0;
      for (const match of window.matchAll(pattern)) if (match.index + match[0].length >= size / 2) end = match.index + match[0].length;
      return end;
    };
    let end = boundary(/\n\s*\n/g) || boundary(/[.!?]["'”’)]*\s+/g) || boundary(/\s+/g) || size;
    // A figure anchor or reference needs to remain intact for the reader to find it.
    const near = Math.max(0, from + end - 100);
    const local = text.slice(near, from + end + 100), spans = [...protectedSpans];
    for (const match of local.matchAll(/\b(?:Fig(?:ure)?s?\.?|Tables?|Tab\.)\s*[A-Z]?\d+(?:\.\d+)?/gi)) spans.push([near + match.index, near + match.index + match[0].length]);
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      if (previous && span[0] < previous[1]) previous[1] = Math.max(previous[1], span[1]);
      else merged.push([...span]);
    }
    const crossing = merged.find(([start, stop]) => start < from + end && stop > from + end);
    if (crossing) end = crossing[0] > from ? crossing[0] - from : crossing[1] - from;
    // Do not split a UTF-16 surrogate pair when there is no natural boundary.
    if (end === size && /[\uD800-\uDBFF]/.test(window[end - 1]) && /[\uDC00-\uDFFF]/.test(text[from + end])) end--;
    parts.push(text.slice(from, from + end)); from += end;
  }
  if (text.slice(from).trim() || !parts.length) parts.push(text.slice(from));
  else parts[parts.length - 1] += text.slice(from);
  return parts;
}

export function importedSections(text, sections, figures = [], pages = []) {
  if (sections?.length) return sections.flatMap(section => {
    if (section.text.length <= 12000) return [section];
    return splitLongText(section.text, 6000, figures).map((part, index) => ({ ...section, title:`${section.title} (${index + 1})`, text:part }));
  });
  if (text.length <= 12000) return null;
  // The extractor omits sections when exactly one PDF page contains text.
  // Retain its actual page number on every generated part.
  if (pages?.length === 1 && Number.isInteger(pages[0]) && pages[0] > 0) {
    return splitLongText(text, 6000, figures).map((part, index) => ({ title:`p. ${pages[0]} (${index + 1})`, text:part, page:pages[0] }));
  }
  return splitLongText(text, 6000, figures).map((part, index) => ({ title:`${index + 1}. ${part.trim().split(/\s+/).slice(0, 6).join(' ')}…`, text:part }));
}

function fallbackSentences(text, language) {
  const result = [];
  const cjk = /^(zh|ja|ko)(?:-|$)/i.test(language);
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '\n' && char !== '\r' && !/[.!?。！？]/.test(char)) continue;
    let end = i + 1;
    if (char !== '\n' && char !== '\r') {
      // Decimal points are not sentence boundaries.
      if (char === '.' && /\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) continue;
      while (end < text.length && /[.!?。！？]/.test(text[end])) end++;
      while (end < text.length && /['"’”）)\]}」』】》]/.test(text[end])) end++;
      if (!cjk && !/[。！？]/.test(char) && end < text.length && !/\s/.test(text[end])) continue;
    }
    while (end < text.length && /\s/.test(text[end])) end++;
    const part = text.slice(start, end);
    if (!part.trim() && result.length) result[result.length - 1] += part;
    else if (part) result.push(part);
    start = end; i = end - 1;
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

export function splitSentences(text, language = 'en') {
  if (!text) return [];
  if (typeof globalThis.Intl?.Segmenter !== 'function') return fallbackSentences(text, language);
  const result = [];
  for (const { segment } of new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)) {
    if (!segment.trim() && result.length) result[result.length - 1] += segment;
    else result.push(segment);
  }
  return result;
}

export function passageParts(text) {
  const paragraphs = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const sentences = splitSentences(text).map(s => s.trim()).filter(Boolean);
  return sentences.length ? sentences : [text];
}

export function selectPassageSelection(text, mode, random = Math.random) {
  if (mode === 'full') return { text, index:null };
  const parts = passageParts(text), index = Math.min(parts.length - 1, Math.floor(random() * parts.length));
  return {text:parts[index], index};
}

export function selectPassage(text, mode, random = Math.random) {
  return selectPassageSelection(text, mode, random).text;
}

export function nextPassageSelection(text, current, position = null) {
  const parts = passageParts(text);
  const index = Number.isInteger(position) && position >= 0 && position < parts.length && parts[position] === current.trim() ? position : parts.indexOf(current.trim());
  const next = (index + 1) % parts.length;
  return {text:parts[next], index:next};
}

export function nextPassage(text, current) {
  return nextPassageSelection(text, current).text;
}
