import { TallyError } from "../errors.ts";

export const COMMANDS_ENV = "TALLY_COMMANDS";

export const commandPlaces = ["service", "agent"] as const;

export type CommandPlace = (typeof commandPlaces)[number];

export function commandsRunIn(env: NodeJS.ProcessEnv = process.env): CommandPlace {
  const value = env[COMMANDS_ENV] ?? "";
  if (value === "") return "service";
  const place = commandPlaces.find((one) => one === value);
  if (place === undefined) throw new TallyError(`${COMMANDS_ENV} is '${value}'; it takes service (tally runs a project's commands) or agent (the agent runs them in its own shell, through the runner)`);
  return place;
}
