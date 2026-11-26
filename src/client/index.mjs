import * as React from 'react';
import { mountSettings } from './page.mjs';

export const inject = ['slots'];
export function apply(ctx) {
  const slots = ctx.slots || ctx.get('slots');
  // DSH slots render React component factories. Only this adapter uses the host's
  // React; the settings UI itself owns a DOM subtree and has no React runtime.
  const mounts = new Set();
  function ConversationPage({ sessionId } = {}) {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const mounted = mountSettings(ref.current, { sessionId: typeof sessionId === 'string' ? sessionId : '' });
        mounts.add(mounted);
        return () => { mounts.delete(mounted); mounted.dispose(); };
      }, [sessionId]);
      return React.createElement('div', { key: sessionId, ref, className: 'skm-embed', style: { height: '100%', minHeight: 0, overflow: 'auto', padding: '0 12px 12px' } });
  }
  function SettingsPage() {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const mounted = mountSettings(ref.current);
      mounts.add(mounted);
      return () => { mounts.delete(mounted); mounted.dispose(); };
    }, []);
    return React.createElement('div', { ref });
  }
  const id = 'project-skills-manager';
  slots.inject('settings.section', () => slots.register({ name: 'settings.section', id, order: 26, label: () => '技能' }, SettingsPage));
  slots.inject('settings.section.icon', () => slots.register({ name: 'settings.section.icon', id }, () => React.createElement('span', { 'aria-hidden': true }, '◈')));
  // Session view tab, placed directly right of billion-context's 「上下文」 (order 30).
  slots.inject('conversation.view', () => slots.register({ name: 'conversation.view', id, order: 31, label: () => '技能' }, ConversationPage));
  ctx.effect(() => () => { for (const mounted of mounts) mounted.dispose(); mounts.clear(); });
}
