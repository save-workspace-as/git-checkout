# Webview UI and UX guide

Read this before you add or change anything in `webview/` or its styles. It is self-contained: it says which control to use for each job, how to write a view, and how modals behave. Where it conflicts with habit or with another file, this file wins; where it is silent, follow VS Code. The repo-wide rules (tests, logging, wording, commits) are in [../AGENTS.md](../AGENTS.md).

References when something is not covered here: the VS Code Elements docs and examples (`https://vscode-elements.github.io/`, the `dev/` folder of `github.com/vscode-elements/elements`) and the Settings editor in VS Code itself.

## 1. Principles

1. **Native first.** Use what VS Code provides before building anything in a webview: commands, `view/title` and `webview/context` menus (`data-vscode-context`), Quick Pick, input boxes, notifications, tree views. A webview is only for what VS Code has no surface for: the commit graph and its search field, diffs, the forms and modals below.
2. **Elements for every control.** Anything a person clicks, types in or chooses is a VS Code Element (`@vscode-elements/elements`), never HTML and CSS drawn by hand. See section 4.
3. **Markup is not data.** A view is a Lit template over a state object (section 2).
4. **Same job, same control.** The same action looks, sits and is worded the same everywhere. Find the existing control first and reuse it. Do not restyle a copy.
5. **Theme tokens only.** Colors come from `--vscode-*` variables, fonts from VS Code's font variables. Nothing hard-coded.

## 2. How a view is written

- **A view is a template over a state object.** The markup is a Lit `html` template. The data is plain variables or one object that message handlers change. `paint()` renders the template from that data. Do not build a view with `document.createElement` chains. The only DOM calls left are the mount points a view draws into and off-screen canvases.
- **Handlers change state and call `paint()`.** They do not edit the DOM. Derived values (a disabled flag, a title, a class) are computed in the template from the state, never written onto elements afterwards.
- **Styles go through `styleMap`.** The page policy is `style-src ${cspSource} 'nonce-…'`, which blocks inline `style="…"`. Write `style=${styleMap({ … })}`. `src/panel/webviewElements.test.ts` fails on any other inline style.
- **Clear with `render(nothing, element)`.** Never `replaceChildren()` or `innerHTML = ''`: Lit remembers what it drew in an element, and a later render into emptied nodes shows nothing.
- **Inside an `<svg>`, nested fragments use the `svg` tag**, not `html`, or their elements are not SVG.
- **Directives:** `live()` for a value the user can also edit (inputs, checkboxes), `classMap` for classes, `repeat` with a key for lists, `unsafeHTML` only for text the extension already escaped.
- **Properties versus attributes:** set a value with a property binding (`.value=${…}`, `.checked=${live(…)}`), a switch with a boolean attribute (`?disabled=${…}`), text with an attribute.
- **Test on a real DOM.** `webview/testing/dom.ts` installs happy-dom (`installDom()`, `resetDom()`, `focus`, `optionsOf(select)`). Mount the view, send it the host's messages, read what it drew. Elements are plain, unregistered elements there, so assert on the properties and attributes the template sets, not on shadow DOM. Tests sit beside the code (`webview/**/*.test.ts`). Check that an element is absent with `assert.equal(element === null, true)`, never `assert.equal(element, null)`: when that fails the runner tries to print the whole DOM and can hang.
- **Every entry imports `./elements` and `installL10n` first.** `webview/elements.ts` registers the Elements; register a new tag there. Import an Element's class only as a type (`import type { VscodeTextfield } from '@vscode-elements/elements/dist/vscode-textfield/index.js'`) where you use it.
- **Webviews import only `webview/` and `src/shared/`**, never `vscode` or the rest of `src/`. `src/layering.test.ts` enforces it.

## 3. Page requirements

Every webview page the extension builds (`getWebviewHtml` and the bottom views) carries:

- the CSP above, with `img-src` limited to the extension and the optional avatar origin;
- `<link rel="stylesheet" href=…/styles.css>`;
- `<link rel="stylesheet" id="vscode-codicon-stylesheet" href=…/codicon.css nonce="${nonce}">`. Elements find their icons through the link with that exact id; the nonce lets the icon component copy the stylesheet into its shadow root;
- `<body data-l10n=…>` for translations.

