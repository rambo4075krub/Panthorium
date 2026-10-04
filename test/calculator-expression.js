const assert = require('node:assert/strict');
const { evaluate } = require('../calculator-expression');

const cases = [
  ['1 + 2 * 3', 7],
  ['(1 + 2) * 3', 9],
  ['-5 + 2', -3],
  ['2×3 + 4÷2', 8],
  ['.5 + 1.25', 1.75],
  ['--4', 4],
  ['10 / 4', 2.5]
];
for (const [input, expected] of cases) assert.equal(evaluate(input), expected, input);

for (const input of ['', '1/0', '2(3+4)', '1+foo', '1/0', '1e999']) {
  assert.throws(() => evaluate(input), Error, input || 'empty expression');
}
console.log('Calculator expression tests passed: precedence, parentheses, signs, decimals, Unicode operators, and invalid input');
