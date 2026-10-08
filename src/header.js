/*!
 * ___overflow_name v___overflow_version
 * ___overflow_date
 * Developed by ___overflow_author_name <___overflow_author_email>
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
// Keep privileged storage out of the page's AMD module registry. Other game
// integration modules retain their existing registration and dependencies.
const privateModules = Object.create(null);
const define = function (name, dependencies, factory) {
    if (name === 'Lockr') {
        privateModules.Lockr = dependencies();
        return;
    }
    if (!Array.isArray(dependencies) || !dependencies.includes('Lockr')) {
        return window.define.apply(window, arguments);
    }
    const publicDependencies = dependencies.filter(dependency => dependency !== 'Lockr');
    return window.define(name, publicDependencies, function (...values) {
        let index = 0;
        return factory.apply(this, dependencies.map(dependency =>
            dependency === 'Lockr' ? privateModules.Lockr : values[index++]));
    });
};
const require = function (dependencies, callback, ...options) {
    if (dependencies === 'Lockr') {
        return privateModules.Lockr;
    }
    if (!Array.isArray(dependencies) || !dependencies.includes('Lockr')) {
        return window.require.apply(window, arguments);
    }
    const publicDependencies = dependencies.filter(dependency => dependency !== 'Lockr');
    return window.require(publicDependencies, function (...values) {
        let index = 0;
        return callback.apply(this, dependencies.map(dependency =>
            dependency === 'Lockr' ? privateModules.Lockr : values[index++]));
    }, ...options);
};
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
