const path = require('path');
const rulesPath = path.resolve(__dirname, '../../../js/rules.js');
const { XiangqiGame, RED, BLACK } = require(rulesPath);

module.exports = {
    XiangqiGame,
    RED,
    BLACK
};
