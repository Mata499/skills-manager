import path from 'node:path';
import { readdir, realpath, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { canonicalPath, globalSkillRoots } from './roots.mjs';

const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };

export function parseSkill(text, fallbackName) {
  let metadata = {};
  let content = text.replace(/^\uFEFF/, '');
  if (/^---\r?\n/.test(content)) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) throw new Error('Unterminated skill frontmatter');
    const doc = parseDocument(match[1], { uniqueKeys: true });
    if (doc.errors.length) throw new Error('Invalid skill YAML: ' + doc.errors[0].message);
    metadata = doc.toJS({ maxAliasCount: 50 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Skill frontmatter must be a mapping');
    content = content.slice(match[0].length);
  }
  const name = metadata.name ?? fallbackName;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.length > 128) throw new Error('Invalid skill name');
  if (metadata.description !== undefined && typeof metadata.description !== 'string') throw new Error('Skill description must be a string');
  if (metadata['disable-model-invocation'] !== undefined && typeof metadata['disable-model-invocation'] !== 'boolean') throw new Error('disable-model-invocation must be boolean');
  if (metadata['user-invocable'] !== undefined && typeof metadata['user-invocable'] !== 'boolean') throw new Error('user-invocable must be boolean');
  const disableModelInvocation = metadata['disable-model-invocation'] === true;
  const whenToUse = metadata['when-to-use'] ?? metadata.whenToUse;
  if (whenToUse !== undefined && typeof whenToUse !== 'string') throw new Error('when-to-use must be a string');
  return { name, description: metadata.description ?? '', content, metadata, whenToUse, disableModelInvocation, invocation: { modelInvocable: !disableModelInvocation, userInvocable: metadata['user-invocable'] !== false } };
}

/** Read-only catalog. Symlink/junction directory traversal is allowed, canonical targets deduplicated. */
export function createCatalog(options = {}) {
  const roots = options.roots ?? globalSkillRoots(options);
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 32;
  const maxDirectories = options.maxDirectories ?? 10000;
  let entries = new Map();
  const errors = [];
  async function readSkill(file) {
    const info = await stat(file);
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid or oversized SKILL.md');
    const text = await readFile(file, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Oversized SKILL.md');
    return text;
  }
  async function scan() {
    const found = [];
    const visited = new Set();
    const files = new Set();
    errors.length = 0;
    const orderedRoots = roots.map((root, index) => typeof root === 'string' ? { path: root, source: 'custom', rank: 300, order: index } : { ...root, order: root.order ?? index })
      .filter(root => root.source !== 'bundled')
      .sort((a, b) => (a.rank ?? 300) - (b.rank ?? 300) || a.order - b.order || compare(a.path, b.path));
    for (const configured of orderedRoots) {
      let root;
      try { root = await canonicalPath(configured.path); }
      catch (error) { if (error.code !== 'ENOENT') errors.push({ path: configured.path, message: error.message }); continue; }
      const source = configured.source ?? 'custom';
      const sourceId = source + ':' + digest(root);
      async function walk(directory, depth) {
        if (depth > maxDepth || visited.size >= maxDirectories) return;
        let canonical;
        try {
          canonical = await canonicalPath(directory);
          if (visited.has(canonical) || !(await stat(canonical)).isDirectory()) return;
          visited.add(canonical);
          const skillFile = path.join(canonical, 'SKILL.md');
          try {
            const realFile = await canonicalPath(skillFile);
            // A skill's markdown must remain within its canonical resource directory.
            if (!inside(canonical, realFile)) throw new Error('SKILL.md escapes resource directory');
            if (files.has(realFile)) return;
            const parsed = parseSkill(await readSkill(realFile), path.basename(canonical));
            files.add(realFile);
            const { content, metadata, ...summary } = parsed;
            found.push({ ...summary, id: sourceId + ':' + digest(realFile), source, sourceId, root, path: canonical, skillFile: realFile, rank: configured.rank ?? 300, tokenEstimate: Math.ceil(content.length / 4) });
            return;
          } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') errors.push({ path: skillFile, message: error.message });
          }
          const children = await readdir(canonical, { withFileTypes: true });
          children.sort((a, b) => compare(a.name, b.name));
          for (const child of children) {
            if (child.name.startsWith('.') || child.name === 'node_modules') continue;
            if (child.isDirectory() || child.isSymbolicLink()) await walk(path.join(canonical, child.name), depth + 1);
          }
        } catch (error) { errors.push({ path: directory, message: error.message }); }
      }
      await walk(root, 0);
    }
    const seenNames = new Set();
    for (const entry of found) { entry.shadowed = seenNames.has(entry.name); seenNames.add(entry.name); }
    entries = new Map(found.map(entry => [entry.id, { ...entry }]));
    return found;
  }
  async function load(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error('Unknown skill source id');
    const directory = await canonicalPath(entry.path);
    const file = await canonicalPath(path.join(directory, 'SKILL.md'));
    if (directory !== entry.path || file !== entry.skillFile || !inside(directory, file)) throw new Error('Skill location changed; rescan required');
    const rawContent = await readSkill(file);
    const parsed = parseSkill(rawContent, path.basename(directory));
    if (parsed.name !== entry.name) throw new Error('Skill identity changed; rescan required');
    return { ...entry, ...parsed, rawContent, resourceBase: { kind: 'directory', path: directory } };
  }
  return { scan, load, errors };
}
