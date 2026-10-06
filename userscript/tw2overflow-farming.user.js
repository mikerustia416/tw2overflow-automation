// ==UserScript==
// @name        TW2Overflow Farmer, Recruiter and Quest
// @description Automating the boring stuff on Tribal Wars 2 with tools like auto farming, auto builder, command scheduler, minimap and more.
// @namespace   local/tw2overflow-farming
// @version     2.1.500.4
// @grant       unsafeWindow
// @run-at      document-start
// @include     https://*.tribalwars2.com/game.php*
// @updateURL   none
// ==/UserScript==

/*!
 * tw2overflow v2.1.500
 * Tue, 06 Oct 2026 10:08:20 GMT
 * Developed by Relaxeaza <relaxeaza@outlook.com>
 *
 * This work is free. You can redistribute it and/or modify it under the
 * terms of the Do What The Fuck You Want To Public License, Version 2,
 * as published by Sam Hocevar. See the LICENCE file for more details.
 */

(function awaitInjector (window, main) {
    if (typeof window.injector === 'undefined') {
        setTimeout(() => awaitInjector(window, main), 250);
    } else {
        main(window);
    }
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window, function (window, undefined) {

const injector = window.injector;
const define = window.define;
const require = window.require;
const angular = window.angular;

const $rootScope = injector.get('$rootScope');
const transferredSharedDataService = injector.get('transferredSharedDataService');
const modelDataService = injector.get('modelDataService');
const socketService = injector.get('socketService');
const routeProvider = injector.get('routeProvider');
const eventTypeProvider = injector.get('eventTypeProvider');
const windowDisplayService = injector.get('windowDisplayService');
const windowManagerService = injector.get('windowManagerService');
const angularHotkeys = injector.get('hotkeys');
const armyService = injector.get('armyService');
const villageService = injector.get('villageService');
const mapService = injector.get('mapService');
const $filter = injector.get('$filter');
const $timeout = injector.get('$timeout');
const storageService = injector.get('storageService');
const resourceService = injector.get('resourceService');
const buildingService = injector.get('buildingService');
const reportService = injector.get('reportService');
const villageInfoService = injector.get('villageInfoService');
const noop = function () {};
const hasOwn = Object.prototype.hasOwnProperty;

define('two/EventScope', [
    'queues/EventQueue'
], function (eventQueue) {
    const EventScope = function (windowId, onDestroy) {
        if (typeof windowId === 'undefined') {
            throw new Error('EventScope: no windowId');
        }

        this.windowId = windowId;
        this.onDestroy = onDestroy || noop;
        this.listeners = [];

        const unregister = $rootScope.$on(eventTypeProvider.WINDOW_CLOSED, (event, templateName) => {
            if (templateName === '!' + this.windowId) {
                this.destroy();
                unregister();
            }
        });
    };

    EventScope.prototype.register = function (id, handler, _root) {
        if (_root) {
            this.listeners.push($rootScope.$on(id, handler));
        } else {
            eventQueue.register(id, handler);

            this.listeners.push(function () {
                eventQueue.unregister(id, handler);
            });
        }
    };

    EventScope.prototype.destroy = function () {
        this.listeners.forEach((unregister) => {
            unregister();
        });

        this.onDestroy();
    };

    return EventScope;
});

define('two/debug', [
    'Lockr'
], function (Lockr) {
    const STORAGE_KEY_DEBUG_LOGS = 'tw2overflow_debug';
    const STORAGE_KEY_DEBUG_LEVEL = 'tw2overflow_debug_level';
    const DEBUG_LEVEL = Lockr.get(STORAGE_KEY_DEBUG_LEVEL, 0);
    const DEBUG_LIMIT_ITEMS = 500;
    const DEBUG_LIMIT_MB = 3;


    if (!DEBUG_LEVEL) {
        Lockr.set(STORAGE_KEY_DEBUG_LOGS, []);
    }

    let logs = Lockr.get(STORAGE_KEY_DEBUG_LOGS, []);
    const colors = ['#54AC00', '#0067AC', '#AC0091', '#00AC1F', '#549300', '#CA6900', '#CA2400', '#CA0034', '#CA0093', '#0021AC'];
    let colorIndex = 0;

    window.addEventListener('beforeunload', function () {
        if (DEBUG_LEVEL) {
            Lockr.set(STORAGE_KEY_DEBUG_LOGS, logs.slice(-DEBUG_LIMIT_ITEMS));
        }
    });

    function checkStorageSize () {
        const textEncoder = new TextEncoder();
        const encodedLogs = textEncoder.encode(JSON.stringify(logs));
        const mb = encodedLogs.length / 1024 / 1024;

        if (mb > DEBUG_LIMIT_MB) {
            logs = logs.slice(-(DEBUG_LIMIT_ITEMS / 2));
            Lockr.set(STORAGE_KEY_DEBUG_LOGS, logs);
        }
    }

    function sprintf () {
        let index = 0;
        const args = Array.from(arguments);
        const string = args.shift();

        return string.replace(/%(s|d|i|o|O)/g, function (type) {
            switch (type) {
                case '%s':
                case '%i':
                case '%d': {
                    return args[index++];
                }
                case '%O':
                case '%o': {
                    return JSON.stringify(args[index++]);
                }
            }
        });
    }

    checkStorageSize();

    const debug = function (id) {
        if (typeof id !== 'string') {
            throw new Error('TW2Overflow debug id is not a string!');
        }

        const color = 'color:' + (colors[++colorIndex] || colors[colorIndex = 0]);

        return function () {
            if (!DEBUG_LEVEL) {
                return;
            }

            if (logs.length >= DEBUG_LIMIT_ITEMS) {
                logs.shift();
            }

            const args = Array.from(arguments);
            const level = args.shift();

            if (level > DEBUG_LEVEL) {
                return;
            }

            const raw = [...args];
            args[0] = '%c' + id + ': ' + args[0];
            args.splice(1, 0, color);
            console.log.apply(null, args);
            logs.push([Date.now(), sprintf.apply(null, raw)]);
        };
    };

    return debug;
});

define('two/utils', [
    'helper/time',
    'helper/math'
], function (
    $timeHelper,
    $math
) {
    const utils = {};

    /**
     * Gera um número aleatório aproximado da base.
     *
     * @param {Number} base - Número base para o calculo.
     */
    utils.randomSeconds = function (base) {
        if (!base) {
            return 0;
        }

        base = parseInt(base, 10);

        const max = base + (base / 2);
        const min = base - (base / 2);

        return Math.round(Math.random() * (max - min) + min);
    };

    /**
     * Converte uma string com um tempo em segundos.
     *
     * @param {String} time - Tempo que será convertido (hh:mm:ss)
     */
    utils.time2seconds = function (time) {
        time = time.split(':');
        time[0] = parseInt(time[0], 10) * 60 * 60;
        time[1] = parseInt(time[1], 10) * 60;
        time[2] = parseInt(time[2], 10);

        return time.reduce(function (a, b) {
            return a + b;
        });
    };

    /**
     * Emite notificação nativa do jogo.
     *
     * @param {String} type - success || error
     * @param {String} message - Texto a ser exibido
     */
    utils.notif = function (type, message) {
        $rootScope.$broadcast(eventTypeProvider.NOTIFICATION_DISABLE);
        $rootScope.$broadcast(eventTypeProvider.NOTIFICATION_ENABLE);

        const eventType = type === 'success'
            ? eventTypeProvider.MESSAGE_SUCCESS
            : eventTypeProvider.MESSAGE_ERROR;

        $rootScope.$broadcast(eventType, {
            message: message
        });
    };


    /**
     * Gera uma string com nome e coordenadas da aldeia
     *
     * @param {Object} village - Dados da aldeia
     * @return {String}
     */
    utils.genVillageLabel = function (village) {
        return village.name + ' (' + village.x + '|' + village.y + ')';
    };

    /**
     * Verifica se uma coordenada é válida.
     * 00|00
     * 000|00
     * 000|000
     * 00|000
     *
     * @param {String} xy - Coordenadas
     * @return {Boolean}
     */
    utils.isValidCoords = function (xy) {
        return /\s*\d{2,3}\|\d{2,3}\s*/.test(xy);
    };

    /**
     * Validação de horario e data de envio. Exmplo: 23:59:00:999 30/12/2016
     *
     * @param  {String}  dateTime
     * @return {Boolean}
     */
    utils.isValidDateTime = function (dateTime) {
        return /^\s*([01][0-9]|2[0-3]):[0-5]\d:[0-5]\d(:\d{1,3})? (0[1-9]|[12][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}\s*$/.test(dateTime);
    };

    /**
     * Inverte a posição do dia com o mês.
     */
    utils.fixDate = function (dateTime) {
        const dateAndTime = dateTime.trim().split(' ');
        const time = dateAndTime[0];
        const date = dateAndTime[1].split('/');

        return time + ' ' + date[1] + '/' + date[0] + '/' + date[2];
    };

    /**
     * Gera um id unico
     *
     * @return {String}
     */
    utils.guid = function () {
        return Math.floor((Math.random()) * 0x1000000).toString(16);
    };

    /**
     * Obtem o timestamp de uma data em string.
     * Formato da data: mês/dia/ano
     * Exmplo de entrada: 23:59:59:999 12/30/2017
     *
     * @param  {String} dateString - Data em formato de string.
     * @return {Number} Timestamp (milisegundos)
     */
    utils.getTimeFromString = function (dateString, offset) {
        const dateSplit = utils.fixDate(dateString).split(' ');
        const time = dateSplit[0].split(':');
        const date = dateSplit[1].split('/');

        const hour = time[0];
        const min = time[1];
        const sec = time[2];
        const ms = time[3] || null;

        const month = parseInt(date[0], 10) - 1;
        const day = date[1];
        const year = date[2];

        const _date = new Date(year, month, day, hour, min, sec, ms);

        return _date.getTime() + (offset || 0);
    };

    /**
     * Formata milisegundos em hora/data
     *
     * @return {String} Data e hora formatada
     */
    utils.formatDate = function (ms, format) {
        return $filter('readableDateFilter')(
            ms,
            null,
            $rootScope.GAME_TIMEZONE,
            $rootScope.GAME_TIME_OFFSET,
            format || 'HH:mm:ss dd/MM/yyyy'
        );
    };

    /**
     * Obtem a diferença entre o timezone local e do servidor.
     *
     * @type {Number}
     */
    utils.getTimeOffset = function () {
        const localDate = $timeHelper.gameDate();
        const localOffset = localDate.getTimezoneOffset() * 1000 * 60;
        const serverOffset = $rootScope.GAME_TIME_OFFSET;

        return localOffset + serverOffset;
    };

    utils.xhrGet = function (url, dataType = 'text') {
        return new Promise(function (resolve, reject) {
            if (!url) {
                return reject();
            }

            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = dataType;
            xhr.addEventListener('load', function () {
                resolve(xhr);
            }, false);

            xhr.send();
        });
    };

    utils.obj2selectOptions = function (obj, _includeIcon) {
        const list = [];

        for (const i in obj) {
            const item = {
                name: obj[i].name,
                value: obj[i].id
            };

            if (_includeIcon) {
                item.leftIcon = obj[i].icon;
            }

            list.push(item);
        }

        return list;
    };

    /**
     * @param {Object} origin - Objeto da aldeia origem.
     * @param {Object} target - Objeto da aldeia alvo.
     * @param {Object} units - Exercito usado no ataque como referência
     * para calcular o tempo.
     * @param {String} type - Tipo de comando (attack,support,relocate)
     * @param {Object} officers - Oficiais usados no comando (usados para efeitos)
     *
     * @return {Number} Tempo de viagem
     */
    utils.getTravelTime = function (origin, target, units, type, officers, useEffects) {
        const targetIsBarbarian = !target.character_id;
        const targetIsSameTribe = target.character_id && target.tribe_id &&
                target.tribe_id === modelDataService.getSelectedCharacter().getTribeId();

        if (useEffects !== false) {
            if (type === 'attack') {
                if ('supporter' in officers) {
                    delete officers.supporter;
                }

                if (targetIsBarbarian) {
                    useEffects = true;
                }
            } else if (type === 'support') {
                if (targetIsSameTribe) {
                    useEffects = true;
                }

                if ('supporter' in officers) {
                    useEffects = true;
                }
            }
        }

        const army = {
            units: units,
            officers: angular.copy(officers)
        };

        const travelTime = armyService.calculateTravelTime(army, {
            barbarian: targetIsBarbarian,
            ownTribe: targetIsSameTribe,
            officers: officers,
            effects: useEffects
        }, type);

        const distance = $math.actualDistance(origin, target);

        const totalTravelTime = armyService.getTravelTimeForDistance(
            army,
            travelTime,
            distance,
            type
        );

        return totalTravelTime * 1000;
    };

    utils.each = function (obj, iterator) {
        if (typeof iterator !== 'function') {
            iterator = noop;
        }

        if (Array.isArray(obj)) {
            for (let i = 0, l = obj.length; i < l; i++) {
                if (iterator(obj[i], i) === false) {
                    return false;
                }
            }
        } else if (angular.isObject(obj)) {
            for (const i in obj) {
                if (hasOwn.call(obj, i)) {
                    if (iterator(obj[i], i) === false) {
                        return false;
                    }
                }
            }
        }

        return true;
    };

    return utils;
});

define('two/ready', [
    'conf/gameStates',
    'two/mapData'
], function (
    GAME_STATES,
    twoMapData
) {
    const queueRequests = {};

    const ready = function (callback, which) {
        which = which || ['map'];

        if (typeof which === 'string') {
            which = [which];
        }

        const readyStep = function (item) {
            which = which.filter(function (_item) {
                return _item !== item;
            });

            if (!which.length) {
                callback();
            }
        };

        const handlers = {
            'map': function () {
                const mapScope = transferredSharedDataService.getSharedData('MapController');

                if (mapScope.isInitialized) {
                    return readyStep('map');
                }

                $rootScope.$on(eventTypeProvider.MAP_INITIALIZED, function () {
                    readyStep('map');
                });
            },
            'tribe_relations': function () {
                const $player = modelDataService.getSelectedCharacter();

                if ($player) {
                    const $tribeRelations = $player.getTribeRelations();

                    if (!$player.getTribeId() || $tribeRelations) {
                        return readyStep('tribe_relations');
                    }
                }

                const unbind = $rootScope.$on(eventTypeProvider.TRIBE_RELATION_LIST, function () {
                    unbind();
                    readyStep('tribe_relations');
                });
            },
            'initial_village': function () {
                const $gameState = modelDataService.getGameState();

                if ($gameState.getGameState(GAME_STATES.INITIAL_VILLAGE_READY)) {
                    return readyStep('initial_village');
                }

                $rootScope.$on(eventTypeProvider.GAME_STATE_INITIAL_VILLAGE_READY, function () {
                    readyStep('initial_village');
                });
            },
            'all_villages_ready': function () {
                const $gameState = modelDataService.getGameState();

                if ($gameState.getGameState(GAME_STATES.ALL_VILLAGES_READY)) {
                    return readyStep('all_villages_ready');
                }

                $rootScope.$on(eventTypeProvider.GAME_STATE_ALL_VILLAGES_READY, function () {
                    readyStep('all_villages_ready');
                });
            },
            'minimap_data': function () {
                if (twoMapData.isLoaded()) {
                    return readyStep('minimap_data');
                }

                twoMapData.load(function () {
                    readyStep('minimap_data');
                });
            },
            'presets': function () {
                if (modelDataService.getPresetList().isLoaded()) {
                    return readyStep('presets');
                }

                queueRequests.presets = queueRequests.presets || new Promise(function (resolve) {
                    socketService.emit(routeProvider.GET_PRESETS, {}, resolve);
                });

                queueRequests.presets.then(function () {
                    readyStep('presets');
                });
            },
            'world_config': function () {
                if (modelDataService.getWorldConfig && modelDataService.getWorldConfig()) {
                    return readyStep('world_config');
                }

                setTimeout(handlers['world_config'], 100);
            }
        };

        const mapScope = transferredSharedDataService.getSharedData('MapController');

        if (!mapScope) {
            return setTimeout(function () {
                ready(callback, which);
            }, 100);
        }

        which.forEach(function (readyItem) {
            handlers[readyItem]();
        });
    };

    return ready;
});

define('two/language', [
    'helper/i18n'
], function (
    i18n
) {
    let initialized = false;
    // eslint-disable-next-line
    const languages = {
    "cs_cz": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Otevřít zprávu",
            "no_report": "Žádná zpráva",
            "reports": "Zprávy",
            "date": "Dává ti",
            "status_time_limit": "Cíl je příliš daleko",
            "status_command_limit": "Limit příkazu",
            "status_full_storage": "Úložiště je plné",
            "status_no_units": "Nejsou k dispozici žádné jednotky",
            "status_abandoned_conquered": "Opuštěný dobytý",
            "status_protected_village": "Cíl je chráněn",
            "status_busy_target": "Cíl je pod útokem",
            "status_no_targets": "K dispozici nejsou žádné cíle",
            "status_target_cycle_end": "Cílový cyklus skončil",
            "status_not_allowed_points": "Cílové body nejsou povoleny",
            "status_unknown": "Neznámý stav",
            "status_attacking": "Útočí",
            "status_waiting_cycle": "Čekací cyklus",
            "status_user_stop": "Zastaveno hráčem",
            "status_expired_step": "Příkaz vypršel",
            "not_loaded": "Není načten.",
            "ignored_targets": "Ignorované cíle",
            "no_ignored_targets": "Nic ignorováno",
            "included_targets": "Zahrnuté cíle",
            "no_included_targets": "Nic není zahrnuto",
            "farmer_villages": "Farmářské vesnice",
            "no_farmer_villages": "Žádné farmářské vesnice",
            "last_status": "Poslední stav",
            "attacking": "Útočí.",
            "paused": "Pozastaveno.",
            "command_limit": "Bylo dosaženo limitu 50 útoků, čeká na návrat.",
            "last_attack": "Poslední útok",
            "village_switch": "Přechod na vesnici",
            "no_preset": "Žádné dostupné předvolby.",
            "no_selected_village": "Žádné dostupné vesnice.",
            "no_units": "Ve vesnici nejsou k dispozici žádné jednotky, čekající útoky se vracejí.",
            "no_units_no_commands": "V žádné vesnici se nevracejí jednotky ani příkazy.",
            "no_villages": "Žádné vesničky dostupné, čekající útoky se vracejí.",
            "preset_first": "Nejprve nastavte předvolbu!",
            "selected_village": "Vesnice vybrána",
            "loading_targets": "Načítání cílů ...",
            "checking_targets": "Kontrola cílů ...",
            "restarting_commands": "Restartování příkazů ...",
            "ignored_village": "přidán do ignorovaného seznamu",
            "included_village": "přidán do seznamu",
            "ignored_village_removed": "odstraněn ze seznamu ignorovaných",
            "included_village_removed": "odstraněn ze seznamu",
            "priority_target": "přidáno k prioritám.",
            "analyse_targets": "Analýza cílů.",
            "step_cycle_restart": "Restartování cyklu příkazů ..",
            "step_cycle_end": "Seznam vesnic skončil a čekal na další běh.",
            "step_cycle_end_no_villages": "K zahájení cyklu nejsou k dispozici žádné vesnice.",
            "step_cycle_next": "Seznam vesnic skončil, další cyklus: %d.",
            "step_cycle_next_no_villages": "K zahájení cyklu není k dispozici žádná vesnice, další cyklus: %d.",
            "full_storage": "Sklad ve vesnici je plný.",
            "farm_stopped": "FarmOverflow se zastavil.",
            "farm_started": "FarmOverflow byl spuštěn.",
            "groups_presets": "Skupiny a předvolby",
            "presets": "Útok pomocí předvoleb",
            "group_ignored": "Ignorujte vesnice ze skupiny",
            "group_include": "Zahrňte vesnice ze skupin",
            "group_only": "Útočte pouze s vesnicemi ze skupin",
            "attack_interval": "Interval mezi útoky",
            "preserve_command_slots": "Zachovat příkazové sloty",
            "farmer_cycle_interval": "Interval mezi zemědělskými cykly",
            "ignore_on_loss": "Ignorujte cíl, který způsobí ztrátu",
            "ignore_full_storage": "Nepoužívejte farmy s vesnicemi s plným úložištěm",
            "step_cycle_header": "Nastavení krokového cyklu",
            "step_cycle": "Povolit krokový cyklus",
            "step_cycle_notifs": "Oznámení cyklů",
            "target_filters": "Cílové filtry",
            "min_distance": "Cíle minimální vzdálenosti",
            "max_distance": "Zaměřuje maximální vzdálenost",
            "min_points": "Zaměřuje minimální počet bodů",
            "max_points": "Zaměřuje maximální počet bodů",
            "max_travel_time": "Maximální doba jízdy",
            "logs_limit": "Maximální počet položek protokolu",
            "event_attack": "Zobrazit protokoly úkolů o útocích",
            "event_village_change": "Zobrazit protokoly úkolů o změnách vesnice",
            "event_priority_add": "Zobrazit protokoly úkolů prioritních cílů",
            "event_ignored_village": "Zobrazit protokoly úkolů ignorovaných vesnic",
            "settings_saved": "Nastavení uloženo!",
            "misc": "Smíšený",
            "attack": "Záchvat",
            "no_logs": "Nejsou zaregistrovány žádné protokoly",
            "clear_logs": "Vymazat protokoly",
            "reseted_logs": "Registrované protokoly byly odstraněny.",
            "date_added": "Datum přidáno",
            "multiple_attacks_interval": "Interval mezi útoky na stejný cíl",
            "next_cycle_in": "Další cyklus začíná v",
            "target_limit_per_village": "Limit cílů na vesnici",
            "ignore_on_loss_tip": "Toto nastavení funguje pouze v případě, že je vybrána skupina pro ignorování.",
            "farmer_behavior": "Zemědělci mohou poslat",
            "allow_single_attack_each_target": "Jeden útok na každý cíl",
            "allow_multiple_attack_each_target": "Několik útoků na každý cíl",
            "target_behavior": "Cíle mohou přijímat",
            "targets_allow_single_farmer": "Útoky od jednoho farmáře",
            "targets_allow_multiple_farmers": "Útoky od více farmářů"
        },
        "common": {
            "start": "Start",
            "started": "Začal",
            "pause": "Pauza",
            "paused": "Pozastaveno",
            "stop": "Stop",
            "stopped": "Zastavil",
            "status": "Postavení",
            "none": "Žádný",
            "info": "Informace",
            "settings": "Nastavení",
            "others": "Ostatní",
            "village": "Vesnice",
            "villages": "Vesnice",
            "building": "Budova",
            "buildings": "Budovy",
            "level": "Úroveň",
            "registers": "Protokoly",
            "filters": "Filtry",
            "add": "Přidat",
            "waiting": "Čekání",
            "attack": "Záchvat",
            "support": "Podpěra, podpora",
            "relocate": "Převod",
            "activate": "aktivovat",
            "deactivate": "Zakázat",
            "units": "Jednotky",
            "officers": "Důstojníci",
            "origin": "Původ",
            "target": [
                "cílová",
                "Cíle"
            ],
            "save": "Uložit",
            "logs": "Protokoly",
            "no-results": "Žádné výsledky ...",
            "selected": "Vybraný",
            "now": "Nyní",
            "costs": "Náklady",
            "duration": "Doba trvání",
            "points": "Body",
            "player": "Hráč",
            "players": "Hráči",
            "next_features": "Další funkce",
            "misc": "Smíšený",
            "colors": "Barvy",
            "reset": "Resetovat",
            "reset_settings": "Resetovat nastavení",
            "reset_settings_confirmation": "Opravdu chcete obnovit nastavení?",
            "here": "tady",
            "disabled": "- Zakázáno -",
            "cancel": "zrušení",
            "actions": "Akce",
            "remove": "Odstranit",
            "started_at": "Začalo v",
            "arrive": "Přijet",
            "settings_saved": "Nastavení uloženo",
            "settings_reseted": "Nastavení bylo obnoveno",
            "discard": "Vyřadit",
            "new_version": "TWOverflow aktualizován na verzi %d",
            "check_changes": "Kliknutím sem zkontrolujete změny",
            "firefox_shill": "Pokud chcete, aby skript fungoval správně na pozadí, použijte prohlížeč Firefox místo prohlížečů založených na prohlížeči Chrome.",
            "error_invalid_interval": "Neplatný formát času pro %d.",
            "readable_time_format": "Příklady formátu času: 1 minuta, 30 minut, 4 hodiny, 1 den."
        }
    },
    "de_de": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Bericht öffnen",
            "no_report": "Kein Bericht",
            "reports": "Berichte",
            "date": "Datum",
            "status_time_limit": "Ziel ist zu weit weg",
            "status_command_limit": "Befehlslimit",
            "status_full_storage": "Speicher voll",
            "status_no_units": "Keine verfügbaren Einheiten",
            "status_abandoned_conquered": "Keine vefügbaren Einheiten",
            "status_protected_village": "Ziel ist geschützt",
            "status_busy_target": "Ziel wird angegriffen",
            "status_no_targets": "Keine verfügbaren Ziele",
            "status_target_cycle_end": "Zielzyklus beendet",
            "status_not_allowed_points": "Zielpunkt nicht erlaubt",
            "status_unknown": "Unbekannter Status",
            "status_attacking": "Angreifen",
            "status_waiting_cycle": "Wartezyklus",
            "status_user_stop": "Vom Spieler gestoppt",
            "status_expired_step": "Befehl abgelaufen",
            "not_loaded": "Nicht geladen.",
            "ignored_targets": "Ignorierte Ziele",
            "no_ignored_targets": "Nichts ignoriert",
            "included_targets": "Hinzugefügte Ziele",
            "no_included_targets": "Nichts hinzugefügt",
            "farmer_villages": "Farmdörfer",
            "no_farmer_villages": "Keine Farmdörfer",
            "last_status": "Letzter Status",
            "attacking": "Im Angriff.",
            "paused": "Angehalten.",
            "command_limit": "Das Befehlslimit ist erreicht, bitte warte auf die Rückkehr einiger Trupps.",
            "last_attack": "Letzter Angriff",
            "village_switch": "Wechsle zu Dorf",
            "no_preset": "Keine Vorlage verfügbar.",
            "no_selected_village": "Keine Dörfer verfügbar.",
            "no_units": "Keine Einheiten im Dorf, wartet auf die Rückkehr von Trupps.",
            "no_units_no_commands": "Kein Dorf hat Einheiten oder zurückkehrende Befehle.",
            "no_villages": "Keine Dörfer verfügbar, warte auf Rückkehr von Befehlen.",
            "preset_first": "Wähle zuerst eine Vorlage!",
            "selected_village": "Ausgewähltes Dorf",
            "loading_targets": "Ziele werden geladen...",
            "checking_targets": "Ziele werden geprüft...",
            "restarting_commands": "Befehle werden neu gestartet...",
            "ignored_village": "zur Ignorierliste hinzugefügt",
            "included_village": "zur Eingeschlossenen-Liste hinzugefügt",
            "ignored_village_removed": "aus der Ignorier-Liste entfernt",
            "included_village_removed": "aus der Eingeschlossenen-Liste entfernt",
            "priority_target": "zur Prioritätenliste hinzugefügt.",
            "analyse_targets": "Ziele werden analysiert.",
            "step_cycle_restart": "Befehlszyklus wird neu gestartet..",
            "step_cycle_end": "Dorfliste abgearbeitet, warte auf den nächsten Durchlauf.",
            "step_cycle_end_no_villages": "Keine Dörfer verfügbar um den Durchgang zu starten.",
            "step_cycle_next": "Dorfliste abgearbeitet, nächster Durchgang: %d.",
            "step_cycle_next_no_villages": "Kein Dorf verfügbar um den Durchgang zu starten, nächster Durchgang: %d.",
            "full_storage": "Der Speicher des Dorfes ist voll.",
            "farm_stopped": "FarmOverflow angehalten.",
            "farm_started": "FarmOverflow gestartet.",
            "groups_presets": "Gruppen & Vorlagen",
            "presets": "Vorlagen zum Angriff",
            "group_ignored": "Ignoriere Dorfgruppe",
            "group_include": "Dorfgruppe umfassen",
            "group_only": "Greife nur aus Dörfern dieser Gruppen an",
            "attack_interval": "Angriffsintervall",
            "preserve_command_slots": "Befehlsslot aufbewahren",
            "farmer_cycle_interval": "Intervall zwischen den Bauernzyklen",
            "ignore_on_loss": "Ignoriere Dörfer, die Truppenverluste verursachen",
            "ignore_full_storage": "Dörfer mit vollen Speichern überspringen",
            "step_cycle_header": "Farmzyklus",
            "step_cycle": "Farmzyklus aktivieren",
            "step_cycle_notifs": "Benachrichtigungen",
            "target_filters": "Zielfilter",
            "min_distance": "Minimale Distanz des Zieldorfes",
            "max_distance": "Maximale Distanz des Zieldorfes",
            "min_points": "Minimale Punktzahl des Zielsdorfes",
            "max_points": "Maximale Punktzahl des Zieldorfes",
            "max_travel_time": "Maximale Reisezeit",
            "logs_limit": "Max. Anzahl an Protokoll-Einträgen",
            "event_attack": "Angriffe protokollieren",
            "event_village_change": "Dorfwechsel protokollieren",
            "event_priority_add": "Priorisierte Ziele protokollieren",
            "event_ignored_village": "Ignorierte Dörfer protokollieren",
            "settings_saved": "Einstellungen gespeichert!",
            "misc": "Weitere Einstellungen",
            "attack": "angreifen",
            "no_logs": "Keine Angriffe protokolliert",
            "clear_logs": "Protokoll löschen",
            "reseted_logs": "Protokoll wurde zurückgesetzt.",
            "date_added": "Datum hinzugefügt",
            "multiple_attacks_interval": "Intervall zwischen Angriffen im selben Ziel",
            "next_cycle_in": "Nächster Zyklus start in",
            "target_limit_per_village": "Limit der Ziele pro Dorf",
            "ignore_on_loss_tip": "Diese Einstellung funktioniert nur, wenn eine Ignoriergruppe ausgewählt ist.",
            "farmer_behavior": "Landwirte können senden",
            "allow_single_attack_each_target": "Ein einzelner Angriff auf jedes Ziel",
            "allow_multiple_attack_each_target": "Mehrere Angriffe auf jedes Ziel",
            "target_behavior": "Ziele können empfangen",
            "targets_allow_single_farmer": "Angriffe eines einzelnen Bauern",
            "targets_allow_multiple_farmers": "Angriffe von mehreren Bauern"
        },
        "common": {
            "start": "Start",
            "started": "Gestartet",
            "pause": "Pause",
            "paused": "Pausiert",
            "stop": "Anhalten",
            "stopped": "Angehalten",
            "status": "Status",
            "none": "Keine",
            "info": "Informationen",
            "settings": "Einstellungen",
            "others": "Andere",
            "village": "Dorf",
            "villages": "Dörfer",
            "building": "Gebäude",
            "buildings": "Gebäude",
            "level": "Stufe",
            "registers": "Protokoll",
            "filters": "Filter",
            "add": "Hinzufügen",
            "waiting": "Ausstehend",
            "attack": "Angriff",
            "support": "Unterstützung",
            "relocate": "Umsiedlung",
            "activate": "Aktivieren",
            "deactivate": "Deaktivieren",
            "units": "Einheiten",
            "officers": "Offiziere",
            "origin": "Herkunft",
            "target": [
                "Ziel",
                "Ziele"
            ],
            "save": "Speichern",
            "logs": "Protokoll",
            "no-results": "Keine Ergebnisse...",
            "selected": "Ausgewählt",
            "now": "Jetzt",
            "costs": "Kosten",
            "duration": "Dauer",
            "points": "Punkte",
            "player": "Spieler",
            "players": "Spieler",
            "next_features": "Kommende Features",
            "misc": "Verschiedenes",
            "colors": "Farben",
            "reset": "Zurücksetzen",
            "reset_settings": "Einstellungen zurücksetzen",
            "reset_settings_confirmation": "Möchten Sie die Einstellungen wirklich zurücksetzen?",
            "here": "hier",
            "disabled": "— Deaktiviert —",
            "cancel": "Abbrechen",
            "actions": "Aktionen",
            "remove": "Entfernen",
            "started_at": "Gestartet um",
            "arrive": "Ankommen",
            "settings_saved": "Einstellungen gespeichert",
            "settings_reseted": "Einstellungen zurückgesetzt",
            "discard": "Abbrechen",
            "new_version": "TWOverflow aktualisiert auf Version %d",
            "check_changes": "Klicke hier um alle Änderungen anzuzeigen",
            "firefox_shill": "Wenn du möchtest, dass das Skript im Hintergrund läuft, dann verwende Firefox anstelle von Chrome basierten Browsern.",
            "error_invalid_interval": "Ungültiges Zeitformat für %d.",
            "readable_time_format": "Beispiele für Zeitformate: 1 Minute, 30 Minuten, 4 Stunden, 1 Tag."
        }
    },
    "el_gr": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Ανοίξτε την αναφορά",
            "no_report": "Χωρίς αναφορά",
            "reports": "Αναφορές",
            "date": "Σου δίνει",
            "status_time_limit": "Ο στόχος είναι πολύ μακριά",
            "status_command_limit": "Όριο εντολών",
            "status_full_storage": "Ο χώρος αποθήκευσης είναι πλήρης",
            "status_no_units": "Δεν υπάρχουν διαθέσιμες μονάδες",
            "status_abandoned_conquered": "Εγκαταλελειμμένο κατακτήθηκε",
            "status_protected_village": "Ο στόχος προστατεύεται",
            "status_busy_target": "Ο στόχος είναι επίθεση",
            "status_no_targets": "Δεν υπάρχουν διαθέσιμοι στόχοι",
            "status_target_cycle_end": "Ο κύκλος στόχος έληξε",
            "status_not_allowed_points": "Δεν επιτρέπονται τα σημεία προορισμού",
            "status_unknown": "Άγνωστη κατάσταση",
            "status_attacking": "Επίθεση",
            "status_waiting_cycle": "Κύκλος αναμονής",
            "status_user_stop": "Διακόπηκε από τον παίκτη",
            "status_expired_step": "Έληξε εντολή",
            "not_loaded": "Μη φορτωμένο.",
            "ignored_targets": "Αγνοημένοι στόχοι",
            "no_ignored_targets": "Τίποτα δεν αγνοήθηκε",
            "included_targets": "Συμπεριλαμβανόμενοι στόχοι",
            "no_included_targets": "Τίποτα δεν περιλαμβάνεται",
            "farmer_villages": "Χωριά αγροτών",
            "no_farmer_villages": "Χωρίς χωριά αγροτών",
            "last_status": "Τελευταία κατάσταση",
            "attacking": "Επίθεση.",
            "paused": "Σε παύση",
            "command_limit": "Έφτασε το όριο των 50 επιθέσεων, περιμένοντας την επιστροφή.",
            "last_attack": "Τελευταία επίθεση",
            "village_switch": "Αλλαγή σε χωριό",
            "no_preset": "Δεν υπάρχουν διαθέσιμες προεπιλογές.",
            "no_selected_village": "Χωρίς διαθέσιμα χωριά.",
            "no_units": "Δεν υπάρχουν διαθέσιμες μονάδες στο χωριό, περιμένοντας τις επιθέσεις να επιστρέψουν.",
            "no_units_no_commands": "Κανένα χωριό δεν έχει επιστρέψει μονάδες ή εντολές.",
            "no_villages": "Δεν υπάρχουν διαθέσιμα χωριά, περιμένουν να επιστρέψουν οι επιθέσεις.",
            "preset_first": "Ορίστε πρώτα μια προεπιλογή!",
            "selected_village": "Το χωριό επιλέχθηκε",
            "loading_targets": "Φόρτωση στόχων ...",
            "checking_targets": "Έλεγχος στόχων ...",
            "restarting_commands": "Επανεκκίνηση εντολών ...",
            "ignored_village": "προστέθηκε στη λίστα που αγνοήθηκε",
            "included_village": "προστέθηκε στη λίστα που περιλαμβάνεται",
            "ignored_village_removed": "καταργήθηκε από τη λίστα που αγνοήθηκε",
            "included_village_removed": "καταργήθηκε από τη λίστα που περιλαμβάνεται",
            "priority_target": "προστέθηκε στις προτεραιότητες.",
            "analyse_targets": "Ανάλυση στόχων.",
            "step_cycle_restart": "Επανεκκίνηση του κύκλου εντολών ..",
            "step_cycle_end": "Ο κατάλογος των χωριών έληξε, περιμένοντας την επόμενη διαδρομή.",
            "step_cycle_end_no_villages": "Δεν υπάρχουν διαθέσιμα χωριά για να ξεκινήσει ο κύκλος.",
            "step_cycle_next": "Ο κατάλογος των χωριών έχει τελειώσει, τον επόμενο κύκλο: %d.",
            "step_cycle_next_no_villages": "Δεν υπάρχει διαθέσιμο χωριό για έναρξη του κύκλου, επόμενος κύκλος: %d.",
            "full_storage": "Η αποθήκη του χωριού είναι πλήρης.",
            "farm_stopped": "Το FarmOverflow σταμάτησε.",
            "farm_started": "Ξεκίνησε το FarmOverflow.",
            "groups_presets": "Ομάδες & προεπιλογές",
            "presets": "Επίθεση με τις προεπιλογές",
            "group_ignored": "Αγνοήστε τα χωριά από την ομάδα",
            "group_include": "Συμπεριλάβετε χωριά από ομάδες",
            "group_only": "Επιθέσεις μόνο με χωριά από ομάδες",
            "attack_interval": "Διάστημα μεταξύ επιθέσεων",
            "preserve_command_slots": "Διατήρηση κουλοχέρη εντολών",
            "farmer_cycle_interval": "Διάστημα μεταξύ των κύκλων των αγροτών",
            "ignore_on_loss": "Αγνοήστε το στόχο που προκαλεί απώλεια",
            "ignore_full_storage": "Μην καλλιεργείτε με χωριά με πλήρη αποθήκη",
            "step_cycle_header": "Ρυθμίσεις κύκλου βημάτων",
            "step_cycle": "Ενεργοποίηση κύκλου βημάτων",
            "step_cycle_notifs": "Ειδοποιήσεις κύκλου",
            "target_filters": "Φίλτρα προορισμού",
            "min_distance": "Ελάχιστοι στόχοι απόστασης",
            "max_distance": "Στοχεύει τη μέγιστη απόσταση",
            "min_points": "Στοχεύει ελάχιστους πόντους",
            "max_points": "Στοχεύει τα μέγιστα σημεία",
            "max_travel_time": "Μέγιστος χρόνος ταξιδιού",
            "logs_limit": "Μέγιστος αριθμός καταχωρήσεων καταγραφής",
            "event_attack": "Εμφάνιση αρχείων καταγραφής εργασιών επιθέσεων",
            "event_village_change": "Εμφάνιση αρχείων καταγραφής εργασιών των αλλαγών του χωριού",
            "event_priority_add": "Εμφάνιση αρχείων καταγραφής εργασιών στόχων προτεραιότητας",
            "event_ignored_village": "Εμφάνιση αρχείων καταγραφής εργασιών αγνοημένων χωριών",
            "settings_saved": "Οι ρυθμίσεις αποθηκεύτηκαν!",
            "misc": "Διάφορα",
            "attack": "επίθεση",
            "no_logs": "Δεν έχουν καταχωρηθεί αρχεία καταγραφής",
            "clear_logs": "Εκκαθάριση αρχείων καταγραφής",
            "reseted_logs": "Έγινε επαναφορά των καταχωρημένων αρχείων καταγραφής.",
            "date_added": "Ημερομηνία προστέθηκε",
            "multiple_attacks_interval": "Διάστημα μεταξύ επιθέσεων στον ίδιο στόχο",
            "next_cycle_in": "Ο επόμενος κύκλος ξεκινά στις",
            "target_limit_per_village": "Όριο στόχων ανά χωριό",
            "ignore_on_loss_tip": "Αυτή η ρύθμιση λειτουργεί μόνο όταν έχει επιλεγεί μια ομάδα παράβλεψης.",
            "farmer_behavior": "Οι αγρότες μπορούν να στείλουν",
            "allow_single_attack_each_target": "Μία επίθεση σε κάθε στόχο",
            "allow_multiple_attack_each_target": "Πολλαπλές επιθέσεις σε κάθε στόχο",
            "target_behavior": "Οι στόχοι μπορούν να λάβουν",
            "targets_allow_single_farmer": "Επιθέσεις από έναν μόνο αγρότη",
            "targets_allow_multiple_farmers": "Επιθέσεις από πολλούς αγρότες"
        },
        "common": {
            "start": "Αρχή",
            "started": "Ξεκίνησε",
            "pause": "Παύση",
            "paused": "Σε παύση",
            "stop": "Να σταματήσει",
            "stopped": "Διακόπηκε",
            "status": "Κατάσταση",
            "none": "Κανένας",
            "info": "Πληροφορίες",
            "settings": "Ρυθμίσεις",
            "others": "Οι υπολοιποι",
            "village": "Χωριό",
            "villages": "Χωριά",
            "building": "Κτίριο",
            "buildings": "Κτίρια",
            "level": "Επίπεδο",
            "registers": "Κούτσουρα",
            "filters": "Φίλτρα",
            "add": "Προσθήκη",
            "waiting": "Αναμονή",
            "attack": "Επίθεση",
            "support": "Υποστήριξη",
            "relocate": "ΜΕΤΑΦΟΡΑ",
            "activate": "Θέτω εις ενέργειαν",
            "deactivate": "Καθιστώ ανίκανο",
            "units": "Μονάδες",
            "officers": "Αξιωματικοί",
            "origin": "Προέλευση",
            "target": [
                "Στόχος",
                "Στόχοι"
            ],
            "save": "Σώσει",
            "logs": "Κούτσουρα",
            "no-results": "Χωρίς αποτέλεσμα ...",
            "selected": "Επιλεγμένο",
            "now": "Τώρα",
            "costs": "Δικαστικά έξοδα",
            "duration": "Διάρκεια",
            "points": "Πόντοι",
            "player": "Παίχτης",
            "players": "Παίκτες",
            "next_features": "Επόμενα χαρακτηριστικά",
            "misc": "Διάφορα",
            "colors": "Χρωματιστά",
            "reset": "Επαναφορά",
            "reset_settings": "Επαναφορά ρυθμίσεων",
            "reset_settings_confirmation": "Είστε βέβαιοι ότι θέλετε να επαναφέρετε τις ρυθμίσεις;",
            "here": "εδώ",
            "disabled": "- Ατομα με ειδικές ανάγκες -",
            "cancel": "Ματαίωση",
            "actions": "Ενέργειες",
            "remove": "Αφαιρώ",
            "started_at": "Ξεκίνησε στις",
            "arrive": "Φθάνω",
            "settings_saved": "Οι ρυθμίσεις αποθηκεύτηκαν",
            "settings_reseted": "Έγινε επαναφορά των ρυθμίσεων",
            "discard": "Απορρίπτω",
            "new_version": "Το TWOverflow ενημερώθηκε στην έκδοση %d",
            "check_changes": "Κάντε κλικ εδώ για να ελέγξετε τις αλλαγές",
            "firefox_shill": "Εάν θέλετε το σενάριο να λειτουργεί σωστά στο παρασκήνιο, χρησιμοποιήστε τον Firefox αντί για προγράμματα περιήγησης που βασίζονται στο Chrome.",
            "error_invalid_interval": "Μη έγκυρη μορφή ώρας για %d.",
            "readable_time_format": "Παραδείγματα μορφής ώρας: 1 λεπτό, 30 λεπτά, 4 ώρες, 1 ημέρα."
        }
    },
    "en_us": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Open report",
            "no_report": "No report",
            "reports": "Reports",
            "date": "Date",
            "status_time_limit": "Target is too far",
            "status_command_limit": "Command limit",
            "status_full_storage": "Storage is full",
            "status_no_units": "No units available",
            "status_abandoned_conquered": "Abandoned conquered",
            "status_protected_village": "Target is protected",
            "status_busy_target": "Target is under attack",
            "status_no_targets": "No targets available",
            "status_target_cycle_end": "Target cycle ended",
            "status_not_allowed_points": "Target points not allowed",
            "status_unknown": "Unknown status",
            "status_attacking": "Attacking",
            "status_waiting_cycle": "Waiting cycle",
            "status_user_stop": "Stopped by player",
            "status_expired_step": "Expired command",
            "not_loaded": "Not loaded.",
            "ignored_targets": "Ignored Targets",
            "no_ignored_targets": "Nothing ignored",
            "included_targets": "Included Targets",
            "no_included_targets": "Nothing included",
            "farmer_villages": "Farmer Villages",
            "no_farmer_villages": "No farmer villages",
            "last_status": "Last Status",
            "attacking": "Attacking.",
            "paused": "Paused.",
            "command_limit": "Limit of 50 attacks reached, waiting return.",
            "last_attack": "Last attack",
            "village_switch": "Changing to village",
            "no_preset": "No presets avaliable.",
            "no_selected_village": "No villages avaliable.",
            "no_units": "No units avaliable in village, waiting attacks return.",
            "no_units_no_commands": "No villages has units or commands returning.",
            "no_villages": "No villages avaliable, waiting attacks return.",
            "preset_first": "Set a preset first!",
            "selected_village": "Village selected",
            "loading_targets": "Loading targets...",
            "checking_targets": "Checking targets...",
            "restarting_commands": "Restarting commands...",
            "ignored_village": "added to the ignored list",
            "included_village": "added to the included list",
            "ignored_village_removed": "removed from the ignored list",
            "included_village_removed": "removed from the included list",
            "priority_target": "added to priorities.",
            "analyse_targets": "Analysing targets.",
            "step_cycle_restart": "Restarting the cycle of commands..",
            "step_cycle_end": "The list of villages ended, waiting for the next run.",
            "step_cycle_end_no_villages": "No villages available to start the cycle.",
            "step_cycle_next": "The list of villages is over, next cycle: %d.",
            "step_cycle_next_no_villages": "No village available to start the cycle, next cycle: %d.",
            "full_storage": "The storage of the village is full.",
            "farm_stopped": "FarmOverflow stopped.",
            "farm_started": "FarmOverflow started.",
            "groups_presets": "Groups & presets",
            "presets": "Attack with the presets",
            "group_ignored": "Ignore villages from group",
            "group_include": "Include villages from groups",
            "group_only": "Only attack with villages from groups",
            "attack_interval": "Interval between attacks",
            "preserve_command_slots": "Preserve command slots",
            "farmer_cycle_interval": "Interval between farmer cycles",
            "ignore_on_loss": "Ignore target that cause loss",
            "ignore_full_storage": "Do not farm with villages with full storage",
            "step_cycle_header": "Step Cycle Settings",
            "step_cycle": "Enable Step Cycle",
            "step_cycle_notifs": "Cycle notifications",
            "target_filters": "Target Filters",
            "min_distance": "Targets minimum distance",
            "max_distance": "Targets maximum distance",
            "min_points": "Targets minimum points",
            "max_points": "Targets maximum points",
            "max_travel_time": "Maximum travel time",
            "logs_limit": "Maximum amount of log entries",
            "event_attack": "Show task logs of attacks",
            "event_village_change": "Show task logs of village's changes",
            "event_priority_add": "Show task logs of priority targets",
            "event_ignored_village": "Show task logs of ignored villages",
            "settings_saved": "Settings saved!",
            "misc": "Miscellaneous",
            "attack": "attack",
            "no_logs": "No logs registered",
            "clear_logs": "Clear logs",
            "reseted_logs": "Registered logs reseted.",
            "date_added": "Date added",
            "multiple_attacks_interval": "Interval between attacks in the same target",
            "next_cycle_in": "Next cycle starts in",
            "target_limit_per_village": "Limit of targets per village",
            "ignore_on_loss_tip": "This setting only works when there's a ignore group selected.",
            "farmer_behavior": "Farmers can send",
            "allow_single_attack_each_target": "A single attack to each target",
            "allow_multiple_attack_each_target": "Multiple attacks to each target",
            "target_behavior": "Targets can receive",
            "targets_allow_single_farmer": "Attacks from a single farmer",
            "targets_allow_multiple_farmers": "Attacks from multiple farmers"
        },
        "common": {
            "start": "Start",
            "started": "Started",
            "pause": "Pause",
            "paused": "Paused",
            "stop": "Stop",
            "stopped": "Stopped",
            "status": "Status",
            "none": "None",
            "info": "Information",
            "settings": "Settings",
            "others": "Others",
            "village": "Village",
            "villages": "Villages",
            "building": "Building",
            "buildings": "Buildings",
            "level": "Level",
            "registers": "Logs",
            "filters": "Filters",
            "add": "Add",
            "waiting": "Waiting",
            "attack": "Attack",
            "support": "Support",
            "relocate": "Transfer",
            "activate": "Activate",
            "deactivate": "Disable",
            "units": "Units",
            "officers": "Officers",
            "origin": "Origin",
            "target": [
                "Target",
                "Targets"
            ],
            "save": "Save",
            "logs": "Logs",
            "no-results": "No results...",
            "selected": "Selected",
            "now": "Now",
            "costs": "Costs",
            "duration": "Duration",
            "points": "Points",
            "player": "Player",
            "players": "Players",
            "next_features": "Next features",
            "misc": "Miscellaneous",
            "colors": "Colors",
            "reset": "Reset",
            "reset_settings": "Reset Settings",
            "reset_settings_confirmation": "Are you sure you want to reset the settings?",
            "here": "here",
            "disabled": "— Disabled —",
            "cancel": "Cancel",
            "actions": "Actions",
            "remove": "Remove",
            "started_at": "Started at",
            "arrive": "Arrive",
            "settings_saved": "Settings saved",
            "settings_reseted": "Settings reseted",
            "discard": "Discard",
            "new_version": "TWOverflow updated to version %d",
            "check_changes": "Click here to check the changes",
            "firefox_shill": "If you want the script to work properly in the background, use Firefox instead of Chrome based browsers.",
            "error_invalid_interval": "Invalid time format for %d.",
            "readable_time_format": "Time format examples: 1 minute, 30 minutes, 4 hours, 1 day."
        }
    },
    "es_es": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Abrir el informe",
            "no_report": "Sin informe",
            "reports": "Informes",
            "date": "Te dio",
            "status_time_limit": "El objetivo está demasiado lejos",
            "status_command_limit": "Límite de comando",
            "status_full_storage": "El almacenamiento está lleno",
            "status_no_units": "No hay unidades disponibles",
            "status_abandoned_conquered": "Abandonado conquistado",
            "status_protected_village": "El objetivo está protegido",
            "status_busy_target": "El objetivo está bajo ataque",
            "status_no_targets": "No hay objetivos disponibles",
            "status_target_cycle_end": "Finalizó el ciclo objetivo",
            "status_not_allowed_points": "Puntos objetivo no permitidos",
            "status_unknown": "Estado desconocido",
            "status_attacking": "Agresor",
            "status_waiting_cycle": "Ciclo de espera",
            "status_user_stop": "Detenido por jugador",
            "status_expired_step": "Comando caducado",
            "not_loaded": "Sin cargar.",
            "ignored_targets": "Objetivos ignorados",
            "no_ignored_targets": "Nada ignorado",
            "included_targets": "Objetivos incluidos",
            "no_included_targets": "Nada incluido",
            "farmer_villages": "Aldeas de agricultores",
            "no_farmer_villages": "No hay pueblos de agricultores",
            "last_status": "Último estado",
            "attacking": "Agresor.",
            "paused": "Pausado.",
            "command_limit": "Límite de 50 ataques alcanzado, esperando regreso.",
            "last_attack": "Último ataque",
            "village_switch": "Cambiando a la aldea",
            "no_preset": "No hay ajustes preestablecidos disponibles.",
            "no_selected_village": "No hay pueblos disponibles.",
            "no_units": "No hay unidades disponibles en la aldea, los ataques en espera regresan.",
            "no_units_no_commands": "Ningún pueblo tiene unidades o comandos que regresen.",
            "no_villages": "No hay pueblos disponibles, esperando que regresen los ataques.",
            "preset_first": "¡Primero establezca un preset!",
            "selected_village": "Pueblo seleccionado",
            "loading_targets": "Cargando objetivos ...",
            "checking_targets": "Comprobando objetivos ...",
            "restarting_commands": "Reiniciando comandos ...",
            "ignored_village": "agregado a la lista ignorada",
            "included_village": "agregado a la lista incluida",
            "ignored_village_removed": "eliminado de la lista ignorada",
            "included_village_removed": "eliminado de la lista incluida",
            "priority_target": "añadido a las prioridades.",
            "analyse_targets": "Analizando objetivos.",
            "step_cycle_restart": "Reinicio del ciclo de comandos.",
            "step_cycle_end": "La lista de pueblos terminó, esperando la próxima carrera.",
            "step_cycle_end_no_villages": "No hay pueblos disponibles para iniciar el ciclo.",
            "step_cycle_next": "La lista de pueblos ha terminado, próximo ciclo: %d.",
            "step_cycle_next_no_villages": "No hay aldea disponible para iniciar el ciclo, próximo ciclo: %d.",
            "full_storage": "El almacenamiento del pueblo está lleno.",
            "farm_stopped": "FarmOverflow se detuvo.",
            "farm_started": "FarmOverflow comenzó.",
            "groups_presets": "Grupos y presets",
            "presets": "Ataca con los presets",
            "group_ignored": "Ignorar pueblos del grupo",
            "group_include": "Incluir pueblos de grupos",
            "group_only": "Solo ataca con aldeas de grupos",
            "attack_interval": "Intervalo entre ataques",
            "preserve_command_slots": "Conservar ranuras de comando",
            "farmer_cycle_interval": "Intervalo entre ciclos de agricultores",
            "ignore_on_loss": "Ignorar el objetivo que causa la pérdida",
            "ignore_full_storage": "No cultive con aldeas con almacenamiento completo",
            "step_cycle_header": "Configuración del ciclo de pasos",
            "step_cycle": "Habilitar ciclo de pasos",
            "step_cycle_notifs": "Notificaciones de ciclo",
            "target_filters": "Filtros de destino",
            "min_distance": "Objetivos de distancia mínima",
            "max_distance": "Objetivos distancia máxima",
            "min_points": "Objetivos puntos mínimos",
            "max_points": "Objetivos máximos de puntos",
            "max_travel_time": "Tiempo máximo de viaje",
            "logs_limit": "Cantidad máxima de entradas de registro",
            "event_attack": "Mostrar registros de tareas de ataques",
            "event_village_change": "Mostrar registros de tareas de los cambios de la aldea",
            "event_priority_add": "Mostrar registros de tareas de objetivos prioritarios",
            "event_ignored_village": "Mostrar registros de tareas de pueblos ignorados",
            "settings_saved": "¡Configuración guardada!",
            "misc": "Diverso",
            "attack": "ataque",
            "no_logs": "No hay registros registrados",
            "clear_logs": "Registros claros",
            "reseted_logs": "Registros registrados reseteados.",
            "date_added": "Fecha Agregada",
            "multiple_attacks_interval": "Intervalo entre ataques en el mismo objetivo",
            "next_cycle_in": "El siguiente ciclo comienza en",
            "target_limit_per_village": "Límite de objetivos por aldea",
            "ignore_on_loss_tip": "Esta configuración solo funciona cuando hay un grupo de ignorar seleccionado.",
            "farmer_behavior": "Los agricultores pueden enviar",
            "allow_single_attack_each_target": "Un solo ataque a cada objetivo",
            "allow_multiple_attack_each_target": "Múltiples ataques a cada objetivo",
            "target_behavior": "Los objetivos pueden recibir",
            "targets_allow_single_farmer": "Ataques de un solo agricultor",
            "targets_allow_multiple_farmers": "Ataques de múltiples agricultores"
        },
        "common": {
            "start": "comienzo",
            "started": "Empezado",
            "pause": "Pausa",
            "paused": "Pausado",
            "stop": "Detener",
            "stopped": "Detenido",
            "status": "Estado",
            "none": "Ninguna",
            "info": "Información",
            "settings": "Configuraciones",
            "others": "Otros",
            "village": "Pueblo",
            "villages": "Pueblos",
            "building": "Edificio",
            "buildings": "Edificios",
            "level": "Nivel",
            "registers": "Registros",
            "filters": "Filtros",
            "add": "Añadir",
            "waiting": "Esperando",
            "attack": "Ataque",
            "support": "Apoyo",
            "relocate": "Transferir",
            "activate": "Activar",
            "deactivate": "Desactivar",
            "units": "Unidades",
            "officers": "Oficiales",
            "origin": "Origen",
            "target": [
                "Objetivo",
                "Objetivos"
            ],
            "save": "Salvar",
            "logs": "Registros",
            "no-results": "No hay resultados ...",
            "selected": "Seleccionado",
            "now": "Ahora",
            "costs": "Costos",
            "duration": "Duración",
            "points": "Puntos",
            "player": "Jugador",
            "players": "Jugadores",
            "next_features": "Características siguientes",
            "misc": "Diverso",
            "colors": "Colores",
            "reset": "Reiniciar",
            "reset_settings": "Reiniciar ajustes",
            "reset_settings_confirmation": "¿Está seguro de que desea restablecer la configuración?",
            "here": "Aquí",
            "disabled": "- Discapacitado -",
            "cancel": "Cancelar",
            "actions": "Comportamiento",
            "remove": "Eliminar",
            "started_at": "Empezó a las",
            "arrive": "Llegar",
            "settings_saved": "Ajustes guardados",
            "settings_reseted": "Configuración restablecida",
            "discard": "Descarte",
            "new_version": "TWOverflow actualizado a la versión %d",
            "check_changes": "Haga clic aquí para verificar los cambios",
            "firefox_shill": "Si desea que la secuencia de comandos funcione correctamente en segundo plano, use Firefox en lugar de navegadores basados en Chrome.",
            "error_invalid_interval": "Formato de hora no válido para %d.",
            "readable_time_format": "Ejemplos de formato de hora: 1 minuto, 30 minutos, 4 horas, 1 día."
        }
    },
    "fr_fr": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Rapport ouvert",
            "no_report": "Aucun rapport",
            "reports": "Rapports",
            "date": "Vous donne",
            "status_time_limit": "La cible est trop loin",
            "status_command_limit": "Limite de commande",
            "status_full_storage": "Le stockage est plein",
            "status_no_units": "Aucune unité disponible",
            "status_abandoned_conquered": "Abandonné conquis",
            "status_protected_village": "La cible est protégée",
            "status_busy_target": "La cible est attaquée",
            "status_no_targets": "Aucune cible disponible",
            "status_target_cycle_end": "Cycle cible terminé",
            "status_not_allowed_points": "Points cibles non autorisés",
            "status_unknown": "État inconnu",
            "status_attacking": "Attaquer",
            "status_waiting_cycle": "Cycle d'attente",
            "status_user_stop": "Arrêté par le joueur",
            "status_expired_step": "Commande expirée",
            "not_loaded": "Pas chargé.",
            "ignored_targets": "Cibles ignorées",
            "no_ignored_targets": "Rien d'ignoré",
            "included_targets": "Cibles incluses",
            "no_included_targets": "Rien d'inclus",
            "farmer_villages": "Villages fermiers",
            "no_farmer_villages": "Pas de villages fermiers",
            "last_status": "Dernier statut",
            "attacking": "Attaquer.",
            "paused": "En pause.",
            "command_limit": "Limite de 50 attaques atteintes, en attente de retour.",
            "last_attack": "Dernière attaque",
            "village_switch": "Changement au village",
            "no_preset": "Aucun préréglage disponible.",
            "no_selected_village": "Pas de villages disponibles.",
            "no_units": "Aucune unité disponible dans le village, les attaques en attente reviennent.",
            "no_units_no_commands": "Aucun village n'a d'unités ou de commandes de retour.",
            "no_villages": "Aucun village disponible, les attaques en attente reviennent.",
            "preset_first": "Définissez d'abord un préréglage!",
            "selected_village": "Village sélectionné",
            "loading_targets": "Chargement des cibles ...",
            "checking_targets": "Vérification des cibles ...",
            "restarting_commands": "Redémarrage des commandes ...",
            "ignored_village": "ajouté à la liste ignorée",
            "included_village": "ajouté à la liste incluse",
            "ignored_village_removed": "supprimé de la liste ignorée",
            "included_village_removed": "retiré de la liste incluse",
            "priority_target": "ajouté aux priorités.",
            "analyse_targets": "Analyse des cibles.",
            "step_cycle_restart": "Redémarrage du cycle de commandes.",
            "step_cycle_end": "La liste des villages s'est terminée, en attendant la prochaine course.",
            "step_cycle_end_no_villages": "Aucun village disponible pour démarrer le cycle.",
            "step_cycle_next": "La liste des villages est terminée, cycle suivant: %d.",
            "step_cycle_next_no_villages": "Aucun village disponible pour démarrer le cycle, cycle suivant: %d.",
            "full_storage": "Le stockage du village est plein.",
            "farm_stopped": "FarmOverflow s'est arrêté.",
            "farm_started": "FarmOverflow a démarré.",
            "groups_presets": "Groupes et préréglages",
            "presets": "Attaque avec les préréglages",
            "group_ignored": "Ignorer les villages du groupe",
            "group_include": "Inclure les villages des groupes",
            "group_only": "Attaque uniquement avec les villages des groupes",
            "attack_interval": "Intervalle entre les attaques",
            "preserve_command_slots": "Préserver les emplacements de commande",
            "farmer_cycle_interval": "Intervalle entre les cycles des agriculteurs",
            "ignore_on_loss": "Ignorer la cible qui cause la perte",
            "ignore_full_storage": "Ne pas cultiver avec des villages avec un stockage complet",
            "step_cycle_header": "Paramètres du cycle d'étape",
            "step_cycle": "Activer le cycle d'étape",
            "step_cycle_notifs": "Notifications de cycle",
            "target_filters": "Filtres cibles",
            "min_distance": "Objectifs de distance minimale",
            "max_distance": "Cible la distance maximale",
            "min_points": "Cible les points minimum",
            "max_points": "Cible le maximum de points",
            "max_travel_time": "Temps de trajet maximum",
            "logs_limit": "Nombre maximum d'entrées de journal",
            "event_attack": "Afficher les journaux de tâches des attaques",
            "event_village_change": "Afficher les journaux des tâches des changements du village",
            "event_priority_add": "Afficher les journaux de tâches des cibles prioritaires",
            "event_ignored_village": "Afficher les journaux de tâches des villages ignorés",
            "settings_saved": "Paramètres sauvegardés!",
            "misc": "Divers",
            "attack": "attaque",
            "no_logs": "Aucun journal enregistré",
            "clear_logs": "Effacer les journaux",
            "reseted_logs": "Les journaux enregistrés ont été réinitialisés.",
            "date_added": "Date ajoutée",
            "multiple_attacks_interval": "Intervalle entre les attaques dans la même cible",
            "next_cycle_in": "Le prochain cycle commence dans",
            "target_limit_per_village": "Limite de cibles par village",
            "ignore_on_loss_tip": "Ce paramètre ne fonctionne que lorsqu'un groupe ignoré est sélectionné.",
            "farmer_behavior": "Les agriculteurs peuvent envoyer",
            "allow_single_attack_each_target": "Une seule attaque sur chaque cible",
            "allow_multiple_attack_each_target": "Attaques multiples sur chaque cible",
            "target_behavior": "Les cibles peuvent recevoir",
            "targets_allow_single_farmer": "Attaques d'un seul agriculteur",
            "targets_allow_multiple_farmers": "Attaques de plusieurs agriculteurs"
        },
        "common": {
            "start": "Début",
            "started": "Commencé",
            "pause": "Pause",
            "paused": "En pause",
            "stop": "Arrêtez",
            "stopped": "Arrêté",
            "status": "Statut",
            "none": "Aucun",
            "info": "Information",
            "settings": "Paramètres",
            "others": "Autres",
            "village": "Village",
            "villages": "Villages",
            "building": "Bâtiment",
            "buildings": "Bâtiments",
            "level": "Niveau",
            "registers": "Journaux",
            "filters": "Filtres",
            "add": "Ajouter",
            "waiting": "Attendre",
            "attack": "Attaque",
            "support": "Soutien",
            "relocate": "Transfert",
            "activate": "Activer",
            "deactivate": "Désactiver",
            "units": "Unités",
            "officers": "Officiers",
            "origin": "Origine",
            "target": [
                "Cible",
                "Cibles"
            ],
            "save": "sauver",
            "logs": "Journaux",
            "no-results": "Aucun résultat ...",
            "selected": "Choisi",
            "now": "Maintenant",
            "costs": "Frais",
            "duration": "Durée",
            "points": "Points",
            "player": "Joueur",
            "players": "Joueurs",
            "next_features": "Fonctionnalités suivantes",
            "misc": "Divers",
            "colors": "Couleurs",
            "reset": "Réinitialiser",
            "reset_settings": "Réinitialiser les options",
            "reset_settings_confirmation": "Voulez-vous vraiment réinitialiser les paramètres?",
            "here": "Ici",
            "disabled": "- Désactivée -",
            "cancel": "Annuler",
            "actions": "Actions",
            "remove": "Retirer",
            "started_at": "Commencé à",
            "arrive": "Arrivée",
            "settings_saved": "Paramètres sauvegardés",
            "settings_reseted": "Paramètres réinitialisés",
            "discard": "Jeter",
            "new_version": "TWOverflow mis à jour vers la version %d",
            "check_changes": "Cliquez ici pour vérifier les changements",
            "firefox_shill": "Si vous souhaitez que le script fonctionne correctement en arrière-plan, utilisez Firefox au lieu des navigateurs basés sur Chrome.",
            "error_invalid_interval": "Format d'heure non valide pour %d.",
            "readable_time_format": "Exemples de format d'heure: 1 minute, 30 minutes, 4 heures, 1 jour."
        }
    },
    "nl_nl": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Open rapport",
            "no_report": "Geen rapport",
            "reports": "Rapporten",
            "date": "Geeft jou",
            "status_time_limit": "Doel is te ver",
            "status_command_limit": "Commando limiet",
            "status_full_storage": "Opslag is vol",
            "status_no_units": "Geen units beschikbaar",
            "status_abandoned_conquered": "Verlaten veroverd",
            "status_protected_village": "Doelwit is beschermd",
            "status_busy_target": "Doelwit wordt aangevallen",
            "status_no_targets": "Geen doelen beschikbaar",
            "status_target_cycle_end": "Doelcyclus beëindigd",
            "status_not_allowed_points": "Richtpunten niet toegestaan",
            "status_unknown": "Onbekende status",
            "status_attacking": "Aanvallen",
            "status_waiting_cycle": "Wachten cyclus",
            "status_user_stop": "Gestopt door speler",
            "status_expired_step": "Verlopen commando",
            "not_loaded": "Niet geladen.",
            "ignored_targets": "Genegeerde doelen",
            "no_ignored_targets": "Niets werd genegeerd",
            "included_targets": "Opgenomen doelen",
            "no_included_targets": "Niets inbegrepen",
            "farmer_villages": "Boerendorpen",
            "no_farmer_villages": "Geen boerendorpen",
            "last_status": "Laatste status",
            "attacking": "Aanvallen.",
            "paused": "Onderbroken.",
            "command_limit": "Limiet van 50 aanvallen bereikt, wachtend op terugkeer.",
            "last_attack": "Laatste aanval",
            "village_switch": "Overstappen naar dorp",
            "no_preset": "Geen beschikbare voorinstellingen.",
            "no_selected_village": "Geen beschikbare dorpen.",
            "no_units": "Geen eenheden beschikbaar in het dorp, wachtende aanvallen keren terug.",
            "no_units_no_commands": "Geen enkel dorp heeft eenheden of commando's die terugkeren.",
            "no_villages": "Geen dorpen beschikbaar, wachtende aanvallen keren terug.",
            "preset_first": "Stel eerst een preset in!",
            "selected_village": "Dorp geselecteerd",
            "loading_targets": "Doelen laden ...",
            "checking_targets": "Doelen controleren ...",
            "restarting_commands": "Herstartopdrachten ...",
            "ignored_village": "toegevoegd aan de genegeerde lijst",
            "included_village": "toegevoegd aan de opgenomen lijst",
            "ignored_village_removed": "verwijderd uit de genegeerde lijst",
            "included_village_removed": "verwijderd uit de opgenomen lijst",
            "priority_target": "toegevoegd aan prioriteiten.",
            "analyse_targets": "Doelstellingen analyseren.",
            "step_cycle_restart": "De cyclus van opdrachten opnieuw starten ...",
            "step_cycle_end": "De lijst met dorpen eindigde, wachtend op de volgende run.",
            "step_cycle_end_no_villages": "Geen dorpen beschikbaar om de cyclus te starten.",
            "step_cycle_next": "De lijst met dorpen is voorbij, volgende cyclus: %d.",
            "step_cycle_next_no_villages": "Geen dorp beschikbaar om de cyclus te starten, volgende cyclus: %d.",
            "full_storage": "De opslag van het dorp is vol.",
            "farm_stopped": "FarmOverflow is gestopt.",
            "farm_started": "FarmOverflow is gestart.",
            "groups_presets": "Groepen en voorinstellingen",
            "presets": "Val aan met de presets",
            "group_ignored": "Negeer dorpen uit de groep",
            "group_include": "Voeg dorpen uit groepen toe",
            "group_only": "Val alleen aan met dorpen van groepen",
            "attack_interval": "Interval tussen aanvallen",
            "preserve_command_slots": "Bewaar opdrachtsleuven",
            "farmer_cycle_interval": "Interval tussen boerencycli",
            "ignore_on_loss": "Negeer het doelwit dat verlies veroorzaakt",
            "ignore_full_storage": "Boerderij niet met dorpen met volledige opslag",
            "step_cycle_header": "Stap Cyclus Instellingen",
            "step_cycle": "Schakel Step Cycle in",
            "step_cycle_notifs": "Fietsmeldingen",
            "target_filters": "Doelfilters",
            "min_distance": "Minimale afstandsdoelen",
            "max_distance": "Streeft naar maximale afstand",
            "min_points": "Streeft naar minimale punten",
            "max_points": "Streeft naar maximale punten",
            "max_travel_time": "Maximale reistijd",
            "logs_limit": "Maximaal aantal logboekvermeldingen",
            "event_attack": "Toon taaklogboeken van aanvallen",
            "event_village_change": "Toon taaklogboeken van de veranderingen in het dorp",
            "event_priority_add": "Toon taaklogboeken met prioriteitsdoelen",
            "event_ignored_village": "Toon taaklogboeken van genegeerde dorpen",
            "settings_saved": "Instellingen opgeslagen!",
            "misc": "Diversen",
            "attack": "aanval",
            "no_logs": "Geen logboeken geregistreerd",
            "clear_logs": "Logboeken wissen",
            "reseted_logs": "Geregistreerde logboeken gereset.",
            "date_added": "Datum toegevoegd",
            "multiple_attacks_interval": "Interval tussen aanvallen op hetzelfde doelwit",
            "next_cycle_in": "De volgende cyclus begint over",
            "target_limit_per_village": "Limiet van doelen per dorp",
            "ignore_on_loss_tip": "Deze instelling werkt alleen als er een negeergroep is geselecteerd.",
            "farmer_behavior": "Boeren kunnen sturen",
            "allow_single_attack_each_target": "Een enkele aanval op elk doelwit",
            "allow_multiple_attack_each_target": "Meerdere aanvallen op elk doelwit",
            "target_behavior": "Doelen kunnen ontvangen",
            "targets_allow_single_farmer": "Aanvallen van een enkele boer",
            "targets_allow_multiple_farmers": "Aanvallen van meerdere boeren"
        },
        "common": {
            "start": "Begin",
            "started": "Begonnen",
            "pause": "Pauze",
            "paused": "Onderbroken",
            "stop": "Hou op",
            "stopped": "Gestopt",
            "status": "Toestand",
            "none": "Geen",
            "info": "Informatie",
            "settings": "Instellingen",
            "others": "Anderen",
            "village": "Dorp",
            "villages": "Dorpen",
            "building": "Gebouw",
            "buildings": "Gebouwen",
            "level": "Niveau",
            "registers": "Logboeken",
            "filters": "Filters",
            "add": "Toevoegen",
            "waiting": "Aan het wachten",
            "attack": "Aanval",
            "support": "Ondersteuning",
            "relocate": "Overdracht",
            "activate": "Activeren",
            "deactivate": "Uitschakelen",
            "units": "Eenheden",
            "officers": "Officieren",
            "origin": "Oorsprong",
            "target": [
                "Doelwit",
                "Doelen"
            ],
            "save": "Sparen",
            "logs": "Logboeken",
            "no-results": "Geen resultaten ...",
            "selected": "Geselecteerd",
            "now": "Nu",
            "costs": "Kosten",
            "duration": "Looptijd",
            "points": "Punten",
            "player": "Speler",
            "players": "Spelers",
            "next_features": "Volgende functies",
            "misc": "Diversen",
            "colors": "Kleuren",
            "reset": "Reset",
            "reset_settings": "Reset instellingen",
            "reset_settings_confirmation": "Weet u zeker dat u de instellingen wilt resetten?",
            "here": "hier",
            "disabled": "- Gehandicapt -",
            "cancel": "annuleren",
            "actions": "Acties",
            "remove": "Verwijderen",
            "started_at": "Begon bij",
            "arrive": "Aankomen",
            "settings_saved": "Instellingen opgeslagen",
            "settings_reseted": "Instellingen gereset",
            "discard": "Gooi weg",
            "new_version": "TWOverflow bijgewerkt naar versie %d",
            "check_changes": "Klik hier om de wijzigingen te bekijken",
            "firefox_shill": "Als u wilt dat het script op de achtergrond correct werkt, gebruikt u Firefox in plaats van op Chrome gebaseerde browsers.",
            "error_invalid_interval": "Ongeldige tijdnotatie voor %d.",
            "readable_time_format": "Voorbeelden van tijdnotaties: 1 minuut, 30 minuten, 4 uur, 1 dag."
        }
    },
    "pl_pl": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Otwórz raport",
            "no_report": "Nie ma raportu",
            "reports": "Raporty",
            "date": "Data",
            "status_time_limit": "Cel jest zbyt daleko",
            "status_command_limit": "Limit poleceń",
            "status_full_storage": "Magazyn jest pełen",
            "status_no_units": "Brak dostępnych jednostek",
            "status_abandoned_conquered": "Porzucone podbicie",
            "status_protected_village": "Cel jest chroniony",
            "status_busy_target": "Cel jest atakowany",
            "status_no_targets": "Brak dostępnych celów",
            "status_target_cycle_end": "Cykl celów zakończony",
            "status_not_allowed_points": "Punkty celu niedozwolone",
            "status_unknown": "Nieznany status",
            "status_attacking": "Attakuje",
            "status_waiting_cycle": "Cykl czekania",
            "status_user_stop": "Zatrzymano przez gracza",
            "status_expired_step": "Przedawnione rozkazy",
            "not_loaded": "Nie załadowany.",
            "ignored_targets": "Ignorowane cele",
            "no_ignored_targets": "Brak ignorowanych",
            "included_targets": "Zawarte cele",
            "no_included_targets": "Brak zawartych",
            "farmer_villages": "Wioski farmy",
            "no_farmer_villages": "Brak wiosek farm",
            "last_status": "Ostatni status",
            "attacking": "Atakuje.",
            "paused": "Zatrzymany.",
            "command_limit": "Limit 50 ataków osiągnięty, oczekiwanie na powrót wojsk.",
            "last_attack": "Ostatni atak",
            "village_switch": "Przejście do wioski",
            "no_preset": "Brak dostępnych szablonów.",
            "no_selected_village": "Brak dostępnych wiosek.",
            "no_units": "Brak dostępnych jednostek w wiosce, oczekiwanie na powrót wojsk.",
            "no_units_no_commands": "Brak jednostek w wioskach lub powracających wojsk.",
            "no_villages": "Brak dostępnych wiosek, oczekiwanie na powrót wojsk.",
            "preset_first": "Wybierz najpierw szablon!",
            "selected_village": "Wybrana wioska",
            "loading_targets": "Ładowanie celów...",
            "checking_targets": "Sprawdzanie celów...",
            "restarting_commands": "Restartowanie poleceń...",
            "ignored_village": "dodany do listy pominiętych",
            "included_village": "dodany do listy zawartych",
            "ignored_village_removed": "usunięty z listy ignorowanych",
            "included_village_removed": "usunięty z listy zawartych",
            "priority_target": "dodany do priorytetowych.",
            "analyse_targets": "Analizowanie celów.",
            "step_cycle_restart": "Restartowanie cyklu poleceń...",
            "step_cycle_end": "Lista wiosek zakończona, oczekiwanie na następny cykl.",
            "step_cycle_end_no_villages": "Brak wiosek do rozpoczęcia cyklu.",
            "step_cycle_next": "Lista wiosek się skończyła, następny cykl: %d.",
            "step_cycle_next_no_villages": "Brak wioski do rozpoczęcia cyklu, następny cykl: %d.",
            "full_storage": "Magazyn w wiosce jest pełny",
            "farm_stopped": "FarmOverflow zatrzymany.",
            "farm_started": "Farmer uruchomiony",
            "groups_presets": "Grupy i szablony",
            "presets": "Szablony",
            "group_ignored": "Pomijaj wioski z grupy",
            "group_include": "Dodaj wioski z grupy",
            "group_only": "Atakuj tylko wioski z grup",
            "attack_interval": "Przerwa między atakami",
            "preserve_command_slots": "Rezerwuj sloty poleceń",
            "farmer_cycle_interval": "Przerwa pomiędzy cyklami farmienia ",
            "ignore_on_loss": "Pomijaj cele jeśli straty",
            "ignore_full_storage": "Pomijaj wioski jeśli magazyn pełny",
            "step_cycle_header": "Cykl Farmienia",
            "step_cycle": "Włącz Cykl farmienia",
            "step_cycle_notifs": "Powiadomienia",
            "target_filters": "Filtry celów",
            "min_distance": "Minimalna odległość",
            "max_distance": "Maksymalna odległość",
            "min_points": "Minimalna liczba punktów",
            "max_points": "Maksymalna liczba punktów",
            "max_travel_time": "Maksymalny czas podróży",
            "logs_limit": "Maksymalna ilość wpisów logów",
            "event_attack": "Logi ataków",
            "event_village_change": "Logi zmiany wiosek",
            "event_priority_add": "Logi celów priorytetowych",
            "event_ignored_village": "Logi pominiętych wiosek",
            "settings_saved": "Ustawienia zapisane!",
            "misc": "Różne",
            "attack": "atakuje",
            "no_logs": "Brak zarejestrowanych logów",
            "clear_logs": "Wyczyść logi",
            "reseted_logs": "Zarejestrowane logi zostały wyczyszczone.",
            "date_added": "Data dodania",
            "multiple_attacks_interval": "Odstęp między atakami na ten sam cel",
            "next_cycle_in": "Następny cykl rozpocznie się za",
            "target_limit_per_village": "Limit celów na wioske",
            "ignore_on_loss_tip": "To ustawienie działa tylko wtedy, gdy wybrana jest grupa ignorowania.",
            "farmer_behavior": "Rolnicy mogą wysyłać",
            "allow_single_attack_each_target": "Pojedynczy atak na każdy cel",
            "allow_multiple_attack_each_target": "Wiele ataków na każdy cel",
            "target_behavior": "Cele mogą otrzymać",
            "targets_allow_single_farmer": "Ataki jednego rolnika",
            "targets_allow_multiple_farmers": "Ataki wielu farmerów"
        },
        "common": {
            "start": "Start",
            "started": "Uruchomiony",
            "pause": "Pauza",
            "paused": "Wstrzymany",
            "stop": "Zatrzymany",
            "stopped": "Zatrzymany",
            "status": "Status",
            "none": "Żaden",
            "info": "Informacje",
            "settings": "Ustawienia",
            "others": "Inne",
            "village": "Wioska",
            "villages": "Wioski",
            "building": "Budynek",
            "buildings": "Budynki",
            "level": "Poziom",
            "registers": "Logi",
            "filters": "Filtry",
            "add": "Dodaj",
            "waiting": "Oczekujące",
            "attack": "Atak",
            "support": "Wsparcie",
            "relocate": "Przeniesienie",
            "activate": "Aktywuj",
            "deactivate": "Wyłącz",
            "units": "Jednostki",
            "officers": "Oficerowie",
            "origin": "Źródło",
            "target": [
                "Cel",
                "Cele"
            ],
            "save": "Zapisz",
            "logs": "Logi",
            "no-results": "Brak wyników...",
            "selected": "Wybrana",
            "now": "Teraz",
            "costs": "Koszty",
            "duration": "Czas trwania",
            "points": "Punkty",
            "player": "Gracz",
            "players": "Gracze",
            "next_features": "Następne funkcje",
            "misc": "Różne",
            "colors": "Kolory",
            "reset": "Resetuj",
            "reset_settings": "Resetowanie ustawień",
            "reset_settings_confirmation": "Czy na pewno chcesz zresetować ustawienia?",
            "here": "tutaj",
            "disabled": "— Wyłączony —",
            "cancel": "Anuluj",
            "actions": "Akcje",
            "remove": "Usuń",
            "started_at": "Uruchomiony",
            "arrive": "Dotarcie",
            "settings_saved": "Ustawienia zapisane",
            "settings_reseted": "Ustawienia zostały zresetowane",
            "discard": "Odrzuć",
            "new_version": "TWOverflow zaktualizowany do wersji %d",
            "check_changes": "Kliknij tutaj, żeby zobaczyć zmiany",
            "firefox_shill": "Jeśli chcesz, aby skrypt działał dobrze w tle, używaj przeglądarki Firefox zamiast Chrome.",
            "error_invalid_interval": "Nieprawidłowy format czasu dla %d.",
            "readable_time_format": "Przykłady formatu czasu: 1 minuta, 30 minut, 4 godziny, 1 dzień."
        }
    },
    "pt_br": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Abrir relatório",
            "no_report": "Sem relatório",
            "reports": "Relatórios",
            "date": "Data",
            "status_time_limit": "Alvo muito longe",
            "status_command_limit": "Limite de comandos",
            "status_full_storage": "Armazém lotado",
            "status_no_units": "Sem tropas disponíveis",
            "status_abandoned_conquered": "Abandonada conquistada",
            "status_protected_village": "Alvo está protegido",
            "status_busy_target": "Alvo já sob ataque",
            "status_no_targets": "Nenhum alvo disponível",
            "status_target_cycle_end": "Cicle de alvos acabou",
            "status_not_allowed_points": "Pontos do alvo não permitido",
            "status_unknown": "Status desconhecido",
            "status_attacking": "Atacando",
            "status_waiting_cycle": "Aguardando ciclo",
            "status_user_stop": "Parado pelo jogador",
            "status_expired_step": "Comando expirado",
            "not_loaded": "Não carregado",
            "ignored_targets": "Alvos Ignorados",
            "no_ignored_targets": "Nada ignorado",
            "included_targets": "Alvos incluídos",
            "no_included_targets": "Nada incluído",
            "farmer_villages": "Aldeias Farm",
            "no_farmer_villages": "Nenhuma aldeia farm disponível",
            "last_status": "Último Status",
            "attacking": "Atacando.",
            "paused": "Pausado.",
            "command_limit": "Limite de 50 ataques atingido, aguardando retorno.",
            "last_attack": "Último ataque",
            "village_switch": "Alternando para a aldeia",
            "no_preset": "Nenhuma predefinição disponível.",
            "no_selected_village": "Nenhuma aldeia disponível.",
            "no_units": "Sem unidades na aldeia, aguardando ataques retornarem.",
            "no_units_no_commands": "Nenhuma aldeia tem tropas nem ataques retornando.",
            "no_villages": "Nenhuma aldeia disponível, aguardando ataques retornarem.",
            "preset_first": "Configure uma predefinição primeiro!",
            "selected_village": "Aldeia selecionada",
            "loading_targets": "Carregando alvos...",
            "checking_targets": "Checando alvos...",
            "restarting_commands": "Reiniciando comandos...",
            "ignored_village": "adicionado a lista de ignorados",
            "included_village": "adicionado à lista de aldeias incluídas",
            "ignored_village_removed": "removida da lista de aldeias ignoradas",
            "included_village_removed": "removida da lista de aldeias incluídas",
            "priority_target": "adicionado as prioridades.",
            "analyse_targets": "Analisando alvos.",
            "step_cycle_restart": "Reiniciando o ciclo de comandos..",
            "step_cycle_end": "A lista de aldeias acabou, esperando próxima execução.",
            "step_cycle_end_no_villages": "Nenhuma aldeia disponível para iniciar o ciclo.",
            "step_cycle_next": "A lista de aldeias acabou, próximo ciclo: %d.",
            "step_cycle_next_no_villages": "Nenhuma aldeia disponível para iniciar o ciclo, próximo ciclo: %d.",
            "full_storage": "O armazém da aldeia está cheio.",
            "farm_stopped": "FarmOverflow parado.",
            "farm_started": "FarmOverflow iniciado.",
            "groups_presets": "Grupos & predefinições",
            "presets": "Atacar com as predefinições",
            "group_ignored": "Ignorar aldeias do grupo",
            "group_include": "Incluir aldeias dos grupos",
            "group_only": "Atacar apenas com aldeias dos grupos",
            "attack_interval": "Intervalo entre ataques",
            "preserve_command_slots": "Número de comandos a se preservar",
            "farmer_cycle_interval": "Intervalo entre ciclos de farme",
            "ignore_on_loss": "Ignorar alvos que causarem perdas",
            "ignore_full_storage": "Ignorar aldeias com armazém lotado",
            "step_cycle_header": "Configurações de Ciclos",
            "step_cycle": "Ativar Ciclo",
            "step_cycle_notifs": "Notificações de ciclos",
            "target_filters": "Filtro de Alvos",
            "min_distance": "Distância mínima",
            "max_distance": "Distância máxima",
            "min_points": "Pontuação mínima",
            "max_points": "Pontuação máxima",
            "max_travel_time": "Tempo máximo de viagem",
            "logs_limit": "Quantidade máxima de registros",
            "event_attack": "Registrar ataques",
            "event_village_change": "Registrar troca de aldeias",
            "event_priority_add": "Registrar alvos prioritarios",
            "event_ignored_village": "Registrar alvos ignorados",
            "settings_saved": "Configurações salvas!",
            "misc": "Diversos",
            "attack": "ataca",
            "no_logs": "Nenhum evento registrado",
            "clear_logs": "Limpar eventos",
            "reseted_logs": "Registro de eventos resetado.",
            "date_added": "Adicionado na data",
            "multiple_attacks_interval": "Intervalo entre ataques no mesmo alvo",
            "next_cycle_in": "Próximo ciclo começa em",
            "target_limit_per_village": "Limite de alvos por aldeia",
            "ignore_on_loss_tip": "Essa configuração só funciona quando tem um grupo de alvos ignorados selecionado.",
            "farmer_behavior": "Farms podem enviar",
            "allow_single_attack_each_target": "Um único ataque em cada alvo",
            "allow_multiple_attack_each_target": "Múltiplo ataques em cada alvo",
            "target_behavior": "Alvos podem receber",
            "targets_allow_single_farmer": "Ataques de um único farm",
            "targets_allow_multiple_farmers": "Ataques de múltiplo farms"
        },
        "common": {
            "start": "Iniciar",
            "started": "Iniciado",
            "pause": "Pausar",
            "paused": "Pausado",
            "stop": "Parar",
            "stopped": "Parado",
            "status": "Status",
            "none": "Nenhum",
            "info": "Informações",
            "settings": "Configurações",
            "others": "Outros",
            "village": "Aldeia",
            "villages": "Aldeias",
            "building": "Edifício",
            "buildings": "Edifícios",
            "level": "Nível",
            "registers": "Registros",
            "filters": "Filtros",
            "add": "Adicionar",
            "waiting": "Em espera",
            "attack": "Ataque",
            "support": "Apoio",
            "relocate": "Transferência",
            "activate": "Ativar",
            "deactivate": "Desativar",
            "units": "Unidades",
            "officers": "Oficiais",
            "origin": "Origem",
            "target": [
                "Alvo",
                "Alvos"
            ],
            "save": "Salvar",
            "logs": "Eventos",
            "no-results": "Sem resultados...",
            "selected": "Selecionado",
            "now": "Agora",
            "costs": "Custos",
            "duration": "Duração",
            "points": "Pontos",
            "player": "Jogador",
            "players": "Jogadores",
            "next_features": "Próximas funcionalidades",
            "misc": "Diversos",
            "colors": "Cores",
            "reset": "Resetar",
            "reset_settings": "Resetar Config.",
            "reset_settings_confirmation": "Você tem certeza que deseja resetar as configurações?",
            "here": "aqui",
            "disabled": "— Desativado —",
            "cancel": "Cancelar",
            "actions": "Ações",
            "remove": "Remover",
            "started_at": "Iniciado em",
            "arrive": "Chegada",
            "settings_saved": "Configurações salvas",
            "settings_reseted": "Configurações resetadas",
            "discard": "Descartar",
            "new_version": "TWOverflow atualizado para a versão %d",
            "check_changes": "Clique aqui para ver as alterações",
            "firefox_shill": "Se você quiser que o script funcione de fundo corretamente, use Firefox ao invés de navegadores baseado no Chrome.",
            "error_invalid_interval": "Formato de tempo inválido para %d.",
            "readable_time_format": "Exemples de formato de tempo: 1 minute, 30 minutes, 4 hours, 1 day."
        }
    },
    "ro_ro": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Deschideți raportul",
            "no_report": "Niciun raport",
            "reports": "Rapoarte",
            "date": "Iti da",
            "status_time_limit": "Ținta este prea departe",
            "status_command_limit": "Limita de comandă",
            "status_full_storage": "Depozitul e plin",
            "status_no_units": "Nu există unități disponibile",
            "status_abandoned_conquered": "Abandonat cucerit",
            "status_protected_village": "Ținta este protejată",
            "status_busy_target": "Ținta este atacată",
            "status_no_targets": "Nu există ținte disponibile",
            "status_target_cycle_end": "Ciclul țintă s-a încheiat",
            "status_not_allowed_points": "Punctele țintă nu sunt permise",
            "status_unknown": "Stare necunoscută",
            "status_attacking": "Atac",
            "status_waiting_cycle": "Ciclul de așteptare",
            "status_user_stop": "Oprit de jucător",
            "status_expired_step": "Comandă expirată",
            "not_loaded": "Nu este încărcat.",
            "ignored_targets": "Ținte ignorate",
            "no_ignored_targets": "Nimic ignorat",
            "included_targets": "Ținte incluse",
            "no_included_targets": "Nimic inclus",
            "farmer_villages": "Satele Fermierilor",
            "no_farmer_villages": "Fără sate de fermieri",
            "last_status": "Ultima stare",
            "attacking": "Atac.",
            "paused": "Întrerupt.",
            "command_limit": "A fost atinsă limita de 50 de atacuri, în așteptarea revenirii.",
            "last_attack": "Ultimul atac",
            "village_switch": "Schimbarea în sat",
            "no_preset": "Nu există presetări disponibile.",
            "no_selected_village": "Nu există sate disponibile.",
            "no_units": "Nu există unități disponibile în sat, atacurile în așteptare revin.",
            "no_units_no_commands": "Niciun sat nu are unități sau comenzi care se întorc.",
            "no_villages": "Nu există sate disponibile, atacurile în așteptare revin.",
            "preset_first": "Setați mai întâi o presetare!",
            "selected_village": "Sat selectat",
            "loading_targets": "Se încarcă ținte ...",
            "checking_targets": "Se verifică țintele ...",
            "restarting_commands": "Repornirea comenzilor ...",
            "ignored_village": "adăugat la lista ignorată",
            "included_village": "adăugat la lista inclusă",
            "ignored_village_removed": "eliminat din lista ignorată",
            "included_village_removed": "eliminat din lista inclusă",
            "priority_target": "adăugat la priorități.",
            "analyse_targets": "Analiza țintelor.",
            "step_cycle_restart": "Repornirea ciclului de comenzi ..",
            "step_cycle_end": "Lista satelor s-a încheiat, așteptând următoarea alergare.",
            "step_cycle_end_no_villages": "Nu există sate disponibile pentru a începe ciclul.",
            "step_cycle_next": "Lista satelor s-a încheiat, următorul ciclu: %d.",
            "step_cycle_next_no_villages": "Nu există sat disponibil pentru a începe ciclul, următorul ciclu: %d.",
            "full_storage": "Depozitarea satului este plină.",
            "farm_stopped": "FarmOverflow s-a oprit.",
            "farm_started": "FarmOverflow a început.",
            "groups_presets": "Grupuri și presetări",
            "presets": "Atacă cu presetările",
            "group_ignored": "Ignorați satele din grup",
            "group_include": "Includeți satele din grupuri",
            "group_only": "Atacă doar cu sate din grupuri",
            "attack_interval": "Interval între atacuri",
            "preserve_command_slots": "Păstrați sloturile de comandă",
            "farmer_cycle_interval": "Interval între ciclurile fermierilor",
            "ignore_on_loss": "Ignorați ținta care cauzează pierderi",
            "ignore_full_storage": "Nu cultivati cu sate cu depozit complet",
            "step_cycle_header": "Setări ciclu pas",
            "step_cycle": "Activați Ciclul pasului",
            "step_cycle_notifs": "Notificările ciclului",
            "target_filters": "Filtre țintă",
            "min_distance": "Distanțe minime vizate",
            "max_distance": "Țintește distanța maximă",
            "min_points": "Vizează puncte minime",
            "max_points": "Vizează puncte maxime",
            "max_travel_time": "Timp maxim de călătorie",
            "logs_limit": "Cantitatea maximă de intrări în jurnal",
            "event_attack": "Afișați jurnalele de sarcini ale atacurilor",
            "event_village_change": "Afișați jurnalele de sarcini ale modificărilor din sat",
            "event_priority_add": "Afișați jurnalele de sarcini ale țintelor prioritare",
            "event_ignored_village": "Afișați jurnalele de activități ale satelor ignorate",
            "settings_saved": "Setari Salvate!",
            "misc": "Diverse",
            "attack": "atac",
            "no_logs": "Nu sunt înregistrate jurnale",
            "clear_logs": "Ștergeți jurnalele",
            "reseted_logs": "Jurnalele înregistrate au fost resetate.",
            "date_added": "Data adaugata",
            "multiple_attacks_interval": "Interval între atacuri în aceeași țintă",
            "next_cycle_in": "Următorul ciclu începe în",
            "target_limit_per_village": "Limita țintelor pe sat",
            "ignore_on_loss_tip": "Această setare funcționează numai atunci când este selectat un grup de ignorare.",
            "farmer_behavior": "Fermierii pot trimite",
            "allow_single_attack_each_target": "Un singur atac către fiecare țintă",
            "allow_multiple_attack_each_target": "Atacuri multiple către fiecare țintă",
            "target_behavior": "Țintele pot primi",
            "targets_allow_single_farmer": "Atacurile unui singur fermier",
            "targets_allow_multiple_farmers": "Atacuri de la mai mulți fermieri"
        },
        "common": {
            "start": "start",
            "started": "Început",
            "pause": "Pauză",
            "paused": "Întrerupt",
            "stop": "Stop",
            "stopped": "Oprit",
            "status": "stare",
            "none": "Nici unul",
            "info": "informație",
            "settings": "Setări",
            "others": "Alții",
            "village": "Sat",
            "villages": "Sate",
            "building": "Clădire",
            "buildings": "Clădiri",
            "level": "Nivel",
            "registers": "Jurnale",
            "filters": "Filtre",
            "add": "Adăuga",
            "waiting": "Aşteptare",
            "attack": "Atac",
            "support": "A sustine",
            "relocate": "Transfer",
            "activate": "Activati",
            "deactivate": "Dezactivează",
            "units": "Unități",
            "officers": "Ofițeri",
            "origin": "Origine",
            "target": [
                "Ţintă",
                "Ținte"
            ],
            "save": "salva",
            "logs": "Jurnale",
            "no-results": "Fara rezultate ...",
            "selected": "Selectat",
            "now": "Acum",
            "costs": "Cheltuieli",
            "duration": "Durată",
            "points": "Puncte",
            "player": "Jucător",
            "players": "Jucători",
            "next_features": "Următoarele caracteristici",
            "misc": "Diverse",
            "colors": "Culori",
            "reset": "Resetați",
            "reset_settings": "Reseteaza setarile",
            "reset_settings_confirmation": "Sigur doriți să resetați setările?",
            "here": "Aici",
            "disabled": "- Dezactivat -",
            "cancel": "Anulare",
            "actions": "Acțiuni",
            "remove": "Elimina",
            "started_at": "A început la",
            "arrive": "Ajunge",
            "settings_saved": "Setari Salvate",
            "settings_reseted": "Setările au fost resetate",
            "discard": "Aruncați",
            "new_version": "TWOverflow a fost actualizat la versiunea %d",
            "check_changes": "Faceți clic aici pentru a verifica modificările",
            "firefox_shill": "Dacă doriți ca scriptul să funcționeze corect în fundal, utilizați Firefox în loc de browsere bazate pe Chrome.",
            "error_invalid_interval": "Format de oră nevalid pentru %d.",
            "readable_time_format": "Exemple de format de timp: 1 minut, 30 minute, 4 ore, 1 zi."
        }
    },
    "ru_ru": {
        "auto_quest": {
            "enabled": "Automatically collect ready quest rewards",
            "check_interval": "Check interval (5 seconds to 5 minutes)",
            "invalid_interval": "Enter a check interval between 5 seconds and 5 minutes.",
            "help": "Save settings, then press Start. AutoQuest opens unread or ready quest lines, selects completed tasks marked with an exclamation icon to reveal their rewards, collects them, and closes the game's quest panel when none remain. Settings and the last running or stopped state are restored after reloading the page."
        },
        "farm_overflow": {
            "auto_presets": "Create automatic farming presets",
            "auto_preset_min_units": "Minimum soldiers per packet",
            "auto_preset_max_units": "Maximum soldiers per packet",
            "auto_preset_carry": "Desired packet carrying capacity",
            "farming_controls": "Farming controls",
            "farming_controls_help": "Preview records planned attacks without sending them. Capacity per hour estimates transport capacity, not actual loot. Saving settings pauses an active farmer.",
            "preview_only": "Preview only (no attacks)",
            "barbarians_only": "Only attack barbarian villages",
            "optimize_haul": "Prefer carrying capacity per round-trip time",
            "estimated_target_loot": "Estimated loot per target (0 = unknown)",
            "estimated_loot_per_hour": "estimated loot per hour",
            "unit_reserve_percent": "Keep units in town (%)",
            "max_attacks_per_cycle": "Maximum attacks per village per cycle",
            "target_order_variation": "Target score variation (%)",
            "attack_jitter": "Maximum extra delay between attacks",
            "cycle_jitter": "Maximum extra delay between cycles",
            "empty_haul_cooldown": "Rest targets after an empty-haul report",
            "loss_cooldown": "Rest targets after a casualty or defeat report",
            "invalid_farming_settings": "Check farming settings: use valid numbers and nonnegative durations up to 7 days, a positive travel limit, and minimums no greater than maximums.",
            "status_target_cooldown": "Target is resting after a report",
            "status_cycle_attack_limit": "Cycle attack limit reached",
            "status_command_timeout": "Send not acknowledged; farmer stopped",
            "status_preview": "Previewing an attack",
            "status_command_error": "Command or game data error",
            "preview": "Preview",
            "preset": "Preset",
            "capacity_per_hour": "capacity per hour (estimate)",
            "open_report": "Открыть отчет",
            "no_report": "Нет отчета",
            "reports": "Отчёты",
            "date": "Дата",
            "status_time_limit": "Цель слишком далеко",
            "status_command_limit": "Предел количества команд",
            "status_full_storage": "Склад переполнен",
            "status_no_units": "Нет доступных войск",
            "status_abandoned_conquered": "Победа деревни варваров",
            "status_protected_village": "Цель под защитой",
            "status_busy_target": "Цель под атакой",
            "status_no_targets": "Нет доступных целей",
            "status_target_cycle_end": "Перечень целей закончен",
            "status_not_allowed_points": "Запрещенные цели назначения",
            "status_unknown": "Неизвестный статус",
            "status_attacking": "Атаковано",
            "status_waiting_cycle": "Ожидание",
            "status_user_stop": "Остановлен игроком",
            "status_expired_step": "Срок действия команды истек",
            "not_loaded": "Не загружено.",
            "ignored_targets": "Игнорируемые цели",
            "no_ignored_targets": "Ничего не игнорировать",
            "included_targets": "Включенные цели",
            "no_included_targets": "Нет включенных",
            "farmer_villages": "Грабеж деревень",
            "no_farmer_villages": "Нет деревень для грабежа",
            "last_status": "Последний статус",
            "attacking": "Атаковано.",
            "paused": "Приостановлен.",
            "command_limit": "Достигнут лимит в 50 атак, дождитесь возвращения.",
            "last_attack": "Последняя атака",
            "village_switch": "Переход к деревни",
            "no_preset": "Нет доступных шаблонов.",
            "no_selected_village": "Нет доступных деревень.",
            "no_units": "Нет доступных войск в деревни, дождитесь возвращения.",
            "no_units_no_commands": "Ни в одной из деревень нет возвращающихся войск.",
            "no_villages": "Нет доступных деревень, дождитесь возвращения войск.",
            "preset_first": "Установите вначале шаблон!",
            "selected_village": "Выбранная деревня",
            "loading_targets": "Загрузка целей...",
            "checking_targets": "Проверка целей...",
            "restarting_commands": "Перезапуск команд...",
            "ignored_village": "добавить в игнорируемое",
            "included_village": "добавить во включенное",
            "ignored_village_removed": "удалить из игнорируемого",
            "included_village_removed": "удалить из включенного",
            "priority_target": "добавить в приоритетное.",
            "analyse_targets": "Анализ целей.",
            "step_cycle_restart": "Перезапуск цикла команд..",
            "step_cycle_end": "Перечень деревень окончен, дождитесь следующего круга.",
            "step_cycle_end_no_villages": "Нет доступных деревень для старта цикла.",
            "step_cycle_next": "Перечень деревень закончился, следующий цикл: %d.",
            "step_cycle_next_no_villages": "Нету свободных деревень для начала цыкла, следующий цыкл.",
            "full_storage": "Склад деревни заполнен.",
            "farm_stopped": "Переизбыток Фарма остановлен.",
            "farm_started": "Переизбыток Фарма начат.",
            "groups_presets": "Группы и Шаблоны",
            "presets": "Атака с шаблонами",
            "group_ignored": "Игнорировать деревни из группы",
            "group_include": "Включить деревни из групп",
            "group_only": "Атаковать только с деревнями из групп",
            "attack_interval": "Интервалы между атаками",
            "preserve_command_slots": "Сохранить управление слотами",
            "farmer_cycle_interval": "Интервал между фермерскими циклами",
            "ignore_on_loss": "Игнорировать деревни, которые приносят потери",
            "ignore_full_storage": "Не фармить при заполнении склада",
            "step_cycle_header": "Настройки пошагового цикла",
            "step_cycle": "Включить пошаговый цикл",
            "step_cycle_notifs": "Цыкл уведомлений",
            "target_filters": "Целевые фильтры",
            "min_distance": "Минимальное расстояние до цели",
            "max_distance": "Максимальное расстояние до цели",
            "min_points": "Минимальные очки цели",
            "max_points": "Максимальные очки цели",
            "max_travel_time": "Максимальное время в пути",
            "logs_limit": "Максимальное колличество записей в журнале событий",
            "event_attack": "Показать журналы задач атак",
            "event_village_change": "Показать журналы задач изменений деревни",
            "event_priority_add": "Показать журналы задач приоритетных целей",
            "event_ignored_village": "Показать журналы задач игнорируемых деревень",
            "settings_saved": "Настройки сохранены!",
            "misc": "Разнообразный",
            "attack": "Атака",
            "no_logs": "Нету зарегистрированного журанал событий",
            "clear_logs": "Очистить журнал события",
            "reseted_logs": "Зарегистрованный журнал событий обнулён.",
            "date_added": "Данные добавлены",
            "multiple_attacks_interval": "Интервал между атаками по одной и той же цели",
            "next_cycle_in": "Следующий цикл начнется через",
            "target_limit_per_village": "Лимит исходящих атак деревни",
            "ignore_on_loss_tip": "Этот параметр работает, только если выбрана группа игнорирования.",
            "farmer_behavior": "Фермеры могут отправить",
            "allow_single_attack_each_target": "По одной атаке на каждую цель",
            "allow_multiple_attack_each_target": "Множественные атаки на каждую цель",
            "target_behavior": "Цели могут получать",
            "targets_allow_single_farmer": "Атаки одного фермера",
            "targets_allow_multiple_farmers": "Атаки нескольких фермеров"
        },
        "common": {
            "start": "Начать",
            "started": "Запущен",
            "pause": "Пауза",
            "paused": "Приостановлен",
            "stop": "Стоп",
            "stopped": "Остановлен",
            "status": "Статус",
            "none": "Отсутсвует",
            "info": "Информация",
            "settings": "Настройки",
            "others": "Прочее",
            "village": "Деревня",
            "villages": "Деревни",
            "building": "Строение",
            "buildings": "Строения",
            "level": "Уровень",
            "registers": "Журнал событий",
            "filters": "Фильтры",
            "add": "Добавить",
            "waiting": "Ожидание",
            "attack": "Атака",
            "support": "Поддержка",
            "relocate": "Перемещение",
            "activate": "Активировать",
            "deactivate": "Отключить",
            "units": "Войска",
            "officers": "Военачальники",
            "origin": "Точка отправления",
            "target": [
                "Точка назначения",
                "Цели"
            ],
            "save": "Сохранить",
            "logs": "Журнал событий",
            "no-results": "Нет результатов ...",
            "selected": "Выбрано",
            "now": "Сейчас же",
            "costs": "Расходы",
            "duration": "Продолжительность",
            "points": "очки\nочков",
            "player": "игрок",
            "players": "игроки",
            "next_features": "Следующие особенности",
            "misc": "Разное",
            "colors": "Цвета",
            "reset": "Сбросить",
            "reset_settings": "Сбросить настройки",
            "reset_settings_confirmation": "Вы уверены, что хотите сбросить настройки?",
            "here": "Вот",
            "disabled": "- Неполноценный -",
            "cancel": "Отмена",
            "actions": "Действия",
            "remove": "удалять",
            "started_at": "Начато в",
            "arrive": "Прибыть",
            "settings_saved": "Настройки сохранены",
            "settings_reseted": "Настройки сброшены",
            "discard": "Отменить",
            "new_version": "TWOverflow обновлен до версии %d",
            "check_changes": "Щелкните здесь, чтобы проверить изменения",
            "firefox_shill": "Если вы хотите, чтобы скрипт правильно работал в фоновом режиме, используйте Firefox вместо браузеров на базе Chrome.",
            "error_invalid_interval": "Неверный формат времени для %d.",
            "readable_time_format": "Примеры формата времени: 1 минута, 30 минут, 4 часа, 1 день."
        }
    }
};
    const DEFAULT_LANG = 'en_us';
    const SHARED_LANGS = {
        'en_dk': 'en_us',
        'pt_pt': 'pt_br'
    };

    function selectLanguage (langId) {
        langId = hasOwn.call(SHARED_LANGS, langId) ? SHARED_LANGS[langId] : langId;
        i18n.setJSON(languages[langId] || languages[DEFAULT_LANG]);
    }

    const twoLanguage = {};

    twoLanguage.init = function () {
        if (initialized) {
            return false;
        }

        initialized = true;

        selectLanguage($rootScope.loc.ale);

        // trigger eventTypeProvider.LANGUAGE_SELECTED_CHANGED you dumb fucks
        $rootScope.$watch('loc.ale', function (newValue, oldValue) {
            if (newValue !== oldValue) {
                selectLanguage($rootScope.loc.ale);
            }
        });
    };

    return twoLanguage;
});

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

