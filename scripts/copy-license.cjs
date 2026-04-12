const { copyFileSync } = require('fs');
const { join } = require('path');

copyFileSync(join(__dirname, '..', 'LICENSE'), 'LICENSE');
