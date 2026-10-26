import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import {
  operationFormSubmitLabel,
  type OperationFormDefinition,
  type OperationFormErrors,
  type OperationFormHostMessage,
  type OperationFormValues,
  type OperationFormWebviewMessage,
} from '../../src/shared/forms/operationForm';
import type { VscodeCheckbox } from '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import type { VscodeRadio } from '@vscode-elements/elements/dist/vscode-radio/index.js';
import type { VscodeSingleSelect } from '@vscode-elements/elements/dist/vscode-single-select/index.js';
import type { VscodeTextarea } from '@vscode-elements/elements/dist/vscode-textarea/index.js';
import type { VscodeTextfield } from '@vscode-elements/elements/dist/vscode-textfield/index.js';

type Field = OperationFormDefinition['fields'][number];
type TextField = Extract<Field, { type: 'text' }>;
type CheckboxField = Extract<Field, { type: 'checkbox' }>;
type RadioField = Extract<Field, { type: 'radio' }>;

/** What the form shows: a field, or consecutive checkboxes drawn as one checkbox group. */
type Block =
  | { kind: 'text'; field: TextField }
  | { kind: 'radio'; field: RadioField }
  | { kind: 'checkboxes'; fields: CheckboxField[] };

function blocksOf(fields: readonly Field[]): Block[] {
  const blocks: Block[] = [];
  for (const field of fields) {
    const last = blocks.at(-1);
    if (field.type === 'checkbox') {
      // A checkbox with its own explanation is a settings row. The others that follow one another are one group.
      const sharesGroup = last?.kind === 'checkboxes'
        && !field.description
        && !last.fields[0].description
        && last.fields[0].group === field.group;
      if (sharesGroup) {
        last.fields.push(field);
      } else {
        blocks.push({ kind: 'checkboxes', fields: [field] });
      }
    } else if (field.type === 'radio') {
      blocks.push({ kind: 'radio', field });
    } else {
      blocks.push({ kind: 'text', field });
    }
  }
  return blocks;
}

