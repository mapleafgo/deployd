import { z } from "zod";
export const variablesSchema = z
  .array(
    z.object({
      key: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "variableInvalid")
        .refine(
          (name) => !["BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "POSIXLY_CORRECT"].includes(name),
          "validation.shellEnvReserved",
        ),
      value: z.string(),
    }),
  )
  .superRefine((rows, ctx) => {
    const keys = new Set<string>();
    rows.forEach((row, index) => {
      if (keys.has(row.key))
        ctx.addIssue({ code: "custom", message: "variableDuplicate", path: [index, "key"] });
      keys.add(row.key);
    });
  });
export type Variable = z.infer<typeof variablesSchema>[number];
export function variablesToObject(rows: Variable[]): Record<string, string> {
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}
export function variableRows(values: Record<string, string>): Variable[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}
export function scriptFor(commands: string[]) {
  return commands.join("\n");
}
export function commandsFor(script: string, originalScript: string, originalCommands: string[]) {
  return script === originalScript ? [...originalCommands] : [`set -e\n${script}`];
}
