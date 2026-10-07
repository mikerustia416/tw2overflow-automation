define('two/Settings', [
    'two/utils',
    'Lockr',
    'humanInterval'
], function (
    utils,
    Lockr,
    humanInterval
) {
    const validators = {
        readable_time: function (value) {
            return typeof value === 'string' && !isNaN(humanInterval(value));
        }
    };

    const parsers = {
        readable_time: function (value) {
            return humanInterval(value);
        }
    };

    const generateDiff = function (before, after) {
        const changes = {};

        for (const id in before) {
            if (hasOwn.call(after, id)) {
                if (!angular.equals(before[id], after[id])) {
                    changes[id] = after[id];
                }
            } else {
                changes[id] = before[id];
            }
        }

        return angular.equals({}, changes) ? false : changes;
    };

    const generateDefaults = function (map) {
        const defaults = {};

        for (const key in map) {
            defaults[key] = map[key].default;
        }

        return defaults;
    };

    const disabledOption = function () {
        return {
            name: $filter('i18n')('disabled', $rootScope.loc.ale, 'common'),
            value: false
        };
    };

    const getUpdates = function (map, changes) {
        const updates = {};

        for (const id in changes) {
            (map[id].updates || []).forEach(function (updateItem) {
                updates[updateItem] = true;
            });
        }

        if (angular.equals(updates, {})) {
            return false;
        }

        return updates;
    };

    const Settings = function (configs) {
        this.settingsMap = configs.settingsMap;
        this.storageKey = configs.storageKey;
        this.defaults = generateDefaults(this.settingsMap);
        this.settings = angular.merge({}, this.defaults, Lockr.get(this.storageKey, {}));
        this.events = {
            settingsChange: configs.onChange || noop
        };
        this.injected = false;
    };

    Settings.prototype.get = function (id) {
        const value = angular.copy(this.settings[id]);
        const inputType = this.settingsMap[id].inputType;

        return hasOwn.call(parsers, inputType)
            ? parsers[inputType].call(this, value)
            : value;
    };

    Settings.prototype.getRaw = function (id) {
        return angular.copy(this.settings[id]);
    };

    Settings.prototype.getAll = function () {
        const copy = {};

        for (const [id, map] of Object.entries(this.settingsMap)) {
            const inputType = map.inputType;

            if (hasOwn.call(parsers, inputType)) {
                copy[id] = parsers[inputType].call(this, this.settings[id]);
            } else {
                copy[id] = this.settings[id];
            }
        }

        return copy;
    };

    Settings.prototype.valid = function (inputType, value) {
        if (hasOwn.call(validators, inputType)) {
            return validators[inputType].call(this, value);
        }

        return false;
    };

    Settings.prototype.getDefault = function (id) {
        return hasOwn.call(this.defaults, id) ? this.defaults[id] : undefined;
    };

    Settings.prototype.store = function () {
        Lockr.set(this.storageKey, this.settings);
    };

    Settings.prototype.set = function (id, value, opt) {
        if (!hasOwn.call(this.settingsMap, id)) {
            return false;
        }

        const map = this.settingsMap[id];

        if (map.inputType === 'number') {
            value = parseInt(value, 10);

            if (hasOwn.call(map, 'min')) {
                value = Math.max(map.min, value);
            }

            if (hasOwn.call(map, 'max')) {
                value = Math.min(map.max, value);
            }
        }

        const before = angular.copy(this.settings);
        this.settings[id] = value;
        const after = angular.copy(this.settings);
        const changes = generateDiff(before, after);

        if (!changes) {
            return false;
        }

        const updates = getUpdates(this.settingsMap, changes);

        this.store();
        this.updateScope();
        this.events.settingsChange.call(this, changes, updates, opt || {});

        return true;
    };

    Settings.prototype.setAll = function (values, opt) {
        const before = angular.copy(this.settings);

        for (const id in values) {
            if (hasOwn.call(this.settingsMap, id)) {
                const map = this.settingsMap[id];
                let value = values[id];

                if (map.inputType === 'number') {
                    value = parseInt(value, 10);

                    if (hasOwn.call(map, 'min')) {
                        value = Math.max(map.min, value);
                    }

                    if (hasOwn.call(map, 'max')) {
                        value = Math.min(map.max, value);
                    }
                }

                this.settings[id] = value;
            }
        }

        const after = angular.copy(this.settings);
        const changes = generateDiff(before, after);

        if (!changes) {
            return false;
        }

        const updates = getUpdates(this.settingsMap, changes);

        this.store();
        this.updateScope();
        this.events.settingsChange.call(this, changes, updates, opt || {});

        return true;
    };

    Settings.prototype.reset = function (id, opt) {
        this.set(id, this.defaults[id], opt);

        return true;
    };

    Settings.prototype.resetAll = function (opt) {
        this.setAll(angular.copy(this.defaults), opt);

        return true;
    };

    Settings.prototype.each = function (callback) {
        for (const id in this.settings) {
            if (!hasOwn.call(this.settingsMap, id)) {
                continue;
            }

            const map = this.settingsMap[id];

            if (map.inputType === 'checkbox') {
                callback.call(this, id, !!this.settings[id], map);
            } else {
                callback.call(this, id, this.settings[id], map);
            }
        }
    };

    Settings.prototype.onChange = function (callback) {
        if (typeof callback === 'function') {
            this.events.settingsChange = callback;
        }
    };

    Settings.prototype.injectScope = function ($scope, opt) {
        this.injected = {
            $scope: $scope,
            opt: opt
        };

        $scope.settings = this.encode(opt);

        utils.each(this.settingsMap, function (map, id) {
            if (map.inputType === 'select') {
                $scope.$watch(function () {
                    return $scope.settings[id];
                }, function (value) {
                    if (map.multiSelect) {
                        if (!value.length) {
                            $scope.settings[id] = [disabledOption()];
                        }
                    } else if (!value) {
                        $scope.settings[id] = disabledOption();
                    }
                }, true);
            }
        });
    };

    Settings.prototype.updateScope = function () {
        if (!this.injected) {
            return false;
        }

        this.injected.$scope.settings = this.encode(this.injected.opt);
    };

    Settings.prototype.encode = function (opt) {
        const encoded = {};
        const presets = modelDataService.getPresetList().getPresets();
        const groups = modelDataService.getGroupList().getGroups();

        opt = opt || {};

        this.each(function (id, value, map) {
            if (map.inputType === 'select') {
                if (!value && map.disabledOption) {
                    encoded[id] = map.multiSelect ? [disabledOption()] : disabledOption();
                    return;
                }

                switch (map.type) {
                    case 'presets': {
                        if (map.multiSelect) {
                            const multiValues = [];

                            value.forEach(function (presetId) {
                                if (!presets[presetId]) {
                                    return;
                                }

                                multiValues.push({
                                    name: presets[presetId].name,
                                    value: presetId
                                });
                            });

                            encoded[id] = multiValues.length ? multiValues : [disabledOption()];
                        } else {
                            if (!presets[value] && map.disabledOption) {
                                encoded[id] = disabledOption();
                                return;
                            }

                            encoded[id] = {
                                name: presets[value].name,
                                value: value
                            };
                        }

                        break;
                    }
                    case 'groups': {
                        if (map.multiSelect) {
                            const multiValues = [];

                            value.forEach(function (groupId) {
                                if (!groups[groupId]) {
                                    return;
                                }

                                multiValues.push({
                                    name: groups[groupId].name,
                                    value: groupId,
                                    leftIcon: groups[groupId].icon
                                });
                            });

                            encoded[id] = multiValues.length ? multiValues : [disabledOption()];
                        } else {
                            if (!groups[value] && map.disabledOption) {
                                encoded[id] = disabledOption();
                                return;
                            }

                            encoded[id] = {
                                name: groups[value].name,
                                value: value
                            };
                        }

                        break;
                    }
                    default: {
                        encoded[id] = {
                            name: opt.textObject ? $filter('i18n')(value, $rootScope.loc.ale, opt.textObject) : value,
                            value: value
                        };

                        if (opt.multiSelect) {
                            encoded[id] = [encoded[id]];
                        }

                        break;
                    }
                }
            } else {
                encoded[id] = value;
            }
        });

        return encoded;
    };

    Settings.prototype.decode = function (encoded) {
        const decoded = {};

        for (const id in encoded) {
            const map = this.settingsMap[id];

            if (map.inputType === 'select') {
                if (map.multiSelect) {
                    if (encoded[id].length === 1 && encoded[id][0].value === false) {
                        decoded[id] = [];
                    } else {
                        const multiValues = [];

                        encoded[id].forEach(function (item) {
                            multiValues.push(item.value);
                        });

                        decoded[id] = multiValues;
                    }
                } else {
                    decoded[id] = encoded[id].value;
                }
            } else {
                decoded[id] = encoded[id];
            }
        }

        return decoded;
    };

    Settings.encodeList = function (list, opt) {
        const encoded = [];

        opt = opt || {};

        if (opt.disabled) {
            encoded.push(disabledOption());
        }

        switch (opt.type) {
            case 'keys': {
                for (const prop in list) {
                    encoded.push({
                        name: prop,
                        value: prop
                    });
                }

                break;
            }
            case 'groups': {
                for (const prop in list) {
                    const value = list[prop];

                    encoded.push({
                        name: value.name,
                        value: value.id,
                        leftIcon: value.icon
                    });
                }

                break;
            }
            case 'presets': {
                for (const prop in list) {
                    const value = list[prop];

                    encoded.push({
                        name: value.name,
                        value: value.id
                    });
                }

                break;
            }
            case 'values':
            default: {
                for (const prop in list) {
                    const value = list[prop];

                    encoded.push({
                        name: opt.textObject ? $filter('i18n')(value, $rootScope.loc.ale, opt.textObject) : value,
                        value: value
                    });
                }
            }
        }

        return encoded;
    };

    Settings.disabledOption = disabledOption;

    return Settings;
});

