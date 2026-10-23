const assert = require('node:assert/strict');
const qs = require('qs');

// GHSA-x5fp-wj9c-mxmx: brackets must not bypass comma-array limits.
assert.throws(() => qs.parse('items[]=1,2,3,4', {
  comma: true, arrayLimit: 3, throwOnLimitExceeded: true
}), /Array limit exceeded/);

// GHSA-4mjr-xmp4-gh2g: untrusted constructor properties must not be called.
const untrusted = qs.parse('item[constructor][isBuffer]=not-a-function', { plainObjects: true });
assert.equal(qs.stringify(untrusted), 'item%5Bconstructor%5D%5BisBuffer%5D=not-a-function');
assert.deepEqual(qs.parse('tag=one&tag=two'), { tag: ['one', 'two'] });
console.log('Dependency security: array limits and hostile-object serialization passed');