define('two/resourceBudget', [], function () {
    const pending = new Map();
    const resources = ['wood', 'clay', 'iron', 'food'];
    const stock = village => village.getResources().getComputed();
    const isBusy = function (village) {
        const entry = pending.get(village.getId());
        if (!entry) {
            return false;
        }
        const current = stock(village);
        if (entry.acknowledged && resources.every(type => !entry.cost[type]
            || (current[type] && Number.isFinite(current[type].currentStock)
                && current[type].currentStock <= entry.before[type] - entry.cost[type]))) {
            pending.delete(village.getId());
            return false;
        }
        return true;
    };
    return {
        isBusy,
        begin: function (village, cost) {
            if (!cost || !resources.every(type => Number.isFinite(Number(cost[type])) && Number(cost[type]) >= 0)
                || isBusy(village)) {
                return false;
            }
            const current = stock(village);
            cost = Object.fromEntries(resources.map(type => [type, Number(cost[type])]));
            const entry = {cost, before: {}, acknowledged: false};
            for (const type of resources) {
                if (cost[type] && (!current[type] || !Number.isFinite(current[type].currentStock)
                    || current[type].currentStock < cost[type])) {
                    return false;
                }
                entry.before[type] = current[type] ? current[type].currentStock : 0;
            }
            pending.set(village.getId(), entry);
            return entry;
        },
        acknowledge: function (village, entry) {
            if (pending.get(village.getId()) === entry) {
                entry.acknowledged = true;
            }
        },
        reject: function (village, entry) {
            if (pending.get(village.getId()) === entry) {
                pending.delete(village.getId());
            }
        },
        clear: function (villageId) {
            pending.delete(Number(villageId));
        }
    };
});

