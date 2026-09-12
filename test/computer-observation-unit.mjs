import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  computerImageSha256,
  normalizeScreenshotProfile,
  prepareComputerObservation
} from '../src/computer/computerObservation.js';

const sourceBuffer = await sharp({
  create: {
    width: 2560,
    height: 1440,
    channels: 3,
    background: { r: 30, g: 60, b: 90 }
  }
}).png().toBuffer();
const source = {
  mimeType: 'image/png',
  data: sourceBuffer.toString('base64'),
  bytes: sourceBuffer.length,
  width: 2560,
  height: 1440
};

const balanced = await prepareComputerObservation(source, 'balanced');
assert.equal(balanced.profile, 'balanced');
assert.equal(balanced.image.width, 1600);
assert.equal(balanced.image.height, 900);
assert.equal(balanced.image.sourceWidth, 2560);
assert.equal(balanced.image.sourceHeight, 1440);
assert.equal(balanced.image.scaleX, 1.6);
assert.equal(balanced.image.scaleY, 1.6);
assert.ok(balanced.image.bytes < source.width * source.height * 4);
assert.equal(balanced.sourceSha256, computerImageSha256(source));

const fast = await prepareComputerObservation(source, 'fast');
assert.equal(fast.image.width, 1280);
assert.equal(fast.image.height, 720);
assert.equal(fast.image.scaleX, 2);
assert.equal(fast.image.scaleY, 2);

const detail = await prepareComputerObservation(source, 'detail');
assert.equal(detail.image.width, 2560);
assert.equal(detail.image.height, 1440);
assert.equal(detail.image.data, source.data);
assert.equal(detail.image.scaleX, 1);
assert.equal(detail.image.scaleY, 1);

assert.equal(normalizeScreenshotProfile(undefined), 'balanced');
assert.throws(() => normalizeScreenshotProfile('unknown'), /fast, balanced, or detail/);

console.log('Computer observations resize predictably, preserve source geometry, and expose stable source hashes.');
