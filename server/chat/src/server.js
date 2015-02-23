var restify = require('restify'),
    uuid = require('uuid'),
    crypto = require('crypto');

// Server
var server = restify.createServer({
    name: 'chat-server',
    version: '1.0.0'
});
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.listen(42112, function () {
    console.log('%s listening at %s', server.name, server.url);
});

function getHashString(data){
    var shasum = crypto.createHash('sha256');
    shasum.update(data, "utf8");
    var hash= shasum.digest();
    return String.fromCharCode.apply(null, new Uint8Array(hash));
}

var chatClients = function(){
    var pub = {},
        list = {};
    pub.addClient = function(username, socket, chainid, key, sessionKey){
        var hash = getHashString(key);
        if(typeof(list[hash]) !== "undefined")
            return "Username already registered";
        list[hash] = {};
        list[hash].socket = socket;
        list[hash].username = username;
        list[hash].chainid = chainid;
        list[hash].key = key;
        list[hash].sessionKey = sessionKey;
        list[hash].hash = hash;

        return "OK";
    };
    pub.getClientList = function(hash, sessionKey){
        if(list[hash].sessionKey !== sessionKey)
            return {error:"sessionKey invalid"};
        var exportList = {};
        for (var client in list) {
            if (list.hasOwnProperty(client) && client !== hash) {
                exportList[client] = {};
                exportList[client].socket = list[client].socket;
                exportList[client].username = list[client].username;
                exportList[client].chainid = list[client].chainid;
                exportList[client].key = list[client].key;
            }
        }
        return exportList;
    };
    pub.removeClient = function(hash, sessionKey){
        if(typeof(list[hash]) === "undefined")
            return {error:"User does not exist"};
        if(list[hash].sessionKey !== sessionKey)
            return {error:"sessionKey invalid"};
        delete list[hash];
        return "OK";
    };
    return pub;
}();

// for testing
// curl -H "Content-Type: application/json" -X POST "http://localhost:42112/user" -d '{"key":"test","username":"testuser","chainid":4,"socket":"1234"}'
server.post('/user', function (req, res, next) {
    console.log("received login");
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    var body = typeof(req.body) === "string" ? JSON.parse(req.body) : req.body;
    console.log(body);
    if (typeof(body.username) === "undefined" || typeof(body.chainid) === "undefined" || typeof(body.socket) === "undefined" || typeof(body.key) === "undefined") {
        res.send(400, createResponseObject('Required fields not present(username, chainid, key and socket)'));
    }
    var sessionKey = uuid.v4();
    var msg = chatClients.addClient(body.username, body.socket, body.chainid, body.key, sessionKey);
    if(msg !== "OK")
        res.send(400, createResponseObject(msg));
    res.send(200, createResponseObject('OK', {"sessionKey":sessionKey}));
    return next();
});

// for testing
// curl -X GET "http://localhost:42112/user?keyHash=test&sessionKey=<key>"
server.get('/user', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var sessionKey = req.query.sessionKey;
    var keyHash = req.query.keyHash;
    console.log("received userlist request from sessionKey:"+sessionKey);
    res.send(200, createResponseObject('OK', chatClients.getClientList(keyHash, sessionKey)));
    return next();
});

// for testing
// curl -X DELETE "http://localhost:42112/user/test2?sessionKey=<key>"
server.del('/user/:keyHash', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var sessionKey = req.query.sessionKey;
    var keyHash = req.params.keyHash;
    console.log("received logout request from sessionKey:"+sessionKey);
    var msg = chatClients.removeClient(keyHash, sessionKey);
    if(msg !== "OK")
        res.send(400, createResponseObject(msg));
    res.send(200, createResponseObject('OK'));
    return next();
});

function createResponseObject(message, dataObject) {
    if (typeof(message) === "undefined")
        return "\n";
    if (typeof(dataObject) === "undefined")
        return {msg: message};
    return {msg: message, data: dataObject};
}