define('two/moduleState', [
    'Lockr',
    'queues/EventQueue'
], function (Lockr, eventQueue) {
    return function (module, storageKey, startEvent, stopEvent) {
        eventQueue.register(startEvent, function () {
            Lockr.set(storageKey, true);
        });
        eventQueue.register(stopEvent, function () {
            Lockr.set(storageKey, false);
        });

        if (Lockr.get(storageKey, false) === true) {
            module.start();
        }
    };
});

define('two/mapData', [
    'conf/conf'
], function (
    conf
) {
    let villages = [];
    const grid = [];
    let loading = false;
    let loaded = false;
    let callbackQueue = [];
    const MINIMAP_WIDTH = 306;
    const MINIMAP_HEIGHT = 306;

    angular.extend(eventTypeProvider, {
        MAP_DATA_LOADED: 'map_data_loaded'
    });

    const init = function () {
        const xChunks = Math.ceil(conf.MAP_SIZE / MINIMAP_WIDTH);
        const yChunks = Math.ceil(conf.MAP_SIZE / MINIMAP_HEIGHT);

        for (let gridX = 0; gridX < xChunks; gridX++) {
            grid.push([]);

            let chunkX = MINIMAP_WIDTH * gridX;
            const chunkWidth = MINIMAP_WIDTH.bound(0, chunkX + MINIMAP_WIDTH).bound(0, conf.MAP_SIZE - chunkX);
            chunkX = chunkX.bound(0, conf.MAP_SIZE);

            for (let gridY = 0; gridY < yChunks; gridY++) {
                let chunkY = MINIMAP_HEIGHT * gridY;
                const chunkHeight = MINIMAP_HEIGHT.bound(0, chunkY + MINIMAP_HEIGHT).bound(0, conf.MAP_SIZE - chunkY);
                chunkY = chunkY.bound(0, conf.MAP_SIZE);

                grid[gridX].push({
                    x: chunkX,
                    y: chunkY,
                    width: chunkWidth,
                    height: chunkHeight
                });
            }
        }
    };

    const twoMapData = {};

    twoMapData.load = function (callback = noop, force) {
        if (force) {
            loaded = false;
        } else if (loading) {
            return callbackQueue.push(callback);
        } else if (loaded) {
            return callback(villages);
        }

        callbackQueue.push(callback);
        loading = true;
        const cells = [];

        for (let gridX = 0; gridX < grid.length; gridX++) {
            for (let gridY = 0; gridY < grid[gridX].length; gridY++) {
                cells.push(grid[gridX][gridY]);
            }
        }

        const requests = [];

        cells.forEach(function (cell) {
            const promise = new Promise(function (resolve, reject) {
                socketService.emit(routeProvider.MAP_GET_MINIMAP_VILLAGES, cell, function (data) {
                    if (data.message) {
                        return reject(data.message);
                    }

                    if (data.villages.length) {
                        villages = villages.concat(data.villages);
                    }

                    resolve();
                });
            });

            requests.push(promise);
        });

        return Promise.all(requests).then(function () {
            loading = false;
            loaded = true;

            $rootScope.$broadcast(eventTypeProvider.MAP_DATA_LOADED);

            callbackQueue.forEach(function (queuedCallback) {
                queuedCallback(villages);
            });

            callbackQueue = [];
        }).catch(function (error) {
            // eslint-disable-next-line no-console
            console.error(error.message);
        });
    };

    twoMapData.getVillages = function () {
        return villages;
    };

    twoMapData.isLoaded = function () {
        return loaded;
    };

    init();

    return twoMapData;
});

