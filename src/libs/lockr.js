/* global GM_getValue, GM_setValue */
/**
 * Synchronous private userscript storage, preserving the legacy Lockr API.
 * The local define adapter keeps this module out of the game's registry.
 */
define('Lockr', function () {
    if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') {
        throw new Error('TW2Overflow requires Tampermonkey storage grants. Install the .user.js build.');
    }

    const getValue = GM_getValue;
    const setValue = GM_setValue;
    const params = new URLSearchParams(location.search);
    const worldId = params.get('world');
    const characterId = params.get('character_id');
    if (!worldId || !characterId) {
        throw new Error('TW2Overflow cannot identify this world and character for private storage.');
    }
    const prefix = `${characterId}_twOverflow_${worldId}-`;
    const legacyStorage = localStorage;

    const writeVerified = function (key, raw) {
        setValue(key, raw);
        if (getValue(key) !== raw) {
            throw new Error('TW2Overflow could not verify private storage. Original browser data was retained.');
        }
    };

    const migrate = function (key) {
        const raw = legacyStorage.getItem(key);
        if (raw === null) {
            return;
        }
        const current = getValue(key);
        if (typeof current === 'undefined') {
            writeVerified(key, raw);
        } else if (current !== raw) {
            // Private settings remain authoritative; preserve a conflicting old
            // value in private storage before removing its page-visible copy.
            writeVerified(`tw2overflow:legacy-backup:${key}`, raw);
        }
        if (getValue(key) !== (typeof current === 'undefined' ? raw : current)) {
            throw new Error('TW2Overflow private storage changed during migration. Original data was retained.');
        }
        if (legacyStorage.getItem(key) !== raw) {
            throw new Error('TW2Overflow browser storage changed during migration. Retry after closing older copies.');
        }
        legacyStorage.removeItem(key);
        if (legacyStorage.getItem(key) !== null) {
            throw new Error('TW2Overflow could not remove migrated browser storage. Original data was retained.');
        }
    };

    // Snapshot keys before removing them. Migrate only this script's owned
    // namespaces, including other characters/worlds and unused module settings.
    const legacyKeys = [];
    for (let index = 0; index < legacyStorage.length; index++) {
        const key = legacyStorage.key(index);
        if (/^\d+_twOverflow_[a-z0-9]+-/.test(key)) {
            legacyKeys.push(key);
        }
    }
    legacyKeys.forEach(migrate);

    const Lockr = {prefix};
    Lockr._getPrefixedKey = function (key, options) {
        return options && options.noPrefix ? key : this.prefix + key;
    };

    Lockr.set = function (key, value, options) {
        const queryKey = this._getPrefixedKey(key, options);
        writeVerified(queryKey, JSON.stringify({data: value}));
    };

    Lockr.get = function (key, missing, options) {
        const queryKey = this._getPrefixedKey(key, options);
        if (options && options.noPrefix) {
            migrate(queryKey);
        }
        const raw = getValue(queryKey);
        if (typeof raw === 'undefined') {
            return missing;
        }
        let value;
        try {
            value = JSON.parse(raw);
        } catch (e) {
            value = raw ? {data: raw} : null;
        }
        if (value === null) {
            return missing;
        } else if (typeof value === 'object' && typeof value.data !== 'undefined') {
            return value.data;
        } else {
            return missing;
        }
    };

    return Lockr;
});
