/**
 * Markdown 渲染器
 *
 * 通过 npm import 使用 markdown-it，不依赖全局 window.markdownit。
 */

import markdownit from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import mk from '@traptitech/markdown-it-katex';
import taskLists from 'markdown-it-task-lists';
import 'katex/dist/katex.min.css';
import { sanitizeMarkdownPreviewHtml } from './markdown-html-sanitizer';

type MarkdownItInstance = ReturnType<typeof markdownit>;

let _md: MarkdownItInstance | null = null;
let _previewMd: MarkdownItInstance | null = null;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/;
const RGB_COLOR_RE = /^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
const BG_SPAN_RE = /^<span\s+style=(["'])\s*background(?:-color)?\s*:\s*([^;"']+)\s*;?\s*\1>([\s\S]*?)<\/span>/i;
const INLINE_MATH_OPEN = '\\(';
const INLINE_MATH_CLOSE = '\\)';
const BLOCK_MATH_OPEN = '\\[';
const BLOCK_MATH_CLOSE = '\\]';
const CALLOUT_MARKER_RE = /^\s*\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-])?(?:[ \t]+(.+?))?\s*$/;

const CALLOUT_ALIASES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

function normalizeCalloutType(type: string): string {
  return CALLOUT_ALIASES[type.toLowerCase()] || 'note';
}

function titleCaseCalloutType(type: string): string {
  return type
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function findMatchingBlockquoteClose(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === 'blockquote_open') depth += 1;
    if (tokens[i].type === 'blockquote_close') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findFirstDirectParagraph(tokens: Token[], openIndex: number, closeIndex: number): number {
  const parentLevel = tokens[openIndex].level;
  for (let i = openIndex + 1; i < closeIndex; i += 1) {
    const token = tokens[i];
    if (token.level !== parentLevel + 1) continue;
    if (token.type === 'paragraph_open') return i;
    if (!token.hidden) return -1;
  }
  return -1;
}

function makeCalloutTitleTokens(state: StateCore, title: string, foldable: boolean, level: number): Token[] {
  const open = new state.Token(
    foldable ? 'callout_summary_open' : 'callout_title_open',
    foldable ? 'summary' : 'div',
    1,
  );
  open.attrSet('class', 'markdown-callout-title');
  open.level = level;

  const inline = new state.Token('inline', '', 0);
  inline.content = title;
  inline.children = [];
  inline.level = level + 1;

  const close = new state.Token(
    foldable ? 'callout_summary_close' : 'callout_title_close',
    foldable ? 'summary' : 'div',
    -1,
  );
  close.level = level;

  return [open, inline, close];
}

function obsidianCallouts(md: MarkdownItInstance): void {
  md.core.ruler.after('block', 'obsidian_callouts', (state: StateCore) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i += 1) {
      const open = tokens[i];
      if (open.type !== 'blockquote_open') continue;

      const closeIndex = findMatchingBlockquoteClose(tokens, i);
      if (closeIndex < 0) continue;

      const paragraphIndex = findFirstDirectParagraph(tokens, i, closeIndex);
      const inlineIndex = paragraphIndex + 1;
      if (
        paragraphIndex < 0 ||
        tokens[paragraphIndex]?.type !== 'paragraph_open' ||
        tokens[inlineIndex]?.type !== 'inline' ||
        tokens[paragraphIndex + 2]?.type !== 'paragraph_close'
      ) {
        continue;
      }

      const inline = tokens[inlineIndex];
      const lineEnd = inline.content.indexOf('\n');
      const firstLine = lineEnd >= 0 ? inline.content.slice(0, lineEnd) : inline.content;
      const match = CALLOUT_MARKER_RE.exec(firstLine);
      if (!match) continue;

      const sourceType = match[1];
      const canonicalType = normalizeCalloutType(sourceType);
      const foldMarker = match[2] || '';
      const foldable = foldMarker === '+' || foldMarker === '-';
      const title = (match[3]?.trim() || titleCaseCalloutType(sourceType));

      open.tag = foldable ? 'details' : 'div';
      open.attrSet('class', `markdown-callout markdown-callout-${canonicalType}`);
      if (foldable && foldMarker === '+') open.attrSet('open', 'open');

      const close = tokens[closeIndex];
      close.tag = foldable ? 'details' : 'div';

      tokens.splice(i + 1, 0, ...makeCalloutTitleTokens(state, title, foldable, open.level + 1));

      if (lineEnd >= 0) {
        inline.content = inline.content.slice(lineEnd + 1);
      } else {
        tokens.splice(paragraphIndex + 3, 3);
      }
    }
  });
}

function normalizeSafeBackgroundColor(raw: string): string | null {
  const color = raw.trim();
  if (HEX_COLOR_RE.test(color)) return color;
  if (RGB_COLOR_RE.test(color)) return color;
  return null;
}

function tokenizeInner(state: StateInline, from: number, to: number): void {
  const oldPos = state.pos;
  const oldMax = state.posMax;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.pos = oldPos;
  state.posMax = oldMax;
}