define('two/ui', [
    'conf/conf',
    'conf/cdn',
    'two/ready'
], function (
    conf,
    cdnConf,
    ready
) {
    const interfaceOverflow = {};
    const templates = {};
    let initialized = false;
    let $menu;

    const $head = document.querySelector('head');
    const httpService = injector.get('httpService');
    const templateManagerService = injector.get('templateManagerService');
    const $templateCache = injector.get('$templateCache');

    templateManagerService.load = function (templateName, onSuccess, opt_onError) {
        let path;

        const success = function (data, status, headers, config) {
            $templateCache.put(path.substr(1), data);

            if (angular.isFunction(onSuccess)) {
                onSuccess(data, status, headers, config);
            }

            if (!$rootScope.$$phase) {
                $rootScope.$apply();
            }
        };

        const error = function (data, status, headers, config) {
            if (angular.isFunction(opt_onError)) {
                opt_onError(data, status, headers, config);
            }
        };

        if (0 !== templateName.indexOf('!')) {
            path = conf.TEMPLATE_PATH_EXT.join(templateName);
        } else {
            path = templateName.substr(1);
        }

        if ($templateCache.get(path.substr(1))) {
            success($templateCache.get(path.substr(1)), 304);
        } else {
            if (cdnConf.versionMap[path]) {
                httpService.get(path, success, error);
            } else {
                success(templates[path], 304);
            }
        }
    };

    interfaceOverflow.init = function () {
        if (initialized) {
            return false;
        }

        const $wrapper = document.querySelector('#wrapper');
        const $container = document.createElement('div');
        const $mainButton = document.createElement('div');

        $container.className = 'two-menu-container';
        $wrapper.appendChild($container);

        $mainButton.className = 'two-main-button';
        $mainButton.style.display = 'none';
        $container.appendChild($mainButton);

        $menu = document.createElement('div');
        $menu.className = 'two-menu';
        $container.appendChild($menu);

        initialized = true;
        interfaceOverflow.addStyle('.two-window a.select-handler{-webkit-box-shadow:none;box-shadow:none}.two-window .small-select a.select-handler{height:22px;line-height:22px}.two-window .small-select a.select-button{height:22px}.two-window input::placeholder{color:rgba(255,243,208,0.7)}.two-window .green{color:#07770b}.two-window .red{color:#770707}.two-window .blue{color:#074677}#toolbar-left{height:calc(100% - 273px) !important;top:165px !important}.two-menu-container{position:absolute;top:84px;left:0;width:90px;z-index:10}.two-menu-container:hover .two-main-button{background-position:0 -75px}.two-menu-container:hover .two-menu{opacity:1;visibility:visible;transition:opacity .1s ease-in-out}.two-main-button{left:0;width:75px;height:75px;background-image:url("data:image/png;base64,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");background-position:0 0;z-index:10}.two-menu{position:absolute;top:8px;left:0px;width:240px;display:flex;flex-flow:wrap;visibility:hidden;opacity:0;z-index:10;padding-left:85px}.two-menu .button{height:24px;padding:0 15px;line-height:22px;margin-bottom:8px}.two-menu .divisor{height:3px;margin-bottom:5px;background:linear-gradient(90deg, #4e2e1a, transparent);border-radius:10px;width:100%}#wrapper.window-open .two-menu-container{left:713px}#wrapper.window-open.window-fullsize .two-menu-container{display:none !important}input:not([type]){border:none;outline:none}a.link{font-weight:bold;color:#3f2615}a.link:hover{text-shadow:0 1px 0 #000;color:#fff}');

        ready(function () {
            $mainButton.style.display = 'block';
        }, ['map']);
    };

    interfaceOverflow.addTemplate = function (path, data) {
        templates[path] = data;
    };

    interfaceOverflow.addStyle = function (styles) {
        const $style = document.createElement('style');
        $style.type = 'text/css';
        $style.appendChild(document.createTextNode(styles));
        $head.appendChild($style);
    };

    interfaceOverflow.addMenuButton = function (label, order, _tooltip) {
        const $button = document.createElement('div');
        $button.className = 'btn-border btn-orange button';
        $button.innerText = label;
        $button.style.order = order;
        $menu.appendChild($button);

        if (typeof _tooltip === 'string') {
            $button.addEventListener('mouseenter', function (event) {
                $rootScope.$broadcast(eventTypeProvider.TOOLTIP_SHOW, 'twoverflow-tooltip', _tooltip, true, event);
            });

            $button.addEventListener('mouseleave', function () {
                $rootScope.$broadcast(eventTypeProvider.TOOLTIP_HIDE, 'twoverflow-tooltip');
            });
        }

        return $button;
    };

    interfaceOverflow.addDivisor = function (order) {
        const $div = document.createElement('div');
        $div.className = 'divisor';
        $div.style.order = order;
        $menu.appendChild($div);
    };

    interfaceOverflow.isInitialized = function () {
        return initialized;
    };

    return interfaceOverflow;
});

require([
    'two/ui'
], function (interfaceOverflow) {
    if (interfaceOverflow.isInitialized()) {
        return false;
    }

    interfaceOverflow.init();
});

require([
    'two/language',
    'two/ready'
], function (
    twoLanguage,
    ready
) {
    ready(function () {
        twoLanguage.init();
    });
});

// Each included module initializes itself from its own src/init.js.

/**
 * https://github.com/tsironis/lockr
 */
