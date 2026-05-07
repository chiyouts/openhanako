import { describe, expect, it } from 'vitest';
import type { ChatListItem } from '../../stores/chat-types';
import { buildTimelineAnchors, formatTimelineAnchorLabel } from '../../components/chat/timeline-anchors';

function message(id: string, role: 'user' | 'assistant', timestamp?: number, text = ''): ChatListItem {
  return {
    type: 'message',
    data: {
      id,
      role,
      timestamp,
      text,
      textHtml: text,
      blocks: role === 'assistant' ? [{ type: 'text', html: text }] : undefined,
    },
  };
}

describe('chat timeline anchors', () => {
  it('uses timestamped user turns as lightweight navigation anchors', () => {
    const items: ChatListItem[] = [
      message('u1', 'user', Date.parse('2026-05-07T05:42:00.000Z'), 'first'),
      message('a1', 'assistant', Date.parse('2026-05-07T05:42:30.000Z'), 'reply'),
      message('u2', 'user', Date.parse('2026-05-07T05:50:00.000Z'), 'second'),
    ];

    const anchors = buildTimelineAnchors(items, {
      now: new Date('2026-05-07T08:00:00.000Z'),
      locale: 'zh-CN',
      timeZone: 'UTC',
    });

    expect(anchors.map(anchor => anchor.messageId)).toEqual(['u1', 'u2']);
    expect(anchors.map(anchor => anchor.label)).toEqual(['05:42', '05:50']);
  });

  it('falls back to timestamped assistant messages when no user timestamps exist', () => {
    const items: ChatListItem[] = [
      message('u1', 'user', undefined, 'legacy user'),
      message('a1', 'assistant', Date.parse('2026-05-07T06:10:00.000Z'), 'reply'),
    ];

    const anchors = buildTimelineAnchors(items, {
      now: new Date('2026-05-07T08:00:00.000Z'),
      locale: 'zh-CN',
      timeZone: 'UTC',
    });

    expect(anchors.map(anchor => anchor.messageId)).toEqual(['a1']);
    expect(anchors[0].label).toBe('06:10');
  });

  it('formats older anchors with compact date context', () => {
    expect(formatTimelineAnchorLabel(
      Date.parse('2026-05-06T23:30:00.000Z'),
      {
        now: new Date('2026-05-07T08:00:00.000Z'),
        locale: 'zh-CN',
        timeZone: 'UTC',
      },
    )).toBe('5月6日 23:30');
  });
});