export function mountOperationForm(
  root: HTMLElement,
  post: (message: OperationFormWebviewMessage) => void,
) {
  let definition: OperationFormDefinition | undefined;
  let values: OperationFormValues = {};
  let version = 0;
  let busy = false;
  let errors: OperationFormErrors = {};
  let failure: string | undefined;
  let selectedTab = 0;
  render(nothing, root);

  const control = <T extends HTMLElement>(id: string): T | null => root.querySelector<T>(`[id="${id}"]`);

  /** The dropdown's choices for a field: those whose `when` condition holds for the current values. */
  const choicesOf = (field: TextField) => (field.suggestions ?? [])
    .filter((entry) => !entry.when || values[entry.when.field] === entry.when.value);

  function paint(): void {
    render(template(), root);
  }

  function update(): void {
    version++;
    failure = undefined;
    for (const field of definition?.fields ?? []) {
      if (field.type !== 'text' || !field.suggestions) { continue; }
      const choices = choicesOf(field);
      if (!choices.some((entry) => entry.value === values[field.id])) {
        values[field.id] = choices[0]?.value ?? '';
      }
    }
    paint();
    post({ type: 'formValidate', version, values: { ...values } });
  }

  function typed(field: TextField, input: VscodeTextfield | VscodeTextarea): void {
    if (field.replaceWhitespace !== undefined && /\s/.test(input.value)) {
      // Keep the caret where it was in the text the person typed.
      const inner = input.wrappedElement;
      const caret = inner.selectionStart ?? input.value.length;
      const before = input.value.slice(0, caret).replace(/\s/g, field.replaceWhitespace);
      input.value = input.value.replace(/\s/g, field.replaceWhitespace);
      inner.setSelectionRange(before.length, before.length);
    }
    values[field.id] = input.value;
    update();
  }

  const label = (field: Field, forId?: string): TemplateResult => html`
    <vscode-label class="operation-form-label" id="label-${field.id}" for=${forId ?? nothing}>${field.label}</vscode-label>`;

  /** The explanation under a label. A checkbox carries its explanation beside the box instead. */
  const helper = (field: Field): TemplateResult | typeof nothing => field.description
    ? html`<vscode-form-helper class="operation-form-description" id="description-${field.id}"><p>${field.description}</p></vscode-form-helper>`
    : nothing;

  const error = (id: string): TemplateResult => html`
    <p id="error-${id}" class=${classMap({ 'operation-form-error': true, hidden: !errors[id] })} aria-live="polite">${errors[id] ?? ''}</p>`;

  function textControl(field: TextField): TemplateResult {
    const common = {
      id: `${field.id}-0`,
      describedBy: `error-${field.id}`,
    };
    if (field.suggestions) {
      const choices = choicesOf(field);
      return html`
        <vscode-single-select id="suggestions-${field.id}" class="operation-form-suggestions"
          aria-label=${l10n.t('{0} suggestions', field.label)} aria-describedby=${common.describedBy}
          .value=${live(String(values[field.id] ?? ''))}
          ?invalid=${Boolean(errors[field.id])} ?disabled=${busy || choices.length === 0}
          @change=${(event: Event) => { values[field.id] = (event.target as VscodeSingleSelect).value; update(); }}
        >${choices.length === 0
          ? html`<vscode-option value="" selected>${l10n.t('None available')}</vscode-option>`
          : choices.map((entry) => html`<vscode-option value=${entry.value} ?selected=${entry.value === values[field.id]}
              >${entry.label ? `${entry.value} (${entry.label})` : entry.value}</vscode-option>`)}</vscode-single-select>`;
    }
    const value = live(String(values[field.id] ?? ''));
    const onInput = (event: Event): void => typed(field, event.target as VscodeTextfield | VscodeTextarea);
    const pick = field.pickLabel
      ? html`<vscode-button slot="content-after" type="button" secondary ?disabled=${busy}
          @click=${() => { if (!busy) { post({ type: 'formPick', field: field.id, version, values: { ...values } }); } }}
        >${field.pickLabel}</vscode-button>`
      : nothing;
    return field.multiline
      ? html`
        <vscode-textarea id=${common.id} name=${field.id} rows="6" spellcheck="false"
          aria-label=${field.label} aria-describedby=${common.describedBy}
          placeholder=${field.placeholder ?? ''} .value=${value}
          ?readonly=${field.readOnly === true} ?required=${field.required === true}
          ?invalid=${Boolean(errors[field.id])} ?disabled=${busy} @input=${onInput}
        ></vscode-textarea>`
      : html`
        <vscode-textfield id=${common.id} name=${field.id} autocomplete="off" spellcheck="false"
          aria-label=${field.label} aria-describedby=${common.describedBy}
          placeholder=${field.placeholder ?? ''} .value=${value}
          ?readonly=${field.readOnly === true} ?required=${field.required === true}
          ?invalid=${Boolean(errors[field.id])} ?disabled=${busy} @input=${onInput}
        >${pick}</vscode-textfield>`;
  }

  const textBlock = (field: TextField): TemplateResult => html`
    <vscode-form-group class="operation-form-field" variant="settings-group">
      ${label(field, field.suggestions ? `suggestions-${field.id}` : `${field.id}-0`)}
      ${helper(field)}
      ${textControl(field)}
      ${error(field.id)}
    </vscode-form-group>`;

  const radioBlock = (field: RadioField): TemplateResult => html`
    <vscode-form-group class="operation-form-field" variant="settings-group" role="group" aria-labelledby="label-${field.id}">
      ${label(field, `radios-${field.id}`)}
      ${helper(field)}
      <vscode-radio-group id="radios-${field.id}" variant="vertical">
        ${field.options.map((option, index) => html`
          <vscode-radio id="${field.id}-${index}" name=${field.id} value=${option.value} label=${option.label}
            aria-label=${option.label} aria-describedby="error-${field.id}"
            .checked=${live(values[field.id] === option.value)} ?invalid=${Boolean(errors[field.id])} ?disabled=${busy}
            @change=${(event: Event) => { values[field.id] = (event.target as VscodeRadio).value; update(); }}
          ></vscode-radio>`)}
      </vscode-radio-group>
      ${error(field.id)}
    </vscode-form-group>`;

  const checkbox = (field: CheckboxField): TemplateResult => html`
    <vscode-checkbox id="${field.id}-0" name=${field.id}
      label=${field.description ?? field.label} aria-label=${field.description ?? field.label}
      aria-describedby="error-${field.id}"
      .checked=${live(values[field.id] === true)} ?invalid=${Boolean(errors[field.id])} ?disabled=${busy}
      @change=${(event: Event) => { values[field.id] = (event.target as VscodeCheckbox).checked; update(); }}
    ></vscode-checkbox>`;

  const checkboxBlock = (fields: readonly CheckboxField[]): TemplateResult => {
    const groupId = `checks-${fields[0].id}`;
    const title = fields.length > 1 ? fields[0].group : undefined;
    return html`
      <vscode-form-group class="operation-form-field" variant="settings-group">
        ${title
          ? html`<vscode-label id="label-${groupId}" for=${groupId}>${title}</vscode-label>`
          : fields.length === 1 && fields[0].description ? label(fields[0], `${fields[0].id}-0`) : nothing}
        <vscode-checkbox-group id=${groupId} variant="vertical">
          ${fields.map((field) => checkbox(field))}
        </vscode-checkbox-group>
        ${fields.map((field) => error(field.id))}
      </vscode-form-group>`;
  };

  const fieldsOf = (blocks: readonly Block[]): TemplateResult => html`
    <vscode-form-container class="operation-form-fields">
      ${blocks.map((block) => block.kind === 'text' ? textBlock(block.field)
        : block.kind === 'radio' ? radioBlock(block.field) : checkboxBlock(block.fields))}
    </vscode-form-container>`;

  /** A long form as tabs; the tab shown stays the same while the form redraws. */
  function tabbed(form: OperationFormDefinition): TemplateResult {
    const tabs = form.tabs ?? [];
    const inTabs = new Set(tabs.flatMap((tab) => tab.fields));
    const rest = form.fields.filter((field) => !inTabs.has(field.id));
    return html`
      <vscode-tabs class="operation-form-tabs" .selectedIndex=${live(selectedTab)}
        @vsc-tabs-select=${(event: CustomEvent<{ selectedIndex: number }>) => { selectedTab = event.detail.selectedIndex; }}>
        ${tabs.map((tab) => html`
          <vscode-tab-header slot="header">${tab.label}</vscode-tab-header>
          <vscode-tab-panel>${fieldsOf(blocksOf(form.fields.filter((field) => tab.fields.includes(field.id))))}</vscode-tab-panel>`)}
      </vscode-tabs>
      ${rest.length > 0 ? fieldsOf(blocksOf(rest)) : nothing}`;
  }

  function template(): TemplateResult {
    const form = definition;
    const blocks = form ? blocksOf(form.fields) : [];
    return html`
      <form class="operation-form" novalidate aria-busy=${String(busy)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Escape' && !busy) { event.preventDefault(); post({ type: 'formCancel' }); }
        }}
        @submit=${(event: Event) => {
          event.preventDefault();
          if (!busy) { post({ type: 'formSubmit', values: { ...values } }); }
        }}>
        ${form?.notice ? html`
          <vscode-form-group variant="settings-group">
            <vscode-form-helper>
              <p class=${classMap({ 'operation-form-notice': true, 'operation-form-notice-success': form.notice.kind === 'success' })}
                role="status" aria-live="polite"><span class="operation-form-notice-icon"
                ><vscode-icon name=${form.notice.kind === 'success' ? 'check' : 'warning'} aria-hidden="true"></vscode-icon></span
                ><span class="operation-form-notice-text">${form.notice.message}</span></p>
            </vscode-form-helper>
          </vscode-form-group>` : nothing}
        ${form?.tabs ? tabbed(form) : fieldsOf(blocks)}
        <vscode-form-group class="operation-form-actions" variant="settings-group">
          ${failure ? html`<p class="operation-form-error" role="alert">${failure}</p>` : nothing}
          <vscode-button type="submit" ?disabled=${busy || Object.keys(errors).length > 0}
          >${form ? operationFormSubmitLabel(form, values) : ''}</vscode-button>
        </vscode-form-group>
      </form>`;
  }

  function focusField(id: string): void {
    // A field in another tab is shown first, as when its value needs fixing.
    const tab = definition?.tabs?.findIndex((entry) => entry.fields.includes(id)) ?? -1;
    if (tab >= 0 && tab !== selectedTab) {
      selectedTab = tab;
      paint();
    }
    const input = control<VscodeTextfield | VscodeTextarea | HTMLElement>(`suggestions-${id}`) ?? control(`${id}-0`);
    input?.focus();
  }

  paint();

  return {
    applyHostMessage(message: OperationFormHostMessage): void {
      if (message.type === 'formInit') {
        definition = message.form;
        selectedTab = 0;
        values = { ...message.form.values };
        errors = {};
        update();
        const first = message.form.fields.find((field) => field.type === 'text' && !field.readOnly);
        if (first) {
          focusField(first.id);
          const input = control<VscodeTextfield>(`${first.id}-0`);
          if (input && 'wrappedElement' in input) {
            input.wrappedElement.setSelectionRange(input.value.length, input.value.length);
          }
        }
      } else if (message.type === 'formValidation') {
        if (message.version === version && !busy) {
          errors = message.errors;
          paint();
        }
      } else if (message.type === 'formPicked') {
        const field = definition?.fields.find((entry) => entry.id === message.field);
        if (message.version === version && field?.type === 'text') {
          values[message.field] = message.value;
          update();
        }
      } else if (message.type === 'formStatus') {
        busy = message.busy;
        if (message.error) { failure = message.error; }
        if (message.errors) { errors = message.errors; }
        paint();
        const id = message.errors ? Object.keys(message.errors)[0] : undefined;
        if (id) { focusField(id); }
      }
    },
  };
}
