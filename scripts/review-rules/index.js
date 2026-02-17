const securityRules = require('./security');
const performanceRules = require('./performance');
const costRules = require('./cost');

const allRules = [
  ...securityRules.map(r => ({ ...r, category: 'security' })),
  ...performanceRules.map(r => ({ ...r, category: 'performance' })),
  ...costRules.map(r => ({ ...r, category: 'cost' })),
];

module.exports = { allRules, securityRules, performanceRules, costRules };
