define('two/builderQueue/labelPolicy', [], function () {
    // Explicit mappings win, then the established roles, then other saved names
    // alphabetically. Selection is independent of group/library insertion order.
    const roles = ['Offensive', 'Defensive', 'Resource'];
    const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const hasSequence = (sequences, name) => sequences && owns(sequences, name) && Array.isArray(sequences[name]);
    const normalizeName = name => typeof name === 'string' ? name.trim().toLowerCase() : '';

    const linkedGroups = function (villageId, groupList) {
        if (!groupList || typeof groupList.getGroups !== 'function' || typeof groupList.getGroupVillageIds !== 'function') {
            return null;
        }

        let groups;
        try {
            groups = groupList.getGroups();
        } catch (error) {
            return null;
        }
        if (!groups || typeof groups !== 'object') {
            return null;
        }
        let unavailable = false;
        const linked = Object.keys(groups).map(key => groups[key]).filter(group => {
            if (!group || group.id === undefined || group.id === null) {
                return false;
            }
            try {
                const villages = groupList.getGroupVillageIds(group.id);
                if (!Array.isArray(villages)) {
                    unavailable = true;
                    return false;
                }
                return villages.some(id => String(id) === String(villageId));
            } catch (error) {
                unavailable = true;
                return false;
            }
        });
        return unavailable ? null : linked;
    };

    const resolve = function (config, villageId, groupList, sequences) {
        config = config || {};
        const fallback = {sequence: config.building_sequence, source: 'fallback', groupId: null};
        if (config.manual_sequence_override === true || config.follow_village_labels === false) {
            return {sequence: config.building_sequence, source: 'manual', groupId: null};
        }
        const linked = linkedGroups(villageId, groupList);
        if (!linked) {
            return fallback;
        }
        const mappings = Array.isArray(config.label_sequence_mappings) ? config.label_sequence_mappings : [];
        for (const mapping of mappings) {
            if (!mapping || !hasSequence(sequences, mapping.sequence)) {
                continue;
            }
            const group = linked.find(item => String(item.id) === String(mapping.group_id));
            if (group) {
                return {sequence: mapping.sequence, source: 'mapping', groupId: group.id};
            }
        }
        const priority = name => {
            const index = roles.findIndex(role => normalizeName(role) === normalizeName(name));
            return index < 0 ? roles.length : index;
        };
        const names = Object.keys(sequences || {}).filter(name => normalizeName(name) && hasSequence(sequences, name));
        names.sort((a, b) => priority(a) - priority(b)
            || normalizeName(a).localeCompare(normalizeName(b), 'en') || a.localeCompare(b, 'en'));
        for (const name of names) {
            const matching = linked.filter(group => normalizeName(group.name) === normalizeName(name));
            matching.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', {numeric: true}));
            if (matching.length) {
                return {sequence: name, source: 'label', groupId: matching[0].id};
            }
        }
        return fallback;
    };

    return {resolve, linkedGroups, normalizeName};
});
