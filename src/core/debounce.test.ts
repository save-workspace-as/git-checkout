import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { Debouncer } from './debounce';

describe('Debouncer', () => {
  it('invokes callback after delay and coalesces rapid calls', () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    const debouncer = new Debouncer(100);
    let count = 0;
    debouncer.schedule(() => {
      count += 1;
    });
    debouncer.schedule(() => {
      count += 1;
    });

    mock.timers.tick(99);
    assert.equal(count, 0);
    mock.timers.tick(1);
    assert.equal(count, 1);

    debouncer.dispose();
    mock.timers.reset();
  });

  it('dispose prevents pending callback', () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    const debouncer = new Debouncer(50);
    let ran = false;
    debouncer.schedule(() => {
      ran = true;
    });
    debouncer.dispose();
    mock.timers.tick(50);
    assert.equal(ran, false);

    mock.timers.reset();
  });
});