`src/panel/webviewElements.test.ts` checks the link, the `./elements` import and that every created tag is registered.

## 4. Which Element for which job

Rule of thumb: find the job in this table. If a row exists, use it. If no row fits, say in the PR why no Element does and what you used.

### In use today

| Job | Element | How we use it |
|-----|---------|---------------|
| Text input | `vscode-textfield` | One line. `.value=${live(…)}`, `placeholder`, `?readonly`, `?required`, `?invalid`, `?disabled`. Icons go in `slot="content-before"` / `slot="content-after"` (the graph search puts its clear button in `content-after`). Enter in a text field submits its form. |
| Multi-line input | `vscode-textarea` | `rows`, `.value`. Enter adds a line, so the modal's Enter shortcut skips it. |
| Dropdown | `vscode-single-select` with `<vscode-option value ?selected description ?disabled>` children | Declare options as children in the template, never as an `.options` array. Mark the current one with `?selected`. A dropdown with no choices shows one disabled "None available" option. |
| Option inside a dropdown | `vscode-option` | `value`, `selected`, `disabled`, `description`. |
| Checkbox | `vscode-checkbox` | `label`, `.checked=${live(…)}`, `?indeterminate`, `?disabled`, `?invalid`. |
| Choice among options | `vscode-radio` in `vscode-radio-group` | `name`, `value`, `label`, `.checked`. `variant="vertical"` for stacked options. |
| Checkboxes that belong together | `vscode-checkbox-group` | Consecutive checkboxes are the options of one group (`variant="vertical"`). |
| Button | `vscode-button` | Filled by default, `secondary` for the quieter one. `type="submit"` for a form's main action, `type="button"` otherwise. `icon=` with `icon-only` for an icon-only button that may be disabled. |
| Actions that go together | `vscode-button-group` | For example Continue, Skip and Abort. Hide the whole group, never one button in it: the first and last button get the rounded ends. |
| Icon-only toolbar action | `vscode-toolbar-button` | `icon`, `label`, `title`. `toggleable` plus `checked` for a button that switches something on; listen to `change`. It has no `disabled`; use an icon-only `vscode-button` when you need one. |
| Standalone icon | `vscode-icon` | `<vscode-icon name="warning" aria-hidden="true">`. In code, `codicon(name)`, or `icon=${ACTION_ICONS.x}` on an Element from `webview/codicon.ts`. Never a hand-written `codicon` span. |
| Form layout | `vscode-form-container`, `vscode-form-group`, `vscode-label`, `vscode-form-helper` | See section 5. The helper is the description, between the label and the control. Validation stays a floating message so the dialog does not grow. |
| Row of toolbar buttons | `vscode-toolbar-container` | The diff toolbar's buttons sit inside it; the first button takes the free space so the row is right-aligned. |
| Progress | `vscode-progress-bar` | `value` and `max`, or `indeterminate`. |

### Available, not used yet

Use these when the job comes up, and add them to `webview/elements.ts` and, if they take focus, to the modal focus list (section 6). Check `dev/<element>/` in the Elements repo for a worked example first.

| Job | Element | Notes |
|-----|---------|-------|
| Count or status pill | `vscode-badge` | `variant`: `default`, `counter`, `activity-bar-counter`, `tab-header-counter`. It cannot take a per-kind color, so the graph's colored ref pills stay custom. |
| Divider line | `vscode-divider` | Between groups in a toolbar or a section. |
| Collapsible section | `vscode-collapsible` | `heading`, `description`, `open`; slots `actions` and `decorations`; event `vsc-collapsible-toggle`. |
| Tabs | `vscode-tabs`, `vscode-tab-header`, `vscode-tab-panel` | The bottom tabs are native views; use these only for tabs inside one webview. |
| Spinner | `vscode-progress-ring` | A busy indicator that is not a bar. |
| Multi-select dropdown | `vscode-multi-select` | With `vscode-option` children. |
| Custom scrollbar | `vscode-scrollable` | Only if the native scrollbar is wrong. |
| Resizable split | `vscode-split-layout` | No keyboard resizing; do not use for anything a person must be able to resize without a mouse. |
| Context menu | `vscode-context-menu`, `vscode-context-menu-item` | Do not use. Context menus are VS Code's, through `data-vscode-context`. |
| Data grid | `vscode-table` (+ `-header`, `-header-cell`, `-body`, `-row`, `-cell`) | A wide, many-column grid. It stacks its cells below its `breakpoint`, has no row selection, keyboard navigation or virtual scrolling. A spike on the History list failed (narrow pane, avatars, row buttons); not for lists. |
| Hierarchy | `vscode-tree`, `vscode-tree-item` | A real tree with expand/collapse. The sidebar tree is native; none of our lists is hierarchical. |