function obsidianHighlights(md: MarkdownItInstance): void {
  md.inline.ruler.before('emphasis', 'obsidian_mark', (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '==') return false;
    const end = state.src.indexOf('==', start + 2);
    if (end < 0 || end === start + 2) return false;

    if (!silent) {
      state.push('mark_open', 'mark', 1);
      tokenizeInner(state, start + 2, end);
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });

  md.inline.ruler.before('text', 'obsidian_background_span', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x3C) return false; // <
    const match = BG_SPAN_RE.exec(state.src.slice(start));
    if (!match) return false;
    const color = normalizeSafeBackgroundColor(match[2]);
    if (!color) return false;

    if (!silent) {
      const open = state.push('mark_open', 'mark', 1);
      open.attrSet('style', `background-color:${color}`);
      const innerStart = start + match[0].indexOf('>') + 1;
      const innerEnd = start + match[0].length - '</span>'.length;
      tokenizeInner(state, innerStart, innerEnd);
      state.push('mark_close', 'mark', -1);
    }
    state.pos = start + match[0].length;
    return true;
  });
}

function isEscaped(src: string, pos: number): boolean {
  let count = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5C; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function findUnescapedDelimiter(src: string, delimiter: string, from: number, to: number): number {
  let pos = src.indexOf(delimiter, from);
  while (pos >= 0 && pos < to) {
    if (!isEscaped(src, pos)) return pos;
    pos = src.indexOf(delimiter, pos + delimiter.length);
  }
  return -1;
}

function findLineEndingDelimiter(line: string, delimiter: string): number {
  let from = 0;
  while (from < line.length) {
    const pos = findUnescapedDelimiter(line, delimiter, from, line.length);
    if (pos < 0) return -1;
    if (line.slice(pos + delimiter.length).trim() === '') return pos;
    from = pos + delimiter.length;
  }
  return -1;
}

function texBracketMath(md: MarkdownItInstance): void {
  md.inline.ruler.before('escape', 'tex_parenthesis_math', (state: StateInline, silent: boolean) => {
    const start = state.pos;
    if (state.src.slice(start, start + INLINE_MATH_OPEN.length) !== INLINE_MATH_OPEN) return false;

    const contentStart = start + INLINE_MATH_OPEN.length;
    const close = findUnescapedDelimiter(state.src, INLINE_MATH_CLOSE, contentStart, state.posMax);
    if (close < 0 || close === contentStart) return false;

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.markup = INLINE_MATH_OPEN;
      token.content = state.src.slice(contentStart, close);
    }
    state.pos = close + INLINE_MATH_CLOSE.length;
    return true;
  });

  md.block.ruler.before('paragraph', 'tex_bracket_math_block', (
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
  ) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start + BLOCK_MATH_OPEN.length > max) return false;
    if (state.src.slice(start, start + BLOCK_MATH_OPEN.length) !== BLOCK_MATH_OPEN) return false;

    let nextLine = startLine;
    const firstLine = state.src.slice(start + BLOCK_MATH_OPEN.length, max);
    const firstLineClose = findLineEndingDelimiter(firstLine, BLOCK_MATH_CLOSE);
    let content = '';

    if (firstLineClose >= 0) {
      content = firstLine.slice(0, firstLineClose);
    } else {
      let found = false;
      let lastLine = '';
      for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];
        if (lineStart < lineMax && state.tShift[nextLine] < state.blkIndent) break;

        const line = state.src.slice(lineStart, lineMax);
        const close = findLineEndingDelimiter(line, BLOCK_MATH_CLOSE);
        if (close >= 0) {
          lastLine = line.slice(0, close);
          found = true;
          break;
        }
      }

      if (!found) return false;
      content = (firstLine.trim() ? `${firstLine}\n` : '')
        + state.getLines(startLine + 1, nextLine, state.tShift[startLine], true)
        + (lastLine.trim() ? lastLine : '');
    }

    if (!content.trim()) return false;
    if (silent) return true;

    state.line = nextLine + 1;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.map = [startLine, state.line];
    token.markup = `${BLOCK_MATH_OPEN}${BLOCK_MATH_CLOSE}`;
    return true;
  }, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

function applyMarkdownPlugins(md: MarkdownItInstance): void {
  md.use(mk);
  md.use(texBracketMath);
  md.use(taskLists, { enabled: false, label: true });
  md.use(obsidianHighlights);
  md.use(obsidianCallouts);
  md.use(mermaidFences);
}

function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() || '';
}

function mermaidFences(md: MarkdownItInstance): void {
  const defaultFence = md.renderer.rules.fence
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (fenceLanguage(token.info) !== 'mermaid') {
      return defaultFence(tokens, idx, options, env, self);
    }

    const source = md.utils.escapeHtml(token.content);
    return [
      '<div class="mermaid-diagram">',
      `<pre class="mermaid-source"><code>${source}</code></pre>`,
      '<div class="mermaid-rendered"></div>',
      '</div>\n',
    ].join('');
  };
}

/** 获取默认 md 实例（html: false, katex 插件） */
export function getMd(): MarkdownItInstance {
  if (_md) return _md;
  _md = markdownit({
    html: false,
    breaks: true,
    linkify: true,
    typographer: true,
  });
  applyMarkdownPlugins(_md);
  return _md;
}

/** 获取文件预览专用 md 实例（html: true，渲染后必须 sanitizer） */
export function getPreviewMd(): MarkdownItInstance {
  if (_previewMd) return _previewMd;
  _previewMd = markdownit({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
  });
  applyMarkdownPlugins(_previewMd);
  return _previewMd;
}

export function renderMarkdown(src: string): string {
  return getMd().render(src);
}

export function renderMarkdownPreview(src: string): string {
  try {
    return sanitizeMarkdownPreviewHtml(getPreviewMd().render(src));
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[markdown] preview sanitizer failed:', err);
    }
    return renderMarkdown(src);
  }
}
