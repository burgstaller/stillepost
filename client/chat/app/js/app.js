'use strict';

// Declare app level module which depends on views, and components
angular.module('chat', [
    'ngRoute',
    'chatServices',
    'chat.login',
    'chat.home',
    'chat.version'
]).
    config(['$routeProvider', function($routeProvider) {
        $routeProvider.otherwise({redirectTo: '/login'});
    }]);
