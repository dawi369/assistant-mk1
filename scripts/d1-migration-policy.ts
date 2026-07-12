export const D1_MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

const RESET_ONLY_SQL_PATTERNS = [
  /\bDROP\s+TABLE\s+IF\s+EXISTS\b/i,
  /\bDELETE\s+FROM\s+d1_migrations\b/i,
] as const;

export function validateD1MigrationFiles(
  files: ReadonlyArray<{ name: string; sql: string }>,
): string[] {
  const errors: string[] = [];
  const names = files.map((file) => file.name);
  const sortedNames = [...names].sort();
  const numberedMigrations: Array<{ name: string; number: number }> = [];

  if (new Set(names).size !== names.length) {
    errors.push("D1 migration filenames must be unique.");
  }

  if (names.some((name, index) => name !== sortedNames[index])) {
    errors.push("D1 migrations must be read in filename order.");
  }

  for (const file of files) {
    if (!D1_MIGRATION_FILE_PATTERN.test(file.name)) {
      errors.push(`${file.name} must use the numbered migration format 0001_description.sql.`);
    } else {
      numberedMigrations.push({
        name: file.name,
        number: Number.parseInt(file.name.slice(0, 4), 10),
      });
    }

    if (file.sql.trim().length === 0) {
      errors.push(`${file.name} must not be empty.`);
    }

    for (const pattern of RESET_ONLY_SQL_PATTERNS) {
      if (pattern.test(file.sql)) {
        errors.push(
          `${file.name} contains reset-only SQL (${pattern.source}); keep destructive resets in schema.sql.`,
        );
      }
    }
  }

  numberedMigrations.forEach((migration, index) => {
    const expectedNumber = index + 1;
    if (migration.number !== expectedNumber) {
      errors.push(
        `${migration.name} has migration number ${migration.number}; expected contiguous number ${expectedNumber}.`,
      );
    }
  });

  return errors;
}
