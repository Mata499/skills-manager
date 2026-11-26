import { normalizeRoot } from './roots.mjs';
import { validateState } from './state.mjs';

/** The single policy predicate for provider list/get and tool guards. */
export function isVisible(name, root, state, source) {
  try {
    validateState(state);
    if (typeof name !== 'string' || !name || state.error) return false;
    const key = normalizeRoot(root);
    const project = Object.hasOwn(state.projects, key) ? state.projects[key] : undefined;
    if (project?.disabled?.includes(name)) return false;
    if (project?.enabled?.includes(name)) return true;
    // Explicit workspace overrides win; legacy blanket defaults do not override source rules.
    if (source === 'library') return false;
    if (['user-dsh', 'user-agents', 'custom'].includes(source)) return true;
    return state.defaults.globalSkills === 'on';
  } catch { return false; }
}