### Native HTML that stays

Only where there is no Element, and each use says why:

- link-style buttons that read as text inside a sentence (GitHub references, parent hashes);
- `input type="range"` (image-diff sliders);
- the commit graph, its virtual rows and the rebase, History and Blame rows (hand-built lists with virtual scrolling, multi-select, drag-reorder, avatars);
- the submodule commit `<ul>`.

Adding another needs a sentence in the PR on why no Element fits.

## 5. Forms

- **Reuse the shared operation form and modal** (`webview/forms/`) for any multi-field Git operation. Do not introduce another modal or per-operation control styling. A host declares the form as data (`OperationFormDefinition` in `src/shared/forms/operationForm.ts`, builders in `src/panel/operationForms.ts`); the webview only renders it.
- **Structure.** Fields sit in one `vscode-form-container`. Each field is a `vscode-form-group variant="settings-group"`. Its children are direct, in the order the element documents: `vscode-label`, then `vscode-form-helper` when the field has a description, then the control. Do not wrap the control in another element; the group only places what is slotted. A button that belongs to a text field (Browse, Test connection) goes in that field's `content-after` slot. A choice among options is a `vscode-radio-group`, and the label's `for` points at that group. Every checkbox sits in a `vscode-checkbox-group`. A checkbox with its own description is its own row: the label is the title, and the description is the text beside the box. Checkboxes without their own description that follow one another are one group, under their `group` title when they share one. Actions that go together are one `vscode-button-group`. A field's explanation is a `vscode-form-helper` containing a paragraph, between the label and the control. A notice is a `vscode-form-helper` in its own settings group, and the submit button is a settings group too, so every row shares the group's inset. There is no description under the dialog title.
- **Spacing comes from the elements.** A `settings-group` pads itself the way a Settings row does. Do not add padding or margin to line a screen up. The dialog body of an operation form has no padding of its own.
- **Anatomy, top to bottom:** optional notice (icon plus text; warning or success), fields, then the submit button. A field's explanation belongs on the field. The title names the action ("Create Branch"). The submit button repeats the title's verb ("Create"), never "Submit". There is no Cancel button: the close button, Escape and the backdrop dismiss.
- **A radio option's detail goes in its label** ("Soft: keep all changes, stage differences"); the Elements radio has no description line. The field's own description is the helper under its title.
- **Validation** shows under its control, floats without growing the modal, and sets `?invalid` on the control. The submit button is disabled while any error shows. While a form is `busy`, every control and the close button are disabled.
- **Read-only values** (a branch name, a revision) are a `vscode-textfield` with `?readonly`, not plain text.

## 6. Modals

All modals (operation forms, interactive rebase, History) are built by `createModalShell` in `webview/modalShell.ts`: overlay, backdrop, dialog, header (title, optional extras, close button), notes line and body. Do not build another frame.

Behavior the shell guarantees, so a modal adds no key handling of its own:

