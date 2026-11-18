'use strict';

/**
 * What a stage can end with, read from its configuration without running it, so
 * the canvas can draw a stage's branches and the editor can list the status words
 * a check may produce. Every runner describes itself (`runner.outcomes(config)`);
 * a script is read by a small scanner, because a script's outcomes are only in its
 * text.
 *
 *   { statuses: [{ status, done }], skips: [{ reason }], fails: [{ reason, retryDelivery, retryStage }],
 *     dynamicStatus }
 *
 * `statuses` are the words the stage can set (`done`: true / false / null when it
 * depends); `skips` and `fails` are the places the stage can call skip() or fail();
 * `dynamicStatus` is true when some status is computed and cannot be listed.
 *
 * The scanner is a reading aid, not a proof: it looks at the script's text (comments
 * and string contents are ignored, so a word inside either is never a call), and
 * anything it cannot read exactly is reported as dynamic rather than guessed.
 */

const QUOTES = new Set(['"', "'", '`']);
// A `/` after one of these starts a regular expression, not a division.
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * The script with comments blanked and the inside of every string and regular
 * expression replaced by `_` (same length, so offsets match the original).
 */
function mask(code) {
  const out = code.split('');
  let previous = '';
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      blank(i, end);
      i = end;
    } else if (ch === '/' && next === '*') {
      let end = code.indexOf('*/', i + 2);
      end = end === -1 ? code.length : end + 2;
      blank(i, end);
      i = end;
    } else if (QUOTES.has(ch)) {
      let k = i + 1;
      while (k < code.length && code[k] !== ch) k += code[k] === '\\' ? 2 : 1;
      for (let m = i + 1; m < Math.min(k, code.length); m += 1) if (out[m] !== '\n') out[m] = '_';
      previous = ch;
      i = k + 1;
    } else if (ch === '/' && (previous === '' || REGEX_AFTER.has(previous) || /\breturn$/.test(code.slice(Math.max(0, i - 7), i).trim()))) {
      let k = i + 1;
      let inClass = false;
      while (k < code.length && (code[k] !== '/' || inClass) && code[k] !== '\n') {
        if (code[k] === '\\') k += 1;
        else if (code[k] === '[') inClass = true;
        else if (code[k] === ']') inClass = false;
        k += 1;
      }
      for (let m = i + 1; m < Math.min(k, code.length); m += 1) out[m] = '_';
      previous = '/';
      i = k + 1;
    } else {
      if (!/\s/.test(ch)) previous = ch;
      i += 1;
    }
  }
  return out.join('');
}

