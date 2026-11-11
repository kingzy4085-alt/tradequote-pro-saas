/* @ds-bundle: {"format":4,"namespace":"TQ","components":[{"name":"Button"},{"name":"TextField"},{"name":"Select"},{"name":"Badge"},{"name":"StatCard"},{"name":"Panel"},{"name":"DataTable"},{"name":"Modal"},{"name":"ModuleTile"},{"name":"PageHeader"},{"name":"ResultPanel"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(' ');
  }
  function rest(props, omit) {
    var out = {};
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k) && omit.indexOf(k) < 0) out[k] = props[k];
    return out;
  }

  function Button(p) {
    var variant = p.variant || 'primary';
    var size = p.size || 'md';
    var tag = p.href ? 'a' : 'button';
    var o = rest(p, ['variant', 'size', 'className', 'children']);
    if (!p.href && !o.type) o.type = 'button';
    o.className = cx('tq-btn', 'tq-btn--' + variant, size !== 'md' && 'tq-btn--' + size, p.className);
    return h(tag, o, p.children);
  }

  var fieldSeq = 0;
  function useId(given) {
    var ref = React.useRef(given || 'tq-f' + ++fieldSeq);
    return ref.current;
  }

  function TextField(p) {
    var id = useId(p.id);
    var o = rest(p, ['label', 'compact', 'mono', 'className', 'id']);
    o.id = id;
    o.className = cx('tq-input', p.compact && 'tq-input--compact', p.mono && 'tq-input--mono');
    if (!o.type) o.type = 'text';
    var input = h('input', o);
    if (!p.label) return h('div', { className: cx('tq-field', p.className) }, input);
    return h('div', { className: cx('tq-field', p.className) }, h('label', { className: 'tq-label', htmlFor: id }, p.label), input);
  }

  function Select(p) {
    var id = useId(p.id);
    var opts = (p.options || []).map(function (opt) {
      var v = typeof opt === 'string' ? opt : opt.value;
      var l = typeof opt === 'string' ? opt : opt.label;
      return h('option', { key: v, value: v }, l);
    });
    var o = rest(p, ['label', 'options', 'compact', 'className', 'id']);
    o.id = id;
    o.className = cx('tq-input', p.compact && 'tq-input--compact');
    var sel = h('select', o, opts);
    return h('div', { className: cx('tq-field', p.className) }, p.label ? h('label', { className: 'tq-label', htmlFor: id }, p.label) : null, sel);
  }

  function Badge(p) {
    return h('span', { className: cx('tq-badge', p.className) }, p.children);
  }

  function StatCard(p) {
    return h('div', { className: cx('tq-card tq-stat', p.className) },
      h('p', { className: 'tq-stat__label' }, p.label),
      h('p', { className: 'tq-stat__value' }, p.loading ? '...' : p.value),
      p.caption ? h('p', { className: 'tq-stat__caption' }, p.caption) : null);
  }

  function Panel(p) {
    return h('section', { className: cx('tq-card tq-panel', p.roomy && 'tq-panel--roomy', p.className) },
      p.title ? h('h2', { className: cx('tq-panel__title', p.description && 'tq-panel__title--section') }, p.title) : null,
      p.description ? h('p', { className: 'tq-panel__desc' }, p.description) : null,
      p.children);
  }

  function DataTable(p) {
    var cols = p.columns || [];
    var rows = p.rows || [];
    var body;
    if (p.loading) body = [h('tr', { key: 's' }, h('td', { className: 'tq-cell--state', colSpan: cols.length }, p.loadingText || 'Loading records...'))];
    else if (!rows.length) body = [h('tr', { key: 's' }, h('td', { className: 'tq-cell--state', colSpan: cols.length }, p.emptyText || 'No records found. Add one above.'))];
    else body = rows.map(function (row, i) {
      return h('tr', { key: row.id || i }, cols.map(function (c) {
        var v = c.render ? c.render(row) : row[c.key];
        return h('td', { key: c.key, className: cx(c.tone && 'tq-cell--' + c.tone, c.align === 'right' && 'tq-right') }, v);
      }));
    });
    return h('div', { className: cx('tq-card tq-table-wrap', p.className) },
      p.title ? h('div', { className: 'tq-table-head' }, h('h2', null, p.title)) : null,
      h('div', { className: 'tq-table-scroll' },
        h('table', { className: 'tq-table' },
          h('thead', null, h('tr', null, cols.map(function (c) {
            return h('th', { key: c.key, className: c.align === 'right' ? 'tq-right' : null }, c.header);
          }))),
          h('tbody', null, body))));
  }

  function Modal(p) {
    if (p.open === false) return null;
    return h('div', { className: cx('tq-scrim', p.inline && 'tq-scrim--inline'), onClick: function (e) { if (e.target === e.currentTarget && p.onClose) p.onClose(); } },
      h('div', { className: 'tq-card tq-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title },
        h('h2', null, p.title),
        h('div', { className: 'tq-modal__body' }, p.children),
        p.actions ? h('div', { className: 'tq-modal__actions' }, p.actions) : null));
  }

  function ModuleTile(p) {
    return h('a', { href: p.href || '#', className: cx('tq-tile', p.className) }, p.children);
  }

  function PageHeader(p) {
    return h('header', { className: cx('tq-header', p.className) },
      h('div', null,
        p.backHref ? h('a', { className: 'tq-back', href: p.backHref }, '← ' + (p.backLabel || 'Back to Command Center')) : null,
        h('h1', null, p.title),
        p.subtitle ? h('p', null, p.subtitle) : null),
      p.actions ? h('div', { className: 'tq-header__actions' }, p.actions) : null);
  }

  function ResultPanel(p) {
    var tone = p.tone || 'success';
    var data = p.data;
    return h('div', { className: cx('tq-card tq-result', 'tq-result--' + tone, p.className), role: 'status' },
      h('h3', null, p.title),
      data !== undefined ? h('pre', null, typeof data === 'string' ? data : JSON.stringify(data, null, 2)) : p.children);
  }

  window.TQ = {
    Button: Button, TextField: TextField, Select: Select, Badge: Badge, StatCard: StatCard, Panel: Panel,
    DataTable: DataTable, Modal: Modal, ModuleTile: ModuleTile, PageHeader: PageHeader, ResultPanel: ResultPanel
  };
})();
