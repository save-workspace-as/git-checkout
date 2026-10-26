import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { archiveArgs, archiveFormat, defaultArchiveName } from './archive';

describe('archive', () => {
  it('picks the format from the file name', () => {
    assert.equal(archiveFormat('/tmp/app.zip'), 'zip');
    assert.equal(archiveFormat('/tmp/app.tar.gz'), 'tar.gz');
    assert.equal(archiveFormat('/tmp/APP.TGZ'), 'tar.gz');
    assert.equal(archiveFormat('/tmp/app.tar'), 'tar');
    assert.equal(archiveFormat('/tmp/app'), 'zip');
  });

  it('puts everything under a folder named after the repository', () => {
    assert.deepEqual(archiveArgs('v1.2', '/tmp/app.tar.gz', 'app'), [
      'archive', '--format=tar.gz', '--prefix=app/', '-o', '/tmp/app.tar.gz', 'v1.2',
    ]);
  });

  it('names the file after the repository and the ref', () => {
    assert.equal(defaultArchiveName('/work/app', 'release/1.0'), 'app-release-1.0.zip');
    assert.equal(defaultArchiveName('/work/app', 'abcdef1'), 'app-abcdef1.zip');
    assert.equal(defaultArchiveName('/work/app', '///'), 'app-archive.zip');
  });
});
