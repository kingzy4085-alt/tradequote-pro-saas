// A small in-memory stand-in for the supabase-js query builder, for route tests.
// It applies filters to plain rows and records every call so tests can check what
// was asked for. It doesn't enforce security; RLS is tested on PGlite instead.

type Row = Record<string, unknown>;
export type DbError = { code?: string; message: string };

export interface FakeOptions {
  /** Primary-key column per table, for duplicate detection on insert. */
  keys?: Record<string, string>;
  /** Return an error for a call, e.g. to simulate a failed read. */
  failOn?: (call: { table: string; op: string; filters: [string, string, unknown][] }) => DbError | null;
  /** Results for rpc(name, args). */
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: DbError | null };
}

export function fakeSupabase(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  const log: { table: string; op: string; columns?: string; filters: [string, string, unknown][]; range?: [number, number]; limit?: number; order: string[]; values?: unknown }[] = [];
  const removed: string[][] = [];

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: [string, string, unknown][] = [];
    const order: [string, boolean][] = [];
    let op = 'select';
    let columns: string | undefined;
    let values: Row | Row[] | undefined;
    let range: [number, number] | undefined;
    let limit: number | undefined;
    let single: 'single' | 'maybe' | null = null;
    let returning = false;
    let wantCount = false;

    const matches = (row: Row) =>
      filters.every(([kind, col, want]) => {
        const v = row[col];
        if (kind === 'eq') return v === want;
        if (kind === 'is') return v === want || (want === null && v === undefined);
        if (kind === 'gt') return String(v) > String(want);
        if (kind === 'lt') return String(v) < String(want);
        if (kind === 'in') return (want as unknown[]).includes(v);
        if (kind === 'ilike') return String(v).toLowerCase().includes(String(want).replace(/%/g, '').toLowerCase());
        return true;
      });

    function run(): { data: unknown; error: DbError | null; count?: number } {
      log.push({ table, op, columns, filters: [...filters], range, limit, order: order.map(([c]) => c), values });
      const failure = options.failOn?.({ table, op, filters });
      if (failure) return { data: null, error: failure };

      let result: Row[];
      if (op === 'insert') {
        const list = (Array.isArray(values) ? values : [values]) as Row[];
        const key = options.keys?.[table];
        for (const row of list) {
          if (key && rows.some((r) => r[key] === row[key])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          rows.push({ ...row });
        }
        result = list;
      } else if (op === 'update') {
        result = rows.filter(matches);
        for (const row of result) Object.assign(row, values);
      } else if (op === 'delete') {
        result = rows.filter(matches);
        tables[table] = rows.filter((r) => !result.includes(r));
      } else {
        result = rows.filter(matches);
      }

      const count = result.length;
      for (const [col, asc] of [...order].reverse()) {
        result = [...result].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (range) result = result.slice(range[0], range[1] + 1);
      if (limit !== undefined) result = result.slice(0, limit);

      if (single) {
        if (result.length === 0 && single === 'single') return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: result[0] ?? null, error: null };
      }
      if (op !== 'select' && !returning) return { data: null, error: null };
      return { data: result, error: null, count: wantCount ? count : undefined };
    }

    const builder = {
      select(cols?: string, opts?: { count?: string }) {
        columns = cols;
        wantCount = !!opts?.count;
        if (op !== 'select') returning = true;
        return builder;
      },
      insert(v: Row | Row[]) {
        op = 'insert';
        values = v;
        return builder;
      },
      update(v: Row) {
        op = 'update';
        values = v;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      upsert(v: Row) {
        op = 'insert';
        values = v;
        return builder;
      },
      eq(c: string, v: unknown) {
        filters.push(['eq', c, v]);
        return builder;
      },
      is(c: string, v: unknown) {
        filters.push(['is', c, v]);
        return builder;
      },
      gt(c: string, v: unknown) {
        filters.push(['gt', c, v]);
        return builder;
      },
      lt(c: string, v: unknown) {
        filters.push(['lt', c, v]);
        return builder;
      },
      in(c: string, v: unknown[]) {
        filters.push(['in', c, v]);
        return builder;
      },
      ilike(c: string, v: string) {
        filters.push(['ilike', c, v]);
        return builder;
      },
      order(c: string, o?: { ascending?: boolean }) {
        order.push([c, o?.ascending !== false]);
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      range(a: number, b: number) {
        range = [a, b];
        return builder;
      },
      maybeSingle() {
        single = 'maybe';
        return builder;
      },
      single() {
        single = 'single';
        return builder;
      },
      then<T>(resolve: (r: { data: unknown; error: DbError | null; count?: number }) => T) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return builder;
  }

  return {
    tables,
    log,
    removed,
    from,
    rpc: async (name: string, args: Record<string, unknown> = {}) => options.rpc?.(name, args) ?? { data: true, error: null },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: paths, error: null };
        },
      }),
    },
  };
}
