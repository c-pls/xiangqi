const crypto = require('crypto');

function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .trim();
}

function cleanPlainUsername(str) {
    if (typeof str !== 'string') return '';
    // Strip control characters and HTML tags entirely for plain usernames
    return str.replace(/[<>'"&]/g, '').trim();
}

class SessionStore {
    constructor() {
        this.sessions = new Map(); // sessionToken -> { userId, username, lastSeen }
        this.usernameToToken = new Map(); // lowerUsername -> sessionToken
    }

    get(token) {
        return this.sessions.get(token);
    }

    createOrUpdate(username, token) {
        const cleanName = cleanPlainUsername(username);
        const lowerName = cleanName.toLowerCase();

        // If client provided a valid existing token
        if (token && this.sessions.has(token)) {
            const existing = this.sessions.get(token);
            // If user wishes to update their username
            if (cleanName && cleanName !== existing.username) {
                // Ensure new username isn't taken by someone else
                const owner = this.usernameToToken.get(lowerName);
                if (owner && owner !== token) {
                    return { success: false, error: 'Username is already taken' };
                }
                this.usernameToToken.delete(existing.username.toLowerCase());
                existing.username = cleanName;
                this.usernameToToken.set(lowerName, token);
            }
            existing.lastSeen = Date.now();
            return {
                success: true,
                user: { userId: existing.userId, username: existing.username, sessionToken: token }
            };
        }

        // New session: Check username uniqueness among registered sessions
        const existingToken = this.usernameToToken.get(lowerName);
        if (existingToken && this.sessions.has(existingToken)) {
            return { success: false, error: 'Username is already in use by an active player' };
        }

        const sessionToken = token || crypto.randomBytes(24).toString('hex');
        const userId = 'u_' + crypto.randomBytes(6).toString('hex');
        const sessionData = { userId, username: cleanName, lastSeen: Date.now() };

        this.sessions.set(sessionToken, sessionData);
        this.usernameToToken.set(lowerName, sessionToken);

        return {
            success: true,
            user: { userId, username: cleanName, sessionToken }
        };
    }

    removeSession(token) {
        const session = this.sessions.get(token);
        if (session) {
            this.usernameToToken.delete(session.username.toLowerCase());
            this.sessions.delete(token);
        }
    }
}

const defaultSessionStore = new SessionStore();

/**
 * Pluggable authenticate function.
 * Designed to be replaced with SSO / OAuth (e.g. OIDC, SAML, JWT) in the future.
 */
async function authenticate(username, sessionToken, store = defaultSessionStore) {
    const clean = cleanPlainUsername(username);
    if (!clean || clean.length < 2 || clean.length > 20) {
        return { success: false, error: 'Username must be between 2 and 20 characters' };
    }

    return store.createOrUpdate(clean, sessionToken);
}

module.exports = {
    authenticate,
    sanitizeText,
    cleanPlainUsername,
    SessionStore,
    defaultSessionStore
};
