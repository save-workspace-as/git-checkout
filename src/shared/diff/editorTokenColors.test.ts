import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  editorTokenColorsFromRules,
  selectTokenCustomization,
  type TokenColorRule,
} from './editorTokenColors';

const rules: TokenColorRule[] = [
  { settings: { foreground: '#D4D4D4' } },
  { scope: 'keyword', settings: { foreground: '#569CD6' } },
  { scope: 'keyword.control', settings: { foreground: '#C586C0' } },
  { scope: ['string', 'punctuation.definition.string'], settings: { foreground: '#CE9178' } },
  { scope: 'constant.numeric', settings: { foreground: '#B5CEA8' } },
  {
    scope: 'comment, punctuation.definition.comment',
    settings: { foreground: '#6A9955', fontStyle: 'italic' },
  },
  { scope: 'entity.name.function', settings: { foreground: '#DCDCAA' } },
  { scope: 'entity.name.type', settings: { foreground: '#4EC9B0' } },
  { scope: 'variable', settings: { foreground: '#9CDCFE' } },
  { scope: 'variable.other.readwrite', settings: { foreground: '#FFFFFF' } },
];

describe('editorTokenColorsFromRules', () => {
  it('uses the last rule whose scope covers each token', () => {
    const colors = editorTokenColorsFromRules(rules, '#CCCCCC');
    assert.equal(colors.foreground, '#CCCCCC');
    assert.equal(colors.keyword, '#569CD6');
    assert.equal(colors.string, '#CE9178');
    assert.equal(colors.number, '#B5CEA8');
    assert.equal(colors.comment, '#6A9955');
    assert.equal(colors.commentStyle, 'italic');
    assert.equal(colors.function, '#DCDCAA');
    assert.equal(colors.type, '#4EC9B0');
    assert.equal(colors.variable, '#9CDCFE');
  });

  it('lets token color customizations override the theme', () => {
    const colors = editorTokenColorsFromRules(rules, '#CCCCCC', {
      comments: '#FF0000',
      textMateRules: [{ scope: 'keyword', settings: { foreground: '#00FF00' } }],
    });
    assert.equal(colors.comment, '#FF0000');
    assert.equal(colors.keyword, '#00FF00');
  });

  it('falls back to the editor foreground variable when the theme has no color', () => {
    const colors = editorTokenColorsFromRules([], undefined);
    assert.equal(colors.keyword, 'var(--vscode-editor-foreground)');
    assert.equal(colors.commentStyle, 'normal');
  });
});

describe('selectTokenCustomization', () => {
  it('prefers the block for the active theme name', () => {
    const selected = selectTokenCustomization(
      {
        comments: '#111111',
        '[Dark Modern]': { comments: '#222222', keywords: '#333333' },
      },
      'Dark Modern',
    );
    assert.equal(selected?.comments, '#222222');
    assert.equal(selected?.keywords, '#333333');
  });
});
