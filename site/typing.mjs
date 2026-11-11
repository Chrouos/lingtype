export function wordEdit(word, value) {
  value = value.replace(/^ +/, '');
  if (!word.startsWith(value)) return { input: '', error: true, complete: false };
  return { input: value, error: false, complete: value === word };
}

// When timer callbacks are delayed (for example in a background tab), do not
// charge the idle interval to the typist.
export function activeTypingEnd(lastKeyAt, now, idleMs) {
  return now - lastKeyAt > idleMs ? lastKeyAt : now;
}

export function articleResult(target, input, elapsed, ignored = new Set()) {
  let correct = 0, total = 0;
  for (let i = 0; i < target.length; i++) if (!ignored.has(i)) { total++; if (target[i] === input[i]) correct++; }
  return { accuracy: total ? Math.round(correct / total * 100) : 0, wpm: elapsed > 0 ? Math.round((correct / 5) / (elapsed / 60000) * 10) / 10 : 0, errors: total - correct };
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
