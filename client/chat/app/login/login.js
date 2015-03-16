'use strict';

angular.module('chat.login', ['ngRoute'])

.config(['$routeProvider', function($routeProvider) {
  $routeProvider.when('/login', {
    templateUrl: 'login/login.html',
    controller: 'ChatLoginCtrl'
  });
}])

.controller('ChatLoginCtrl', ['$scope', 'ChatServer', function($scope, ChatServer) {

  var oi = window.stillepost.onion.interfaces,
  chat = window.stillepost.chat,
  cu = window.stillepost.cryptoUtils,
  _publicKey = null,
  _privateKey = null,
  _chatObject = null;

  /*
   testing code
   TODO allow user to specify own keypair + method for extraction
   */
  cu.getGeneratedRSAKeyPair().then(function(keys) {
    _publicKey = keys.publicKey;
    _privateKey = keys.privateKey;
  });

  $scope.login = function(){
    var params = {};
    params.username = $scope.username;
    params.publicKey = _publicKey;
    params.privateKey = _privateKey;
    oi.buildChain().then(function(){
      chat.init(params, function(chatObject){
        _chatObject = chatObject;
        _chatObject.onUserListUpdate = updateUserList;
        _chatObject.onReceiveMessage = receiveMessage;
        //_chatObject.onClientConnected
        _chatObject.updateUserList();
      });
    });
  };

}]);