- **Escape and the close button and a backdrop click dismiss** (`onDismiss`). While a form is busy, dismissal is blocked.
- **Enter presses the main action:** the first filled (not `secondary`), enabled, visible `vscode-button` that is not icon-only. So mark a modal's other buttons `secondary`. Enter is left alone on buttons (they press themselves), dropdowns (they open), text areas (a new line) and the reword editor `<dialog>` (it saves with Ctrl/Cmd+Enter). Enter from a text field is taken over so a form is not submitted twice.
- **Tab is trapped** inside the dialog. The trap's selector (`FOCUSABLE` in `modalShell.ts`) lists the focusable tags. **Add any new Element tag that takes focus there**, because its focus lives in a shadow root. `webviewElements.test.ts` fails when one is missing.
- **The rest of the page is `inert` while a modal is open**, and focus returns to what had it when the modal closes.
- **Header.** Title only, no logo. The close button is an icon-only `vscode-button` with the `close` icon. A modal's own header controls go in the `extras` slot, a line of text under the header in `notes`.
- **A reopened modal must draw again.** Clear a modal body with `render(nothing, …)` (section 2); there is a regression test.

Verify any modal change on **all three surfaces** (operation forms, interactive rebase, History), wide and narrow, in dark, light and high-contrast themes.

## 7. Styling

- **Size an Element with layout only:** `flex`, `width`, `min-width`, `display`, `gap`. Do not override its padding, border, color, height or focus outline. When an Element lacks a state, use its documented CSS custom properties or `::part`.
- **Settings-based metrics come from the Elements:** 26px minimum control height, 4px radius, 18px checkbox. Do not restate them in `webview/styles.css`.
- **Text inherits VS Code's font:** `--vscode-font-family`, `--vscode-font-size`, `--vscode-font-weight` for UI; the `--vscode-editor-font-*` variables for code and diffs. Do not set custom `font-size`, `font-weight` (headings may use 600), `line-height`, `text-transform` or `letter-spacing`, and add no custom font stacks.
- **Colors are `--vscode-*` variables** (`descriptionForeground` for secondary text, `list-*` for selection, `panel-border` for lines). No hex values except as a `var()` fallback.
- **Spacing values to reuse:** modal header `12px 14px`, modal body `12px 14px 18px`, row gap `9px`. Do not add new ones.
- **Hide with `visibility`, not removal,** for icon buttons that appear on hover or selection, so nothing shifts. Hidden whole groups use the `hidden` class.
- **Layout rules live in `webview/styles.css`;** `media/webview/styles.css` is generated from it by `npm run compile` (with the icon font); do not edit or hand-copy it.

## 8. Icons

- Codicons only, never hand-drawn SVG paths. Each action has one icon in `src/shared/app/actionIcons.ts` and every place that offers it uses it: `package.json` command `icon` (`$(name)`), and in webviews `codicon()` or `icon=${ACTION_ICONS.x}` on an Element. A new action gets a new entry with an icon no other action uses; `src/shared/app/actionIcons.test.ts` maps each iconed command to its action.
- File and folder rows show the user's file icon theme; the codicons `file` and `folder` are only the fallback.
- **Placement:** an icon button sits at the end of its row or toolbar, always in the same order: row actions (stage, unstage, discard) before open, then the status badge. Icon buttons are 16px glyphs. Toolbars right-align their buttons and toggle with `aria-pressed` / `checked`.

## 9. Diff options

