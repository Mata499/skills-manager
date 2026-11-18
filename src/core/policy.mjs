import { normalizeRoot } from './roots.mjs';
import { validateState } from './state.mjs';

/** The single policy predicate for provider list/get and tool guards. */
export function isVisible(name, root, state) {
  try {
    validateState(state);
    if (typeof name !== 'string' || !name || state.error) return false;
    const key = normalizeRoot(root);
    const project = Object.hasOwn(state.projects, key) ? state.projects[key] : undefined;
    if (project?.disabled?.includes(name)) return false;
    if (project?.enabled?.includes(name)) return true;
    return state.defaults.globalSkills === 'on';
  } catch { return false; }
}
