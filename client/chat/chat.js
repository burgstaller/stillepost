
window.stillepost = window.stillepost || {};
window.stillepost.chat = (function() {
    var public = {},
        chatServerUrl = "http://127.0.0.1:42112",
        cu = window.stillepost.cryptoUtils,
        sessionKey = "",
        pubKeyHash = "";

    function login(username, pubKey, chainId, socket, successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var response = JSON.parse(this.responseText);

            console.log("LOGIN SUCCESS; response: ");
            console.log(response);
            sessionKey = response.data.sessionKey;
            console.log("sessionKey: "+sessionKey);
            cu.hash(pubKey).then(function(data){
                pubKeyHash = data;
                console.log("pubkeyhash: "+pubKeyHash);
                if(typeof(successCallback) !== "undefined")
                    successCallback(response, sessionKey, pubKeyHash);
            });

        };
        xhr.onerror = function(e) {
            console.log("Error occured at login: ");
            console.log(e.target);
        };
        xhr.open("post", chatServerUrl + "/user", true);
        xhr.send(JSON.stringify({"key":pubKey,"username":username,"chainid":chainId,"socket":socket}));
    }

    function getUserList(pubKeyHash, sessionKey, successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var response = JSON.parse(this.responseText);

            console.log("getUserList SUCCESS; response: ");
            console.log(response);
            if(typeof(successCallback) !== "undefined")
                successCallback(response, response.data);
        };
        xhr.onerror = function(e) {
            console.log("Error occured at getUserList: ");
            console.log(e.target);
        };
        xhr.open("get", chatServerUrl + "/user?sessionKey="+encodeURIComponent(sessionKey)+"&keyHash="+encodeURIComponent(pubKeyHash), true);
        xhr.send();
    }

    function logout(pubKeyHash, sessionKey, successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var response = JSON.parse(this.responseText);

            console.log("LOGOUT SUCCESS; response: ");
            console.log(response);
            if(typeof(successCallback) !== "undefined")
                successCallback(response);
        };
        xhr.onerror = function(e) {
            console.log("Error occured at logout: ");
            console.log(e.target);
        };
        xhr.open("delete", chatServerUrl + "/user/"+encodeURIComponent(pubKeyHash)+"?sessionKey="+encodeURIComponent(sessionKey), true);
        xhr.send();
    }

    public.test = function(){
        cu.getGeneratedPublicKey().then(function(pubKey) {
            console.log("Generated pubKey: "+pubKey);
            var username = "test";
            var chainid = 4;
            var socket = "horse";

            // test login
            login(username, pubKey, chainid, socket, function(response, sessionkey, pubKeyHash){
                console.log("login fin");

                // test getUserList
                setTimeout(function(){getUserList(pubKeyHash, sessionKey, function(response, users){
                    console.log("getuserlist fin");
                    console.log(response);
                    console.log(users);
                });}, 1000);

                /*
                // test logout
                setTimeout(function(){logout(pubKeyHash, sessionKey, function(response){
                   console.log("logout fin");
                });}, 2000);
                */

            });


        }).catch(function(err) {
            console.log("Error generating public RSA Key", err);
        });
    };

    return public;
})();
