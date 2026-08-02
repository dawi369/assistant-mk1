export type ProvisionResourceKind =
  | "cloudflare-d1"
  | "cloudflare-r2"
  | "fly-app"
  | "vercel-project";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const provisionResourceExists = (
  kind: ProvisionResourceKind,
  output: string,
  resourceName: string,
) => {
  const name = escapeRegExp(resourceName);
  const patterns: Record<ProvisionResourceKind, RegExp> = {
    "cloudflare-d1": new RegExp(`"name"\\s*:\\s*"${name}"`),
    "cloudflare-r2": new RegExp(`(?:^|\\n)name:\\s*${name}(?:\\s|$)`),
    "fly-app": new RegExp(`"(?:Name|ID)"\\s*:\\s*"${name}"`),
    "vercel-project": new RegExp(`(?:^|\\n)\\s*${name}(?:\\s|$)`),
  };
  return patterns[kind].test(output);
};

export const describeProvisionCommandFailure = (input: {
  command: string;
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
}) => {
  const diagnostic = `${input.stderr}\n${input.stdout}`
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return `${input.command} ${input.args.slice(0, 4).join(" ")} exited with ${input.status ?? "signal"}${diagnostic ? `: ${diagnostic}` : ""}`;
};
