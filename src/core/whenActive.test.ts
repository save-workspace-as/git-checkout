import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Activity, keepEverythingActive, whenActive } from './whenActive';

describe('whenActive', () => {
  it('runs a task at once while the activity holds', () => {
    let on = true;
    const activity = new Activity(() => on);
    let runs = 0;
    const gate = whenActive(() => { runs += 1; }, () => activity.active, activity.onDidBecomeActive);
    gate.request();
    gate.request();
    assert.equal(runs, 2);
    on = false;
    gate.dispose();
  });

  it('remembers the asks while it does not hold, and runs once when it does again', () => {
    let on = false;
    const activity = new Activity(() => on);
    let runs = 0;
    const gate = whenActive(() => { runs += 1; }, () => activity.active, activity.onDidBecomeActive);
    gate.request();
    gate.request();
    gate.request();
    assert.equal(runs, 0);
    activity.changed();
    assert.equal(runs, 0, 'a change that leaves it off runs nothing');
    on = true;
    activity.changed();
    assert.equal(runs, 1);
    activity.changed();
    assert.equal(runs, 1, 'and nothing is asked for again');
    gate.dispose();
  });

  it('runs nothing for a view that nobody asked about', () => {
    let on = false;
    const activity = new Activity(() => on);
    let runs = 0;
    const gate = whenActive(() => { runs += 1; }, () => activity.active, activity.onDidBecomeActive);
    on = true;
    activity.changed();
    assert.equal(runs, 0);
    gate.dispose();
  });

  it('stops listening once disposed', () => {
    let on = false;
    const activity = new Activity(() => on);
    let runs = 0;
    const gate = whenActive(() => { runs += 1; }, () => activity.active, activity.onDidBecomeActive);
    gate.request();
    gate.dispose();
    on = true;
    activity.changed();
    assert.equal(runs, 0);
  });

  it('can be forced on, whatever the parts say', () => {
    const activity = new Activity(() => false);
    let runs = 0;
    const gate = whenActive(() => { runs += 1; }, () => activity.active, activity.onDidBecomeActive);
    keepEverythingActive(true);
    try {
      gate.request();
      assert.equal(runs, 1);
    } finally {
      keepEverythingActive(false);
      gate.dispose();
    }
  });
});
