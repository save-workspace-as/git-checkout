import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

/** Sends one prompt to a language model and returns its whole reply; rejects when the request fails or is canceled. */
export type AskModel = (prompt: string, token: vscode.CancellationToken) => Promise<string>;

/** Thrown when VS Code has no language model to ask; there is no model to try again. */
export class NoLanguageModelError extends Error {
  constructor() {
    super('No language model is available');
    this.name = 'NoLanguageModelError';
  }
}

/** Thrown when the person turned the AI features off with `gitCheckout.ai.enabled`. */
export class AiDisabledError extends Error {
  constructor() {
    super('AI features are turned off');
    this.name = 'AiDisabledError';
  }
}

/** Whether the AI features are on: the buttons and menu items show, and prompts are sent. */
export const aiEnabled = (): boolean => vscode.workspace.getConfiguration('gitCheckout.ai').get<boolean>('enabled', true);

/** What to tell the person when an AI feature is used with the setting off. */
export const aiDisabledMessage = (): string =>
  l10n.t('AI features are turned off. Turn them on with the setting gitCheckout.ai.enabled.');

let seeded: AskModel | undefined;

/** Answers every prompt with `model` instead of a language model; `undefined` goes back to VS Code's (e2e only: the tests have no model to ask). */
export function seedLanguageModel(model: AskModel | undefined): void {
  seeded = model;
}

/** Asks the first language model VS Code provides, such as GitHub Copilot's. */
export const askLanguageModel: AskModel = async (prompt, token) => {
  if (!aiEnabled()) {
    throw new AiDisabledError();
  }
  if (seeded) {
    return seeded(prompt, token);
  }
  const model = (await vscode.lm.selectChatModels())[0];
  if (!model) {
    throw new NoLanguageModelError();
  }
  const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
  let reply = '';
  for await (const chunk of response.text) {
    reply += chunk;
  }
  return reply;
};