define('Lockr', function (root, Lockr) {
    const [, worldId, characterId] = location.search.match(/world=([a-z0-9]+).*character_id=(\d+)/);

    Lockr.prefix = `${characterId}_twOverflow_${worldId}-`;

    Lockr._getPrefixedKey = function (key, options) {
        options = options || {};

        if (options.noPrefix) {
            return key;
        } else {
            return this.prefix + key;
        }

    };

    Lockr.set = function (key, value, options) {
        const query_key = this._getPrefixedKey(key, options);

        try {
            localStorage.setItem(query_key, JSON.stringify({
                data: value
            }));
        } catch (e) {}
    };

    Lockr.get = function (key, missing, options) {
        const query_key = this._getPrefixedKey(key, options);
        let value;

        try {
            value = JSON.parse(localStorage.getItem(query_key));
        } catch (e) {
            if (localStorage[query_key]) {
                value = {
                    data: localStorage.getItem(query_key)
                };
            } else {
                value = null;
            }
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

/**
 * https://github.com/blakeembrey/node-numbered
 */
define('numbered', function () {
    const NUMBER_MAP = {
        '.': 'point',
        '-': 'negative',
        0: 'zero',
        1: 'one',
        2: 'two',
        3: 'three',
        4: 'four',
        5: 'five',
        6: 'six',
        7: 'seven',
        8: 'eight',
        9: 'nine',
        10: 'ten',
        11: 'eleven',
        12: 'twelve',
        13: 'thirteen',
        14: 'fourteen',
        15: 'fifteen',
        16: 'sixteen',
        17: 'seventeen',
        18: 'eighteen',
        19: 'nineteen',
        20: 'twenty',
        30: 'thirty',
        40: 'forty',
        50: 'fifty',
        60: 'sixty',
        70: 'seventy',
        80: 'eighty',
        90: 'ninety'
    };

    // http://en.wikipedia.org/wiki/English_numerals#Cardinal_numbers
    const CARDINAL_MAP = {
        2: 'hundred',
        3: 'thousand',
        6: 'million',
        9: 'billion',
        12: 'trillion',
        15: 'quadrillion',
        18: 'quintillion',
        21: 'sextillion',
        24: 'septillion',
        27: 'octillion',
        30: 'nonillion',
        33: 'decillion',
        36: 'undecillion',
        39: 'duodecillion',
        42: 'tredecillion',
        45: 'quattuordecillion',
        48: 'quindecillion',
        51: 'sexdecillion',
        54: 'septendecillion',
        57: 'octodecillion',
        60: 'novemdecillion',
        63: 'vigintillion',
        100: 'googol',
        303: 'centillion'
    };

    // Make a hash of words back to their numeric value.
    const WORD_MAP = {
        nil: 0,
        naught: 0,
        period: '.',
        decimal: '.'
    };

    Object.keys(NUMBER_MAP).forEach(function (num) {
        WORD_MAP[NUMBER_MAP[num]] = isNaN(+num) ? num : +num;
    });

    Object.keys(CARDINAL_MAP).forEach(function (num) {
        WORD_MAP[CARDINAL_MAP[num]] = isNaN(+num) ? num : Math.pow(10, +num);
    });

    /**
   * Returns the number of significant figures for the number.
   *
   * @param  {number} num
   * @return {number}
   */
    function intervals (num) {
        const match = String(num).match(/e\+(\d+)/);

        if (match) return match[1];

        return String(num).length - 1;
    }

    /**
   * Calculate the value of the current stack.
   *
   * @param {Array}  stack
   * @param {number} largest
   */
    function totalStack (stack, largest) {
        const total = stack.reduceRight(function (prev, num, index) {
            if (num > stack[index + 1]) {
                return prev * num;
            }

            return prev + num;
        }, 0);

        return total * largest;
    }

    /**
   * Accepts both a string and number type, and return the opposite.
   *
   * @param  {string|number} num
   * @return {string|number}
   */
    function numbered (num) {
        if (typeof num === 'string') return numbered.parse(num);
        if (typeof num === 'number') return numbered.stringify(num);

        throw new Error('Numbered can only parse strings or stringify numbers');
    }

    /**
   * Turn a number into a string representation.
   *
   * @param  {number} num
   * @return {string}
   */
    numbered.stringify = function (value) {
        const num = Number(value);
        const floor = Math.floor(num);

        // If the number is in the numbers object, we quickly return.
        if (NUMBER_MAP[num]) return NUMBER_MAP[num];

        // If the number is a negative value.
        if (num < 0) return NUMBER_MAP['-'] + ' ' + numbered.stringify(-num);

        // Check if we have decimals.
        if (floor !== num) {
            const words = [numbered.stringify(floor), NUMBER_MAP['.']];
            const chars = String(num).split('.').pop();

            for (let i = 0; i < chars.length; i++) {
                words.push(numbered.stringify(+chars[i]));
            }

            return words.join(' ');
        }

        let interval = intervals(num);

        // It's below one hundred, but greater than nine.
        if (interval === 1) {
            return NUMBER_MAP[Math.floor(num / 10) * 10] + '-' + numbered.stringify(Math.floor(num % 10));
        }

        const sentence = [];

        // Simple check to find the closest full number helper.
        while (!CARDINAL_MAP[interval]) interval -= 1;

        if (CARDINAL_MAP[interval]) {
            const remaining = Math.floor(num % Math.pow(10, interval));

            sentence.push(numbered.stringify(Math.floor(num / Math.pow(10, interval))));
            sentence.push(CARDINAL_MAP[interval] + (remaining > 99 ? ',' : ''));

            if (remaining) {
                if (remaining < 100) sentence.push('and');

                sentence.push(numbered.stringify(remaining));
            }
        }

        return sentence.join(' ');
    };

    /**
   * Turns a string representation of a number into a number type
   * @param  {string} num
   * @return {number}
   */
    numbered.parse = function (num) {
        let modifier = 1;
        let largest = 0;
        let largestInterval = 0;
        let zeros = 0; // Track leading zeros in a decimal.
        let stack = [];

        const total = num.split(/\W+/g)
            .map(function (word) {
                const num = word.toLowerCase();

                return WORD_MAP[num] !== undefined ? WORD_MAP[num] : num;
            })
            .filter(function (num) {
                if (num === '-') modifier = -1;
                if (num === '.') return true; // Decimal points are a special case.

                return typeof num === 'number';
            })
            .reduceRight(function (memo, num) {
                const interval = intervals(num);

                // Check the interval is smaller than the largest one, then create a stack.
                if (typeof num === 'number' && interval < largestInterval) {
                    stack.push(num);
                    if (stack.length === 1) return memo - largest;
                    return memo;
                }

                memo += totalStack(stack, largest);
                stack = []; // Reset the stack for more computations.

                // If the number is a decimal, transform everything we have worked with.
                if (num === '.') {
                    const decimals = zeros + String(memo).length;

                    zeros = 0;
                    largest = 0;
                    largestInterval = 0;

                    return memo * Math.pow(10, -decimals);
                }

                // Buffer encountered zeros.
                if (num === 0) {
                    zeros += 1;
                    return memo;
                }

                // Shove the number on the front if the intervals match and the number whole.
                if (memo >= 1 && interval === largestInterval) {
                    let output = '';

                    while (zeros > 0) {
                        zeros -= 1;
                        output += '0';
                    }

                    return Number(String(num) + output + String(memo));
                }

                largest = num;
                largestInterval = intervals(largest);

                return (memo + num) * Math.pow(10, zeros);
            }, 0);

        return modifier * (total + totalStack(stack, largest));
    };

    return numbered;
});

/**
 * https://github.com/agenda/human-interval
 */
define('humanInterval', [
    'numbered'
], function (
    numbered
) {
    const units = {};
    units.second = 1000;
    units.minute = units.second * 60;
    units.hour = units.minute * 60;
    units.day = units.hour * 24;
    units.week = units.day * 7;
    units.month = units.day * 30;
    units.year = units.day * 365;

    const regexp = /(second|minute|hour|day|week|month|year)s?/;

    return function (time) {
        if (!time || typeof time === 'number') {
            return time;
        }

        let result = Number.NaN;

        time = time.replace(/([^a-z\d.-]|and)+/g, ' ');

        for (;;) {
            const match = time.match(regexp);
            if (!match) {
                return result;
            }

            const matchedNumber = time.slice(0, match.index).trim();
            const unit = units[match[1]];
            let number = 1;
            if (matchedNumber.length !== 0) {
                number = Number.parseFloat(matchedNumber);
                if (Number.isNaN(number)) {
                    number = numbered.parse(matchedNumber);
                }
            }

            if (Number.isNaN(result)) {
                result = 0;
            }

            result += number * unit;
            time = time.slice(match.index + match[0].length);
        }
    };
});

define('two/autoQuest', [
    'two/Settings',
    'two/autoQuest/settings',
    'two/autoQuest/settings/map',
    'two/autoQuest/settings/updates',
    'queues/EventQueue',
    'two/autoQuest/events'
], function (Settings, SETTINGS, SETTINGS_MAP, UPDATES, eventQueue) {
    let initialized = false;
    let running = false;
    let settings;
    let localSettings;
    let intervalId;
    let windowCheckId;
    let actionTimeoutId;
    let pendingAction;

    const isAvailable = function (button) {
        return !button.disabled && button.getAttribute('aria-disabled') !== 'true'
            && !button.classList.contains('btn-grey') && button.getClientRects().length > 0;
    };

    const questModelFor = function (button) {
        const scope = angular.element(button).scope();
        return scope && scope.data && scope.data.questModel;
    };

    const questRows = function () {
        return Array.from(document.querySelectorAll('[ng-controller="ModalQuestLineController"] [ng-click*="selectQuest"]'))
            .filter(button => /^\s*selectQuest\(\$index\)\s*;?\s*$/.test(button.getAttribute('ng-click')));
    };

    const isReadyTask = function (button) {
        return isAvailable(button) && !button.classList.contains('selected')
            && !!button.querySelector('.icon-44x44-quest-ready-to-finish')
            && !button.querySelector('.icon-44x44-quest-finished');
    };

    const isClaimable = function (button) {
        if (!isAvailable(button)) {
            return false;
        }

        const questModel = questModelFor(button);
        return questModel && typeof questModel.isFinishable === 'function'
            ? questModel.isFinishable() && !(typeof questModel.isClosed === 'function' && questModel.isClosed())
            : button.classList.contains('btn-green');
    };

    const scheduleCheck = function (delay = 1000) {
        clearTimeout(windowCheckId);
        windowCheckId = setTimeout(checkAndFinishQuests, delay);
    };

    const act = function (button, type) {
        clearTimeout(actionTimeoutId);
        pendingAction = {button, type, questModel: type === 'claim' ? questModelFor(button) : null};
        // Wait for the game to acknowledge a claim before attempting it again.
        actionTimeoutId = setTimeout(function () {
            pendingAction = null;
        }, 10000);
        button.click();
        scheduleCheck();
    };

    const checkAndFinishQuests = function () {
        if (!running || !localSettings[SETTINGS.ENABLED]) {
            return;
        }
        // Native clicks invoke Angular's ng-click $apply. Run after the current
        // digest rather than nesting another $apply inside the Start handler.
        if ($rootScope.$$phase) {
            scheduleCheck(0);
            return;
        }
        if (pendingAction && pendingAction.type === 'claim'
            && (!pendingAction.button.isConnected || !isClaimable(pendingAction.button))) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
        }
        const tasks = questRows();
        if (pendingAction && ((pendingAction.type === 'open' && tasks.length)
            || (pendingAction.type === 'select' && (!pendingAction.button.isConnected
                || pendingAction.button.classList.contains('selected'))))) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
        }

        const finishButton = Array.from(document.querySelectorAll('[ng-click*="finishQuest"]')).find(function (button) {
            return /^\s*finishQuest\(\)\s*;?\s*$/.test(button.getAttribute('ng-click')) && isClaimable(button);
        });

        if (finishButton) {
            if (pendingAction && pendingAction.type === 'claim' && pendingAction.button === finishButton
                && pendingAction.questModel === questModelFor(finishButton)) {
                return;
            }
            return act(finishButton, 'claim');
        }

        // Selecting the exclamation-mark task updates data.questModel and
        // reveals its reward. Never select unfinished or already closed tasks.
        const readyTask = tasks.find(isReadyTask);
        if (readyTask) {
            if (!pendingAction) {
                act(readyTask, 'select');
            }
            return;
        }
        // An open panel with no claimable/ready tasks can be closed without
        // reopening a different toolbar line while this one is displayed.
        if (tasks.length) {
            const closeButton = Array.from(document.querySelectorAll(
                '[ng-controller="ModalQuestLineController"] [ng-click="closeWindow()"]'
            )).find(isAvailable);
            if (closeButton && !pendingAction) {
                act(closeButton, 'close');
            }
            return;
        }

        const questLine = Array.from(document.querySelectorAll('.quest-line-finishable[ng-click], .quest-line-unread[ng-click]')).find(function (button) {
            return /^\s*openQuestLineModal\(questLineModel\)\s*;?\s*$/.test(button.getAttribute('ng-click')) && isAvailable(button);
        });
        if (questLine && !pendingAction) {
            act(questLine, 'open');
        } else if (!questLine && (!pendingAction || pendingAction.type !== 'open')) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
            const closeButton = Array.from(document.querySelectorAll(
                '[ng-controller="ModalQuestLineController"] [ng-click="closeWindow()"]'
            )).find(isAvailable);
            if (closeButton) {
                act(closeButton, 'close');
            }
        }
    };

    const stopChecker = function () {
        clearInterval(intervalId);
        clearTimeout(windowCheckId);
        clearTimeout(actionTimeoutId);
        pendingAction = null;
        intervalId = null;
        windowCheckId = null;
    };

    const startChecker = function () {
        const configuredInterval = localSettings[SETTINGS.CHECK_INTERVAL];
        const interval = Number.isFinite(configuredInterval)
            ? Math.min(300000, Math.max(5000, configuredInterval)) : 30000;
        intervalId = setInterval(checkAndFinishQuests, interval);
        checkAndFinishQuests();
    };

    const autoQuest = {};

    autoQuest.init = function () {
        if (initialized) {
            return false;
        }

        settings = new Settings({
            settingsMap: SETTINGS_MAP,
            storageKey: 'auto_quest_settings'
        });
        settings.store();
        localSettings = settings.getAll();

        settings.onChange(function (changes, updates) {
            localSettings = settings.getAll();

            if (running && updates && updates[UPDATES.CHECK_INTERVAL]) {
                stopChecker();
                startChecker();
            }
        });

        $rootScope.$on(eventTypeProvider.WINDOW_OPENED, function () {
            if (running) {
                scheduleCheck();
            }
        });
        initialized = true;
    };

    autoQuest.start = function () {
        if (!initialized || running) {
            return false;
        }

        running = true;
        startChecker();
        eventQueue.trigger(eventTypeProvider.AUTO_QUEST_START);
    };

    autoQuest.stop = function () {
        if (!running) {
            return false;
        }

        running = false;
        stopChecker();
        eventQueue.trigger(eventTypeProvider.AUTO_QUEST_STOP);
    };

    autoQuest.getSettings = function () {
        return settings;
    };

    autoQuest.isInitialized = function () {
        return initialized;
    };

    autoQuest.isRunning = function () {
        return running;
    };

    return autoQuest;
});

define('two/autoQuest/events', [], function () {
    angular.extend(eventTypeProvider, {
        AUTO_QUEST_START: 'auto_quest_start',
        AUTO_QUEST_STOP: 'auto_quest_stop'
    });
});

define('two/autoQuest/settings', [], function () {
    return {
        ENABLED: 'enabled',
        CHECK_INTERVAL: 'check_interval'
    };
});

define('two/autoQuest/settings/updates', function () {
    return {
        ENABLED: 'enabled',
        CHECK_INTERVAL: 'check_interval'
    };
});

define('two/autoQuest/settings/map', [
    'two/autoQuest/settings',
    'two/autoQuest/settings/updates'
], function (SETTINGS, UPDATES) {
    return {
        [SETTINGS.ENABLED]: {
            default: true,
            updates: [UPDATES.ENABLED],
            inputType: 'checkbox'
        },
        [SETTINGS.CHECK_INTERVAL]: {
            default: '30 seconds',
            updates: [UPDATES.CHECK_INTERVAL],
            inputType: 'readable_time',
            min: '5 seconds',
            max: '5 minutes'
        }
    };
});

define('two/autoQuest/ui', [
    'two/ui',
    'two/autoQuest',
    'two/autoQuest/settings',
    'two/EventScope',
    'two/utils',
    'queues/EventQueue',
    'humanInterval'
], function (interfaceOverflow, autoQuest, SETTINGS, EventScope, utils, eventQueue, humanInterval) {
    let settings;
    let $button;

    const init = function () {
        if ($button) {
            return false;
        }

        settings = autoQuest.getSettings();
        interfaceOverflow.addTemplate('twoverflow_auto_quest_window', `<div id=\"two-auto-quest\" class=\"win-content two-window\"><header class=\"win-head\"><h2>AutoQuest</h2><ul class=\"list-btn\"><li><a href=\"#\" class=\"size-34x34 btn-red icon-26x26-close\" ng-click=\"closeWindow()\"></a></ul></header><div class=\"win-main\" scrollbar=\"\"><div class=\"box-paper footer\"><div class=\"scroll-wrap\"><table class=\"settings tbl-border-light tbl-striped tbl-medium-height\"><col><col width=\"270px\"><tr><th colspan=\"2\">{{ 'settings' | i18n:loc.ale:'common' }}<tr><td>{{ 'enabled' | i18n:loc.ale:'auto_quest' }}<td><div switch-slider=\"\" enabled=\"true\" border=\"true\" value=\"enabled\" vertical=\"false\" size=\"'56x28'\"></div><tr><td>{{ 'check_interval' | i18n:loc.ale:'auto_quest' }}<td><input class=\"fit textfield-border text-center\" ng-model=\"checkInterval\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"><tr><td colspan=\"2\">{{ 'help' | i18n:loc.ale:'auto_quest' }}</table></div></div></div><footer class=\"win-foot\"><ul class=\"list-btn list-center\"><li><a href=\"#\" class=\"btn-border btn-orange\" ng-click=\"saveSettings()\">{{ 'save' | i18n:loc.ale:'common' }}</a><li><a href=\"#\" class=\"btn-border\" ng-class=\"{'btn-red': running, 'btn-orange': !running}\" ng-click=\"switchState()\">{{ (running ? 'stop' : 'start') | i18n:loc.ale:'common' }}</a></ul></footer></div>`);
        $button = interfaceOverflow.addMenuButton('Quest', 20);
        $button.addEventListener('click', buildWindow);

        eventQueue.register(eventTypeProvider.AUTO_QUEST_START, function () {
            $button.classList.remove('btn-orange');
            $button.classList.add('btn-red');
        });
        eventQueue.register(eventTypeProvider.AUTO_QUEST_STOP, function () {
            $button.classList.remove('btn-red');
            $button.classList.add('btn-orange');
        });
    };

    const buildWindow = function () {
        const scope = $rootScope.$new();
        scope.running = autoQuest.isRunning();
        scope.enabled = settings.getRaw(SETTINGS.ENABLED);
        scope.checkInterval = settings.getRaw(SETTINGS.CHECK_INTERVAL);

        scope.switchState = function () {
            if (autoQuest.isRunning()) {
                autoQuest.stop();
            } else {
                autoQuest.start();
            }
        };

        scope.saveSettings = function () {
            const interval = humanInterval(scope.checkInterval);
            if (!settings.valid('readable_time', scope.checkInterval)
                || !Number.isFinite(interval) || interval < 5000 || interval > 300000) {
                return utils.notif('error', $filter('i18n')('invalid_interval', $rootScope.loc.ale, 'auto_quest'));
            }

            settings.setAll({
                [SETTINGS.ENABLED]: scope.enabled,
                [SETTINGS.CHECK_INTERVAL]: scope.checkInterval
            });
            utils.notif('success', $filter('i18n')('settings_saved', $rootScope.loc.ale, 'common'));
        };

        const eventScope = new EventScope('twoverflow_auto_quest_window');
        eventScope.register(eventTypeProvider.AUTO_QUEST_START, function () {
            scope.$evalAsync(function () {
                scope.running = true;
            });
        });
        eventScope.register(eventTypeProvider.AUTO_QUEST_STOP, function () {
            scope.$evalAsync(function () {
                scope.running = false;
            });
        });
        scope.$on('$destroy', function () {
            eventScope.destroy();
        });

        windowManagerService.getScreenWithInjectedScope('!twoverflow_auto_quest_window', scope);
    };

    return init;
});

require([
    'two/ready',
    'two/autoQuest',
    'two/autoQuest/ui',
    'two/moduleState',
    'two/autoQuest/events'
], function (
    ready,
    autoQuest,
    autoQuestInterface,
    restoreModuleState
) {
    if (autoQuest.isInitialized()) {
        return false;
    }

    ready(function () {
        autoQuest.init();
        autoQuestInterface();
        restoreModuleState(autoQuest, 'auto_quest_active', eventTypeProvider.AUTO_QUEST_START, eventTypeProvider.AUTO_QUEST_STOP);
    }, ['map']);
});

define('two/farmOverflow', [
    'two/Settings',
    'two/farmOverflow/types/errors',
    'two/farmOverflow/types/status',
    'two/farmOverflow/settings',
    'two/farmOverflow/settings/map',
    'two/farmOverflow/settings/updates',
    'two/farmOverflow/types/farmerBehavior',
    'two/farmOverflow/types/targetBehavior',
    'two/farmOverflow/types/logs',
    'two/mapData',
    'two/utils',
    'two/ready',
    'helper/math',
    'helper/time',
    'queues/EventQueue',
    'conf/commandTypes',
    'conf/village',
    'conf/resourceTypes',
    'struct/MapData',
    'Lockr',
    'two/debug',
    'two/farmOverflow/policy',
    'two/farmOverflow/autoPresets'
], function (
    Settings,
    ERROR_TYPES,
    STATUS,
    SETTINGS,
    SETTINGS_MAP,
    UPDATES,
    FARMER_BEHAVIOR,
    TARGET_BEHAVIOR,
    LOG_TYPES,
    twoMapData,
    utils,
    ready,
    math,
    timeHelper,
    eventQueue,
    COMMAND_TYPES,
    VILLAGE_CONFIG,
    RESOURCE_TYPES,
    $mapData,
    Lockr,
    setupDebug,
    policy,
    autoPresets
) {
    let initialized = false;
    let running = false;
    let settings;
    let localSettings;
    const farmers = [];
    let logs = [];
    let includedVillages = [];
    let ignoredVillages = [];
    let onlyVillages = [];
    let selectedPresets = [];
    let activeFarmer = false;
    let sendingCommand = false;
    let currentTarget = false;
    let farmerIndex = 0;
    let cycleTimer = null;
    let stepDelayTimer = null;
    let commandExpireTimer = null;
    let exceptionLogs;
    const tempVillageReports = {};
    let $player;
    let unitsData;
    let persistentRunningLastCheck = timeHelper.gameTime();
    let persistentRunningTimer = null;
    let nextCycleDate = null;
    let runVersion = 0;
    let targetCooldowns = {};
    let cooldownStorageKey;
    const PERSISTENT_RUNNING_CHECK_INTERVAL = 30 * 1000;
    const VILLAGE_COMMAND_LIMIT = 50;
    const MINIMUM_FARMER_CYCLE_INTERVAL = 1000; // ms
    const MINIMUM_ATTACK_INTERVAL = 1000; // ms
    const STEP_EXPIRE_TIME = 30 * 1000;
    const CYCLE_BEGIN = 'cycle_begin';
    const IGNORE_UPDATES = 'ignore_update';
    const STORAGE_KEYS = {
        LOGS: 'farm_overflow_logs',
        SETTINGS: 'farm_overflow_settings',
        EXCEPTION_LOGS: 'farm_overflow_exception_logs'
    };
    const RESOURCES = [
        RESOURCE_TYPES.WOOD,
        RESOURCE_TYPES.CLAY,
        RESOURCE_TYPES.IRON
    ];

    const debug = setupDebug('farm_overflow');

    const villageFilters = {
        distance: function (target) {
            return !Number.isFinite(target.distance) || !target.distance.between(
                localSettings[SETTINGS.MIN_DISTANCE],
                localSettings[SETTINGS.MAX_DISTANCE]
            );
        },
        ownPlayer: function (target) {
            return Number(target.character_id) === Number($player.getId());
        },
        included: function (target) {
            return !policy.isBarbarian(target) && !includedVillages.includes(target.id);
        },
        barbarian: function (target) {
            return localSettings[SETTINGS.BARBARIANS_ONLY] && !policy.isBarbarian(target);
        },
        ignored: function (target) {
            return ignoredVillages.includes(target.id);
        },
        points: function (points) {
            return !points.between(
                localSettings[SETTINGS.MIN_POINTS],
                localSettings[SETTINGS.MAX_POINTS]
            );
        }
    };

    const targetFilters = [
        villageFilters.distance,
        villageFilters.ownPlayer,
        villageFilters.included,
        villageFilters.ignored,
        villageFilters.barbarian
    ];

    const calcDistances = function (targets, origin) {
        return targets.map(function (target) {
            return {...target, distance: math.actualDistance(origin, target)};
        });
    };

    const filterTargets = function (targets) {
        const seen = new Set();
        return targets.filter(function (target) {
            if (seen.has(target.id)) {
                return false;
            }

            seen.add(target.id);
            return targetFilters.every(function (fn) {
                return !fn(target);
            });
        });
    };

    const sortTargets = function (targets) {
        return targets.sort(function (a, b) {
            return a.distance - b.distance;
        });
    };

    const arrayUnique = function (array) {
        return array.sort().filter(function (item, pos, ary) {
            return !pos || item != ary[pos - 1];
        });
    };

    const reloadTimers = function () {
        if (!running) {
            return;
        }

        if (stepDelayTimer) {
            stopTimers();
            activeFarmer.targetStep({
                delay: true
            });
        } else if (cycleTimer) {
            stopTimers();

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);

            farmerIndex = 0;
            farmerStep();
        }
    };

    const updateIncludedVillage = function () {
        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];

        includedVillages = [];

        groupsInclude.forEach(function (groupId) {
            const groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupId);
            includedVillages = includedVillages.concat(groupVillages);
        });

        includedVillages = arrayUnique(includedVillages);
    };

    const updateIgnoredVillage = function () {
        const groupIgnored = localSettings[SETTINGS.GROUP_IGNORE];
        ignoredVillages = modelDataService.getGroupList().getGroupVillageIds(groupIgnored);
    };

    const updateOnlyVillage = function () {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];

        onlyVillages = [];

        groupsOnly.forEach(function (groupId) {
            let groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupId);
            groupVillages = groupVillages.filter(function (villageId) {
                return !!$player.getVillage(villageId);
            });

            onlyVillages = onlyVillages.concat(groupVillages);
        });

        onlyVillages = arrayUnique(onlyVillages);
    };

    const updateExceptionLogs = function () {
        const exceptionVillages = ignoredVillages.concat(includedVillages);
        let modified = false;

        exceptionVillages.forEach(function (villageId) {
            if (!hasOwn.call(exceptionLogs, villageId)) {
                exceptionLogs[villageId] = {
                    time: timeHelper.gameTime(),
                    report: false
                };
                modified = true;
            }
        });

        utils.each(exceptionLogs, function (time, villageId) {
            villageId = parseInt(villageId, 10);

            if (!exceptionVillages.includes(villageId)) {
                delete exceptionLogs[villageId];
                modified = true;
            }
        });

        if (modified) {
            Lockr.set(STORAGE_KEYS.EXCEPTION_LOGS, exceptionLogs);
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED);
        }
    };

    const updateGroupVillages = function () {
        updateIncludedVillage();
        updateIgnoredVillage();
        updateOnlyVillage();
        updateExceptionLogs();

        debug(1, 'includedVillages %o', includedVillages);
        debug(1, 'ignoredVillages %o', ignoredVillages);
        debug(1, 'onlyVillages %o', onlyVillages);

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_VILLAGES_UPDATED);
    };

    const villageGroupLink = function (event, data) {
        debug(1, 'group village linked: %d', data.group_id);

        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const isOwnVillage = $player.getVillage(data.village_id);
        let farmerListUpdated = false;

        updateGroupVillages();

        if (groupIgnore === data.group_id) {
            if (isOwnVillage) {
                removeFarmer(data.village_id);
                farmerListUpdated = true;
            } else {
                removeTarget(data.village_id);

                addLog(LOG_TYPES.IGNORED_VILLAGE, {
                    villageId: data.village_id
                });
                addExceptionLog(data.village_id);
            }
        }

        if (groupsInclude.includes(data.group_id) && !isOwnVillage) {
            reloadTargets();

            addLog(LOG_TYPES.INCLUDED_VILLAGE, {
                villageId: data.village_id
            });
            addExceptionLog(data.village_id);
        }

        if (groupsOnly.includes(data.group_id) && isOwnVillage) {
            const farmer = createFarmer(data.village_id);
            farmer.init().then(function () {
                if (running) {
                    farmer.start();
                }
            });

            farmerListUpdated = true;
        }

        if (farmerListUpdated) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const villageGroupUnlink = function (event, data) {
        debug(1, 'group village unlinked: %d', data.group_id);

        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const isOwnVillage = $player.getVillage(data.village_id);
        let farmerListUpdated = false;

        updateGroupVillages();

        if (groupIgnore === data.group_id) {
            if (isOwnVillage) {
                const farmer = createFarmer(data.village_id);
                farmer.init().then(function () {
                    if (running) {
                        farmer.start();
                    }
                });

                farmerListUpdated = true;
            } else {
                reloadTargets();

                addLog(LOG_TYPES.IGNORED_VILLAGE_REMOVED, {
                    villageId: data.village_id
                });
            }
        }

        if (groupsInclude.includes(data.group_id) && !isOwnVillage) {
            reloadTargets();

            addLog(LOG_TYPES.INCLUDED_VILLAGE_REMOVED, {
                villageId: data.village_id
            });
        }

        if (groupsOnly.includes(data.group_id) && isOwnVillage) {
            removeFarmer(data.village_id);
            farmerListUpdated = true;
        }

        if (farmerListUpdated) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const validGroups = function (_flag) {
        const gameGroups = modelDataService.getGroupList().getGroups();
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];

        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const validedGroupIgnore = hasOwn.call(gameGroups, groupIgnore) ? groupIgnore : settings.getDefault(SETTINGS.GROUP_IGNORE);
        const validedGroupsOnly = groupsOnly.filter(groupId => hasOwn.call(gameGroups, groupId));
        const validedGroupsInclude = groupsInclude.filter(groupId => hasOwn.call(gameGroups, groupId));

        settings.setAll({
            [SETTINGS.GROUP_IGNORE]: validedGroupIgnore,
            [SETTINGS.GROUP_ONLY]: validedGroupsOnly,
            [SETTINGS.GROUP_INCLUDE]: validedGroupsInclude
        }, _flag);
    };

    const removedGroupListener = function () {
        validGroups();
        updateGroupVillages();

        flushFarmers();
        reloadTargets();
        createFarmers();
    };

    const processPresets = function () {
        selectedPresets = [];
        const playerPresets = modelDataService.getPresetList().getPresets();
        const activePresets = localSettings[SETTINGS.PRESETS];

        activePresets.forEach(function (presetId) {
            if (!hasOwn.call(playerPresets, presetId)) {
                return;
            }

            const preset = {...playerPresets[presetId]};
            preset.load = getPresetHaul(preset);
            preset.travelTime = armyService.calculateTravelTime(preset, {
                barbarian: false,
                officers: false
            });

            selectedPresets.push(preset);
        });

        selectedPresets = selectedPresets.sort(function (a, b) {
            return a.travelTime - b.travelTime || b.load - a.load;
        });

        debug(1, 'selected presets %o', selectedPresets.map(preset => preset.id));
        debug(2, 'selected presets detailed %o', selectedPresets);
    };

    const ignoreVillage = function (villageId) {
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];

        if (!groupIgnore) {
            return false;
        }

        socketService.emit(routeProvider.GROUPS_LINK_VILLAGE, {
            group_id: groupIgnore,
            village_id: villageId
        });

        return true;
    };

    const presetListener = function () {
        processPresets();

        if (!selectedPresets.length && !localSettings[SETTINGS.AUTO_PRESETS]) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
                reason: ERROR_TYPES.NO_PRESETS
            });

            if (running) {
                farmOverflow.stop();
            }
        }
    };

    const reportListener = function (event, data) {
        if (data.type !== COMMAND_TYPES.TYPES.ATTACK || !isTarget(data.target_village_id)) {
            return;
        }

        const hadLoss = data.result === 2 || data.result === 3;
        const cooldown = hadLoss ? localSettings[SETTINGS.LOSS_COOLDOWN]
            : data.haul === 'none' ? localSettings[SETTINGS.EMPTY_HAUL_COOLDOWN] : 0;

        if (Number.isFinite(cooldown) && cooldown > 0) {
            targetCooldowns[data.target_village_id] = timeHelper.gameTime() + cooldown;
            Lockr.set(cooldownStorageKey, targetCooldowns);
        }

        // 1 = nocasualties
        // 2 = casualties
        // 3 = defeat
        if (hadLoss && localSettings[SETTINGS.IGNORE_ON_LOSS] && localSettings[SETTINGS.GROUP_IGNORE]) {
            tempVillageReports[data.target_village_id] = {
                haul: data.haul,
                id: data.id,
                result: data.result,
                title: data.title
            };

            ignoreVillage(data.target_village_id);
        }
    };

    const commandSentListener = function (event, data) {
        if (!running || !sendingCommand || !activeFarmer || !currentTarget) {
            return;
        }

        if (data.origin.id !== activeFarmer.getId()) {
            return;
        }

        if (data.target.id !== currentTarget.id) {
            return;
        }

        if (data.direction === 'forward' && data.type === COMMAND_TYPES.TYPES.ATTACK) {
            activeFarmer.commandSent(data);
        }
    };

    const commandErrorListener = function (event, data) {
        if (!activeFarmer || !sendingCommand || !currentTarget) {
            return;
        }

        if (data.cause === routeProvider.SEND_PRESET.type) {
            activeFarmer.commandError(data);
        }
    };

    const getPresetHaul = function (preset) {
        let haul = 0;

        utils.each(preset.units, function (unitAmount, unitName) {
            if (unitAmount) {
                haul += unitsData[unitName].load * unitAmount;
            }
        });

        return haul;
    };

    const addExceptionLog = function (villageId) {
        exceptionLogs[villageId] = {
            time: timeHelper.gameTime(),
            report: tempVillageReports[villageId] || false
        };

        delete tempVillageReports[villageId];

        Lockr.set(STORAGE_KEYS.EXCEPTION_LOGS, exceptionLogs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED);
    };

    const addLog = function (type, data = {}) {
        if (typeof type !== 'string') {
            return false;
        }

        if (!angular.isObject(data)) {
            data = {};
        }

        data.time = timeHelper.gameTime();
        data.type = type;

        logs.unshift(data);
        trimAndSaveLogs();

        return true;
    };

    const trimAndSaveLogs = function () {
        const limit = localSettings[SETTINGS.LOGS_LIMIT];

        if (logs.length > limit) {
            logs.splice(logs.length - limit, logs.length);
        }

        Lockr.set(STORAGE_KEYS.LOGS, logs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_LOGS_UPDATED);
    };

    const targetIsFree = function (thisFarmerIsAttacking, otherFarmerIsAttacking) {
        const farmerBehavior = localSettings[SETTINGS.FARMER_BEHAVIOR];
        const targetBehavior = localSettings[SETTINGS.TARGET_BEHAVIOR];

        return (!thisFarmerIsAttacking || farmerBehavior === FARMER_BEHAVIOR.ALLOW_MULTIPLE_ATTACK_EACH_TARGET)
            && (!otherFarmerIsAttacking || targetBehavior === TARGET_BEHAVIOR.TARGETS_ALLOW_MULTIPLE_FARMERS);
    };

    const enableRequiredPresets = function (villageId, callback) {
        const villagePresets = modelDataService.getPresetList().getPresetsByVillageId(villageId);
        const missingPresets = [];

        selectedPresets.forEach(function (preset) {
            if (!hasOwn.call(villagePresets, preset.id)) {
                missingPresets.push(preset.id);
            }
        });

        if (missingPresets.length) {
            // include already enabled presets because you can't only enable
            // missing ones, you need to emit all you want enabled.
            for (const id in villagePresets) {
                if (hasOwn.call(villagePresets, id)) {
                    missingPresets.push(id);
                }
            }

            socketService.emit(routeProvider.ASSIGN_PRESETS, {
                village_id: villageId,
                preset_ids: missingPresets
            }, callback);

            return;
        }

        callback();
    };

    const persistentRunningStart = function () {
        const cycleInterval = getCycleInterval();
        const attackInterval = getAttackInterval();
        const timeLimit = cycleInterval + (cycleInterval / 2) + attackInterval
            + localSettings[SETTINGS.CYCLE_JITTER] + localSettings[SETTINGS.ATTACK_JITTER] + STEP_EXPIRE_TIME;

        persistentRunningTimer = setInterval(function () {
            const now = timeHelper.gameTime();

            if (now - persistentRunningLastCheck > timeLimit) {
                farmOverflow.stop(STATUS.EXPIRED_STEP);
            }
        }, PERSISTENT_RUNNING_CHECK_INTERVAL);
    };

    const persistentRunningStop = function () {
        clearInterval(persistentRunningTimer);
    };

    const persistentRunningUpdate = function () {
        persistentRunningLastCheck = timeHelper.gameTime();
    };

    const stopTimers = function () {
        clearTimeout(cycleTimer);
        clearTimeout(stepDelayTimer);
        clearTimeout(commandExpireTimer);

        cycleTimer = null;
        stepDelayTimer = null;
        commandExpireTimer = null;
    };

    const getCycleInterval = function () {
        return Math.max(MINIMUM_FARMER_CYCLE_INTERVAL, localSettings[SETTINGS.FARMER_CYCLE_INTERVAL]);
    };

    const getAttackInterval = function () {
        return Math.max(MINIMUM_ATTACK_INTERVAL, localSettings[SETTINGS.ATTACK_INTERVAL]);
    };

    const getPresetChoice = function (farmer, target) {
        const distance = math.actualDistance(farmer.village.getPosition(), target);
        const generated = policy.isBarbarian(target) ? farmer.generatedPresets || [] : [];
        return policy.choosePreset(selectedPresets.concat(generated), farmer.village.getUnitInfo().getUnits(), unitsData, function (preset) {
            const fieldTime = armyService.calculateTravelTime(preset, {
                barbarian: policy.isBarbarian(target),
                officers: true,
                effects: true
            });
            return armyService.getTravelTimeForDistance(preset, fieldTime, distance, COMMAND_TYPES.TYPES.ATTACK);
        }, {
            optimize: localSettings[SETTINGS.OPTIMIZE_HAUL],
            reservePercent: localSettings[SETTINGS.UNIT_RESERVE_PERCENT],
            expectedLoot: localSettings[SETTINGS.ESTIMATED_TARGET_LOOT],
            maxTravelMs: localSettings[SETTINGS.MAX_TRAVEL_TIME]
        });
    };

    const storageIsFull = function (village) {
        resourceService.updateMaxStorage(village);
        const resources = village.getResources();
        const computed = resources.getComputed();
        const maximum = resources.getMaxStorage();
        return RESOURCES.every(type => computed[type].currentStock >= maximum);
    };

    function incomingCommandsFilter (command) {
        const type = command.type || command.data.type;
        return command.startCharacterId === $player.getId() && command.data.direction === 'forward'
            && (!type || type === COMMAND_TYPES.TYPES.ATTACK);
    }

    const Farmer = function (villageId) {
        this.villageId = villageId;
        this.village = $player.getVillage(villageId);

        if (!this.village) {
            throw new Error(`new Farmer -> Village ${villageId} doesn't exist.`);
        }

        this.index = 0;
        this.running = false;
        this.initialized = false;
        this.targets = false;
        this.onCycleEndFn = noop;
        this.status = STATUS.WAITING_CYCLE;
        this.stepVersion = 0;
        this.attacksThisCycle = 0;
        this.generatedPresets = [];
    };

    Farmer.prototype.init = function () {
        const loadPromises = [];

        if (!this.isInitialized()) {
            loadPromises.push(new Promise((resolve) => {
                if (this.isInitialized()) {
                    return resolve();
                }

                villageService.ensureVillageDataLoaded(this.villageId, resolve);
            }));

            loadPromises.push(new Promise((resolve) => {
                if (this.isInitialized()) {
                    return resolve();
                }

                this.loadTargets(() => {
                    eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_READY, {
                        villageId: this.villageId
                    });
                    resolve();
                });
            }));
        }

        return Promise.all(loadPromises).then(() => {
            this.initialized = true;
        });
    };

    Farmer.prototype.start = function () {
        persistentRunningUpdate();

        if (!running || this.running) {
            return false;
        }

        if (!this.initialized) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_ERROR_NOT_READY, {
                villageId: this.villageId
            });
            return false;
        }

        if (!this.targets.length) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_ERROR_NO_TARGETS, {
                villageId: this.villageId
            });
            return false;
        }

        activeFarmer = this;
        this.running = true;
        this.index = 0;
        this.attacksThisCycle = 0;
        this.generatedPresets = this.buildAutoPresets();
        this.targets = policy.orderTargets(this.targets, target => {
            const choice = getPresetChoice(this, target);
            return choice.score || 1 / Math.max(1, target.distance);
        }, localSettings[SETTINGS.TARGET_ORDER_VARIATION]);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_START, {
            villageId: this.villageId
        });

        this.targetStep({delay: false});
        return true;
    };

    Farmer.prototype.buildAutoPresets = function () {
        return localSettings[SETTINGS.AUTO_PRESETS] ? autoPresets(this.villageId, this.targets || [], this.village.getUnitInfo().getUnits(), unitsData, {
            unitNames: localSettings[SETTINGS.AUTO_PRESET_UNITS],
            minimum: localSettings[SETTINGS.AUTO_PRESET_MIN_UNITS],
            maximum: localSettings[SETTINGS.AUTO_PRESET_MAX_UNITS],
            carry: localSettings[SETTINGS.AUTO_PRESET_CARRY],
            reservePercent: localSettings[SETTINGS.UNIT_RESERVE_PERCENT],
            attackLimit: localSettings[SETTINGS.MAX_ATTACKS_PER_CYCLE],
            commandSlots: Math.max(1, VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS]
                    - this.village.getCommandListModel().getOutgoingCommands(true, true).length)
        }) : [];
    };

    Farmer.prototype.stop = function (reason) {
        this.running = false;
        this.stepVersion++;

        debug(1, 'stop farmer village %d', this.villageId);

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_STOP, {
            villageId: this.villageId,
            reason: reason
        });

        if (reason === ERROR_TYPES.USER_STOP) {
            this.setStatus(STATUS.USER_STOP);
        } else if (reason) {
            this.setStatus(reason);
        }

        stopTimers();

        this.onCycleEndFn(reason);
        this.onCycleEndFn = noop;
    };

    function stepFactory (id, handler) {
        return function () {
            const promise = new Promise(function (resolve, reject) {
                handler(resolve, reject);
            });

            const stepStart = Date.now();

            promise.catch(noop).finally(function () {
                const stepEnd = Date.now();
                const elapsedTime = stepEnd - stepStart;
                debug(3, '%s took %d', id, elapsedTime);
            });

            return promise;
        };
    }

    Farmer.prototype.targetStep = async function (options = {}) {
        if (!running || !this.running) {
            return false;
        }

        const stepVersion = ++this.stepVersion;
        const isActive = () => running && this.running && activeFarmer === this && stepVersion === this.stepVersion;
        const attackDelay = options.delay
            ? policy.boundedDelay(getAttackInterval(), localSettings[SETTINGS.ATTACK_JITTER], MINIMUM_ATTACK_INTERVAL) : 0;

        debug(1, 'start target step %d', this.villageId);

        persistentRunningUpdate();

        let selectedPreset = false;
        let selectedChoice;
        let target;
        let incomingAttacks = [];
        let checkedLocalCommands = false;
        let otherFarmerIsAttacking;
        let thisFarmerIsAttacking;

        const delayStep = stepFactory('delayStep', (resolve, reject) => {
            if (options.delay) {
                stepDelayTimer = setTimeout(() => {
                    stepDelayTimer = null;

                    if (!isActive()) {
                        return reject(STATUS.USER_STOP);
                    }

                    resolve();
                }, attackDelay);
            } else {
                resolve();
            }
        });

        const checkCommandLimit = stepFactory('checkCommandLimit', (resolve, reject) => {
            const villageCommands = this.village.getCommandListModel().getOutgoingCommands(true, true);
            const limit = VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS];

            if (this.attacksThisCycle >= localSettings[SETTINGS.MAX_ATTACKS_PER_CYCLE]) {
                reject(STATUS.CYCLE_ATTACK_LIMIT);
            } else if (villageCommands.length >= limit) {
                reject(STATUS.COMMAND_LIMIT);
            } else {
                resolve();
            }
        });

        const checkStorage = stepFactory('checkStorage', (resolve, reject) => {
            if (localSettings[SETTINGS.IGNORE_FULL_STORAGE] && storageIsFull(this.village)) {
                return reject(STATUS.FULL_STORAGE);
            }

            resolve();
        });

        const selectTarget = stepFactory('selectTarget', (resolve, reject) => {
            if (!this.targets.length) {
                return reject(STATUS.NO_TARGETS);
            }

            if (this.index > this.targets.length || !this.targets[this.index]) {
                return reject(STATUS.TARGET_CYCLE_END);
            }

            target = this.targets[this.index];

            resolve();
        });

        const checkTarget = stepFactory('checkTarget', (resolve, reject) => {
            if (targetCooldowns[target.id] > timeHelper.gameTime()) {
                return reject(STATUS.TARGET_COOLDOWN);
            }

            const checkTargetHandler = (data) => {
                if (!isActive()) {
                    reject(STATUS.USER_STOP);
                } else if (!data || data.id !== target.id || !Number.isFinite(data.points)) {
                    reject(STATUS.COMMAND_ERROR);
                } else if (villageFilters.points(data.points)) {
                    return reject(STATUS.NOT_ALLOWED_POINTS);
                } else if (villageFilters.barbarian(data) || villageFilters.ownPlayer(data)
                    || villageFilters.included(data) || villageFilters.ignored(data)) {
                    reject(STATUS.ABANDONED_CONQUERED);
                } else if (data.attack_protection) {
                    reject(STATUS.PROTECTED_VILLAGE);
                } else {
                    target = {...target, ...data};
                    resolve();
                }
            };

            const data = $mapData.getTownAt(target.x, target.y);

            if (data) {
                checkTargetHandler(data);
            } else {
                $mapData.getTownAtAsync(target.x, target.y, checkTargetHandler);
            }
        });

        const checkPresets = stepFactory('checkPresets', (resolve, reject) => {
            if (localSettings[SETTINGS.PREVIEW_ONLY]) {
                return resolve();
            }

            enableRequiredPresets(this.villageId, () => {
                if (isActive()) {
                    resolve();
                } else {
                    reject(STATUS.USER_STOP);
                }
            });
        });

        const selectPreset = stepFactory('selectPreset', (resolve, reject) => {
            selectedChoice = getPresetChoice(this, target);

            if (!selectedChoice.preset) {
                return reject(selectedChoice.reason === 'time_limit' ? STATUS.TIME_LIMIT : STATUS.NO_UNITS);
            }

            selectedPreset = selectedChoice.preset;
            resolve();
        });

        const checkLocalCommands = stepFactory('checkLocalCommands', (resolve, reject) => {
            const characterVillages = Object.values(modelDataService.getVillages());
            const allOwnCommandsReady = characterVillages.every(village => village.readyState[VILLAGE_CONFIG.READY_STATES.OWN_COMMANDS]);

            if (allOwnCommandsReady) {
                checkedLocalCommands = true;

                const x = villageInfoService.getCommands(target.id);
                const incomingCommands = x.filter(incomingCommandsFilter);
                incomingAttacks = incomingCommands;

                otherFarmerIsAttacking = incomingCommands.some((command) => command.startVillageId !== this.villageId);
                thisFarmerIsAttacking = incomingCommands.some((command) => command.startVillageId === this.villageId);

                if (!targetIsFree(thisFarmerIsAttacking, otherFarmerIsAttacking)) {
                    return reject(STATUS.BUSY_TARGET);
                }
            }

            resolve();
        });

        const checkLoadedCommands = stepFactory('checkLoadedCommands', (resolve, reject) => {
            if (checkedLocalCommands) {
                return resolve();
            }

            socketService.emit(routeProvider.MAP_GET_VILLAGE_DETAILS, {
                my_village_id: this.villageId,
                village_id: target.id,
                num_reports: 0
            }, (data) => {
                if (!isActive()) {
                    return reject(STATUS.USER_STOP);
                }

                if (!data || !data.commands || !Array.isArray(data.commands.own)) {
                    return reject(STATUS.COMMAND_ERROR);
                }

                incomingAttacks = data.commands.own.filter((command) => command.type === COMMAND_TYPES.TYPES.ATTACK && command.direction === 'forward');
                otherFarmerIsAttacking = incomingAttacks.some((command) => command.start_village_id !== this.villageId);
                thisFarmerIsAttacking = incomingAttacks.some((command) => command.start_village_id === this.villageId);

                if (!targetIsFree(thisFarmerIsAttacking, otherFarmerIsAttacking)) {
                    debug(2, 'rejected by checkLoadedCommands');
                    return reject(STATUS.BUSY_TARGET);
                }

                resolve();
            });
        });

        const minimumInterval = stepFactory('minimumInterval', (resolve, reject) => {
            if (!thisFarmerIsAttacking && !otherFarmerIsAttacking) {
                return resolve();
            }

            const arrival = timeHelper.gameTime() / 1000 + selectedChoice.travelSeconds;
            const attackCollision = policy.arrivalIsBusy(arrival, incomingAttacks, localSettings[SETTINGS.MULTIPLE_ATTACKS_INTERVAL]);

            if (attackCollision) {
                debug(2, 'rejected by minimumInterval');
                return reject(STATUS.BUSY_TARGET);
            }

            resolve();
        });

        const prepareAttack = () => {
            if (!isActive()) {
                return false;
            }

            // Recheck mutable state immediately before issuing a command.
            const latest = $mapData.getTownAt(target.x, target.y);

            if (!latest || latest.id !== target.id || villageFilters.barbarian(latest)
                || villageFilters.ownPlayer(latest) || villageFilters.included(latest) || villageFilters.ignored(latest)) {
                throw STATUS.ABANDONED_CONQUERED;
            }

            if (latest.attack_protection) {
                throw STATUS.PROTECTED_VILLAGE;
            }

            if (!Number.isFinite(latest.points) || villageFilters.points(latest.points)) {
                throw STATUS.NOT_ALLOWED_POINTS;
            }

            if (targetCooldowns[target.id] > timeHelper.gameTime()) {
                throw STATUS.TARGET_COOLDOWN;
            }

            selectedChoice = getPresetChoice(this, {...target, ...latest});

            if (!selectedChoice.preset || selectedChoice.preset.id !== selectedPreset.id) {
                throw STATUS.NO_UNITS;
            }

            const commands = this.village.getCommandListModel().getOutgoingCommands(true, true);

            if (commands.length >= VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS]) {
                throw STATUS.COMMAND_LIMIT;
            }

            if (localSettings[SETTINGS.IGNORE_FULL_STORAGE] && storageIsFull(this.village)) {
                throw STATUS.FULL_STORAGE;
            }

            if (policy.arrivalIsBusy(timeHelper.gameTime() / 1000 + selectedChoice.travelSeconds,
                incomingAttacks,
                localSettings[SETTINGS.MULTIPLE_ATTACKS_INTERVAL])) {
                throw STATUS.BUSY_TARGET;
            }

            clearTimeout(commandExpireTimer);
            commandExpireTimer = null;
            this.index++;
            this.attacksThisCycle++;

            if (localSettings[SETTINGS.PREVIEW_ONLY]) {
                this.setStatus(STATUS.PREVIEW);
                addLog(LOG_TYPES.PLANNED_VILLAGE, {
                    targetId: target.id,
                    originId: this.villageId,
                    presetId: selectedPreset.id,
                    units: {...selectedPreset.units},
                    capacity: selectedChoice.haul,
                    travelSeconds: selectedChoice.travelSeconds,
                    ratePerHour: Math.round(selectedChoice.score * 3600),
                    usingLootEstimate: localSettings[SETTINGS.ESTIMATED_TARGET_LOOT] > 0
                });
                this.targetStep({delay: true});
                return;
            }

            this.setStatus(STATUS.ATTACKING);

            sendingCommand = true;
            currentTarget = target;

            debug(2, 'sending attack to %d from %d', target.id, this.villageId);

            commandExpireTimer = setTimeout(() => {
                if (isActive() && sendingCommand) {
                    // An unacknowledged send must not be retried automatically.
                    farmOverflow.stop(STATUS.COMMAND_TIMEOUT);
                }
            }, STEP_EXPIRE_TIME);

            if (selectedPreset.generated) {
                if (!routeProvider.SEND_CUSTOM_ARMY) {
                    farmOverflow.stop(STATUS.COMMAND_ERROR);
                    return;
                }
                socketService.emit(routeProvider.SEND_CUSTOM_ARMY, {
                    start_village: this.villageId,
                    target_village: target.id,
                    units: selectedPreset.units,
                    officers: {},
                    icon: 0,
                    catapult_target: false,
                    type: COMMAND_TYPES.TYPES.ATTACK
                });
                return;
            }
            socketService.emit(routeProvider.SEND_PRESET, {
                start_village: this.villageId,
                target_village: target.id,
                army_preset_id: selectedPreset.id,
                type: COMMAND_TYPES.TYPES.ATTACK
            });
        };

        const stepStatus = (status) => {
            if (!isActive()) {
                return;
            }

            stopTimers();

            debug(1, 'target step finished "%s"', status);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_STEP_STATUS, {
                villageId: this.villageId,
                error: status
            });

            switch (status) {
                case STATUS.TIME_LIMIT:
                case STATUS.BUSY_TARGET:
                case STATUS.ABANDONED_CONQUERED:
                case STATUS.PROTECTED_VILLAGE: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep(options);
                    break;
                }
                case STATUS.TARGET_COOLDOWN: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep(options);
                    break;
                }
                case STATUS.USER_STOP: {
                    this.setStatus(status);
                    break;
                }
                case STATUS.NOT_ALLOWED_POINTS: {
                    this.index++;
                    this.setStatus(status);
                    removeTarget(target.id);
                    this.targetStep(options);
                    break;
                }
                case STATUS.NO_UNITS:
                case STATUS.NO_TARGETS:
                case STATUS.FULL_STORAGE:
                case STATUS.COMMAND_LIMIT: {
                    this.index++;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.CYCLE_ATTACK_LIMIT: {
                    this.index = 0;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.TARGET_CYCLE_END: {
                    this.index = 0;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.EXPIRED_STEP: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep({delay: true});
                    break;
                }
                default: {
                    this.index++;
                    this.setStatus(STATUS.UNKNOWN);
                    this.stop(STATUS.UNKNOWN);
                    break;
                }
            }
        };

        const activeStep = (step) => () => {
            if (!isActive()) {
                throw STATUS.USER_STOP;
            }

            return step();
        };

        const attackPromise = new Promise((resolve, reject) => {
            delayStep()
                .then(activeStep(checkCommandLimit))
                .then(activeStep(checkStorage))
                .then(activeStep(selectTarget))
                .then(activeStep(checkTarget))
                .then(activeStep(checkPresets))
                .then(activeStep(selectPreset))
                .then(activeStep(checkLocalCommands))
                .then(activeStep(checkLoadedCommands))
                .then(activeStep(minimumInterval))
                .then(resolve)
                .catch(reject);
        });

        const expirePromise = new Promise((resolve, reject) => {
            commandExpireTimer = setTimeout(() => {
                if (isActive()) {
                    reject(STATUS.EXPIRED_STEP);
                }
            }, STEP_EXPIRE_TIME + attackDelay);
        });

        Promise.race([
            attackPromise,
            expirePromise
        ])
            .then(prepareAttack)
            .catch(stepStatus);
    };

    Farmer.prototype.setStatus = function (newStatus) {
        this.status = newStatus;
    };

    Farmer.prototype.getStatus = function () {
        return this.status || STATUS.UNKNOWN;
    };

    Farmer.prototype.commandSent = function (data) {
        sendingCommand = false;
        currentTarget = false;

        stopTimers();

        addLog(LOG_TYPES.ATTACKED_VILLAGE, {
            targetId: data.target.id
        });

        this.targetStep({
            delay: true
        });
    };

    Farmer.prototype.commandError = function () {
        sendingCommand = false;
        currentTarget = false;

        this.stop(STATUS.COMMAND_ERROR);
    };

    Farmer.prototype.onCycleEnd = function (handler) {
        this.onCycleEndFn = handler;
    };

    Farmer.prototype.loadTargets = function (callback) {
        const pos = this.village.getPosition();

        twoMapData.load((loadedTargets) => {
            this.targets = calcDistances(loadedTargets, pos);
            this.targets = filterTargets(this.targets, pos);
            this.targets = sortTargets(this.targets);
            this.targets = this.targets.slice(0, localSettings[SETTINGS.TARGET_LIMIT]);

            if (typeof callback === 'function') {
                callback(this.targets);
            }

            debug(2, 'village %d targets %o', this.villageId, this.targets.map(village => village.id));
            debug(3, 'village %d detailed targets %o', this.villageId, this.targets);

            // make sure villages area are pre-loaded
            for (const target of this.targets) {
                $mapData.loadTownData(target.x, target.y, 1, 1);
            }
        });
    };

    Farmer.prototype.getTargets = function () {
        return this.targets;
    };

    Farmer.prototype.getIndex = function () {
        return this.index;
    };

    Farmer.prototype.getVillage = function () {
        return this.village;
    };

    Farmer.prototype.isRunning = function () {
        return this.running;
    };

    Farmer.prototype.isInitialized = function () {
        return this.initialized;
    };

    Farmer.prototype.removeTarget = function (targetId) {
        if (typeof targetId !== 'number' || !this.targets) {
            return false;
        }

        const removedBeforeIndex = this.targets.slice(0, this.index).filter(target => target.id === targetId).length;
        this.targets = this.targets.filter(function (target) {
            return target.id !== targetId;
        });
        this.index = Math.max(0, this.index - removedBeforeIndex);

        return true;
    };

    Farmer.prototype.getId = function () {
        return this.villageId;
    };

    const createFarmer = function (villageId) {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];

        villageId = parseInt(villageId, 10);

        if (groupsOnly.length && !onlyVillages.includes(villageId)) {
            return false;
        }

        if (ignoredVillages.includes(villageId)) {
            return false;
        }

        let farmer = farmOverflow.getFarmer(villageId);

        if (!farmer) {
            farmer = new Farmer(villageId);
            farmers.push(farmer);
        }

        return farmer;
    };

    const createFarmers = function () {
        utils.each($player.getVillages(), function (village, villageId) {
            createFarmer(villageId);
        });

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
    };

    /**
     * Clean farmer instances by removing villages based on
     * groups-only, only-villages and ignore-villages group filters.
     */
    const flushFarmers = function () {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const removeIds = [];

        farmers.forEach(function (farmer) {
            const villageId = farmer.getId();

            if (groupsOnly.length && !onlyVillages.includes(villageId)) {
                removeIds.push(villageId);
            } else if (ignoredVillages.includes(villageId)) {
                removeIds.push(villageId);
            }
        });

        if (removeIds.length) {
            removeIds.forEach(function (removeId) {
                removeFarmer(removeId);
            });

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const removeFarmer = function (farmerId) {
        for (let i = 0; i < farmers.length; i++) {
            if (farmers[i].getId() === farmerId) {
                farmers[i].stop(ERROR_TYPES.KILL_FARMER);
                farmers.splice(i, i + 1);

                return true;
            }
        }

        return false;
    };

    const farmerStep = function (status) {
        if (!running) {
            return;
        }

        persistentRunningUpdate();

        if (!farmers.length) {
            debug(1, 'farmerStep: no active farmers');
            activeFarmer = false;
        } else if (farmerIndex >= farmers.length) {
            debug(1, 'farmerStep: cycle end');
            farmerIndex = 0;
            activeFarmer = false;
        } else {
            activeFarmer = farmers[farmerIndex];
        }

        if (activeFarmer) {
            activeFarmer.onCycleEnd(function (reason) {
                if (running && reason !== ERROR_TYPES.USER_STOP) {
                    debug(1, 'farmerStep: farmer finished, select next farmer');
                    farmerIndex++;
                    farmerStep();
                }
            });

            if (status === CYCLE_BEGIN) {
                debug(1, 'farmerStep: cycle start');
                nextCycleDate = null;
                eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);
            }

            if (!activeFarmer.start()) {
                farmerIndex++;
                farmerStep();
            }
        } else {
            const cycleDelay = policy.boundedDelay(getCycleInterval(), localSettings[SETTINGS.CYCLE_JITTER], MINIMUM_FARMER_CYCLE_INTERVAL);
            nextCycleDate = timeHelper.gameTime() + cycleDelay;
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_END);

            cycleTimer = setTimeout(function () {
                cycleTimer = null;
                farmerIndex = 0;
                nextCycleDate = null;
                eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);
                farmerStep();
            }, cycleDelay);
        }
    };

    const isTarget = function (targetId) {
        for (let i = 0; i < farmers.length; i++) {
            const farmer = farmers[i];
            const targets = farmer.getTargets() || [];

            for (let j = 0; j < targets.length; j++) {
                const target = targets[j];

                if (target.id === targetId) {
                    return true;
                }
            }
        }

        return false;
    };

    const removeTarget = function (targetId) {
        farmers.forEach(function (farmer) {
            farmer.removeTarget(targetId);
        });
    };

    const reloadTargets = function () {
        twoMapData.load(function () {
            farmers.forEach(function (farmer) {
                farmer.loadTargets();
            });
        }, true);
    };

    const farmOverflow = {};

    farmOverflow.previewAutoPresets = function () {
        return Promise.all(farmers.map(farmer => new Promise(resolve => {
            villageService.ensureVillageDataLoaded(farmer.villageId, () => farmer.loadTargets(() => {
                resolve(farmer.buildAutoPresets().map(preset => ({
                    villageId: farmer.villageId,
                    name: preset.name,
                    units: preset.units,
                    nearbyTargets: preset.nearbyTargets,
                    capacity: getPresetHaul(preset)
                })));
            }));
        }))).then(plans => [].concat(...plans));
    };

    farmOverflow.init = function () {
        debug(1, 'initialized');

        initialized = true;
        logs = Lockr.get(STORAGE_KEYS.LOGS, []);
        exceptionLogs = Lockr.get(STORAGE_KEYS.EXCEPTION_LOGS, {});
        $player = modelDataService.getSelectedCharacter();
        unitsData = modelDataService.getGameData().getUnitsObject();
        cooldownStorageKey = `farm_overflow_cooldowns_${$player.getWorldId()}_${$player.getId()}`;
        targetCooldowns = Lockr.get(cooldownStorageKey, {});

        for (const [id, until] of Object.entries(targetCooldowns)) {
            if (!Number.isFinite(until) || until <= timeHelper.gameTime()) {
                delete targetCooldowns[id];
            }
        }

        settings = new Settings({
            settingsMap: SETTINGS_MAP,
            storageKey: STORAGE_KEYS.SETTINGS
        });

        // Earlier versions stored the target-count text input without parsing it.
        const legacyTargetLimit = settings.getRaw(SETTINGS.TARGET_LIMIT);

        if (typeof legacyTargetLimit === 'string' && legacyTargetLimit.trim() !== ''
            && Number.isInteger(Number(legacyTargetLimit))) {
            settings.set(SETTINGS.TARGET_LIMIT, Number(legacyTargetLimit));
        }

        settings.onChange(function (changes, updates, _flag) {
            debug(1, 'settings changes: %o updates: %o', changes, updates);

            localSettings = settings.getAll();

            if (_flag === IGNORE_UPDATES) {
                return;
            }

            if (running) {
                farmOverflow.stop();
            }

            if (updates[UPDATES.PRESET]) {
                processPresets();
            }

            if (updates[UPDATES.GROUPS]) {
                updateGroupVillages();
            }

            if (updates[UPDATES.TARGETS]) {
                reloadTargets();
            }

            if (updates[UPDATES.VILLAGES]) {
                flushFarmers();
                createFarmers();
            }

            if (updates[UPDATES.LOGS]) {
                trimAndSaveLogs();
            }

            if (updates[UPDATES.INTERVAL_TIMERS]) {
                reloadTimers();
            }
        });

        localSettings = settings.getAll();
        debug(1, 'settings %O', localSettings);

        validGroups(IGNORE_UPDATES);
        updateGroupVillages();
        createFarmers();

        ready(function () {
            processPresets();
        }, 'presets');

        ready(function () {
            farmers.forEach(function (farmer) {
                farmer.loadTargets();
            });
        }, 'minimap_data');

        $rootScope.$on(eventTypeProvider.ARMY_PRESET_UPDATE, presetListener);
        $rootScope.$on(eventTypeProvider.ARMY_PRESET_DELETED, presetListener);
        $rootScope.$on(eventTypeProvider.GROUPS_VILLAGE_LINKED, villageGroupLink);
        $rootScope.$on(eventTypeProvider.GROUPS_VILLAGE_UNLINKED, villageGroupUnlink);
        $rootScope.$on(eventTypeProvider.GROUPS_DESTROYED, removedGroupListener);
        $rootScope.$on(eventTypeProvider.COMMAND_SENT, commandSentListener);
        $rootScope.$on(eventTypeProvider.MESSAGE_ERROR, commandErrorListener);
        $rootScope.$on(eventTypeProvider.REPORT_NEW, reportListener);
    };

    farmOverflow.start = function () {
        if (running) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.ALREADY_RUNNING);
            return false;
        }

        const validSettings = Object.entries(SETTINGS_MAP).every(([id, map]) => {
            const value = localSettings[id];

            if (map.inputType === 'readable_time') {
                return Number.isFinite(value) && value >= 0 && value <= 7 * 24 * 60 * 60 * 1000;
            }

            if (map.inputType === 'number') {
                return Number.isInteger(value) && value >= map.min && value <= map.max;
            }

            if (map.inputType === 'checkbox') {
                return typeof value === 'boolean';
            }

            return true;
        });

        if (!validSettings || localSettings[SETTINGS.MAX_TRAVEL_TIME] <= 0
            || localSettings[SETTINGS.MIN_DISTANCE] > localSettings[SETTINGS.MAX_DISTANCE]
            || localSettings[SETTINGS.MIN_POINTS] > localSettings[SETTINGS.MAX_POINTS]
            || localSettings[SETTINGS.AUTO_PRESET_MIN_UNITS] > localSettings[SETTINGS.AUTO_PRESET_MAX_UNITS]
            || (localSettings[SETTINGS.AUTO_PRESETS] && (!Array.isArray(localSettings[SETTINGS.AUTO_PRESET_UNITS])
                || !localSettings[SETTINGS.AUTO_PRESET_UNITS].length
                || localSettings[SETTINGS.AUTO_PRESET_UNITS].some(name => !unitsData[name])))) {
            utils.notif('error', $filter('i18n')('invalid_farming_settings', $rootScope.loc.ale, 'farm_overflow'));
            return false;
        }

        if (!selectedPresets.length && !localSettings[SETTINGS.AUTO_PRESETS]) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.NO_SELECTED_PRESET);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
                reason: ERROR_TYPES.NO_PRESETS
            });

            return false;
        }

        running = true;
        const startedRun = ++runVersion;

        const readyFarmers = [];

        farmers.forEach(function (farmer) {
            readyFarmers.push(farmer.init());
        });

        if (!readyFarmers.length) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.NO_PRESETS);
            running = false;
            return false;
        }

        Promise.all(readyFarmers).then(function () {
            if (!running || runVersion !== startedRun) {
                return;
            }

            debug(1, 'start: all farmers ready');
            farmerStep(CYCLE_BEGIN);
        }).catch(function () {
            if (running && runVersion === startedRun) {
                farmOverflow.stop(STATUS.UNKNOWN);
            }
        });

        persistentRunningUpdate();
        persistentRunningStart();

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_START);
        debug(1, 'start: success');

        addLog(LOG_TYPES.FARM_START);
    };

    farmOverflow.stop = function (reason = STATUS.USER_STOP) {
        running = false;
        runVersion++;
        sendingCommand = false;
        currentTarget = false;

        if (activeFarmer) {
            activeFarmer.stop(reason);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_END, reason);
        }

        nextCycleDate = null;

        stopTimers();

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
            reason: reason
        });

        persistentRunningStop();

        if (reason === STATUS.USER_STOP) {
            addLog(LOG_TYPES.FARM_STOP);
        }
    };

    farmOverflow.getFarmer = function (farmerId) {
        return farmers.find(function (farmer) {
            return farmer.getId() === farmerId;
        });
    };

    farmOverflow.getFarmers = function () {
        return farmers;
    };

    farmOverflow.getSettings = function () {
        return settings;
    };

    farmOverflow.getExceptionVillages = function () {
        return {
            included: includedVillages,
            ignored: ignoredVillages
        };
    };

    farmOverflow.getExceptionLogs = function () {
        return exceptionLogs;
    };

    farmOverflow.isInitialized = function () {
        return initialized;
    };

    farmOverflow.isRunning = function () {
        return running;
    };

    farmOverflow.getLogs = function () {
        return logs;
    };

    farmOverflow.clearLogs = function () {
        logs = [];
        Lockr.set(STORAGE_KEYS.LOGS, logs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_LOGS_UPDATED);

        return logs;
    };

    farmOverflow.getNextCycleDate = function () {
        return nextCycleDate;
    };

    farmOverflow.getCycleInterval = getCycleInterval;

    return farmOverflow;
});

