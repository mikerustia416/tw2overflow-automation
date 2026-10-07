define('two/builderQueue/labelPolicy', [], function () {
    // Matching multiple role labels uses this stable order. Explicit group mappings
    // are checked first, in the order saved in Builder settings.
    const roles = ['Offensive', 'Defensive', 'Resource'];
    const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const hasSequence = (sequences, name) => sequences && owns(sequences, name) && Array.isArray(sequences[name]);
    const normalizeName = name => typeof name === 'string' ? name.trim().toLowerCase() : '';

    const resolve = function (config, villageId, groupList, sequences) {
        config = config || {};
        const fallback = {sequence: config.building_sequence, source: 'fallback', groupId: null};
        if (config.manual_sequence_override === true || config.follow_village_labels === false) {
            return {sequence: config.building_sequence, source: 'manual', groupId: null};
        }
        if (!groupList || typeof groupList.getGroups !== 'function' || typeof groupList.getGroupVillageIds !== 'function') {
            return fallback;
        }

        let groups;
        try {
            groups = groupList.getGroups();
        } catch (error) {
            return fallback;
        }
        if (!groups || typeof groups !== 'object') {
            return fallback;
        }
        const linked = Object.keys(groups).map(key => groups[key]).filter(group => {
            if (!group || group.id === undefined || group.id === null) {
                return false;
            }
            try {
                const villages = groupList.getGroupVillageIds(group.id);
                return Array.isArray(villages) && villages.some(id => String(id) === String(villageId));
            } catch (error) {
                return false;
            }
        });

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
        for (const role of roles) {
            if (!hasSequence(sequences, role)) {
                continue;
            }
            const matching = linked.filter(group => normalizeName(group.name) === normalizeName(role));
            // Duplicate role labels also resolve consistently across group-list order.
            matching.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', {numeric: true}));
            if (matching.length) {
                return {sequence: role, source: 'label', groupId: matching[0].id};
            }
        }
        return fallback;
    };

    return {resolve};
});
