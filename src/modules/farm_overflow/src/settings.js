define('two/farmOverflow/settings', [], function () {
    return {
        PRESETS: 'presets',
        GROUP_IGNORE: 'group_ignore',
        GROUP_INCLUDE: 'group_include',
        GROUP_ONLY: 'group_only',
        MAX_DISTANCE: 'max_distance',
        MIN_DISTANCE: 'min_distance',
        IGNORE_FULL_STORAGE: 'ignore_full_storage',        
        ATTACK_INTERVAL: 'attack_interval',
        MAX_TRAVEL_TIME: 'max_travel_time',
        MULTIPLE_ATTACKS_INTERVAL: 'multiple_attacks_interval',
        PRESERVE_COMMAND_SLOTS: 'preserve_command_slots',
        FARMER_CYCLE_INTERVAL: 'farmer_cycle_interval',
        MIN_POINTS: 'min_points',
        MAX_POINTS: 'max_points',
        LOGS_LIMIT: 'logs_limit',
        IGNORE_ON_LOSS: 'ignore_on_loss',
        TARGET_LIMIT: 'target_limit',
        FARMER_BEHAVIOR: 'farmer_behavior',
        TARGET_BEHAVIOR: 'target_behavior',
        BARBARIANS_ONLY: 'barbarians_only',
        OPTIMIZE_HAUL: 'optimize_haul',
        ESTIMATED_TARGET_LOOT: 'estimated_target_loot',
        UNIT_RESERVE_PERCENT: 'unit_reserve_percent',
        ATTACK_JITTER: 'attack_jitter',
        CYCLE_JITTER: 'cycle_jitter',
        TARGET_ORDER_VARIATION: 'target_order_variation',
        EMPTY_HAUL_COOLDOWN: 'empty_haul_cooldown',
        LOSS_COOLDOWN: 'loss_cooldown',
        MAX_ATTACKS_PER_CYCLE: 'max_attacks_per_cycle',
        PREVIEW_ONLY: 'preview_only',
        AUTO_FREE_SPEEDUP: 'auto_free_speedup',
        
        // Intelligent farming settings
        BARBARIAN_POWER_WEIGHT: 'barbarian_power_weight',
        BARBARIAN_POWER_ESTIMATE: 'barbarian_power_estimate',
        ATTACK_OVERKILL_PERCENT: 'attack_overkill_percent'
    };
});

define('two/farmOverflow/settings/updates', function () {
    return {
        PRESET: 'preset',
        GROUPS: 'groups',
        TARGETS: 'targets',
        VILLAGES: 'villages',
        WAITING_VILLAGES: 'waiting_villages',
        FULL_STORAGE: 'full_storage',
        LOGS: 'logs',
        INTERVAL_TIMERS: 'interval_timers'
    };
});

