export const CUSTOM_COMMAND_CONTEXTS = ['branch', 'file', 'submodule', 'url'] as const;

export type CustomCommandContext = (typeof CUSTOM_COMMAND_CONTEXTS)[number];

export const CUSTOM_COMMAND_VARS = ['branch', 'file', 'submodule', 'url', 'repo', 'sha'] as const;

export type CustomCommandVar = (typeof CUSTOM_COMMAND_VARS)[number];

export type CustomCommandVars = Partial<Record<CustomCommandVar, string>>;

export interface CustomCommandDefinition {
  name: string;
  command: string;
  context: CustomCommandContext;
}

const PLACEHOLDER = /\$\{(branch|file|submodule|url|repo|sha)\}/g;

function isContext(value: unknown): value is CustomCommandContext {
  return (
    typeof value === 'string' &&
    (CUSTOM_COMMAND_CONTEXTS as readonly string[]).includes(value)
  );
}

export function parseCustomCommands(value: unknown): CustomCommandDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const commands: CustomCommandDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const command = typeof record.command === 'string' ? record.command.trim() : '';
    if (!name || !command || !isContext(record.context)) {
      continue;
    }
    commands.push({ name, command, context: record.context });
  }
  return commands;
}

export function customCommandVarKeys(definition: CustomCommandDefinition): CustomCommandVar[] {
  const keys = new Set<CustomCommandVar>();
  if (definition.context === 'branch') {
    keys.add('branch');
  } else if (definition.context === 'file') {
    keys.add('file');
  } else if (definition.context === 'submodule') {
    keys.add('submodule');
  }
  for (const match of definition.command.matchAll(PLACEHOLDER)) {
    keys.add(match[1] as CustomCommandVar);
  }
  return [...keys];
}

export function customCommandNeedsRepo(definition: CustomCommandDefinition): boolean {
  if (definition.context !== 'url') {
    return true;
  }
  return customCommandVarKeys(definition).some((key) => key !== 'url');
}

export function expandCustomCommand(
  template: string,
  vars: CustomCommandVars,
  encode: boolean,
): string {
  return template.replace(PLACEHOLDER, (token, key: CustomCommandVar) => {
    const value = vars[key];
    if (!value) {
      return token;
    }
    const singleLine = value.replace(/[\r\n]/g, '');
    return encode ? encodeURIComponent(singleLine) : singleLine;
  });
}

export function parseOpenableUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return url.toString();
}
