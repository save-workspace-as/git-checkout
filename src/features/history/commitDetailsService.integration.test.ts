import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_COMMIT_DIFF_VIEW } from '../../shared/diff/commitDiffPresentation';
import { CommitDetailsService } from './commitDetailsService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('CommitDetailsService git diff-tree', () => {
  it('lists added, modified, and renamed files and resolves the parent', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'a\n');
      writeFileSync(join(repo.repoRoot, 'keep.txt'), 'keep\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'init']);

      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const root = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      assert.equal(await service.resolveParent(repo.repoRoot, root), null);
      const created = await service.listFiles(repo.repoRoot, root);
      assert.deepEqual(
        created.map((file) => file.status.charAt(0) + ' ' + file.path).sort(),
        ['A a.txt', 'A keep.txt'],
      );

      writeFileSync(join(repo.repoRoot, 'a.txt'), 'b\n');
      runGit(repo.repoRoot, ['add', 'a.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'edit']);
      const edited = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      assert.equal(await service.resolveParent(repo.repoRoot, edited), root);
      assert.deepEqual(await service.listFiles(repo.repoRoot, edited), [
        { status: 'M', path: 'a.txt' },
      ]);

      runGit(repo.repoRoot, ['mv', 'a.txt', 'renamed.txt']);
      // runGit joins arguments for the shell, so a bare # would be a comment.
      runGit(repo.repoRoot, ['commit', '-m', 'rename', '-m', '"Fixes #9"']);
      assert.equal(await service.readBody(repo.repoRoot, 'HEAD'), 'Fixes #9');
      const renamed = await service.listFiles(repo.repoRoot, 'HEAD');
      assert.equal(renamed.length, 1);
      assert.equal(renamed[0]?.path, 'renamed.txt');
      assert.equal(renamed[0]?.oldPath, 'a.txt');
      assert.match(renamed[0]?.status ?? '', /^R/);
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService between two commits', () => {
  it('lists and diffs everything that changed from the older commit to the newer one', async () => {
    const repo = initTempRepository();
    try {
      const head = async () => (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'one\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'one']);
      const older = await head();
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'two\n');
      writeFileSync(join(repo.repoRoot, 'b.txt'), 'new\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'two']);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'three\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'three']);
      const newer = await head();

      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const files = await service.listFilesBetween(repo.repoRoot, older, newer);
      assert.deepEqual(files.map((file) => `${file.status} ${file.path}`).sort(), ['A b.txt', 'M a.txt']);
      const diff = await service.diffFileBetween(repo.repoRoot, older, newer, 'a.txt');
      assert.deepEqual(
        diff.lines.filter((line) => line.kind === 'add' || line.kind === 'del').map((line) => `${line.kind} ${line.text}`),
        ['del one', 'add three'],
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService binary preview', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('describes an image on both sides and a plain binary file as binary', async () => {
    const repo = initTempRepository();
    try {
      const head = async () => (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      writeFileSync(join(repo.repoRoot, 'logo.png'), PNG);
      writeFileSync(join(repo.repoRoot, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'add']);
      const added = await head();
      writeFileSync(join(repo.repoRoot, 'logo.png'), Buffer.concat([PNG, Buffer.from([0])]));
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'change']);
      const changed = await head();

      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const created = await service.binaryPreview(repo.repoRoot, null, added, 'logo.png');
      assert.equal(created.nonTextKind, 'image');
      assert.deepEqual(created.blobs?.map((blob) => [blob.side, blob.byteLength]), [['old', 0], ['new', PNG.length]]);
      assert.equal(created.blobs?.[1].mimeType, 'image/png');
      assert.equal(created.blobs?.[1].inline?.dataBase64, PNG.toString('base64'));

      const modified = await service.binaryPreview(repo.repoRoot, added, changed, 'logo.png');
      assert.deepEqual(modified.blobs?.map((blob) => blob.byteLength), [PNG.length, PNG.length + 1]);

      const plain = await service.binaryPreview(repo.repoRoot, null, added, 'blob.bin');
      assert.equal(plain.nonTextKind, 'binary');
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService diff view options', () => {
  it('applies whitespace, context and full-file options through git', async () => {
    const repo = initTempRepository();
    try {
      const body = Array.from({ length: 40 }, (_, i) => `line ${i}`);
      writeFileSync(join(repo.repoRoot, 'a.txt'), `${body.join('\n')}\n`);
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'one']);
      const edited = [...body];
      edited[20] = '  line 20';
      edited[30] = 'changed 30';
      writeFileSync(join(repo.repoRoot, 'a.txt'), `${edited.join('\n')}\n`);
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'two']);
      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const changes = (view: Partial<typeof DEFAULT_COMMIT_DIFF_VIEW>) =>
        service
          .diffFile(repo.repoRoot, 'HEAD', 'a.txt', { ...DEFAULT_COMMIT_DIFF_VIEW, ...view })
          .then(({ lines }) => ({
            changed: lines.filter((line) => line.kind === 'add').map((line) => line.text),
            context: lines.filter((line) => line.kind === 'context').length,
          }));

      assert.deepEqual((await changes({})).changed, ['  line 20', 'changed 30']);
      assert.deepEqual((await changes({ ignoreWhitespace: true })).changed, ['changed 30']);
      const narrow = await changes({ contextLines: 1 });
      const wide = await changes({ contextLines: 6 });
      assert.ok(narrow.context < wide.context);
      assert.equal((await changes({ fullFile: true })).context, 38);
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService renamed files', () => {
  it('shows the content change of a renamed file when given both paths', async () => {
    const repo = initTempRepository();
    try {
      const body = Array.from({ length: 12 }, (_, i) => `line ${i}`);
      writeFileSync(join(repo.repoRoot, 'old.txt'), `${body.join('\n')}\n`);
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'one']);
      runGit(repo.repoRoot, ['mv', 'old.txt', 'new.txt']);
      writeFileSync(join(repo.repoRoot, 'new.txt'), `${body.join('\n').replace('line 5', 'line five')}\n`);
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'rename-and-edit']);
      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const changed = async (oldPath?: string) =>
        (await service.diffFile(repo.repoRoot, 'HEAD', 'new.txt', DEFAULT_COMMIT_DIFF_VIEW, oldPath)).lines
          .filter((line) => line.kind === 'add' || line.kind === 'del')
          .map((line) => `${line.kind} ${line.text}`);
      assert.deepEqual(await changed(), ['add line 0', 'add line 1', 'add line 2', 'add line 3', 'add line 4', 'add line five', 'add line 6', 'add line 7', 'add line 8', 'add line 9', 'add line 10', 'add line 11']);
      assert.deepEqual(await changed('old.txt'), ['del line 5', 'add line five']);
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService working copy', () => {
  it('diffs staged, unstaged and untracked files', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'one\ntwo\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'init']);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'one\nTWO\n');
      runGit(repo.repoRoot, ['add', 'a.txt']);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'one\nTWO\nthree\n');
      writeFileSync(join(repo.repoRoot, 'new.txt'), 'x\ny\n');
      writeFileSync(join(repo.repoRoot, 'blob.bin'), Buffer.from([0, 1, 2]));

      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const changed = async (side: 'staged' | 'unstaged', path: string, untracked = false) =>
        (await service.diffWorkingFile(repo.repoRoot, path, side, untracked)).lines
          .filter((line) => line.kind === 'add' || line.kind === 'del')
          .map((line) => `${line.kind} ${line.text}`);

      assert.deepEqual(await changed('staged', 'a.txt'), ['del two', 'add TWO']);
      assert.deepEqual(await changed('unstaged', 'a.txt'), ['add three']);
      assert.deepEqual(await changed('unstaged', 'new.txt', true), ['add x', 'add y']);
      assert.equal((await service.diffWorkingFile(repo.repoRoot, 'blob.bin', 'unstaged', true)).binary, true);
    } finally {
      repo.cleanup();
    }
  });
});

