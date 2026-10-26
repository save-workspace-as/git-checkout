import * as l10n from '@vscode/l10n';

export type OperationFormValues = Record<string, string | boolean>;
export type OperationFormErrors = Record<string, string>;

interface FormFieldBase {
  id: string;
  label: string;
  /** Shown with the field, the way a Settings row shows its explanation. */
  description?: string;
}

export type OperationFormField =
  | (FormFieldBase & {
      type: 'text';
      placeholder?: string;
      required?: boolean;
      readOnly?: boolean;
      multiline?: boolean;
      /** Typing or pasting whitespace puts this text in its place, as for a branch name. */
      replaceWhitespace?: string;
      pickLabel?: string;
      suggestions?: { value: string; label?: string; when?: { field: string; value: string } }[];
    })
  | (FormFieldBase & {
      type: 'checkbox';
      /** Consecutive checkboxes with the same group are one checkbox group under this title. */
      group?: string;
    })
  | (FormFieldBase & {
      type: 'radio';
      options: { value: string; label: string }[];
    });

export interface OperationFormDefinition {
  title: string;
  notice?: { kind: 'warning' | 'success'; message: string };
  fields: OperationFormField[];
  values: OperationFormValues;
  submitLabel: string;
  checkedSubmitLabel?: { field: string; label: string };
  /** Splits a long form into tabs, each listing its fields by id; fields in no tab follow the tabs. */
  tabs?: { label: string; fields: string[] }[];
}

export type OperationFormHostMessage =
  | { type: 'formInit'; form: OperationFormDefinition }
  | { type: 'formValidation'; version: number; errors: OperationFormErrors }
  | { type: 'formPicked'; version: number; field: string; value: string }
  | { type: 'formStatus'; busy: boolean; error?: string; errors?: OperationFormErrors };

export type OperationFormModalHostMessage =
  | { type: 'operationFormOpen'; sessionId: number; form: OperationFormDefinition }
  | { type: 'operationFormUpdate'; sessionId: number; message: OperationFormHostMessage }
  | { type: 'operationFormClose'; sessionId: number };

export interface OperationFormModalWebviewMessage {
  type: 'operationFormMessage';
  sessionId: number;
  message: OperationFormWebviewMessage;
}

export type OperationFormWebviewMessage =
  | { type: 'formReady' }
  | { type: 'formCancel' }
  | { type: 'formValidate'; version: number; values: OperationFormValues }
  | { type: 'formPick'; version: number; field: string; values: OperationFormValues }
  | { type: 'formSubmit'; values: OperationFormValues };

export function validateOperationForm(
  form: OperationFormDefinition,
  input: unknown,
): { values: OperationFormValues; errors: OperationFormErrors } {
  const values: OperationFormValues = {};
  const errors: OperationFormErrors = {};
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  for (const field of form.fields) {
    const value = record[field.id];
    const choices = field.type === 'text' ? field.suggestions?.filter((option) =>
      !option.when || record[option.when.field] === option.when.value) : undefined;
    if (field.type === 'checkbox') {
      if (typeof value === 'boolean') {
        values[field.id] = value;
      } else {
        errors[field.id] = l10n.t('Choose a value for {0}.', field.label);
      }
    } else if (typeof value !== 'string') {
      errors[field.id] = l10n.t('Enter a value for {0}.', field.label);
    } else if (field.type === 'radio' && !field.options.some((option) => option.value === value)) {
      errors[field.id] = l10n.t('Choose a value for {0}.', field.label);
    } else if (choices && !choices.some((option) => option.value === value)
      && !(choices.length === 0 && value === '')) {
      errors[field.id] = l10n.t('Choose a value for {0}.', field.label);
    } else {
      values[field.id] = value;
      if (field.type === 'text' && field.required && !value.trim()) {
        errors[field.id] = l10n.t('{0} is required.', field.label);
      }
    }
  }
  return { values, errors };
}

export function operationFormSubmitLabel(
  form: OperationFormDefinition,
  values: OperationFormValues,
): string {
  return form.checkedSubmitLabel && values[form.checkedSubmitLabel.field] === true
    ? form.checkedSubmitLabel.label : form.submitLabel;
}
