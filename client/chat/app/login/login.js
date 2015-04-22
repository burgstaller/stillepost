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

  /*
   testing code
   TODO allow user to specify own keypair + method for extraction
   */
  cu.getGeneratedRSAKeyPair().then(function(keys) {
    _publicKey = keys.publicKey;
    _privateKey = keys.privateKey;
  });


  function updateUserList(users){
    _usermap = [];
    var id = -1;
    for(var user in users){
      id++;
      _usermap[id] = users[user];
      _usermap[id].hash = user;
    }
  }

  $scope.login = function(){
    var params = {};
    params.username = $scope.username;
    params.publicKey = _publicKey;
    params.privateKey = _privateKey;
    oi.buildChain().then(function(){
      //chat.init(params, function(chatObject){
      ChatServer.init(params, function(chatObject){
        /*
        _chatObject = chatObject;
        //_chatObject.onUserListUpdate = updateUserList;
        _chatObject.onUserListUpdate = function(){};
        //_chatObject.onReceiveMessage = receiveMessage;
        _chatObject.onReceiveMessage = function(){};
        //_chatObject.onClientConnected
        _chatObject.updateUserList();
        */
        console.log("switching to home");
        $location.path("home");
        $scope.$apply();
      });
    });
  };

}]);