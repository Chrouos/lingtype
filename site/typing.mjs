export function wordInput(word, input, character) {
  const next = input + character;
  if (!word.startsWith(next)) return { input: '', error: true, complete: false };
  return { input: next, error: false, complete: next === word };
}

export function wordEdit(word, value) {
  value = value.replace(/^ +/, '');
  if (!word.startsWith(value)) return { input: '', error: true, complete: false };
  return { input: value, error: false, complete: value === word };
}

export function articleResult(target, input, elapsed, ignored = new Set()) {
  let correct = 0, total = 0;
  for (let i = 0; i < target.length; i++) if (!ignored.has(i)) { total++; if (target[i] === input[i]) correct++; }
  return { accuracy: total ? Math.round(correct / total * 100) : 0, wpm: elapsed > 0 ? Math.round((correct / 5) / (elapsed / 60000) * 10) / 10 : 0, errors: total - correct };
}

export function liveArticleStats(target, input, elapsed, ignored = new Set()) {
  const typed = input.slice(0, target.length);
  let correct = 0, total = 0;
  for (let i = 0; i < typed.length; i++) if (!ignored.has(i)) { total++; if (typed[i] === target[i]) correct++; }
  return { accuracy: total ? Math.round(correct / total * 100) : 0, wpm: elapsed > 0 ? Math.round(correct / 5 / (elapsed / 60000) * 10) / 10 : 0, progress: target.length ? Math.round(typed.length / target.length * 100) : 0 };
}

// Correct and scored characters typed so far, so several texts in one session can be added up.
export function typedCounts(target, input, ignored = new Set()) {
  let correct = 0, total = 0;
  for (let i = 0; i < Math.min(input.length, target.length); i++) if (!ignored.has(i)) { total++; if (input[i] === target[i]) correct++; }
  return { correct, total };
}

export function sessionStats({ correct, total }, elapsed) {
  return { accuracy: total ? Math.round(correct / total * 100) : 0, wpm: elapsed > 0 ? Math.round(correct / 5 / (elapsed / 60000) * 10) / 10 : 0, errors: total - correct };
}