/** The index of the bracket closing the one at `open` (in masked text), or -1. */
function closing(masked, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The index of the `{` enclosing `at` (in masked text), or -1. */
function enclosingBrace(masked, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (masked[i] === '}') depth += 1;
    else if (masked[i] === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/** The end of the expression starting at `from`: the first `,`, `}` or `)` outside any brackets. */
function expressionEnd(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) {
      if (depth === 0) return i;
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return masked.length;
}

/** The string literals in code[from, to), by the masked text's quote positions. */
function stringLiterals(code, masked, from, to) {
  const found = [];
  for (let i = from; i < to; i += 1) {
    if (QUOTES.has(code[i]) && code[i] === masked[i]) {
      const quote = code[i];
      let k = i + 1;
      while (k < to && code[k] !== quote) k += code[k] === '\\' ? 2 : 1;
      found.push({ text: code.slice(i + 1, k), template: quote === '`' && code.slice(i + 1, k).includes('${') });
      i = k;
    }
  }
  return found;
}

/** A quoted first argument, or null. */
function firstString(code, masked, open) {
  const start = open + 1 + (masked.slice(open + 1).match(/^\s*/)[0].length);
  if (!QUOTES.has(code[start])) return null;
  const [literal] = stringLiterals(code, masked, start, masked.length);
  return literal && !literal.template ? literal.text : null;
}

/**
 * The possible values of the expression in masked[from, to): itself, or, for
 * `test ? a : b`, the leaves of `a` and `b` (nested ternaries included).
 */
function ternaryLeaves(masked, from, to) {
  let depth = 0;
  let question = -1;
  let nested = 0;
  for (let i = from; i < to; i += 1) {
    const ch = masked[i];
    if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) depth -= 1;
    else if (depth === 0 && ch === '?' && (masked[i + 1] === '?' || masked[i + 1] === '.' || masked[i - 1] === '?')) continue; // ?? and ?.
    else if (depth === 0 && ch === '?' && question === -1) question = i;
    else if (depth === 0 && ch === '?') nested += 1;
    else if (depth === 0 && ch === ':' && question !== -1) {
      if (nested > 0) nested -= 1;
      else return [...ternaryLeaves(masked, question + 1, i), ...ternaryLeaves(masked, i + 1, to)];
    }
  }
  return [{ from, to }];
}

function scanScript(code) {
  const source = String(code || '');
  const masked = mask(source);
  const skips = [];
  const fails = [];
  const statuses = [];
  let dynamicStatus = false;

  for (const match of masked.matchAll(/(?<![.\w$])skip\s*\(/g)) {
    skips.push({ reason: firstString(source, masked, match.index + match[0].length - 1) });
  }

  for (const match of masked.matchAll(/(?<![.\w$])fail\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const end = closing(masked, open);
    const call = end === -1 ? '' : masked.slice(open, end);
    fails.push({
      reason: firstString(source, masked, open),
      retryDelivery: /\bretryDelivery\s*:\s*true\b/.test(call),
      retryStage: /\bretryStage\s*:\s*true\b/.test(call),
    });
  }

  for (const match of masked.matchAll(/(?<![.\w$])status\s*:\s*/g)) {
    const from = match.index + match[0].length;
    const to = expressionEnd(masked, from);
    const expression = masked.slice(from, to).trim();
    if (/^-?\d/.test(expression) || /^(null|undefined)$/.test(expression)) continue; // an HTTP-style number, not a status word
    const brace = enclosingBrace(masked, match.index);
    const objectEnd = brace === -1 ? -1 : closing(masked, brace);
    const object = brace === -1 || objectEnd === -1 ? '' : masked.slice(brace, objectEnd);
    const doneMatch = object.match(/\bdone\s*:\s*([^,}]+)/);
    const done = !doneMatch ? false : /^true\b/.test(doneMatch[1].trim()) ? true : /^false\b/.test(doneMatch[1].trim()) ? false : null;

    for (const leaf of ternaryLeaves(masked, from, to)) {
      const text = masked.slice(leaf.from, leaf.to).trim();
      const literal = /^(["'`])_*\1$/.test(text) ? stringLiterals(source, masked, leaf.from, leaf.to)[0] : null;
      if (literal && !literal.template) statuses.push({ status: literal.text, done });
      else if (!/^(null|undefined)$/.test(text) && !/^-?\d/.test(text)) dynamicStatus = true;
    }
  }

  return { statuses: dedupeStatuses(statuses), skips, fails, dynamicStatus };
}

/** One entry per status word; `done` is kept only when every mention agrees (otherwise null). */
function dedupeStatuses(statuses) {
  const byWord = new Map();
  for (const { status, done } of statuses) {
    byWord.set(status, byWord.has(status) && byWord.get(status).done !== done ? { status, done: null } : { status, done });
  }
  return [...byWord.values()];
}

const NO_OUTCOMES = { statuses: [], skips: [], fails: [], dynamicStatus: false };

/**
 * The outcomes of a stage, from its runner. A runner that does not describe itself
 * has none known (`known: false`), which is different from a stage that cannot end
 * in anything.
 */
function stageOutcomes(stage, runners) {
  const runner = runners.get(stage && stage.runner && stage.runner.type);
  if (!runner || typeof runner.outcomes !== 'function') return { ...NO_OUTCOMES, known: false };
  return { ...NO_OUTCOMES, ...runner.outcomes((stage.runner && stage.runner.config) || {}, stage), known: true };
}

module.exports = { scanScript, stageOutcomes, mask, NO_OUTCOMES };
