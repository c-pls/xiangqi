const crypto = require('crypto');

// Crockford Base32 alphabet: excludes 0, O, 1, I, L
const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generateRoomCode(length = 6) {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CHARSET[bytes[i] % CHARSET.length];
    }
    return code;
}

function normalizeRoomCode(code) {
    if (typeof code !== 'string') return '';
    return code
        .trim()
        .toUpperCase()
        .replace(/0/g, 'O') // Normalization in case user typed 0 or 1
        .replace(/1/g, 'I');
}

module.exports = {
    generateRoomCode,
    normalizeRoomCode,
    CHARSET
};