define('two/farmOverflow/autoPresets', ['two/farmOverflow/policy'], function (policy) {
    // Farmer-owned packets use SEND_CUSTOM_ARMY and never modify native presets.
    return function (villageId, targets, units, unitData, options) {
        if (!Array.isArray(options.unitNames) || !Number.isFinite(options.reservePercent)
            || options.reservePercent < 0 || options.reservePercent > 100
            || !Number.isInteger(options.minimum) || !Number.isInteger(options.maximum)
            || options.minimum < 1 || options.maximum < options.minimum
            || !Number.isFinite(options.carry) || options.carry <= 0) {
            return [];
        }
        const nearby = targets.filter(policy.isBarbarian);
        if (!nearby.length) {
            return [];
        }
        const packets = Math.max(1, Math.min(nearby.length, options.commandSlots, options.attackLimit));
        if (!Number.isInteger(packets)) {
            return [];
        }
        const result = [];
        for (const name of new Set(options.unitNames)) {
            const data = unitData[name];
            const stock = units[name] && units[name].in_town;
            if (!data || !Number.isFinite(data.load) || data.load <= 0 || !Number.isInteger(stock) || stock < 0) {
                continue;
            }
            const available = Math.floor(stock * (1 - options.reservePercent / 100));
            const cap = Math.min(available, options.maximum, Math.ceil(options.carry / data.load));
            if (cap < options.minimum) {
                continue;
            }
            const base = Math.min(cap, Math.max(options.minimum, Math.floor(available / packets)));
            for (const amount of new Set([base, Math.min(cap, base * 2), cap])) {
                result.push({
                    id: `auto:${villageId}:${name}:${amount}`,
                    name: `Auto ${name} × ${amount}`,
                    units: {[name]: amount},
                    officers: {},
                    generated: true,
                    nearbyTargets: nearby.length
                });
            }
        }
        return result;
    };
});

define('two/farmOverflow/events', [], function () {
    angular.extend(eventTypeProvider, {
        FARM_OVERFLOW_START: 'farm_overflow_start',
        FARM_OVERFLOW_STOP: 'farm_overflow_stop',
        FARM_OVERFLOW_INSTANCE_READY: 'farm_overflow_instance_ready',
        FARM_OVERFLOW_INSTANCE_START: 'farm_overflow_instance_start',
        FARM_OVERFLOW_INSTANCE_STOP: 'farm_overflow_instance_stop',
        FARM_OVERFLOW_INSTANCE_ERROR_NO_TARGETS: 'farm_overflow_instance_error_no_targets',
        FARM_OVERFLOW_INSTANCE_ERROR_NOT_READY: 'farm_overflow_instance_error_not_ready',
        FARM_OVERFLOW_INSTANCE_STEP_STATUS: 'farm_overflow_instance_command_status',
        FARM_OVERFLOW_PRESETS_LOADED: 'farm_overflow_presets_loaded',
        FARM_OVERFLOW_LOGS_UPDATED: 'farm_overflow_log_updated',
        FARM_OVERFLOW_COMMAND_SENT: 'farm_overflow_command_sent',
        FARM_OVERFLOW_IGNORED_TARGET: 'farm_overflow_ignored_target',
        FARM_OVERFLOW_VILLAGE_IGNORED: 'farm_overflow_village_ignored',
        FARM_OVERFLOW_EXCEPTION_VILLAGES_UPDATED: 'farm_overflow_exception_villages_updated',
        FARM_OVERFLOW_FARMER_VILLAGES_UPDATED: 'farm_overflow_farmer_villages_updated',
        FARM_OVERFLOW_REPORTS_UPDATED: 'farm_overflow_reports_updated',
        FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED: 'farm_overflow_exception_logs_updated',
        FARM_OVERFLOW_CYCLE_BEGIN: 'farm_overflow_cycle_begin',
        FARM_OVERFLOW_CYCLE_END: 'farm_overflow_cycle_end'
    });
});

