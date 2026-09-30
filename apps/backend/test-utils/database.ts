/** Sequential test-only store. Does not model Convex OCC or rollback. */
export function testDatabase(seed: Record<string, any[]> = {}) {
  const tables = structuredClone(seed);
  let sequence = 0;
  const jobs: Array<{ delay: number; args: unknown }> = [];
  const rows = (table: string) => (tables[table] ??= []);
  const db = {
    get: async (table: string, id: string) =>
      structuredClone(rows(table).find((row) => row._id === id) ?? null),
    insert: async (table: string, data: Record<string, unknown>) => {
      const id = `${table}-${++sequence}`;
      rows(table).push({ ...structuredClone(data), _id: id });
      return id;
    },
    patch: async (
      table: string,
      id: string,
      patch: Record<string, unknown>,
    ) => {
      const row = rows(table).find((item) => item._id === id);
      if (!row) throw new Error(`Missing test row ${table}/${id}`);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = structuredClone(value);
      }
    },
    query: (table: string) => {
      const filters: Array<(row: any) => boolean> = [];
      const index = {
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return index;
        },
        lte: (key: string, value: number) => {
          filters.push((row) => row[key] <= value);
          return index;
        },
      };
      const matches = () =>
        structuredClone(
          rows(table).filter((row) => filters.every((filter) => filter(row))),
        );
      const query = {
        withIndex: (_name: string, select: (q: typeof index) => unknown) => {
          select(index);
          return query;
        },
        order: (_direction: string) => query,
        first: async () => matches()[0] ?? null,
        unique: async () => {
          const found = matches();
          if (found.length > 1) throw new Error("Non-unique test query");
          return found[0] ?? null;
        },
        take: async (count: number) => matches().slice(0, count),
        collect: async () => matches(),
      };
      return query;
    },
  };
  return {
    tables,
    jobs,
    ctx: {
      db,
      scheduler: {
        runAfter: async (delay: number, _fn: unknown, args: unknown) => {
          jobs.push({ delay, args });
          return `job-${jobs.length}`;
        },
      },
    },
  };
}
