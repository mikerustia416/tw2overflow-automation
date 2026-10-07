define('two/builderQueue/settings', [], function () {
    return {
        GROUP_VILLAGES: 'group_villages',
        VILLAGE_PROFILES: 'village_profiles',
        ENABLED: 'enabled',
        ACTIVE_SEQUENCE: 'building_sequence',
        BUILDING_SEQUENCES: 'building_orders',
        PRESERVE_WOOD: 'preserve_wood',
        PRESERVE_CLAY: 'preserve_clay',
        PRESERVE_IRON: 'preserve_iron',
        PRIORIZE_FARM: 'priorize_farm',
        AUTO_SEQUENCE: 'follow_village_labels',
        MANUAL_OVERRIDE: 'manual_sequence_override',
        LABEL_MAPPINGS: 'label_sequence_mappings',
        DYNAMIC: 'dynamic_building',
        PRIORIZE_WAREHOUSE: 'priorize_warehouse',
        WAIT_MINUTES: 'dynamic_wait_minutes',
        MAX_DELAY_MINUTES: 'dynamic_max_delay_minutes',
        WAREHOUSE_PERCENT: 'dynamic_warehouse_percent',
        MINIMUM_FOOD: 'dynamic_minimum_food',
        RESOURCE_LEVEL_LIMIT: 'dynamic_resource_level_limit',
        RESOURCE_DETOUR_LIMIT: 'dynamic_resource_detour_limit'
    };
});

define('two/builderQueue/settings/updates', [], function () {
    return {
        ANALYSE: 'analyse'
    };
});

define('two/builderQueue/settings/map', [
    'two/builderQueue/defaultOrders',
    'two/builderQueue/settings',
    'two/builderQueue/settings/updates'
], function (
    DEFAULT_ORDERS,
    SETTINGS,
    UPDATES
) {
    return {
        [SETTINGS.AUTO_SEQUENCE]: {default: true, inputType: 'checkbox', updates: [UPDATES.ANALYSE]},
        [SETTINGS.MANUAL_OVERRIDE]: {default: false, inputType: 'checkbox', updates: [UPDATES.ANALYSE]},
        [SETTINGS.LABEL_MAPPINGS]: {default: [], inputType: 'profiles', updates: [UPDATES.ANALYSE]},
        [SETTINGS.DYNAMIC]: {default: false, inputType: 'checkbox', updates: [UPDATES.ANALYSE]},
        [SETTINGS.PRIORIZE_WAREHOUSE]: {default: true, inputType: 'checkbox', updates: [UPDATES.ANALYSE]},
        [SETTINGS.WAIT_MINUTES]: {default: 30, inputType: 'number', updates: [UPDATES.ANALYSE], min: 1, max: 1440},
        [SETTINGS.MAX_DELAY_MINUTES]: {default: 15, inputType: 'number', updates: [UPDATES.ANALYSE], min: 0, max: 1440},
        [SETTINGS.WAREHOUSE_PERCENT]: {default: 90, inputType: 'number', updates: [UPDATES.ANALYSE], min: 50, max: 100},
        [SETTINGS.MINIMUM_FOOD]: {default: 50, inputType: 'number', updates: [UPDATES.ANALYSE], min: 0, max: 10000},
        [SETTINGS.RESOURCE_LEVEL_LIMIT]: {default: 15, inputType: 'number', updates: [UPDATES.ANALYSE], min: 0, max: 30},
        [SETTINGS.RESOURCE_DETOUR_LIMIT]: {default: 2, inputType: 'number', updates: [UPDATES.ANALYSE], min: 0, max: 10},
        [SETTINGS.VILLAGE_PROFILES]: {default: {}, inputType: 'profiles', updates: [UPDATES.ANALYSE]},
        [SETTINGS.ENABLED]: {default: true, inputType: 'checkbox', updates: [UPDATES.ANALYSE]},
        [SETTINGS.GROUP_VILLAGES]: {
            default: false,
            inputType: 'select',
            disabledOption: true,
            type: 'groups',
            updates: [UPDATES.ANALYSE]
        },
        [SETTINGS.ACTIVE_SEQUENCE]: {
            default: 'Essential',
            inputType: 'select',
            updates: [UPDATES.ANALYSE]
        },
        [SETTINGS.BUILDING_SEQUENCES]: {
            default: DEFAULT_ORDERS,
            inputType: 'buildingOrder',
            updates: [UPDATES.ANALYSE]
        },
        [SETTINGS.PRESERVE_WOOD]: {
            default: 0,
            updates: [UPDATES.ANALYSE],
            inputType: 'number',
            min: 0,
            max: 600000
        },
        [SETTINGS.PRESERVE_CLAY]: {
            default: 0,
            updates: [UPDATES.ANALYSE],
            inputType: 'number',
            min: 0,
            max: 600000
        },
        [SETTINGS.PRESERVE_IRON]: {
            default: 0,
            updates: [UPDATES.ANALYSE],
            inputType: 'number',
            min: 0,
            max: 600000
        },
        [SETTINGS.PRIORIZE_FARM]: {
            default: true,
            inputType: 'checkbox',
            updates: [UPDATES.ANALYSE]
        }
    };
});
