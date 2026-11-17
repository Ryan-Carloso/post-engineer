import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessShardCoverage } from './check-shard-coverage.mjs';

const total = 4;

describe('assessShardCoverage', () => {
  it('accepts an empty report only when every shard selected nothing', () => {
    const result = assessShardCoverage({
      markers: [1, 2, 3, 4].map((shard) => ({ shard, selected: 0 })),
      coverageShards: [],
      total,
    });
    assert.equal(result.ok, true);
  });

  it('fails when a shard that ran tests did not upload coverage', () => {
    const result = assessShardCoverage({
      markers: [
        { shard: 1, selected: 12 },
        { shard: 2, selected: 0 },
        { shard: 3, selected: 4 },
        { shard: 4, selected: 0 },
      ],
      coverageShards: [1],
      total,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /shard 3 selected 4/);
  });

  it('fails when a marker is missing', () => {
    const result = assessShardCoverage({
      markers: [{ shard: 1, selected: 3 }],
      coverageShards: [1],
      total,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /expected 4 shard markers/);
  });

  it('passes when every shard that ran uploaded coverage', () => {
    const result = assessShardCoverage({
      markers: [
        { shard: 1, selected: 10 },
        { shard: 2, selected: 10 },
        { shard: 3, selected: 10 },
        { shard: 4, selected: 10 },
      ],
      coverageShards: [4, 2, 1, 3],
      total,
    });
    assert.equal(result.ok, true);
  });
});
