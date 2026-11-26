import { styles } from './styles.mjs';

export function filterSkills(skills, { search = '', source = '', status = '' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return skills.filter(skill => (!source || skill.source === source) && (!status || Boolean(skill.enabled) === (status === 'on')) && (!query || [skill.name, skill.description, skill.root, skill.source].join(' ').toLocaleLowerCase().includes(query)));
}

export function mountSettings(container, { fetch: request = globalThis.fetch, sessionId } = {}) {
  const doc = container.ownerDocument;
  const sessionBound = sessionId !== undefined;
  let disposed = false, generation = 0, detailGeneration = 0, project = '', state, busy = false;
  const abort = new AbortController();
  const el = (tag, text, className) => { const node = doc.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
  const root = el('section', null, 'skm-page');
  root.setAttribute('aria-label', '技能');
  const style = el('style', styles); root.append(style);
  const heading = el('header', null, 'skm-header');
  heading.append(el('h2', '技能'));
  const refresh = el('button', '刷新技能'); refresh.type = 'button';
  heading.append(refresh); root.append(heading);
  const notices = el('div'); notices.setAttribute('aria-live', 'polite'); root.append(notices);
  const controls = el('div', null, 'skm-controls');
  const labeled = (label, input) => { const wrap = el('label', label); wrap.append(input); controls.append(wrap); return input; };
  const select = (name, options) => { const node = el('select'); node.setAttribute('aria-label', name); for (const [value, label] of options) { const opt = el('option', label); opt.value = value; node.append(opt); } return node; };
  const projectSelect = labeled('工作区', select('工作区', []));
  root.append(controls);
  const stats = el('div', null, 'skm-stats'); stats.setAttribute('aria-live', 'polite'); root.append(stats);
  const filters = el('div', null, 'skm-filters');
  const search = el('input'); search.type = 'search'; search.placeholder = '搜索技能名称、描述或路径'; search.setAttribute('aria-label', '搜索技能');
  const source = select('来源筛选', [['', '全部来源']]);
  const status = select('状态筛选', [['', '全部状态'], ['on', '已启用'], ['off', '已停用']]);
  filters.append(search, source, status); root.append(filters);
  const list = el('div', null, 'skm-list'); root.append(list);
  const dialog = el('dialog', null, 'skm-dialog'); dialog.setAttribute('aria-label', '技能纯文本详情');
  const detailHeading = el('h3', '技能详情'), detailPath = el('p', '', 'skm-muted'), detailText = el('pre');
  const close = el('button', '关闭详情'); close.type = 'button';
  dialog.append(close, detailHeading, detailPath, detailText); root.append(dialog);
  let previousFocus;
  const closeDetail = () => { detailGeneration++; if (dialog.open && typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); previousFocus?.focus(); };
  close.addEventListener('click', closeDetail);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); close.focus(); } });
  container.append(root);

  async function api(path, options = {}) {
    const response = await request('/api/skills-manager/' + path, { credentials: 'same-origin', signal: abort.signal, ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error('服务返回了无效的 JSON'); }
    if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || ('请求失败：HTTP ' + response.status));
    return data;
  }
  function message(text, error = false) { const node = el('p', text, error ? 'skm-error' : 'skm-notice'); node.setAttribute('role', error ? 'alert' : 'status'); notices.append(node); }
  function lock(value) {
    busy = value; root.setAttribute('aria-busy', String(value));
    const hasChoices = Boolean(state?.workspaces?.length || state?.projects?.length || project);
    for (const node of root.querySelectorAll('button, select, input[type=checkbox]')) if (node !== close) node.disabled = value || (node === projectSelect && (sessionBound || !hasChoices)) || (node.type === 'checkbox' && !project);
  }
  function render() {
    list.replaceChildren(); if (!state) return;
    const skills = state.skills;
    const enabled = skills.filter(skill => skill.enabled);
    const tokens = enabled.reduce((total, skill) => total + (Number.isFinite(skill.tokens) ? skill.tokens : 0), 0);
    const cells = [skills.length + ' 个技能', enabled.length + ' 个已启用', (skills.length - enabled.length) + ' 个已停用', (state.warnings?.length ?? 0) + ' 个诊断提示'];
    stats.replaceChildren(...cells.map(text => el('span', text)));
    stats.title = '正文估算 ≈' + tokens + ' tokens（字符数/4，不是系统目录实际消耗）';
    const filtered = filterSkills(skills, { search: search.value, source: source.value, status: status.value });
    if (!filtered.length) { list.append(el('p', skills.length ? '没有匹配的技能，请调整搜索或筛选条件。' : '未发现可管理的全局技能。内置技能不在此管理。', 'skm-empty')); return; }
    const groups = new Map();
    for (const skill of filtered) { const key = skill.source + '\0' + skill.root; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(skill); }
    for (const group of groups.values()) {
      const section = el('details', null, 'skm-group'); section.open = true;
      const title = el('summary', group[0].source + ' · ' + group.length + ' 个技能'); title.append(el('span', group[0].root, 'skm-root')); section.append(title);
      for (const skill of group) {
        const row = el('div', null, 'skm-row'); const copy = el('div', null, 'skm-copy');
        const name = el('button', skill.name, 'skm-name'); name.type = 'button'; name.addEventListener('click', () => showDetail(skill));
        copy.append(name, el('span', Number.isFinite(skill.tokens) ? ' ≈' + skill.tokens + ' tokens' : ' token 未知', 'skm-muted'), el('p', skill.description || '暂无描述'));
        const toggleLabel = el('label', null, 'skm-toggle'); const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = Boolean(skill.enabled); toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '在本项目启用 ' + skill.name); toggle.disabled = busy || !project;
        toggle.addEventListener('change', () => { const enabled = toggle.checked; toggle.checked = Boolean(skill.enabled); action({ type: 'toggle', project, name: skill.name, enabled }); });
        toggleLabel.append(toggle, el('span', skill.enabled ? '已启用' : '已停用')); row.append(copy, toggleLabel); section.append(row);
      }
      list.append(section);
    }
  }
  async function load() {
    const current = ++generation; lock(true); notices.replaceChildren(); message('正在加载技能…');
    try {
      if (sessionBound && !sessionId) throw new Error('未能识别当前会话');
      const query = sessionBound ? '?sessionId=' + encodeURIComponent(sessionId) : project ? '?project=' + encodeURIComponent(project) : '';
      const next = await api('state' + query);
      if (disposed || current !== generation) return;
      if (!Array.isArray(next.skills) || !Array.isArray(next.projects)) throw new Error('技能状态格式无效');
      if (sessionBound && (!next.sessionWorkspace?.path || !next.project)) throw new Error('未找到当前会话所属的工作区');
      state = next; project = typeof next.project === 'string' ? next.project : '';
      const workspaces = sessionBound ? [next.sessionWorkspace] : (Array.isArray(next.workspaces) && next.workspaces.length ? next.workspaces : next.projects.map(path => ({ path, title: '' })))
        .filter(row => row && typeof row.path === 'string' && row.path);
      if (!sessionBound && project && !workspaces.some(row => row.path === project)) workspaces.unshift({ path: project, title: '' });
      projectSelect.replaceChildren();
      for (const row of workspaces) { const option = el('option', row.title || row.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '工作区'); option.value = row.path; projectSelect.append(option); }
      if (!project) { const option = el('option', workspaces.length ? '请选择工作区' : '暂无工作区'); option.value = ''; projectSelect.prepend(option); }
      projectSelect.value = sessionBound ? next.sessionWorkspace.path : project;
      if (sessionBound) projectSelect.title = next.sessionWorkspace.path;
      const chosenSource = source.value; source.replaceChildren();
      for (const value of ['', ...new Set(next.skills.map(skill => skill.source))]) { const option = el('option', value || '全部来源'); option.value = value; source.append(option); }
      source.value = [...source.options].some(option => option.value === chosenSource) ? chosenSource : '';
      notices.replaceChildren();
      message(next.enforcement?.message || (next.enforcement?.verified ? '受管技能目录覆盖已通过核验。' : '目录覆盖尚未核验，请刷新重试。'));
      for (const warning of next.warnings || []) message(warning);
      if (!project) message(workspaces.length ? '请选择一个工作区后再设置技能开关。' : '没有发现工作区，请先在 DSH 中添加工作区后刷新。');
      render();
    } catch (error) { if (disposed || current !== generation) return; state = undefined; if (sessionBound) { project = ''; projectSelect.replaceChildren(); projectSelect.title = ''; } list.replaceChildren(); stats.replaceChildren(); notices.replaceChildren(); message('加载失败：' + error.message + '。请点击刷新技能重试。', true); }
    finally { if (!disposed && current === generation) { lock(false); render(); } }
  }
  async function action(payload) {
    if (busy || disposed) return;
    lock(true); render(); notices.replaceChildren(); message('正在保存…');
    try { await api('action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!disposed) await load(); }
    catch (error) { if (!disposed) { notices.replaceChildren(); message('操作失败：' + error.message, true); } }
    finally { if (!disposed) { lock(false); render(); } }
  }
  async function showDetail(skill) {
    const current = ++detailGeneration; previousFocus = doc.activeElement; detailHeading.textContent = skill.name; detailPath.textContent = ''; detailText.textContent = '正在加载纯文本详情…';
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); } close.focus();
    try { const detail = await api('skill?id=' + encodeURIComponent(skill.id) + '&project=' + encodeURIComponent(project)); if (disposed || current !== detailGeneration) return; detailHeading.textContent = detail.name; detailPath.textContent = detail.path; detailText.textContent = detail.content; }
    catch (error) { if (!disposed && current === detailGeneration) detailText.textContent = '详情加载失败：' + error.message; }
  }
  if (!sessionBound) projectSelect.addEventListener('change', () => { project = projectSelect.value; closeDetail(); load(); });
  refresh.addEventListener('click', () => { if (!state) load(); else action({ type: 'refresh' }); });
  for (const input of [search, source, status]) input.addEventListener(input === search ? 'input' : 'change', render);
  const ready = load();
  return { ready, reload: load, dispose() { if (disposed) return; disposed = true; generation++; detailGeneration++; abort.abort(); root.remove(); } };
}