describe('CommitDetailsService.readImage with real git', () => {
  // A real 1x1 PNG, so the bytes git stores are binary, with a NUL and bytes over 0x7f.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('reads a committed picture byte for byte at a revision, and not a file that only has its name', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'logo.png'), png);
      writeFileSync(join(repo.repoRoot, 'fake.png'), 'not a picture\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', '"add pictures"']);
      writeFileSync(join(repo.repoRoot, 'logo.png'), Buffer.concat([png, Buffer.from([0])]));
      runGit(repo.repoRoot, ['commit', '-am', '"change the picture"']);

      const service = new CommitDetailsService(mockCliRegistry(repo.repoRoot, repo.cli));
      const first = await service.readImage(repo.repoRoot, 'HEAD~1', 'logo.png');
      assert.equal(first?.kind, 'image');
      assert.equal(first?.kind === 'image' ? first.mimeType : '', 'image/png');
      assert.deepEqual(first?.kind === 'image' ? Buffer.from(first.bytes) : undefined, png);
      const second = await service.readImage(repo.repoRoot, 'HEAD', 'logo.png');
      assert.equal(second?.kind === 'image' ? second.bytes.length : 0, png.length + 1);

      assert.equal(await service.readImage(repo.repoRoot, 'HEAD', 'fake.png'), undefined);
      assert.equal(await service.readImage(repo.repoRoot, 'HEAD', 'missing.png'), undefined);
    } finally {
      repo.cleanup();
    }
  });
});
