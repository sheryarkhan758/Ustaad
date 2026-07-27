import { getTableName } from 'drizzle-orm';

/**
 * Guard the database handle so `admin_actions` can never be updated or deleted.
 *
 * The append-only rule is enforced at the execution boundary rather than by
 * convention, which makes an accidental mutation fail fast before it reaches
 * SQLite or Postgres.
 */
export function guardAdminActionsWrites<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'update' && property !== 'delete') {
        return Reflect.get(target, property, receiver);
      }

      const original = Reflect.get(target, property, receiver);
      if (typeof original !== 'function') return original;

      return (table: unknown, ...args: unknown[]) => {
        if (getTableName(table as never) === 'admin_actions') {
          throw new Error('admin_actions is append-only; use appendAdminAction instead.');
        }
        return original.call(target, table, ...args);
      };
    },
  });
}