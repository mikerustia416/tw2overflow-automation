define('two/recruiter/settings/map', [], function () {
    const number = (value, max) => ({default: value, updates: [], inputType: 'number', min: 0, max});
    return {
        village_profiles: {default: {}, updates: [], inputType: 'profiles'},
        enabled: {default: true, updates: [], inputType: 'checkbox'},
        preview_only: {default: true, updates: [], inputType: 'checkbox'},
        check_interval: {default: '1 minute', updates: [], inputType: 'readable_time'},
        enabled_groups: {default: [], updates: [], inputType: 'select', multiSelect: true, type: 'groups', disabledOption: true},
        targets: {default: {}, updates: [], inputType: 'targets'},
        preserve_wood: number(5000, 10000000),
        preserve_clay: number(5000, 10000000),
        preserve_iron: number(5000, 10000000),
        preserve_food: number(0, 10000000),
        building_wood: number(0, 10000000),
        building_clay: number(0, 10000000),
        building_iron: number(0, 10000000),
        building_food: number(0, 10000000),
        protect_buildings: {default: [], updates: [], inputType: 'building_list'},
        spend_percent: number(25, 100),
        max_batch: {default: 50, updates: [], inputType: 'number', min: 1, max: 10000},
        max_queue_jobs: {default: 5, updates: [], inputType: 'number', min: 1, max: 100}
    };
});