define('two/farmOverflow/ui', [
    'two/ui',
    'two/farmOverflow',
    'two/farmOverflow/types/status',
    'two/farmOverflow/types/errors',
    'two/farmOverflow/types/logs',
    'two/farmOverflow/types/farmerBehavior',
    'two/farmOverflow/types/targetBehavior',
    'two/farmOverflow/settings',
    'two/Settings',
    'two/EventScope',
    'two/utils',
    'queues/EventQueue',
    'helper/time',
    'helper/util',
    'humanInterval'
], function (
    interfaceOverflow,
    farmOverflow,
    STATUS,
    ERROR_TYPES,
    LOG_TYPES,
    FARMER_BEHAVIOR,
    TARGET_BEHAVIOR,
    SETTINGS,
    Settings,
    EventScope,
    utils,
    eventQueue,
    timeHelper,
    util,
    humanInterval
) {
    let $scope;
    let settings;
    const presetList = modelDataService.getPresetList();
    const groupList = modelDataService.getGroupList();
    let $button;
    const villagesInfo = {};
    const villagesLabel = {};
    let cycleCountdownTimer = null;
    const TAB_TYPES = {
        SETTINGS: 'settings',
        VILLAGES: 'villages',
        LOGS: 'logs'
    };

    const updateVisibleLogs = function () {
        const offset = $scope.pagination.offset;
        const limit = $scope.pagination.limit;

        $scope.visibleLogs = $scope.logs.slice(offset, offset + limit);
        $scope.pagination.count = $scope.logs.length;

        $scope.visibleLogs.forEach(function (log) {
            if (log.villageId) {
                loadVillageInfo(log.villageId);
            }

            if (log.targetId) {
                loadVillageInfo(log.targetId);
            }
        });
    };

    // TODO: make it shared with other modules
    const loadVillageInfo = function (villageId) {
        if (villagesInfo[villageId]) {
            return villagesInfo[villageId];
        }

        villagesInfo[villageId] = true;
        villagesLabel[villageId] = 'LOADING...';

        socketService.emit(routeProvider.MAP_GET_VILLAGE_DETAILS, {
            my_village_id: modelDataService.getSelectedVillage().getId(),
            village_id: villageId,
            num_reports: 1
        }, function (data) {
            villagesInfo[villageId] = {
                x: data.village_x,
                y: data.village_y,
                name: data.village_name,
                last_report: data.last_reports[0]
            };

            villagesLabel[villageId] = `${data.village_name} (${data.village_x}|${data.village_y})`;
        });
    };

    const loadExceptionsInfo = function () {
        $scope.exceptionVillages.included.forEach(function (villageId) {
            loadVillageInfo(villageId);
        });
        $scope.exceptionVillages.ignored.forEach(function (villageId) {
            loadVillageInfo(villageId);
        });
    };

    const switchFarm = function () {
        if (farmOverflow.isRunning()) {
            farmOverflow.stop();
        } else {
            farmOverflow.start();
        }
    };

    const selectTab = function (tabType) {
        $scope.selectedTab = tabType;
    };

    const saveSettings = function () {
        const validSettings = [
            SETTINGS.ATTACK_INTERVAL,
            SETTINGS.FARMER_CYCLE_INTERVAL,
            SETTINGS.MULTIPLE_ATTACKS_INTERVAL,
            SETTINGS.MAX_TRAVEL_TIME,
            SETTINGS.ATTACK_JITTER,
            SETTINGS.CYCLE_JITTER,
            SETTINGS.EMPTY_HAUL_COOLDOWN,
            SETTINGS.LOSS_COOLDOWN
        ];

        for (const id of validSettings) {
            const duration = humanInterval($scope.settings[id]);

            if (!settings.valid('readable_time', $scope.settings[id]) || duration < 0
                || duration > 7 * 24 * 60 * 60 * 1000 || (id === SETTINGS.MAX_TRAVEL_TIME && duration === 0)) {
                return utils.notif('error', $filter('i18n')('error_invalid_interval', $rootScope.loc.ale, 'common', id));
            }
        }

        const decoded = settings.decode($scope.settings);
        decoded[SETTINGS.AUTO_PRESET_UNITS] = $scope.autoPresetUnits.filter(unit => unit.enabled).map(unit => unit.name);
        const validNumbers = Object.entries(settings.settingsMap).every(([id, map]) => {
            if (map.inputType !== 'number') {
                return true;
            }

            const value = Number(decoded[id]);
            return decoded[id] !== '' && Number.isInteger(value) && value >= map.min && value <= map.max;
        });

        if (!validNumbers || Number(decoded[SETTINGS.MIN_DISTANCE]) > Number(decoded[SETTINGS.MAX_DISTANCE])
            || Number(decoded[SETTINGS.MIN_POINTS]) > Number(decoded[SETTINGS.MAX_POINTS])
            || Number(decoded[SETTINGS.AUTO_PRESET_MIN_UNITS]) > Number(decoded[SETTINGS.AUTO_PRESET_MAX_UNITS])
            || (decoded[SETTINGS.AUTO_PRESETS] && !decoded[SETTINGS.AUTO_PRESET_UNITS].length)) {
            return utils.notif('error', $filter('i18n')('invalid_farming_settings', $rootScope.loc.ale, 'farm_overflow'));
        }

        settings.setAll(decoded);
        $scope.saveButtonColor = 'orange';
        utils.notif('success', $filter('i18n')('settings_saved', $rootScope.loc.ale, 'farm_overflow'));
        return true;
    };

    const resetSettings = function () {
        confirmResetModal(function onReset () {
            settings.resetAll();

            function notifReset () {
                utils.notif('success', $filter('i18n')('settings_reseted', $rootScope.loc.ale, 'common'));
            }

            if (farmOverflow.isRunning()) {
                farmOverflow.stop(STATUS.USER_STOP);

                setTimeout(notifReset, 1000);
            } else {
                notifReset();
            }
        });
    };

    const confirmResetModal = function (onReset, onCancel) {
        const modalScope = $rootScope.$new();
        modalScope.title = $filter('i18n')('reset_settings', $rootScope.loc.ale, 'common');
        modalScope.text = $filter('i18n')('reset_settings_confirmation', $rootScope.loc.ale, 'common');
        modalScope.submitText = $filter('i18n')('reset', $rootScope.loc.ale, 'common');
        modalScope.cancelText = $filter('i18n')('cancel', $rootScope.loc.ale, 'common');
        modalScope.switchColors = true;

        modalScope.submit = function () {
            modalScope.closeWindow();
            onReset && onReset();
        };

        modalScope.cancel = function () {
            modalScope.closeWindow();
            onCancel && onCancel();
        };

        windowManagerService.getModal('modal_attention', modalScope);
    };

    const removeIgnored = function (villageId) {
        const groupIgnore = settings.get(SETTINGS.GROUP_IGNORE);
        const groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupIgnore);

        if (!groupVillages.includes(villageId)) {
            return false;
        }

        socketService.emit(routeProvider.GROUPS_UNLINK_VILLAGE, {
            group_id: groupIgnore,
            village_id: villageId
        });
    };

    const removeIncluded = function (villageId) {
        const groupsInclude = settings.get(SETTINGS.GROUP_INCLUDE);

        groupsInclude.forEach(function (groupId) {
            const groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupId);

            if (groupVillages.includes(villageId)) {
                socketService.emit(routeProvider.GROUPS_UNLINK_VILLAGE, {
                    group_id: groupId,
                    village_id: villageId
                });
            }
        });
    };

    const checkCycleInterval = function () {
        clearInterval(cycleCountdownTimer);
        const nextCycleDate = farmOverflow.getNextCycleDate();

        if (nextCycleDate) {
            $scope.showCycleTimer = true;
            $scope.nextCycleCountdown = nextCycleDate - timeHelper.gameTime();

            const scope = $scope;
            cycleCountdownTimer = setInterval(function () {
                scope.$evalAsync(function () {
                    scope.nextCycleCountdown = Math.max(0, (farmOverflow.getNextCycleDate() || timeHelper.gameTime()) - timeHelper.gameTime());
                });
            }, 1000);
        }
    };

    const eventHandlers = {
        updatePresets: function () {
            $scope.presets = Settings.encodeList(presetList.getPresets(), {
                disabled: false,
                type: 'presets'
            });
        },
        updateGroups: function () {
            $scope.groups = Settings.encodeList(groupList.getGroups(), {
                disabled: false,
                type: 'groups'
            });

            $scope.groupsWithDisabled = Settings.encodeList(groupList.getGroups(), {
                disabled: true,
                type: 'groups'
            });
        },
        start: function () {
            $scope.running = true;

            utils.notif('success', $filter('i18n')('farm_started', $rootScope.loc.ale, 'farm_overflow'));
        },
        stop: function (event, data) {
            $scope.running = false;
            $scope.showCycleTimer = false;
            clearInterval(cycleCountdownTimer);

            switch (data.reason) {
                case ERROR_TYPES.NO_PRESETS: {
                    utils.notif('success', $filter('i18n')('no_preset', $rootScope.loc.ale, 'farm_overflow'));
                    break;
                }
                case ERROR_TYPES.USER_STOP: {
                    utils.notif('success', $filter('i18n')('farm_stopped', $rootScope.loc.ale, 'farm_overflow'));
                    break;
                }
            }
        },
        updateLogs: function () {
            $scope.logs = angular.copy(farmOverflow.getLogs());
            updateVisibleLogs();

            if (!$scope.logs.length) {
                utils.notif('success', $filter('i18n')('reseted_logs', $rootScope.loc.ale, 'farm_overflow'));
            }
        },
        updateFarmerVillages: function () {
            $scope.farmers = farmOverflow.getFarmers();
        },
        updateExceptionVillages: function () {
            $scope.exceptionVillages = farmOverflow.getExceptionVillages();
            loadExceptionsInfo();
        },
        updateExceptionLogs: function () {
            $scope.exceptionLogs = farmOverflow.getExceptionLogs();
        },
        onCycleBegin: function () {
            $scope.showCycleTimer = false;
            clearInterval(cycleCountdownTimer);
        },
        onCycleEnd: function (event, reason) {
            if (reason || !farmOverflow.isRunning()) {
                return;
            }

            checkCycleInterval();
        }
    };

    const init = function () {
        settings = farmOverflow.getSettings();
        $button = interfaceOverflow.addMenuButton('Farmer', 10);

        $button.addEventListener('click', function () {
            buildWindow();
        });

        eventQueue.register(eventTypeProvider.FARM_OVERFLOW_START, function () {
            $button.classList.remove('btn-orange');
            $button.classList.add('btn-red');
        });

        eventQueue.register(eventTypeProvider.FARM_OVERFLOW_STOP, function () {
            $button.classList.remove('btn-red');
            $button.classList.add('btn-orange');
        });

        interfaceOverflow.addTemplate('twoverflow_farm_overflow_window', `<div id=\"two-farmoverflow\" class=\"win-content two-window\"><header class=\"win-head\"><h2>FarmOverflow</h2><ul class=\"list-btn\"><li><a href=\"#\" class=\"size-34x34 btn-red icon-26x26-close\" ng-click=\"closeWindow()\"></a></ul></header><div class=\"win-main\" scrollbar=\"\"><div class=\"tabs tabs-bg\"><div class=\"tabs-three-col\"><div class=\"tab\" ng-click=\"selectTab(TAB_TYPES.SETTINGS)\" ng-class=\"{'tab-active': selectedTab == TAB_TYPES.SETTINGS}\"><div class=\"tab-inner\"><div ng-class=\"{'box-border-light': selectedTab === TAB_TYPES.SETTINGS}\"><a href=\"#\" ng-class=\"{'btn-icon btn-orange': selectedTab !== TAB_TYPES.SETTINGS}\">{{ TAB_TYPES.SETTINGS | i18n:loc.ale:'common' }}</a></div></div></div><div class=\"tab\" ng-click=\"selectTab(TAB_TYPES.VILLAGES)\" ng-class=\"{'tab-active': selectedTab == TAB_TYPES.VILLAGES}\"><div class=\"tab-inner\"><div ng-class=\"{'box-border-light': selectedTab === TAB_TYPES.VILLAGES}\"><a href=\"#\" ng-class=\"{'btn-icon btn-orange': selectedTab !== TAB_TYPES.VILLAGES}\">{{ TAB_TYPES.VILLAGES | i18n:loc.ale:'common' }}</a></div></div></div><div class=\"tab\" ng-click=\"selectTab(TAB_TYPES.LOGS)\" ng-class=\"{'tab-active': selectedTab == TAB_TYPES.LOGS}\"><div class=\"tab-inner\"><div ng-class=\"{'box-border-light': selectedTab === TAB_TYPES.LOGS}\"><a href=\"#\" ng-class=\"{'btn-icon btn-orange': selectedTab !== TAB_TYPES.LOGS}\">{{ TAB_TYPES.LOGS | i18n:loc.ale:'common' }}</a></div></div></div></div></div><div class=\"box-paper footer\"><div class=\"scroll-wrap\"><div class=\"settings\" ng-show=\"selectedTab === TAB_TYPES.SETTINGS\"><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col><col width=\"270px\"><tr><th colspan=\"2\">Automatic farming presets<tr><td colspan=\"2\">Farmer creates local troop packets for nearby barbarians each cycle, using troops in town after reserves. Carrying capacity estimates loot space; it does not estimate defenders. Manual presets remain available.<tr ng-repeat=\"settingId in autoPresetSettings\" ng-switch=\"settingsMap[settingId].inputType\"><td>{{ settingId | i18n:loc.ale:'farm_overflow' }}<td ng-switch-when=\"checkbox\"><div switch-slider=\"\" enabled=\"true\" border=\"true\" value=\"settings[settingId]\" vertical=\"false\" size=\"'56x28'\"></div><td ng-switch-when=\"number\"><input type=\"number\" class=\"fit textfield-border text-center\" ng-model=\"settings[settingId]\" min=\"{{ settingsMap[settingId].min }}\" max=\"{{ settingsMap[settingId].max }}\" step=\"1\"><tr><td>Allowed unit types<td><label ng-repeat=\"unit in autoPresetUnits\"><input type=\"checkbox\" ng-model=\"unit.enabled\"> {{ unit.name }}</label><tr><td colspan=\"2\"><a href=\"#\" class=\"btn-border btn-orange\" ng-click=\"previewAutoPresets()\">Save and preview packets</a><tr ng-repeat=\"plan in autoPresetPlans\"><td>Village {{ plan.villageId }} — {{ plan.nearbyTargets }} barbarians<td>{{ plan.name }} — capacity {{ plan.capacity }}</table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col><col width=\"270px\"><tr><th colspan=\"2\">{{ 'farming_controls' | i18n:loc.ale:'farm_overflow' }}<tr><td colspan=\"2\">{{ 'farming_controls_help' | i18n:loc.ale:'farm_overflow' }}<tr ng-repeat=\"settingId in farmingSettings\" ng-switch=\"settingsMap[settingId].inputType\"><td>{{ settingId | i18n:loc.ale:'farm_overflow' }}<td ng-switch-when=\"checkbox\"><div switch-slider=\"\" enabled=\"true\" border=\"true\" value=\"settings[settingId]\" vertical=\"false\" size=\"'56x28'\"></div><td ng-switch-when=\"number\"><input type=\"number\" class=\"fit textfield-border text-center\" ng-model=\"settings[settingId]\" min=\"{{ settingsMap[settingId].min }}\" max=\"{{ settingsMap[settingId].max }}\" step=\"1\"><td ng-switch-when=\"readable_time\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[settingId]\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"></table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col width=\"*\"><col width=\"270px\"><tr><th colspan=\"2\">{{ 'step_cycle_header' | i18n:loc.ale:'farm_overflow' }}<tr><td><span class=\"ff-cell-fix\">{{ 'farmer_behavior' | i18n:loc.ale:'farm_overflow' }}</span><td><div select=\"\" list=\"farmerBehaviorList\" selected=\"selectedFarmerBehavior\" drop-down=\"true\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'target_behavior' | i18n:loc.ale:'farm_overflow' }}</span><td><div select=\"\" list=\"targetBehaviorList\" selected=\"selectedTargetBehavior\" drop-down=\"true\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'multiple_attacks_interval' | i18n:loc.ale:'farm_overflow' }}</span><td><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MULTIPLE_ATTACKS_INTERVAL]\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"></table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col width=\"*\"><col width=\"270px\"><tr><th colspan=\"2\">{{ 'groups_presets' | i18n:loc.ale:'farm_overflow' }}<tr><td><span class=\"ff-cell-fix\">{{ 'presets' | i18n:loc.ale:'farm_overflow' }}</span><td><div select=\"\" list=\"presets\" selected=\"settings[SETTINGS.PRESETS]\" drop-down=\"true\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'group_ignored' | i18n:loc.ale:'farm_overflow' }}</span><td class=\"snowflake\"><div select=\"\" list=\"groupsWithDisabled\" selected=\"settings[SETTINGS.GROUP_IGNORE]\" drop-down=\"true\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'group_include' | i18n:loc.ale:'farm_overflow' }}</span><td><div select=\"\" list=\"groups\" selected=\"settings[SETTINGS.GROUP_INCLUDE]\" drop-down=\"true\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'group_only' | i18n:loc.ale:'farm_overflow' }}</span><td><div select=\"\" list=\"groups\" selected=\"settings[SETTINGS.GROUP_ONLY]\" drop-down=\"true\"></div></table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col><col width=\"200px\"><col width=\"60px\"><tr><th colspan=\"3\">{{ 'misc' | i18n:loc.ale:'farm_overflow' }}<tr><td><span class=\"ff-cell-fix\">{{ 'attack_interval' | i18n:loc.ale:'farm_overflow' }}</span><td colspan=\"2\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.ATTACK_INTERVAL]\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"><tr><td><span class=\"ff-cell-fix\">{{ 'farmer_cycle_interval' | i18n:loc.ale:'farm_overflow' }}</span><td colspan=\"2\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.FARMER_CYCLE_INTERVAL]\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"><tr><td><span class=\"ff-cell-fix\">{{ 'preserve_command_slots' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.PRESERVE_COMMAND_SLOTS].min\" max=\"settingsMap[SETTINGS.PRESERVE_COMMAND_SLOTS].max\" value=\"settings[SETTINGS.PRESERVE_COMMAND_SLOTS]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.PRESERVE_COMMAND_SLOTS]\"><tr><td colspan=\"2\"><span class=\"ff-cell-fix\">{{ 'ignore_on_loss' | i18n:loc.ale:'farm_overflow' }}</span><td><div switch-slider=\"\" enabled=\"settings[SETTINGS.GROUP_IGNORE].value\" border=\"true\" value=\"settings[SETTINGS.IGNORE_ON_LOSS]\" vertical=\"false\" size=\"'56x28'\" tooltip=\"\" tooltip-content=\"{{ 'ignore_on_loss_tip' | i18n:loc.ale:'farm_overflow' }}\"></div><tr><td colspan=\"2\"><span class=\"ff-cell-fix\">{{ 'ignore_full_storage' | i18n:loc.ale:'farm_overflow' }}</span><td><div switch-slider=\"\" enabled=\"true\" border=\"true\" value=\"settings[SETTINGS.IGNORE_FULL_STORAGE]\" vertical=\"false\" size=\"'56x28'\"></div><tr><td><span class=\"ff-cell-fix\">{{ 'target_limit_per_village' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.TARGET_LIMIT].min\" max=\"settingsMap[SETTINGS.TARGET_LIMIT].max\" value=\"settings[SETTINGS.TARGET_LIMIT]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.TARGET_LIMIT]\"></table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col><col width=\"200px\"><col width=\"60px\"><tr><th colspan=\"3\">{{ 'target_filters' | i18n:loc.ale:'farm_overflow' }}<tr><td><span class=\"ff-cell-fix\">{{ 'min_distance' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.MIN_DISTANCE].min\" max=\"settingsMap[SETTINGS.MIN_DISTANCE].max\" value=\"settings[SETTINGS.MIN_DISTANCE]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MIN_DISTANCE]\"><tr><td><span class=\"ff-cell-fix\">{{ 'max_distance' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.MAX_DISTANCE].min\" max=\"settingsMap[SETTINGS.MAX_DISTANCE].max\" value=\"settings[SETTINGS.MAX_DISTANCE]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MAX_DISTANCE]\"><tr><td><span class=\"ff-cell-fix\">{{ 'min_points' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.MIN_POINTS].min\" max=\"settingsMap[SETTINGS.MIN_POINTS].max\" value=\"settings[SETTINGS.MIN_POINTS]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MIN_POINTS]\"><tr><td><span class=\"ff-cell-fix\">{{ 'max_points' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.MAX_POINTS].min\" max=\"settingsMap[SETTINGS.MAX_POINTS].max\" value=\"settings[SETTINGS.MAX_POINTS]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MAX_POINTS]\"><tr><td><span class=\"ff-cell-fix\">{{ 'max_travel_time' | i18n:loc.ale:'farm_overflow' }}</span><td colspan=\"2\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.MAX_TRAVEL_TIME]\" tooltip=\"\" tooltip-content=\"{{ 'readable_time_format' | i18n:loc.ale:'common' }}\"></table><table class=\"tbl-border-light tbl-content tbl-medium-height\"><col><col width=\"200px\"><col width=\"60px\"><tr><th colspan=\"3\">{{ 'others' | i18n:loc.ale:'common' }}<tr><td><span class=\"ff-cell-fix\">{{ 'logs_limit' | i18n:loc.ale:'farm_overflow' }}</span><td><div range-slider=\"\" min=\"settingsMap[SETTINGS.LOGS_LIMIT].min\" max=\"settingsMap[SETTINGS.LOGS_LIMIT].max\" value=\"settings[SETTINGS.LOGS_LIMIT]\" enabled=\"true\"></div><td class=\"cell-bottom\"><input class=\"fit textfield-border text-center\" ng-model=\"settings[SETTINGS.LOGS_LIMIT]\"></table></div><div class=\"villages rich-text\" ng-show=\"selectedTab === TAB_TYPES.VILLAGES\"><p ng-show=\"showCycleTimer\" class=\"text-center\">{{ 'next_cycle_in' | i18n:loc.ale:'farm_overflow' }}: {{ nextCycleCountdown | readableMillisecondsFilter }}<h5 class=\"twx-section\">{{ 'farmer_villages' | i18n:loc.ale:'farm_overflow' }}</h5><p ng-show=\"!farmers.length\" class=\"text-center\">{{ 'no_farmer_villages' | i18n:loc.ale:'farm_overflow' }}<table class=\"tbl-border-light tbl-striped\" ng-show=\"farmers.length\"><col><col width=\"40%\"><col width=\"20%\"><tr><th>{{ 'villages' | i18n:loc.ale:'common' }}<th>{{ 'last_status' | i18n:loc.ale:'farm_overflow' }}<th>{{ 'target' | i18n:loc.ale:'common':2 }}<tr ng-repeat=\"farmer in farmers\"><td><span ng-class=\"{true:'icon-20x20-queue-indicator-long', false:'icon-20x20-queue-indicator-short'}[farmer.isRunning()]\"></span> <a class=\"link\" ng-click=\"openVillageInfo(farmer.getVillage().getId())\"><span class=\"icon-20x20-village\"></span> {{ farmer.getVillage().getName() }} ({{ farmer.getVillage().getX() }}|{{ farmer.getVillage().getY() }})</a><td>{{ 'status_' + farmer.getStatus() | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"farmer.getTargets()\"><span ng-if=\"farmer.isRunning()\">{{ farmer.getIndex() }} / </span><span>{{ farmer.getTargets().length }}</span><td ng-if=\"!farmer.getTargets()\">{{ 'not_loaded' | i18n:loc.ale:'farm_overflow' }}</table><h5 class=\"twx-section\">{{ 'ignored_targets' | i18n:loc.ale:'farm_overflow' }}</h5><p ng-if=\"!exceptionVillages.ignored.length\" class=\"text-center\">{{ 'no_ignored_targets' | i18n:loc.ale:'farm_overflow' }}<table class=\"ignored-villages tbl-border-light tbl-striped\" ng-show=\"exceptionVillages.ignored.length\"><col><col width=\"15%\"><col width=\"15%\"><col width=\"30px\"><tr><th>{{ 'villages' | i18n:loc.ale:'common' }}<th>{{ 'date' | i18n:loc.ale:'farm_overflow' }}<th>{{ 'reports' | i18n:loc.ale:'farm_overflow' }}<th><tr ng-repeat=\"villageId in exceptionVillages.ignored track by $index\"><td><a class=\"link\" ng-click=\"openVillageInfo(villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[villageId] }}</a><td>{{ exceptionLogs[villageId].time | readableDateFilter:loc.ale:GAME_TIMEZONE:GAME_TIME_OFFSET }}<td><span ng-if=\"exceptionLogs[villageId].report\"><a class=\"link\" ng-click=\"showReport(exceptionLogs[villageId].report.id)\" tooltip=\"\" tooltip-content=\"{{ exceptionLogs[villageId].report.title }}\"><span class=\"icon-20x20-report\"></span> {{ 'open_report' | i18n:loc.ale:'farm_overflow' }}</a> <span ng-class=\"{2:'icon-20x20-queue-indicator-medium', 3:'icon-20x20-queue-indicator-short'}[exceptionLogs[villageId].report.result]\"></span> <span ng-class=\"{'full': 'icon-26x26-capacity', 'partial':'icon-26x26-capacity-low', 'none':'hidden'}[exceptionLogs[villageId].report.haul]\"></span> </span><span ng-if=\"!exceptionLogs[villageId].report\">{{ 'no_report' | i18n:loc.ale:'farm_overflow' }}</span><td><a href=\"#\" class=\"size-20x20 btn-red icon-20x20-close\" ng-click=\"removeIgnored(villageId)\" tooltip=\"\" tooltip-content=\"\"></a></table><h5 class=\"twx-section\">{{ 'included_targets' | i18n:loc.ale:'farm_overflow' }}</h5><p ng-if=\"!exceptionVillages.included.length\" class=\"text-center\">{{ 'no_included_targets' | i18n:loc.ale:'farm_overflow' }}<table class=\"tbl-border-light tbl-striped\" ng-show=\"exceptionVillages.included.length\"><col><col width=\"15%\"><col width=\"30px\"><tr><th>{{ 'villages' | i18n:loc.ale:'common' }}<th>{{ 'date' | i18n:loc.ale:'farm_overflow' }}<th><tr ng-repeat=\"villageId in exceptionVillages.included track by $index\"><td><a class=\"link\" ng-click=\"openVillageInfo(villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[villageId] }}</a><td>{{ exceptionLogs[villageId].time | readableDateFilter:loc.ale:GAME_TIMEZONE:GAME_TIME_OFFSET }}<td><a href=\"#\" class=\"size-20x20 btn-red icon-20x20-close\" ng-click=\"removeIncluded(villageId)\" tooltip=\"\" tooltip-content=\"\"></a></table></div><div class=\"logs rich-text\" ng-show=\"selectedTab === TAB_TYPES.LOGS\"><div class=\"page-wrap\" pagination=\"pagination\"></div><p class=\"text-center\" ng-show=\"!visibleLogs.length\">{{ 'no_logs' | i18n:loc.ale:'farm_overflow' }}<table class=\"log-list tbl-border-light tbl-striped\" ng-show=\"visibleLogs.length\"><col width=\"100px\"><col width=\"30px\"><col><tr ng-repeat=\"log in visibleLogs track by $index\"><td>{{ log.time | readableDateFilter:loc.ale:GAME_TIMEZONE:GAME_TIME_OFFSET }}<td><span class=\"icon-bg-black\" ng-class=\"{
                                'icon-26x26-dot-green': log.type === LOG_TYPES.FARM_START,
                                'icon-26x26-dot-red': log.type === LOG_TYPES.FARM_STOP,
                                'icon-26x26-check-negative': log.type === LOG_TYPES.IGNORED_VILLAGE || log.type === LOG_TYPES.INCLUDED_VILLAGE_REMOVED,
                                'icon-26x26-check-positive': log.type === LOG_TYPES.INCLUDED_VILLAGE || log.type === LOG_TYPES.IGNORED_VILLAGE_REMOVED,
                                'icon-26x26-attack-small': log.type === LOG_TYPES.ATTACKED_VILLAGE}\"></span><td ng-if=\"log.type === LOG_TYPES.ATTACKED_VILLAGE || log.type === LOG_TYPES.PLANNED_VILLAGE\"><span ng-if=\"log.type === LOG_TYPES.PLANNED_VILLAGE\">{{ 'preview' | i18n:loc.ale:'farm_overflow' }}: </span><span class=\"icon-26x26-attack-small\"></span> <a class=\"link\" ng-click=\"openVillageInfo(log.targetId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[log.targetId] }}</a> <span ng-if=\"log.type === LOG_TYPES.PLANNED_VILLAGE\">— {{ 'preset' | i18n:loc.ale:'farm_overflow' }} {{ log.presetId }}, {{ log.ratePerHour }} {{ (log.usingLootEstimate ? 'estimated_loot_per_hour' : 'capacity_per_hour') | i18n:loc.ale:'farm_overflow' }}</span><td ng-if=\"log.type === LOG_TYPES.IGNORED_VILLAGE\"><a class=\"link\" ng-click=\"openVillageInfo(log.villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[log.villageId] }}</a> {{ 'ignored_village' | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"log.type === LOG_TYPES.IGNORED_VILLAGE_REMOVED\"><a class=\"link\" ng-click=\"openVillageInfo(log.villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[log.villageId] }}</a> {{ 'ignored_village_removed' | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"log.type === LOG_TYPES.INCLUDED_VILLAGE\"><a class=\"link\" ng-click=\"openVillageInfo(log.villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[log.villageId] }}</a> {{ 'included_village' | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"log.type === LOG_TYPES.INCLUDED_VILLAGE_REMOVED\"><a class=\"link\" ng-click=\"openVillageInfo(log.villageId)\"><span class=\"icon-20x20-village\"></span> {{ villagesLabel[log.villageId] }}</a> {{ 'included_village_removed' | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"log.type === LOG_TYPES.FARM_START\">{{ 'farm_started' | i18n:loc.ale:'farm_overflow' }}<td ng-if=\"log.type === LOG_TYPES.FARM_STOP\">{{ 'farm_stopped' | i18n:loc.ale:'farm_overflow' }}</table><div class=\"page-wrap\" pagination=\"pagination\"></div></div></div></div></div><footer class=\"win-foot\"><ul class=\"list-btn list-center\"><li ng-show=\"selectedTab === TAB_TYPES.SETTINGS\"><a href=\"#\" class=\"btn-border btn-orange\" ng-click=\"resetSettings()\">{{ 'reset_settings' | i18n:loc.ale:'common' }}</a><li ng-show=\"selectedTab === TAB_TYPES.SETTINGS\"><a href=\"#\" class=\"btn-border btn-{{ saveButtonColor }}\" ng-click=\"saveSettings()\">{{ 'save' | i18n:loc.ale:'common' }}</a><li ng-show=\"selectedTab === TAB_TYPES.LOGS\"><a href=\"#\" class=\"btn-border btn-orange\" ng-click=\"clearLogs()\">{{ 'clear_logs' | i18n:loc.ale:'farm_overflow' }}</a><li><a href=\"#\" ng-class=\"{false:'btn-green', true:'btn-red'}[running]\" class=\"btn-border\" ng-click=\"switchFarm()\"><span ng-show=\"running\">{{ 'pause' | i18n:loc.ale:'common' }}</span> <span ng-show=\"!running\">{{ 'start' | i18n:loc.ale:'common' }}</span></a></ul></footer></div>`);
        interfaceOverflow.addStyle('#two-farmoverflow .settings table{margin-bottom:15px}#two-farmoverflow .settings input.textfield-border{width:219px;height:34px;margin-bottom:2px;padding-top:2px}#two-farmoverflow .settings input.textfield-border.fit{width:100%}#two-farmoverflow .settings span.select-wrapper{width:100%}#two-farmoverflow .settings a.select-handler{line-height:28px}#two-farmoverflow .settings td.snowflake a.select-handler{line-height:31px}#two-farmoverflow .settings .range-container{width:250px}#two-farmoverflow .villages td{padding:2px 5px;white-space:nowrap}#two-farmoverflow .villages .hidden{display:none}#two-farmoverflow .logs .status tr{height:25px}#two-farmoverflow .logs .status td{padding:0 6px}#two-farmoverflow .logs .log-list{margin-bottom:10px}#two-farmoverflow .logs .log-list td{white-space:nowrap;text-align:center;padding:0 5px}#two-farmoverflow .logs .log-list td .village-link{max-width:200px;white-space:nowrap;text-overflow:ellipsis}#two-farmoverflow .icon-20x20-village:before{margin-top:-11px}');
    };

    const buildWindow = function () {
        $scope = $rootScope.$new();
        $scope.SETTINGS = SETTINGS;
        $scope.TAB_TYPES = TAB_TYPES;
        $scope.LOG_TYPES = LOG_TYPES;
        $scope.running = farmOverflow.isRunning();
        $scope.selectedTab = TAB_TYPES.SETTINGS;
        $scope.farmers = farmOverflow.getFarmers();
        $scope.villagesLabel = villagesLabel;
        $scope.villagesInfo = villagesInfo;
        $scope.exceptionVillages = farmOverflow.getExceptionVillages();
        $scope.exceptionLogs = farmOverflow.getExceptionLogs();
        $scope.logs = farmOverflow.getLogs();
        $scope.visibleLogs = [];
        $scope.showCycleTimer = false;
        $scope.nextCycleCountdown = 0;
        $scope.saveButtonColor = 'orange';
        $scope.settingsMap = settings.settingsMap;
        $scope.farmingSettings = [
            SETTINGS.PREVIEW_ONLY,
            SETTINGS.BARBARIANS_ONLY,
            SETTINGS.OPTIMIZE_HAUL,
            SETTINGS.ESTIMATED_TARGET_LOOT,
            SETTINGS.UNIT_RESERVE_PERCENT,
            SETTINGS.MAX_ATTACKS_PER_CYCLE,
            SETTINGS.TARGET_ORDER_VARIATION,
            SETTINGS.ATTACK_JITTER,
            SETTINGS.CYCLE_JITTER,
            SETTINGS.EMPTY_HAUL_COOLDOWN,
            SETTINGS.LOSS_COOLDOWN
        ];

        $scope.pagination = {
            count: $scope.logs.length,
            offset: 0,
            loader: updateVisibleLogs,
            limit: storageService.getPaginationLimit()
        };

        $scope.farmerBehaviorList = util.toActionList(FARMER_BEHAVIOR, function (actionType) {
            return $filter('i18n')(actionType, $rootScope.loc.ale, 'farm_overflow');
        });

        $scope.selectedFarmerBehavior = {
            name: $filter('i18n')(settings.get(SETTINGS.FARMER_BEHAVIOR), $rootScope.loc.ale, 'farm_overflow'),
            value: settings.get(SETTINGS.FARMER_BEHAVIOR)
        };

        $scope.targetBehaviorList = util.toActionList(TARGET_BEHAVIOR, function (actionType) {
            return $filter('i18n')(actionType, $rootScope.loc.ale, 'farm_overflow');
        });

        $scope.selectedTargetBehavior = {
            name: $filter('i18n')(settings.get(SETTINGS.TARGET_BEHAVIOR), $rootScope.loc.ale, 'farm_overflow'),
            value: settings.get(SETTINGS.TARGET_BEHAVIOR)
        };

        settings.injectScope($scope, {textObject: 'farm_overflow'});
        $scope.autoPresetUnits = Object.entries(modelDataService.getGameData().getUnitsObject())
            .filter(([name, data]) => data.load > 0 && !['knight', 'snob', 'ram', 'catapult', 'trebuchet'].includes(name))
            .map(([name]) => ({name, enabled: settings.get(SETTINGS.AUTO_PRESET_UNITS).includes(name)}));
        $scope.autoPresetSettings = [SETTINGS.AUTO_PRESETS,
            SETTINGS.AUTO_PRESET_MIN_UNITS,
            SETTINGS.AUTO_PRESET_MAX_UNITS,
            SETTINGS.AUTO_PRESET_CARRY];
        $scope.previewAutoPresets = function () {
            if (saveSettings() !== true) {
                return;
            }
            farmOverflow.previewAutoPresets().then(plans => $scope.$evalAsync(() => {
                $scope.autoPresetPlans = plans;
            }));
        };
        eventHandlers.updatePresets();
        eventHandlers.updateGroups();
        updateVisibleLogs();
        loadExceptionsInfo();
        checkCycleInterval();

        // scope functions
        $scope.switchFarm = switchFarm;
        $scope.selectTab = selectTab;
        $scope.saveSettings = saveSettings;
        $scope.resetSettings = resetSettings;
        $scope.clearLogs = farmOverflow.clearLogs;
        $scope.jumpToVillage = mapService.jumpToVillage;
        $scope.openVillageInfo = windowDisplayService.openVillageInfo;
        $scope.showReport = reportService.showReport;
        $scope.removeIgnored = removeIgnored;
        $scope.removeIncluded = removeIncluded;

        const eventScope = new EventScope('twoverflow_farm_overflow_window', function onDestroy () {
            clearInterval(cycleCountdownTimer);
        });

        eventScope.register(eventTypeProvider.ARMY_PRESET_UPDATE, eventHandlers.updatePresets, true);
        eventScope.register(eventTypeProvider.ARMY_PRESET_DELETED, eventHandlers.updatePresets, true);
        eventScope.register(eventTypeProvider.GROUPS_UPDATED, eventHandlers.updateGroups, true);
        eventScope.register(eventTypeProvider.GROUPS_CREATED, eventHandlers.updateGroups, true);
        eventScope.register(eventTypeProvider.GROUPS_DESTROYED, eventHandlers.updateGroups, true);
        const scope = $scope;
        const inAngular = (handler) => (...args) => scope.$evalAsync(() => {
            if (!scope.$$destroyed) {
                handler(...args);
            }
        });

        eventScope.register(eventTypeProvider.FARM_OVERFLOW_START, inAngular(eventHandlers.start));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_STOP, inAngular(eventHandlers.stop));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_LOGS_UPDATED, inAngular(eventHandlers.updateLogs));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED, inAngular(eventHandlers.updateFarmerVillages));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_VILLAGES_UPDATED, inAngular(eventHandlers.updateExceptionVillages));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED, inAngular(eventHandlers.updateExceptionLogs));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN, inAngular(eventHandlers.onCycleBegin));
        eventScope.register(eventTypeProvider.FARM_OVERFLOW_CYCLE_END, inAngular(eventHandlers.onCycleEnd));

        windowManagerService.getScreenWithInjectedScope('!twoverflow_farm_overflow_window', $scope);

        const unsavedSettingsState = (updates = 0) => function () {
            if (updates++) {
                $scope.saveButtonColor = 'red';
            }
        };

        $scope.$watch('settings', unsavedSettingsState(), true);
        $scope.$watch('autoPresetUnits', unsavedSettingsState(), true);

        $scope.$watch('selectedFarmerBehavior', function (data) {
            $scope.settings[SETTINGS.FARMER_BEHAVIOR] = data;
        }, true);

        $scope.$watch('selectedTargetBehavior', function (data) {
            $scope.settings[SETTINGS.TARGET_BEHAVIOR] = data;
        }, true);
    };

    return init;
});