// Village profiles share the existing world/character-namespaced Settings storage.
define('two/villageSettings', ['two/Settings'], function (Settings) {
    return function (base, villageId, sharedKeys) {
        if (!villageId) {
            return base;
        }
        const view = Object.create(Settings.prototype);
        view.settingsMap = Object.fromEntries(Object.entries(base.settingsMap).filter(([key]) => key !== 'village_profiles'));
        view.defaults = base.defaults;
        view.storageKey = base.storageKey;
        view.events = {settingsChange: noop};
        view.injected = false;
        const refresh = function () {
            const profiles = base.getRaw('village_profiles');
            const profile = profiles && profiles[villageId] || {};
            view.settings = Object.fromEntries(Object.keys(view.settingsMap).map(key => [key,
                !sharedKeys.includes(key) && hasOwn.call(profile, key) ? angular.copy(profile[key]) : base.getRaw(key)]));
        };
        refresh();
        // Read through to the base so sequence-library edits and other windows stay current.
        for (const method of ['get', 'getRaw', 'getAll', 'encode', 'set', 'setAll']) {
            view[method] = function (...args) {
                refresh();
                const changed = Settings.prototype[method].apply(view, args);
                if (method === 'setAll' && !changed && !hasOwn.call(base.getRaw('village_profiles') || {}, villageId)) {
                    view.store();
                    view.updateScope();
                    return true;
                }
                return changed;
            };
        }
        view.store = function () {
            const profiles = base.getRaw('village_profiles') || {};
            const values = {};
            profiles[villageId] = {};
            for (const key of Object.keys(view.settingsMap)) {
                if (sharedKeys.includes(key)) {
                    values[key] = angular.copy(view.settings[key]);
                } else {
                    profiles[villageId][key] = angular.copy(view.settings[key]);
                }
            }
            base.setAll({...values, village_profiles: profiles});
        };
        view.resetProfile = function () {
            const profiles = base.getRaw('village_profiles') || {};
            delete profiles[villageId];
            base.set('village_profiles', profiles);
            refresh();
            view.updateScope();
        };
        return view;
    };
});