Every diff view in the bottom panel (Commit's Changes, Changes' Diff, Tree's Preview) has its options as buttons in the native view header, from the `gitCheckout.diff.*` commands in `view/title`; a button that switches something on uses `toggled`. The History modal has no native header, so it uses the shared toolbar in `webview/details/diffToolbar.ts` with the same icons, labels and order. Do not add another in-webview toolbar for a view that has a header.

## 10. Wording and localization

- Every string a person can read goes through `l10n.t('…', args)` with a literal first argument (`import * as l10n from '@vscode/l10n'`), placeholders instead of concatenation. Run `npm run l10n:export` after changing one and commit `l10n/bundle.l10n.json`.
- Labels, placeholders and buttons are sentence case ("Test connection"); titles name the action ("Create Tag"); a submit button repeats its title's verb. A menu item that opens a form ends with "…"; one that acts at once does not; creating items start with "New".
- American English; "Checkout" as one word; Git terms as in the Git docs (commit message with subject and body, hash, upstream branch, working tree, index, stash entry with apply, pop and drop). The full list is in [../AGENTS.md](../AGENTS.md).

## 11. Accessibility

- Every control has a visible label or an `aria-label`. Icon-only controls always have both `label`/`aria-label` and `title`.
- Lists that keyboard users move through are one tab stop with arrow keys inside (`role="listbox"`, `aria-selected`), like VS Code's own lists.
- Validation text is in an `aria-live` region and linked from the control by `aria-describedby`.
- Never rely on color alone for state; combine it with an icon or text. Check high-contrast themes.

## 12. Examples

Every snippet below is how the code does it today. Copy the shape.

**A view: template over state, one `paint()`**

```ts
export function mountThingView(container: HTMLElement, post: (message: ThingWebviewMessage) => void) {
  render(nothing, container);          // clear what a previous view drew
  let items: ThingDto[] = [];          // the data
  let selected: string | null = null;

  const rowTemplate = (item: ThingDto): TemplateResult => html`
    <div class=${classMap({ row: true, selected: item.id === selected })}
      style=${styleMap({ height: `${ROW_HEIGHT}px` })}
      @click=${() => { selected = item.id; post({ type: 'thingSelect', id: item.id }); paint(); }}>
      ${item.name}
    </div>`;

  const paint = (): void => render(html`${repeat(items, (item) => item.id, rowTemplate)}`, container);

  return {
    applyHostMessage(message: ThingHostMessage) {   // a handler changes state, then paints
      if (message.type === 'thingItems') { items = message.items; paint(); }
    },
  };
}
```

**A form field: label, control, error (`operationFormView.ts`)**

```ts
html`
  <vscode-form-group class="operation-form-field" variant="settings-group">
    <vscode-label for="name-0">${l10n.t('Branch name')}</vscode-label>
    <vscode-textfield id="name-0" name="name" autocomplete="off" spellcheck="false"
      .value=${live(String(values.name ?? ''))} ?invalid=${Boolean(errors.name)} ?disabled=${busy}
      aria-describedby="error-name" @input=${onInput}></vscode-textfield>
    <p id="error-name" class=${classMap({ 'operation-form-error': true, hidden: !errors.name })}
      aria-live="polite">${errors.name ?? ''}</p>
  </vscode-form-group>`
```

**A dropdown: options are children, the current one is `selected`**

```ts
html`
  <vscode-single-select .value=${live(current)} ?disabled=${choices.length === 0}
    @change=${(event: Event) => { current = (event.target as VscodeSingleSelect).value; paint(); }}>
    ${choices.map((entry) => html`
      <vscode-option value=${entry.value} description=${entry.hint ?? ''} ?selected=${entry.value === current}
        >${entry.label}</vscode-option>`)}
  </vscode-single-select>`
```

**Checkboxes and radios are grouped**

```ts
html`
  <vscode-checkbox-group variant="vertical">
    <vscode-checkbox label=${l10n.t('Update dependent branches')} .checked=${live(values.update === true)}
      @change=${(event: Event) => { values.update = (event.target as VscodeCheckbox).checked; update(); }}></vscode-checkbox>
    <vscode-checkbox label=${l10n.t('Stash and reapply local changes')} .checked=${live(values.stash === true)}
      @change=${…}></vscode-checkbox>
  </vscode-checkbox-group>

  <vscode-radio-group variant="vertical">
    ${options.map((option) => html`
      <vscode-radio name="mode" value=${option.value} label=${option.label}
        .checked=${live(values.mode === option.value)}
        @change=${(event: Event) => { values.mode = (event.target as VscodeRadio).value; update(); }}></vscode-radio>`)}
  </vscode-radio-group>`
```

**Buttons: the main action, the quiet one, and a group**

```ts
html`
  <vscode-button type="submit" ?disabled=${busy || hasErrors}>${l10n.t('Create')}</vscode-button>   <!-- Enter presses this -->
  <vscode-button type="button" secondary @click=${pick}>${l10n.t('Browse…')}</vscode-button>

  <vscode-button-group class=${classMap({ hidden: !inProgress })}>   <!-- hide the whole group, never one button -->
    <vscode-button type="button" secondary @click=${() => post({ type: 'rebaseContinue' })}>${l10n.t('Continue')}</vscode-button>
    <vscode-button type="button" secondary @click=${() => post({ type: 'rebaseSkip' })}>${l10n.t('Skip')}</vscode-button>
    <vscode-button type="button" secondary @click=${() => post({ type: 'rebaseAbort' })}>${l10n.t('Abort')}</vscode-button>
  </vscode-button-group>`
```

**Icons**

```ts
html`
  <vscode-icon name="warning" aria-hidden="true"></vscode-icon>
  <vscode-button type="button" icon=${ACTION_ICONS.generateMessage} icon-only
    title=${l10n.t('Generate message')} aria-label=${l10n.t('Generate message')}></vscode-button>
  <vscode-toolbar-button icon=${ACTION_ICONS[entry.icon]} label=${entry.label} title=${entry.label}
    .toggleable=${entry.pressed !== undefined} .checked=${isOn}   <!-- a button that switches something on -->
    @click=${() => onOption(entry.option)}></vscode-toolbar-button>`
```

**A text field with a clear button inside it (`graphView.ts`)**

```ts
html`
  <vscode-textfield class="graph-search" placeholder=${l10n.t('Search hash, author, or message')}
    aria-label=${l10n.t('Search commits')} .value=${live(searchText)} @input=${onSearchInput}>
    <vscode-toolbar-button slot="content-after" icon="close" label=${l10n.t('Clear search')}
      @click=${clearSearch}></vscode-toolbar-button>
  </vscode-textfield>`
```

**Progress**

```ts
html`<vscode-progress-bar max="100" aria-label=${l10n.t('Progress')} .value=${Math.round(fraction * 100)}></vscode-progress-bar>`
```

**A modal: the shell gives Escape, Enter, Tab trap and inert background**

```ts
const modal = createModalShell(shell, {
  className: 'history-modal',
  title: l10n.t('History'),
  onDismiss: () => { post({ type: 'pathHistoryClose' }); modal.hide(); },
});
render(html`<vscode-checkbox label=${l10n.t('Include merges')} …></vscode-checkbox>`, modal.extras); // header controls
render(html`<div class="history-status">${summary}</div>`, modal.notes);                               // line under the header
render(html`…the body…`, modal.body);
modal.show();   // later: modal.hide(), which also restores focus
```

**A test on the real DOM (`webview/**/*.test.ts`)**

```ts
import { installDom, resetDom, optionsOf } from '../testing/dom';
// Elements are plain elements here: assert on the properties and attributes the template sets.
const select = container.querySelector('vscode-single-select')!;
assert.deepEqual(optionsOf(select).map((option) => option.value), ['main', 'develop']);
assert.equal(container.querySelector('vscode-button[type="submit"]')!.hasAttribute('disabled'), true);
```

**Do not**

```ts
const button = document.createElement('button');              // an Element: <vscode-button>
element.setAttribute('style', 'width: 10px');                 // blocked by the CSP: styleMap({ width: '10px' })
container.replaceChildren();                                  // Lit forgets nothing: render(nothing, container)
select.options = choices.map(…);                              // declare <vscode-option> children in the template
html`<span class="codicon codicon-warning"></span>`;          // <vscode-icon name="warning">
```

## 13. Checklist before you finish

- [ ] The control is an Element from section 4 (examples in section 12), or the PR says why not.
- [ ] The view is a template over state; handlers only change state and call `paint()`.
- [ ] No inline `style="…"`; no hard-coded colors or fonts; no overrides of an Element's own metrics.
- [ ] New tags are registered in `webview/elements.ts` and, if focusable, in the `FOCUSABLE` list.
- [ ] Same job, same control, same icon, same wording as everywhere else.
- [ ] Strings use `l10n.t`; `npm run l10n:export` run.
- [ ] A test on the real DOM for the behavior; `npm run lint`, `test:unit`, and `test:e2e` for a flow users drive.
- [ ] Looked at it in a browser harness or a real window, in dark and light themes, wide and narrow.