define('two/farmOverflow/settings/map', [
    'two/farmOverflow/settings',
    'two/farmOverflow/settings/updates',
    'two/farmOverflow/types/farmerBehavior',
    'two/farmOverflow/types/targetBehavior'
], function (
    SETTINGS,
    UPDATES,
    FARMER_BEHAVIOR,
    TARGET_BEHAVIOR
) {
    return {
        [SETTINGS.BARBARIANS_ONLY]: {
            default: true,
            updates: [UPDATES.TARGETS],
            inputType: 'checkbox'
        },
        [SETTINGS.OPTIMIZE_HAUL]: {
            default: true,
            updates: [UPDATES.TARGETS],
            inputType: 'checkbox'
        },
        [SETTINGS.ESTIMATED_TARGET_LOOT]: {
            default: 0,
            updates: [UPDATES.TARGETS],
            inputType: 'number',
            min: 0,
            max: 1000000
        },
        [SETTINGS.UNIT_RESERVE_PERCENT]: {
            default: 0,
            updates: [],
            inputType: 'number',
            min: 0,
            max: 100
        },
        [SETTINGS.ATTACK_JITTER]: {
            default: '1 second',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.CYCLE_JITTER]: {
            default: '30 seconds',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.TARGET_ORDER_VARIATION]: {
            default: 5,
            updates: [UPDATES.TARGETS],
            inputType: 'number',
            min: 0,
            max: 25
        },
        [SETTINGS.EMPTY_HAUL_COOLDOWN]: {
            default: '20 minutes',
            updates: [],
            inputType: 'readable_time'
        },
        [SETTINGS.LOSS_COOLDOWN]: {
            default: '24 hours',
            updates: [],
            inputType: 'readable_time'
        },
        [SETTINGS.MAX_ATTACKS_PER_CYCLE]: {
            default: 50,
            updates: [],
            inputType: 'number',
            min: 1,
            max: 1000
        },
        [SETTINGS.PREVIEW_ONLY]: {
            default: true,
            updates: [],
            inputType: 'checkbox'
        },
        [SETTINGS.AUTO_FREE_SPEEDUP]: {
            default: true,
            updates: [],
            inputType: 'checkbox'
        },
        [SETTINGS.PRESETS]: {
            default: [],
            updates: [
                UPDATES.PRESET,
                UPDATES.INTERVAL_TIMERS
            ],
            disabledOption: true,
            inputType: 'select',
            multiSelect: true,
            type: 'presets'
        },
        [SETTINGS.GROUP_IGNORE]: {
            default: false,
            updates: [
                UPDATES.GROUPS,
                UPDATES.INTERVAL_TIMERS
            ],
            disabledOption: true,
            inputType: 'select',
            type: 'groups'
        },
        [SETTINGS.GROUP_INCLUDE]: {
            default: [],
            updates: [
                UPDATES.GROUPS,
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            disabledOption: true,
            inputType: 'select',
            multiSelect: true,
            type: 'groups'
        },
        [SETTINGS.GROUP_ONLY]: {
            default: [],
            updates: [
                UPDATES.GROUPS,
                UPDATES.VILLAGES,
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            disabledOption: true,
            inputType: 'select',
            multiSelect: true,
            type: 'groups'
        },
        [SETTINGS.ATTACK_INTERVAL]: {
            default: '2 seconds',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.FARMER_CYCLE_INTERVAL]: {
            default: '5 minutes',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.MULTIPLE_ATTACKS_INTERVAL]: {
            default: '5 minutes',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.PRESERVE_COMMAND_SLOTS]: {
            default: 5,
            updates: [],
            inputType: 'number',
            min: 0,
            max: 50
        },
        [SETTINGS.IGNORE_ON_LOSS]: {
            default: true,
            updates: [],
            inputType: 'checkbox'
        },
        [SETTINGS.IGNORE_FULL_STORAGE]: {
            default: true,
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'checkbox'
        },
        [SETTINGS.MIN_DISTANCE]: {
            default: 0,
            updates: [
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            inputType: 'number',
            min: 0,
            max: 50
        },
        [SETTINGS.MAX_DISTANCE]: {
            default: 15,
            updates: [
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            inputType: 'number',
            min: 0,
            max: 50
        },
        [SETTINGS.MIN_POINTS]: {
            default: 0,
            updates: [
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            inputType: 'number',
            min: 0,
            max: 11223
        },
        [SETTINGS.MAX_POINTS]: {
            default: 3600,
            updates: [
                UPDATES.TARGETS,
                UPDATES.INTERVAL_TIMERS
            ],
            inputType: 'number',
            min: 0,
            max: 11223
        },
        [SETTINGS.MAX_TRAVEL_TIME]: {
            default: '90 minutes',
            updates: [UPDATES.INTERVAL_TIMERS],
            inputType: 'readable_time'
        },
        [SETTINGS.LOGS_LIMIT]: {
            default: 500,
            updates: [UPDATES.LOGS],
            inputType: 'number',
            min: 0,
            max: 2000
        },
        [SETTINGS.TARGET_LIMIT]: {
            default: 25,
            updates: [UPDATES.TARGETS],
            inputType: 'number',
            min: 0,
            max: 500
        },
        [SETTINGS.FARMER_BEHAVIOR]: {
            default: FARMER_BEHAVIOR.ALLOW_MULTIPLE_ATTACK_EACH_TARGET,
            updates: [],
            inputType: 'select',
            disabledOption: false
        },
        [SETTINGS.TARGET_BEHAVIOR]: {
            default: TARGET_BEHAVIOR.TARGETS_ALLOW_MULTIPLE_FARMERS,
            updates: [],
            inputType: 'select',
            disabledOption: false
        },
        [SETTINGS.BARBARIAN_POWER_WEIGHT]: {
            default: 20,
            updates: [UPDATES.TARGETS],
            inputType: 'number',
            min: 0,
            max: 100
        },
        [SETTINGS.BARBARIAN_POWER_ESTIMATE]: {
            default: 'points',
            updates: [UPDATES.TARGETS],
            inputType: 'select',
            disabledOption: false,
            options: [
                {name: 'Village Points', value: 'points'},
                {name: 'Building Levels', value: 'buildings'}
            ]
        },
        [SETTINGS.ATTACK_OVERKILL_PERCENT]: {
            default: 20,
            updates: [],
            inputType: 'number',
            min: 0,
            max: 200
        }
    };
});