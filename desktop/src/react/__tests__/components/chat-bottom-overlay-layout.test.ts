import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function read(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readCssBlock(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{[\\s\\S]*?\\}`));
  if (!match) throw new Error(`Missing CSS block: ${selector}`);
  return match[0];
}

describe('chat bottom overlay layout', () => {
  it('keeps the transcript panel visually tucked under the input card', () => {
    const styleSource = read('components/chat/Chat.module.css');

    expect(styleSource).toMatch(
      /\.sessionShell\s*\{[\s\S]*bottom:\s*calc\(var\(--input-card-h,\s*0px\)\s*\/\s*2\s*\+\s*var\(--space-lg\)\);/,
    );
  });

  it('shortens only the visible scrollbar track above the tucked transcript area', () => {
    const styleSource = read('components/chat/Chat.module.css');

    expect(styleSource).toMatch(
      /--chat-scrollbar-bottom-inset:\s*calc\(var\(--input-card-h,\s*0px\)\s*\/\s*2\);/,
    );
    expect(styleSource).toMatch(
      /\.sessionPanel::-webkit-scrollbar-track\s*\{[\s\S]*margin-bottom:\s*var\(--chat-scrollbar-bottom-inset\);/,
    );
  });

  it('keeps the timeline navigator outside the scroll container so it floats while messages scroll', () => {
    const chatAreaSource = read('components/chat/ChatArea.tsx');
    const styleSource = read('components/chat/Chat.module.css');

    expect(chatAreaSource).toMatch(
      /<div[\s\S]*className=\{styles\.sessionShell\}[\s\S]*<div[\s\S]*className=\{styles\.sessionPanel\}[\s\S]*<\/div>\s*<ChatTimelineNavigator/,
    );
    expect(styleSource).toMatch(
      /\.sessionShell\s*\{[\s\S]*position:\s*absolute;[\s\S]*overflow:\s*hidden;/,
    );
    expect(styleSource).toMatch(
      /\.timelineNav\s*\{[\s\S]*position:\s*absolute;/,
    );
  });

  it('keeps the timeline compact, rail-free, and expands a Hana-styled card from the same markers', () => {
    const timelineSource = read('components/chat/ChatTimelineNavigator.tsx');
    const styleSource = read('components/chat/Chat.module.css');

    expect(timelineSource).not.toContain('timelineRail');
    expect(timelineSource).not.toContain('timelineDot');
    expect(timelineSource).toContain('timelineCard');
    expect(timelineSource).toContain('timelineList');
    expect(timelineSource).toContain('timelineLine');
    expect(timelineSource).toContain('TIMELINE_MAX_VISIBLE_ROWS = 10');
    expect(timelineSource).toContain('list.scrollTop = list.scrollHeight');
    expect(timelineSource).toContain("'--timeline-visible-rows'");
    expect(timelineSource).not.toContain('measureTimelineMarkerPercent');
    expect(timelineSource).not.toContain('cardStyle');
    expect(styleSource).not.toContain('.timelineRail');
    expect(styleSource).not.toContain('.timelineDot');
    const timelineNavBlock = readCssBlock(styleSource, '.timelineNav');
    expect(timelineNavBlock).toContain('top: 76px;');
    expect(timelineNavBlock).toContain('right: 0;');
    expect(timelineNavBlock).toContain('height: 50%;');
    expect(timelineNavBlock).toContain('width: 64px;');
    expect(timelineNavBlock).toContain('--timeline-card-width: min(176px, calc(100vw - 96px));');
    expect(timelineNavBlock).toContain('--timeline-row-height: 28px;');
    expect(timelineNavBlock).toContain('--timeline-card-pad-y: 0.375rem;');
    expect(timelineNavBlock).toContain('--timeline-marker-pad-left: 0.75rem;');
    expect(timelineNavBlock).toContain('--timeline-marker-pad-right: 0.375rem;');
    expect(timelineNavBlock).toContain('--timeline-marker-gap: 0.375rem;');
    expect(timelineNavBlock).toContain('--timeline-card-surface-outset-right: 0.25rem;');
    expect(styleSource).toMatch(
      /\.timelineMarker\s*\{[\s\S]*opacity:\s*0;/,
    );
    expect(styleSource).toMatch(
      /\.timelineNav:hover\s+\.timelineMarker,\s*\.timelineNav:focus-within\s+\.timelineMarker\s*\{[\s\S]*opacity:\s*1;/,
    );
    const timelineCardBlock = readCssBlock(styleSource, '.timelineCard');
    expect(timelineCardBlock).toContain('top: 50%;');
    expect(timelineCardBlock).toContain('right: var(--timeline-marker-right);');
    expect(timelineCardBlock).toContain('transform: translateY(-50%);');
    expect(timelineCardBlock).toContain('border-radius: var(--radius-card);');
    expect(timelineCardBlock).toContain('height: calc(var(--timeline-visible-rows) * var(--timeline-row-height) + 2 * var(--timeline-card-pad-y));');
    expect(timelineCardBlock).toContain('max-height: calc(10 * var(--timeline-row-height) + 2 * var(--timeline-card-pad-y));');
    expect(timelineCardBlock).toContain('pointer-events: none;');
    expect(timelineCardBlock).toContain('overflow: visible;');
    const cardSurfaceBlock = readCssBlock(styleSource, '.timelineCard::before');
    expect(cardSurfaceBlock).toContain('inset: 0 calc(-1 * var(--timeline-card-surface-outset-right)) 0 0;');
    expect(cardSurfaceBlock).toContain('background: var(--bg-card, var(--bg));');
    expect(cardSurfaceBlock).toContain('border: 1px solid var(--border);');
    expect(cardSurfaceBlock).toContain('opacity: 0;');
    expect(cardSurfaceBlock).toContain('transform: scale(0.985);');
    expect(cardSurfaceBlock).toMatch(/transition:[^;]*opacity[^;]*transform/);
    const expandedCardSurfaceBlock = readCssBlock(styleSource, '.timelineNavExpanded .timelineCard::before');
    expect(expandedCardSurfaceBlock).toContain('opacity: 1;');
    expect(expandedCardSurfaceBlock).toContain('transform: scale(1);');
    expect(styleSource).toMatch(
      /\.timelineList\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow-y:\s*auto;/,
    );
    const timelineListBlock = readCssBlock(styleSource, '.timelineList');
    expect(timelineListBlock).toContain('padding-block: var(--timeline-card-pad-y);');
    expect(timelineListBlock).toContain('box-sizing: border-box;');
    expect(styleSource).toMatch(
      /\.timelineList\s*\{[\s\S]*scrollbar-width:\s*none;/,
    );
    expect(styleSource).toMatch(
      /\.timelineList::-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/,
    );
    expect(styleSource).toMatch(
      /\.timelineMarker\s*\{[\s\S]*position:\s*relative;[\s\S]*height:\s*var\(--timeline-row-height\);/,
    );
    const timelineMarkerBlock = readCssBlock(styleSource, '.timelineMarker');
    expect(timelineMarkerBlock).toContain('width: 100%;');
    expect(timelineMarkerBlock).toContain('padding: 0 var(--timeline-marker-pad-right) 0 var(--timeline-marker-pad-left);');
    expect(timelineMarkerBlock).toContain('gap: var(--timeline-marker-gap);');
    expect(styleSource).toMatch(
      /\.timelineLabel\s*\{[\s\S]*text-align:\s*left;/,
    );
    const timelineLabelBlock = readCssBlock(styleSource, '.timelineLabel');
    expect(timelineLabelBlock).toContain('display: block;');
    expect(timelineLabelBlock).toContain('width: 100%;');
    expect(timelineLabelBlock).toContain('overflow: hidden;');
    expect(timelineLabelBlock).toContain('text-overflow: ellipsis;');
    expect(timelineLabelBlock).toContain('white-space: nowrap;');
    expect(styleSource).toMatch(
      /\.timelineLine\s*\{[\s\S]*width:\s*var\(--timeline-marker-width\);[\s\S]*min-width:\s*0\.5em;[\s\S]*max-width:\s*1em;/,
    );
    const timelineLineBlock = readCssBlock(styleSource, '.timelineLine');
    expect(timelineLineBlock).toContain('border-radius: 999px;');
    expect(timelineLineBlock).not.toContain('border-radius: 50%;');
  });

  it('session footer leaves one extra line of breathing room above the input top edge', () => {
    const styleSource = read('components/chat/Chat.module.css');

    expect(styleSource).toMatch(
      /\.sessionFooter\s*\{[\s\S]*height:\s*calc\(var\(--input-card-h,\s*0px\)\s*\/\s*2\s*\+\s*var\(--space-lg\)\s*\+\s*8rem\);/,
    );
  });

  it('measures the stable input card instead of the whole input area container', () => {
    const appSource = read('App.tsx');
    const inputSource = read('components/InputArea.tsx');

    expect(appSource).toContain("parent.style.setProperty('--input-card-h'");
    expect(appSource).toContain('<InputArea key={currentSessionPath || \'__new\'} cardRef={inputCardRef} />');
    expect(inputSource).toContain("<div className={styles['input-wrapper']} ref={cardRef}>");
  });

  it('lets the transparent input-area shell pass through pointer events while children stay interactive', () => {
    const styleSource = read('../styles.css');

    expect(styleSource).toMatch(/\.input-area\s*\{[^}]*pointer-events:\s*none;/);
    expect(styleSource).toMatch(/\.input-area\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto;/);
  });
});
