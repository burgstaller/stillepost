var restify = require('restify'),
    uuid = require('uuid'),
    crypto = require('crypto'),
    fs = require("fs");


// Server
var server = restify.createServer({
    name: 'dir-server',
    version: '1.0.0',
    key: fs.readFileSync('server-key.pem'),
    certificate: fs.readFileSync('server-cert.pem')
});
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

var heartbeatTimeout = 10000,
    heartbeatInterval = 5000;

var nodes = function(){
    var pub = {},
        list = {};
    pub.addNode = function(node){
        list[node.id] = {};
        list[node.id].id = node.id;
        list[node.id].socket = node.socket;
        list[node.id].key = node.key;
        list[node.id].heartbeat = node.heartbeat;

        return "OK";
    };
    pub.getNodeList = function(id){
        if(typeof(list[id]) === "undefined")
            return "No such node registered";
        var exportList = [];
        for (var node in list) {
            if (list.hasOwnProperty(node)) {
                exportList.push(list[node]);
            }
        }
        return exportList;
    };
    pub.removeNode = function(id){
        if(typeof(list[id]) === "undefined")
            return {error:"Node does not exist"};
        delete list[id];
        return "OK";
    };
    pub.updateHeartbeat = function(id){
        if(typeof(list[id]) === "undefined")
            return {error:"Node does not exist"};
        list[id].heartbeat = new Date().getTime();
        return "OK";
    };
    pub.checkHeartbeats = function(){
        var curTime = new Date().getTime();
        for (var node in list) {
            if (list.hasOwnProperty(node) && list[node].heartbeat + heartbeatTimeout <= curTime) {
                console.log("client timed out (sk="+list[node].sessionKey+", pk="+list[node].key+")\n");
                delete list[node];
            }

        }
    };
    return pub;
}();

setInterval(function(){
    console.log("checkingHeartbeats");
    nodes.checkHeartbeats();
}, heartbeatInterval);

//returns the list of all registered nodes
server.get('/node/:id', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    var id = req.params.id;
    if(typeof(id) === "undefined")
        res.send(400, createResponseObject('Id is missing'));
    else{
        var nodelist = nodes.getNodeList(id);
        if(typeof(nodelist) === "string")
            res.send(400, createResponseObject(nodelist));
        else
            res.send(200, createResponseObject('OK', nodelist));
    }

    next();
});

//each node has to send heartbeat to the directory server
//otherwise it will be assumed, that the node went offline
server.put('/node/:id', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var id = req.params.id;
    if(typeof(id) === "undefined")
        res.send(400, createResponseObject('Id is missing or wrong'));
    else{
        var msg = nodes.updateHeartbeat(id);
        if(msg !== "OK")
            res.send(400, createResponseObject(msg));
        else
            res.send(200, createResponseObject('OK'));
    }
    return next();
});
server.post('/node', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var body = JSON.parse(req.body);
    if (typeof(body.address) === "undefined" || typeof(body.port) === "undefined" || typeof(body.key) === "undefined") {
        res.send(400, createResponseObject('Required fields not present(address, port and key)'));
    }

    var genId = uuid.v4();
    nodes.addNode({socket: {address:body.address,port:body.port}, key: body.key, heartbeat: new Date().getTime(), id:genId});
    res.send(200, createResponseObject('OK', genId));
    return next();
});
server.post('/logout', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var body = JSON.parse(req.body),
        id = body.id,
        socket = body.socket,
        msg = nodes.removeNode(id);
    if(msg !== "OK")
        res.send(400, createResponseObject(msg));
    else
        res.send(200, createResponseObject('OK'));

    console.log("node logged out ",socket);
    return next();
});

server.listen(42111, function () {
    console.log('%s listening at %s', server.name, server.url);
});

function createResponseObject(message, dataObject) {
    if (typeof(message) === "undefined")
        return "\n";
    if (typeof(dataObject) === "undefined")
        return {msg: message};
    return {msg: message, data: dataObject};
}
