import type { FieldType } from './modules';

/** Postgres column type for each registry field type. Used by the migration test to keep SQL and registry in sync. */
export const SQL_TYPE: Record<FieldType, string> = {
  text: 'text',
  textarea: 'text',
  email: 'text',
  tel: 'text',
  select: 'text',
  number: 'numeric',
  money: 'numeric(14,2)',
  date: 'date',
  boolean: 'boolean',
  project: 'uuid',
  client: 'uuid',
  uuid: 'uuid',
};
