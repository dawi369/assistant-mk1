export const releaseEvidenceCommand = (argv: string[]) => {
  const separator = argv.lastIndexOf("--");
  return separator >= 0 ? argv.slice(separator + 1) : [];
};
