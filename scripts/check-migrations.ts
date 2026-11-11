// Fails when two migrations share a version prefix, or a file has none. Tools that key migrations on
// the version treat a duplicate as a clash, and the second file can be skipped without a word.
// Run: npm run db:check
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';

export function migrationProblems(files: string[]): string[] {
  const byVersion = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of files) {
    const version = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file)?.[1];
    if (!version) {
      problems.push(`${file} is not named <14-digit version>_<name>.sql`);
      continue;
    }
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  for (const [version, names] of byVersion) {
    if (names.length > 1) problems.push(`Version ${version} is used by ${names.join(' and ')}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = readdirSync(MIGRATIONS_DIR);
  const problems = migrationProblems(files);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  else console.log(`${files.length} migrations, every version unique.`);
}
