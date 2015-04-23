'use strict';

angular.module('chat.login', ['ngRoute'])

.config(['$routeProvider', function($routeProvider) {
  $routeProvider.when('/login', {
    templateUrl: 'login/login.html',
    controller: 'ChatLoginCtrl'
  });
}])

.controller('ChatLoginCtrl', ['$scope', '$location', 'ChatServer', function($scope, $location, ChatServer) {

  var oi = window.stillepost.interfaces,
  chat = window.stillepost.chat,
  cu = window.stillepost.cryptoUtils,
  _publicKey = null,
  _privateKey = null,
  _chatObject = null,
  _usermap = null;

  $scope.loginEnabled = false;
  document.addEventListener("chainReady", function() {
    $scope.loginEnabled = true;
    $scope.$apply();
  });

  cu.getGeneratedRSAKeyPair().then(function(keys) {
    _publicKey = keys.publicKey;
    _privateKey = keys.privateKey;
  });

  $scope.login = function(){
    var params = {};
    params.username = $scope.username;

    // user specified his own keys
    if(typeof($scope.privateKey) !== "undefined" && typeof($scope.publicKey) !== "undefined" ){
      params.publicKey = $scope.publicKey;
      crypto.subtle.importKey("jwk", JSON.parse($scope.privateKey), cu.rsaAlgorithm, true, ["decrypt", "unwrapKey"]).then(function(impKey) {
        params.privateKey = impKey;
        oi.buildChain().then(function(){
          ChatServer.init(params, function(chatObject){
            console.log("switching to home");
            $location.path("home");
            $scope.$apply();
          });
        });
      });
    }else{
      // use genereated keys
      params.publicKey = _publicKey;
      params.privateKey = _privateKey;
      oi.buildChain().then(function(){
        ChatServer.init(params, function(chatObject){
          console.log("switching to home");
          $location.path("home");
          $scope.$apply();
        });
      });
    }


  };

}]);