define('two/farmOverflow/policy', [], function () {
    const MAX_TIMER = 2147483647;

    const isBarbarian = function (target) {
        return !!target && (target.character_id === null || target.character_id === 0 || target.character_id === '0');
    };

    const boundedDelay = function (base, jitter, minimum, random = Math.random) {
        base = Number(base);
        jitter = Number(jitter);
        const safeBase = Number.isFinite(base) ? Math.max(minimum, base) : minimum;
        const safeJitter = Number.isFinite(jitter) ? Math.max(0, jitter) : 0;
        return Math.min(MAX_TIMER, Math.round(safeBase + safeJitter * random()));
    };

    // Estimate barbarian village power based on available data
    const estimateBarbarianPower = function (target, estimateMethod) {
        if (!target) return 0;

        // Use village points as the primary power indicator
        if (!Number.isFinite(target.points) || target.points <= 0) {
            return 100; // Default power for unknown villages
        }

        if (estimateMethod === 'buildings') {
            // Building levels correlate with village strength
            const basePower = target.points * 10;
            return Math.round(basePower);
        }

        // Default: use village points directly
        return Math.round(target.points * 50);
    };

    // Calculate distance penalty - longer travel time = lower priority
    const calculateDistancePenalty = function (distance, baseTravelSeconds) {
        // Penalize based on round-trip travel time
        const roundTrip = baseTravelSeconds * 2;
        // 10% penalty per 100 seconds of travel
        const penaltyFactor = 1 - (Math.min(roundTrip, 3600) / 3600) * 0.3;
        return Math.max(0.1, penaltyFactor);
    };

    // Score a target considering power, distance, and loot
    const scoreTarget = function (target, options) {
        if (!target || !Number.isFinite(target.distance)) {
            return 0;
        }

        const powerWeight = Number(options.powerWeight) || 20;
        const powerEstimate = options.powerEstimate || 'points';
        const distancePenalty = calculateDistancePenalty(target.distance, options.baseTravelSeconds || 60);

        // Base score: loot per round-trip second
        const baseScore = (options.capacity || 1000) / (2 * (options.baseTravelSeconds || 60));

        // Apply power factor - higher power targets are worth more but riskier
        const powerEstimateValue = estimateBarbarianPower(target, powerEstimate);
        const powerFactor = 1 + (powerWeight / 100) * Math.log10(powerEstimateValue + 1);

        // Final score with distance penalty
        return baseScore * powerFactor * distancePenalty;
    };

    // Select preset based on target power and overkill percentage
    const choosePresetForTarget = function (presets, units, unitData, travelSeconds, target, options) {
        if (!Number.isFinite(options.maxTravelMs) || options.maxTravelMs <= 0
            || !Number.isFinite(options.reservePercent) || options.reservePercent < 0 || options.reservePercent > 100) {
            return {reason: 'no_units'};
        }

        let best = null;
        let affordable = false;

        // Estimate target power for preset selection
        const targetPower = estimateBarbarianPower(target, options.powerEstimate || 'points');
        const overkillPercent = Number(options.overkillPercent) || 20;
        const powerBuffer = 1 + (overkillPercent / 100);

        for (const preset of presets) {
            let haul = 0;
            let valid = !!preset.units && Object.keys(preset.units).length > 0;

            // Calculate required power to handle target with buffer
            let requiredPower = Math.round(targetPower * powerBuffer);

            for (const [name, amount] of Object.entries(preset.units || {})) {
                if (!Number.isInteger(amount) || amount < 0) {
                    valid = false;
                    break;
                }

                if (!amount) {
                    continue;
                }

                const stock = units[name] && units[name].in_town;
                const load = unitData[name] && unitData[name].load;
                const available = Math.floor(stock * (1 - options.reservePercent / 100));

                if (!Number.isFinite(stock) || !Number.isFinite(load) || available < amount) {
                    valid = false;
                    break;
                }

                haul += amount * load;

                // Estimate unit power (simplified: assume 1 power per 5 load)
                const unitPower = (load / 5) * amount;
                requiredPower -= unitPower;
            }

            if (!valid || haul <= 0) {
                continue;
            }

            affordable = true;
            const seconds = travelSeconds(preset);

            if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > options.maxTravelMs) {
                continue;
            }

            // Score considers power efficiency
            const expectedHaul = Number.isFinite(options.expectedLoot) && options.expectedLoot > 0
                ? Math.min(haul, options.expectedLoot) : haul;

            // Power-adjusted score: favor presets that match target power
            const powerEfficiency = requiredPower <= 0 ? 1.2 : (1 - Math.min(1, -requiredPower / targetPower) * 0.3);

            const candidate = {
                preset,
                haul,
                expectedHaul,
                travelSeconds: seconds,
                powerEstimate: targetPower,
                requiredPower: Math.round(targetPower * powerBuffer),
                score: (expectedHaul / (2 * seconds)) * powerEfficiency
            };

            if (!best || (options.optimize ? candidate.score > best.score : seconds < best.travelSeconds)) {
                best = candidate;
            }
        }

        return best || {reason: affordable ? 'time_limit' : 'no_units'};
    };

    // Original choosePreset - kept for backwards compatibility
    const choosePreset = function (presets, units, unitData, travelSeconds, options) {
        if (!Number.isFinite(options.maxTravelMs) || options.maxTravelMs <= 0
            || !Number.isFinite(options.reservePercent) || options.reservePercent < 0 || options.reservePercent > 100) {
            return {reason: 'no_units'};
        }

        let best = null;
        let affordable = false;

        for (const preset of presets) {
            let haul = 0;
            let valid = !!preset.units && Object.keys(preset.units).length > 0;

            for (const [name, amount] of Object.entries(preset.units || {})) {
                if (!Number.isInteger(amount) || amount < 0) {
                    valid = false;
                    break;
                }

                if (!amount) {
                    continue;
                }

                const stock = units[name] && units[name].in_town;
                const load = unitData[name] && unitData[name].load;
                const available = Math.floor(stock * (1 - options.reservePercent / 100));

                if (!Number.isFinite(stock) || !Number.isFinite(load) || available < amount) {
                    valid = false;
                    break;
                }

                haul += amount * load;
            }

            if (!valid || haul <= 0) {
                continue;
            }

            affordable = true;
            const seconds = travelSeconds(preset);

            if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > options.maxTravelMs) {
                continue;
            }

            const expectedHaul = Number.isFinite(options.expectedLoot) && options.expectedLoot > 0
                ? Math.min(haul, options.expectedLoot) : haul;
            const candidate = {preset, haul, expectedHaul, travelSeconds: seconds, score: expectedHaul / (2 * seconds)};

            if (!best || (options.optimize ? candidate.score > best.score : seconds < best.travelSeconds)) {
                best = candidate;
            }
        }

        return best || {reason: affordable ? 'time_limit' : 'no_units'};
    };

    // Shuffle only within bands whose scores differ by at most the given percent.
    const orderTargets = function (targets, scoreTarget, variationPercent, random = Math.random) {
        const ranked = targets.map(target => ({target, score: scoreTarget(target)}))
            .filter(item => Number.isFinite(item.score) && item.score > 0)
            .sort((a, b) => b.score - a.score || a.target.id - b.target.id);
        const tolerance = Math.min(25, Math.max(0, Number(variationPercent) || 0)) / 100;

        if (tolerance) {
            for (let start = 0; start < ranked.length;) {
                let end = start + 1;
                const minimum = ranked[start].score * (1 - tolerance);

                while (end < ranked.length && ranked[end].score >= minimum) {
                    end++;
                }

                for (let i = end - 1; i > start; i--) {
                    const j = start + Math.floor(random() * (i - start + 1));
                    [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
                }

                start = end;
            }
        }

        return ranked.map(item => item.target);
    };

    const arrivalIsBusy = function (arrivalSeconds, commands, minimumIntervalMs) {
        if (minimumIntervalMs <= 0) {
            return false;
        }

        return commands.some(function (command) {
            const completed = command.time_completed;
            // Unknown arrival time must not silently bypass duplicate protection.
            return !Number.isFinite(completed) || Math.abs(arrivalSeconds - completed) * 1000 < minimumIntervalMs;
        });
    };

    return {
        isBarbarian,
        boundedDelay,
        choosePreset,
        choosePresetForTarget,
        scoreTarget,
        estimateBarbarianPower,
        orderTargets,
        arrivalIsBusy
    };
});
define('two/farmOverflow/settings', [], function () {
    return {
        PRESETS: 'presets',
        AUTO_PRESETS: 'auto_presets',
        AUTO_PRESET_MIN_UNITS: 'auto_preset_min_units',
        AUTO_PRESET_MAX_UNITS: 'auto_preset_max_units',
        AUTO_PRESET_CARRY: 'auto_preset_carry',
        AUTO_PRESET_UNITS: 'auto_preset_units',
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
        [SETTINGS.AUTO_PRESETS]: {default: false, updates: [], inputType: 'checkbox'},
        [SETTINGS.AUTO_PRESET_MIN_UNITS]: {default: 5, updates: [], inputType: 'number', min: 1, max: 10000},
        [SETTINGS.AUTO_PRESET_MAX_UNITS]: {default: 100, updates: [], inputType: 'number', min: 1, max: 10000},
        [SETTINGS.AUTO_PRESET_CARRY]: {default: 1000, updates: [], inputType: 'number', min: 1, max: 1000000},
        [SETTINGS.AUTO_PRESET_UNITS]: {default: ['spear', 'axe', 'light_cavalry'], updates: [], inputType: 'unit_list'},
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

define('two/farmOverflow/types/errors', [], function () {
    return {
        NO_PRESETS: 'no_presets',
        USER_STOP: 'user_stop',
        KILL_FARMER: 'kill_farmer',
        ALREADY_RUNNING: 'already_running',
        NO_SELECTED_PRESET: 'no_selected_preset'
    };
});

define('two/farmOverflow/types/status', [], function () {
    return {
        TIME_LIMIT: 'time_limit',
        COMMAND_LIMIT: 'command_limit',
        FULL_STORAGE: 'full_storage',
        NO_UNITS: 'no_units',
        NO_SELECTED_VILLAGE: 'no_selected_village',
        ABANDONED_CONQUERED: 'abandoned_conquered',
        PROTECTED_VILLAGE: 'protected_village',
        BUSY_TARGET: 'busy_target',
        NO_TARGETS: 'no_targets',
        TARGET_CYCLE_END: 'target_cycle_end',
        FARMER_CYCLE_END: 'farmer_cycle_end',
        COMMAND_ERROR: 'command_error',
        NOT_ALLOWED_POINTS: 'not_allowed_points',
        UNKNOWN: 'unknown',
        ATTACKING: 'attacking',
        WAITING_CYCLE: 'waiting_cycle',
        USER_STOP: 'user_stop',
        EXPIRED_STEP: 'expired_step',
        TARGET_COOLDOWN: 'target_cooldown',
        CYCLE_ATTACK_LIMIT: 'cycle_attack_limit',
        COMMAND_TIMEOUT: 'command_timeout',
        PREVIEW: 'preview'
    };
});

define('two/farmOverflow/types/logs', [], function () {
    return {
        FARM_START: 'farm_start',
        FARM_STOP: 'farm_stop',
        IGNORED_VILLAGE: 'ignored_village',
        INCLUDED_VILLAGE: 'included_village',
        IGNORED_VILLAGE_REMOVED: 'ignored_village_removed',
        INCLUDED_VILLAGE_REMOVED: 'included_village_removed',
        ATTACKED_VILLAGE: 'attacked_village',
        PLANNED_VILLAGE: 'planned_village'
    };
});

define('two/farmOverflow/types/farmerBehavior', [], function () {
    return {
        ALLOW_SINGLE_ATTACK_EACH_TARGET: 'allow_single_attack_each_target',
        ALLOW_MULTIPLE_ATTACK_EACH_TARGET: 'allow_multiple_attack_each_target'
    };
});

define('two/farmOverflow/types/targetBehavior', [], function () {
    return {
        TARGETS_ALLOW_SINGLE_FARMER: 'targets_allow_single_farmer',
        TARGETS_ALLOW_MULTIPLE_FARMERS: 'targets_allow_multiple_farmers'
    };
});

require([
    'two/ready',
    'two/farmOverflow',
    'two/farmOverflow/ui',
    'two/farmOverflow/events'
], function (
    ready,
    farmOverflow,
    farmOverflowInterface
) {
    if (farmOverflow.isInitialized()) {
        return false;
    }

    ready(function () {
        farmOverflow.init();
        farmOverflowInterface();
    }, ['map', 'presets']);
});

define('two/recruiter', [
    'two/Settings',
    'two/recruiter/settings/map',
    'two/recruiter/policy',
    'two/resourceBudget',
    'two/ready',
    'queues/EventQueue',
    'Lockr'
], function (Settings, settingsMap, policy, resourceBudget, ready, eventQueue, Lockr) {
    let initialized = false;
    let running = false;
    let settings;
    let config;
    let timer;
    let version = 0;
    let pending;
    let pendingKey;
    let plans = [];
    const resources = ['wood', 'clay', 'iron', 'food'];
    const timers = new Map();
    const publish = () => eventQueue.trigger('two_recruiter_updated');
    const unitData = () => modelDataService.getGameData().getUnitsObject();
    const buildingData = () => modelDataService.getGameData().getBuildings();
    const valid = () => policy.validSettings(config, settingsMap, unitData(), buildingData());

    const villages = function () {
        const player = modelDataService.getSelectedCharacter();
        const groups = modelDataService.getGroupList();
        const ids = config.enabled_groups.length
            ? [...new Set(config.enabled_groups.flatMap(id => groups.getGroupVillageIds(id)))]
            : Object.keys(player.getVillages());
        return ids.map(id => player.getVillage(id)).filter(Boolean);
    };

    const snapshot = function (village) {
        buildingService.compute(village);
        const computed = village.getResources().getComputed();
        const stock = Object.fromEntries(resources.map(type => [type, computed[type] && computed[type].currentStock]));
        const data = village.getBuildingData();
        const barracks = data.getDataForBuilding('barracks');
        const queue = village.getRecruitingQueue('barracks');
        const jobs = queue && (typeof queue.getQueue === 'function' ? queue.getQueue() : queue.jobs);
        const buildingCosts = {wood: 0, clay: 0, iron: 0, food: 0};
        const buildingQueue = village.buildingQueue;
        if (config.protect_buildings.length && (!buildingQueue || typeof buildingQueue.getQueue !== 'function')) {
            throw new Error('Building queue unavailable');
        }
        const buildingJobs = buildingQueue ? buildingQueue.getQueue() : [];
        for (const name of new Set(config.protect_buildings)) {
            // A queued upgrade is already paid; protect its following level once it completes.
            if (buildingJobs.some(job => job.building === name)) {
                continue;
            }
            const building = data.getDataForBuilding(name);
            if (building && building.level >= Number(buildingData()[name].max_level)) {
                continue;
            }
            const cost = building && building.nextLevelCosts;
            for (const type of resources) {
                if (!cost || !Number.isFinite(Number(cost[type])) || Number(cost[type]) < 0) {
                    throw new Error('Next building costs unavailable');
                }
                buildingCosts[type] += Number(cost[type]);
            }
        }
        return {stock, buildingCosts, barracksLevel: barracks && barracks.level,
            jobs: Array.isArray(jobs) ? jobs.map(job => job.data || job) : null,
            units: village.getUnitInfo().getUnits()};
    };

    const reconcile = function (village, state) {
        const entry = pending[village.getId()];
        if (!entry) {
            return !resourceBudget.isBusy(village);
        }
        // Wait for both the server job and resource debit before permitting another order.
        const observed = entry.jobId && state.jobs && state.jobs.some(job => String(job.job_id || job.id) === String(entry.jobId));
        if (observed && resources.every(type => !entry.cost[type]
            || state.stock[type] <= entry.before[type] - entry.cost[type])) {
            delete pending[village.getId()];
            Lockr.set(pendingKey, pending);
            clearTimeout(timers.get(village.getId()));
            timers.delete(village.getId());
            return !resourceBudget.isBusy(village);
        }
        return false;
    };

    const cycle = function () {
        if (!running) {
            return;
        }
        plans = [];
        if (!valid()) {
            recruiter.stop('Invalid recruitment settings');
            return;
        }
        for (const village of villages()) {
            if (!running) {
                break;
            }
            try {
                const state = snapshot(village);
                const plan = policy.plan(state, config, unitData());
                plan.villageId = village.getId();
                plans.push(plan);
                if (!config.preview_only && !reconcile(village, state)) {
                    plan.reason = 'Waiting for an earlier spend to appear in game data';
                    if (pending[village.getId()] && Date.now() - pending[village.getId()].sentAt >= 30000) {
                        recruiter.stop('Pending recruitment needs a queue/resource check');
                        break;
                    }
                    continue;
                }
                if (running && !config.preview_only && plan.orders.length) {
                    // One batch per village/cycle; next cycle replans against fresh game data.
                    send(village, state, plan.orders[0]);
                }
            } catch (error) {
                plans.push({villageId: village.getId(), reason: error.message, orders: []});
            }
        }
        publish();
    };

    const send = function (village, state, order) {
        if (!routeProvider.BARRACKS_RECRUIT) {
            recruiter.stop('Recruitment route unavailable');
            return;
        }
        const reservation = resourceBudget.begin(village, order.cost);
        if (!reservation) {
            return;
        }
        const entry = {before: state.stock, cost: order.cost, sentAt: Date.now(), unit: order.unit_type, amount: order.amount};
        pending[village.getId()] = entry;
        Lockr.set(pendingKey, pending);
        timers.set(village.getId(), setTimeout(() => {
            try {
                if (!reconcile(village, snapshot(village))) {
                    recruiter.stop('Recruitment acknowledgement or resource update missing; inspect the game queue');
                }
            } catch (error) {
                recruiter.stop(error.message);
            }
        }, 30000));
        // Keep uncertain reservations on stop/restart and reload. Never automatically retry.
        socketService.emit(routeProvider.BARRACKS_RECRUIT, {
            village_id: village.getId(), unit_type: order.unit_type, amount: order.amount
        }, data => {
            if (pending[village.getId()] !== entry) {
                return;
            }
            if (data && data.error) {
                delete pending[village.getId()];
                Lockr.set(pendingKey, pending);
                resourceBudget.reject(village, reservation);
                clearTimeout(timers.get(village.getId()));
                timers.delete(village.getId());
                recruiter.stop('Recruitment rejected by the server');
                return;
            }
            const job = data && (data.job || data);
            if (job && job.job_id && Number(job.village_id) === Number(village.getId())
                && job.unit_type === order.unit_type && job.amount === order.amount) {
                entry.jobId = job.job_id;
                Lockr.set(pendingKey, pending);
                resourceBudget.acknowledge(village, reservation);
            }
            publish();
        });
    };

    const recruiter = {
        status: 'Stopped',
        init: function () {
            if (initialized) {
                return;
            }
            initialized = true;
            const player = modelDataService.getSelectedCharacter();
            const suffix = `${player.getWorldId()}_${player.getId()}`;
            pendingKey = `recruiter_pending_${suffix}`;
            pending = Lockr.get(pendingKey, {});
            settings = new Settings({settingsMap, storageKey: `recruiter_settings_${suffix}`});
            config = settings.getAll();
            settings.onChange(() => {
                recruiter.stop('Settings saved; start again to apply');
                config = settings.getAll();
            });
        },
        start: function () {
            if (running || !valid()) {
                return false;
            }
            running = true;
            recruiter.status = config.preview_only ? 'Previewing recruitment' : 'Recruiting';
            const token = ++version;
            ready(() => {
                if (!running || token !== version) {
                    return;
                }
                cycle();
                if (running && token === version) {
                    timer = setInterval(cycle, config.check_interval);
                }
            }, 'all_villages_ready');
            publish();
            return true;
        },
        stop: function (reason = 'Stopped') {
            running = false;
            version++;
            clearInterval(timer);
            recruiter.status = reason;
            publish();
        },
        isRunning: () => running,
        isInitialized: () => initialized,
        getSettings: () => settings,
        resolvePending: function (villageId) {
            if (running) {
                return false;
            }
            delete pending[villageId];
            Lockr.set(pendingKey, pending);
            resourceBudget.clear(villageId);
            clearTimeout(timers.get(Number(villageId)));
            timers.delete(Number(villageId));
            recruiter.status = 'Guard cleared after manual check; start again';
            publish();
            return true;
        },
        getPlans: () => plans,
        getPending: () => pending
    };
    return recruiter;
});

define('two/recruiter/ui', [
    'two/ui', 'two/recruiter', 'two/recruiter/policy', 'two/Settings', 'two/EventScope', 'two/utils', 'humanInterval'
], function (ui, recruiter, policy, Settings, EventScope, utils, humanInterval) {
    const labels = {
        preview_only: 'Preview only', check_interval: 'Check interval', spend_percent: 'Maximum share of spendable resources per cycle (%)',
        max_batch: 'Maximum soldiers per batch', max_queue_jobs: 'Maximum barracks queue jobs',
        preserve_wood: 'Wood savings', preserve_clay: 'Clay savings', preserve_iron: 'Iron savings', preserve_food: 'Free population to preserve',
        building_wood: 'Additional wood budget for buildings', building_clay: 'Additional clay budget for buildings',
        building_iron: 'Additional iron budget for buildings', building_food: 'Additional population budget for buildings'
    };
    return function () {
        const button = ui.addMenuButton('Recruiter', 50);
        ui.addTemplate('two_recruiter_window', `<div id=\"two-recruiter\" class=\"win-content two-window\"><header class=\"win-head\"><h2>Recruiter</h2><ul class=\"list-btn\"><li><a href=\"#\" class=\"size-34x34 btn-red icon-26x26-close\" ng-click=\"closeWindow()\"></a></ul></header><div class=\"win-main\" scrollbar=\"\"><div class=\"box-paper footer\"><div class=\"scroll-wrap\"><p>Maintain troop targets per village. Targets include owned troops away from home and soldiers still in training. Zero disables a unit type. Each cycle sends at most one batch per village; types are considered in the order shown.<p>Spendable budget = current stock − savings − additional building budget − selected upcoming upgrade costs. Queued buildings and troops are already paid and are not charged twice. Food means free population.<table class=\"tbl-border-light tbl-content tbl-medium-height\"><tr><td>Village groups (empty = all owned villages)<td><div select=\"\" list=\"groups\" selected=\"settings.enabled_groups\" drop-down=\"true\"></div><tr ng-repeat=\"id in controls\" ng-switch=\"map[id].inputType\"><td>{{ labels[id] }}<td ng-switch-when=\"checkbox\"><div switch-slider=\"\" enabled=\"true\" border=\"true\" value=\"settings[id]\" vertical=\"false\" size=\"'56x28'\"></div><td ng-switch-when=\"number\"><input type=\"number\" class=\"fit textfield-border\" ng-model=\"settings[id]\" min=\"{{ map[id].min }}\" max=\"{{ map[id].max }}\" step=\"1\"><td ng-switch-when=\"readable_time\"><input class=\"fit textfield-border\" ng-model=\"settings[id]\"><tr><th>Unit kind<th>Target soldiers per village<tr ng-repeat=\"unit in units\"><td>{{ unit.name }}<td><input type=\"number\" class=\"fit textfield-border\" min=\"0\" max=\"1000000\" step=\"1\" ng-model=\"unit.target\"></table><h3>Save for upcoming building upgrades</h3><p>Reserve the next level cost of each selected building. A building with an upgrade already in the queue is skipped until that upgrade finishes. Use additional building budgets above to save for further levels or other spending.<div class=\"building-choices\"><label ng-repeat=\"building in buildings\"><input type=\"checkbox\" ng-model=\"building.enabled\"> {{ building.name }}</label></div><h3>{{ status }}</h3><div ng-repeat=\"(villageId, entry) in pending\"><p>Village {{ villageId }}: pending {{ entry.amount }} {{ entry.unit }}.</p><a href=\"#\" ng-show=\"!running\" class=\"btn-border btn-orange\" ng-click=\"resolvePending(villageId)\">Resolve guard after checking game</a></div><div ng-repeat=\"plan in plans\" class=\"recruit-plan\"><h3>Village {{ plan.villageId }} — {{ plan.reason }}</h3><p>Protected: {{ plan.protected }}<br>Upcoming buildings: {{ plan.buildingCosts }}<br>Cycle budget: {{ plan.budget }}<table class=\"tbl-border-light tbl-content\"><tr><th>Unit<th>Owned<th>In training<th>Target<th>Missing<tr ng-repeat=\"item in plan.deficits\"><td>{{ item.name }}<td>{{ item.owned }}<td>{{ item.queued }}<td>{{ item.target }}<td>{{ item.deficit }}</table><p ng-repeat=\"order in plan.orders\">{{ $first ? 'Next batch' : 'Later priority' }}: {{ order.amount }} {{ order.unit_type }} — cost {{ order.cost }}</div></div></div></div><footer class=\"win-foot\"><ul class=\"list-btn list-center\"><li><a href=\"#\" class=\"btn-border btn-orange\" ng-click=\"save()\">Save</a><li><a href=\"#\" class=\"btn-border\" ng-class=\"running ? 'btn-red' : 'btn-green'\" ng-click=\"toggle()\">{{ running ? 'Pause' : 'Start' }}</a></ul></footer></div>`);
        ui.addStyle('#two-recruiter .scroll-wrap{padding:12px}#two-recruiter p{margin:10px 0}#two-recruiter h3{margin-top:16px}#two-recruiter .building-choices label{display:inline-block;width:180px;padding:5px}#two-recruiter .recruit-plan{border-top:1px solid #bca475;margin-top:16px}');
        button.addEventListener('click', function () {
            const scope = $rootScope.$new();
            const settings = recruiter.getSettings();
            const map = settings.settingsMap;
            const units = modelDataService.getGameData().getUnitsObject();
            const buildings = modelDataService.getGameData().getBuildings();
            settings.injectScope(scope);
            scope.labels = labels;
            scope.map = map;
            scope.controls = Object.keys(labels);
            scope.groups = Settings.encodeList(modelDataService.getGroupList().getGroups(), {disabled: false, type: 'groups'});
            scope.units = Object.entries(units).filter(([name, data]) => data.building === 'barracks')
                .map(([name]) => ({name, target: settings.get('targets')[name] || 0}));
            scope.buildings = Object.keys(buildings).map(name => ({name, enabled: settings.get('protect_buildings').includes(name)}));
            const update = function () {
                scope.running = recruiter.isRunning();
                scope.status = recruiter.status;
                scope.plans = recruiter.getPlans();
                scope.pending = recruiter.getPending();
                button.classList.toggle('btn-red', scope.running);
                button.classList.toggle('btn-orange', !scope.running);
            };
            scope.save = function () {
                const values = settings.decode(scope.settings);
                values.targets = Object.fromEntries(scope.units.map(unit => [unit.name, unit.target]));
                values.protect_buildings = scope.buildings.filter(building => building.enabled).map(building => building.name);
                const parsed = {...values, check_interval: humanInterval(values.check_interval)};
                if (!policy.validSettings(parsed, map, units, buildings)) {
                    utils.notif('error', 'Use whole, non-negative troop counts and budgets. Check interval must be 10 seconds to 24 hours.');
                    return false;
                }
                settings.setAll(values);
                utils.notif('success', 'Recruiter settings saved');
                return true;
            };
            scope.toggle = function () {
                if (recruiter.isRunning()) {
                    recruiter.stop();
                } else if (scope.save()) {
                    if (!recruiter.start()) {
                        utils.notif('error', 'Recruiter could not start; check settings');
                    }
                }
                update();
            };
            scope.resolvePending = function (villageId) {
                const modal = $rootScope.$new();
                modal.title = 'Resolve pending recruitment';
                modal.text = 'Check the village barracks queue, owned troop totals, and resources in the game first. Clearing this guard allows another batch and may repeat an earlier order if game data is still stale.';
                modal.submitText = 'I checked the game; clear guard';
                modal.cancelText = 'Cancel';
                modal.submit = function () {
                    modal.closeWindow();
                    recruiter.resolvePending(villageId);
                    update();
                };
                modal.cancel = () => modal.closeWindow();
                windowManagerService.getModal('modal_attention', modal);
            };
            update();
            const events = new EventScope('two_recruiter_window', noop);
            events.register('two_recruiter_updated', () => scope.$evalAsync(() => {
                if (!scope.$$destroyed) {
                    update();
                }
            }));
            windowManagerService.getScreenWithInjectedScope('!two_recruiter_window', scope);
        });
    };
});

define('two/recruiter/policy', [], function () {
    const resources = ['wood', 'clay', 'iron', 'food'];
    const validCount = value => Number.isSafeInteger(value) && value >= 0;

    const validSettings = function (settings, map, unitData, buildings) {
        return Object.entries(map).every(([id, item]) => {
            const value = settings[id];
            if (item.inputType === 'number') {
                return validCount(value) && value >= item.min && value <= item.max;
            }
            if (item.inputType === 'checkbox') {
                return typeof value === 'boolean';
            }
            if (item.inputType === 'readable_time') {
                return Number.isFinite(value) && value >= 10000 && value <= 86400000;
            }
            return true;
        }) && settings.targets && !Array.isArray(settings.targets) && typeof settings.targets === 'object'
            && Object.entries(settings.targets).every(([name, amount]) => unitData[name]
                && unitData[name].building === 'barracks' && validCount(amount) && amount <= 1000000)
            && Array.isArray(settings.enabled_groups)
            && Array.isArray(settings.protect_buildings) && settings.protect_buildings.every(name => buildings[name]);
    };

    const plan = function (snapshot, settings, unitData) {
        const empty = reason => ({reason, orders: [], budget: {}, protected: {}});
        if (!Number.isInteger(snapshot.barracksLevel) || snapshot.barracksLevel < 1) {
            return empty('Barracks unavailable');
        }
        if (!Array.isArray(snapshot.jobs) || snapshot.jobs.length >= settings.max_queue_jobs) {
            return empty('Recruitment queue full or unavailable');
        }
        const budget = {};
        const protectedResources = {};
        for (const type of resources) {
            const stock = snapshot.stock[type];
            const building = snapshot.buildingCosts[type];
            if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(building) || building < 0) {
                return empty('Resources or building costs unavailable');
            }
            protectedResources[type] = settings[`preserve_${type}`] + settings[`building_${type}`] + building;
            budget[type] = Math.floor(Math.max(0, stock - protectedResources[type])
                * (type === 'food' ? 1 : settings.spend_percent / 100));
        }
        const remaining = {...budget};
        const queued = {};
        for (const job of snapshot.jobs) {
            if (!job || !validCount(job.amount) || !validCount(job.recruited) || job.recruited > job.amount
                || !unitData[job.unit_type]) {
                return empty('Recruitment queue data unavailable');
            }
            queued[job.unit_type] = (queued[job.unit_type] || 0) + job.amount - job.recruited;
        }
        const orders = [];
        const deficits = [];
        // Settings order is recruitment priority; zero targets disable a kind.
        for (const [name, target] of Object.entries(settings.targets)) {
            if (!target) {
                continue;
            }
            const data = unitData[name];
            const count = snapshot.units[name] && snapshot.units[name].total;
            if (!validCount(count)) {
                return empty('Owned troop totals unavailable');
            }
            const deficit = Math.max(0, target - count - (queued[name] || 0));
            deficits.push({name, target, owned: count, queued: queued[name] || 0, deficit});
            if (!data || data.building !== 'barracks' || !validCount(data.required_level)
                || snapshot.barracksLevel < data.required_level || snapshot.barracksLevel < 1
                || orders.length + snapshot.jobs.length >= settings.max_queue_jobs) {
                continue;
            }
            // World unit data supplies costs. No hard-coded troop prices.
            const cost = Object.fromEntries(resources.map(type => [type, Number(data[type])]));
            if (!resources.every(type => Number.isFinite(cost[type]) && cost[type] >= 0) || cost.food <= 0) {
                return empty('Troop costs unavailable');
            }
            let amount = Math.min(deficit, settings.max_batch);
            for (const type of resources) {
                if (cost[type] > 0) {
                    amount = Math.min(amount, Math.floor(remaining[type] / cost[type]));
                }
            }
            if (amount <= 0) {
                continue;
            }
            const totalCost = {};
            for (const type of resources) {
                totalCost[type] = amount * cost[type];
                remaining[type] -= totalCost[type];
            }
            orders.push({unit_type: name, amount, cost: totalCost});
        }
        return {reason: orders.length ? 'Ready' : 'Targets met, units locked, or budget reserved', orders,
            deficits, budget, remaining, protected: protectedResources, buildingCosts: snapshot.buildingCosts};
    };
    return {plan, validSettings};
});

define('two/recruiter/settings/map', [], function () {
    const number = (value, max) => ({default: value, updates: [], inputType: 'number', min: 0, max});
    return {
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

require(['two/ready', 'two/recruiter', 'two/recruiter/ui'], function (ready, recruiter, ui) {
    ready(function () {
        if (!recruiter.isInitialized()) {
            recruiter.init();
            ui();
        }
    }, 'all_villages_ready');
});

});
