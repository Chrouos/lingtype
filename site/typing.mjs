export function wordInput(word, input, character) {
  const next = input + character;
  if (!word.startsWith(next)) return { input: '', error: true, complete: false };
  return { input: next, error: false, complete: next === word };
}

export function wordEdit(word, value) {
  if (!word.startsWith(value)) return { input: '', error: true, complete: false };
  return { input: value, error: false, complete: value === word };
}

export function articleResult(target, input, elapsed) {
  const correct = [...target].filter((char, i) => input[i] === char).length;
  return { accuracy: target.length ? Math.round(correct / target.length * 100) : 0, wpm: elapsed > 0 ? Math.round((correct / 5) / (elapsed / 60000) * 10) / 10 : 0, errors: target.length - correct };
}
