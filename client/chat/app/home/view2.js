'use strict';

angular.module('chat.home', ['ngRoute'])

.config(['$routeProvider', function($routeProvider) {
  $routeProvider.when('/home', {
    templateUrl: 'home/home.html',
    controller: 'ChatHomeCtrl'
  });
}])

.controller('ChatHomeCtrl', [function() {

}]);