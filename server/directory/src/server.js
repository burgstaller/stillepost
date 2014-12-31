var restify = require('restify'),
    uuid = require('uuid');

// Server
var server = restify.createServer({
    name: 'dir-server',
    version: '1.0.0'
});
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

var nodes = {},
    nodesArray = [],
    idRegistry = {};


// adds a new node to both the map and array of nodes
// if a entry was already present for a given socket, we need to update
nodes.addEntry = function (entry) {
    if (typeof(nodes[getNodeKey(entry.socket)]) !== "undefined") {
        for (var i = 0; i < nodesArray.length; i++) {
            if (getNodeKey(nodesArray[i].socket) === getNodeKey(entry.socket))
                nodesArray[i] = entry;
        }
    }
    else {
        nodesArray.push(entry);
    }
    nodes[getNodeKey(entry.socket)] = entry;
    idRegistry[entry.id] = true;
};

nodes.deleteEntry = function (socket) {
    delete idRegistry[nodes[getNodeKey(socket)].id];
    delete nodes[getNodeKey(socket)];

    for (var i = 0; i < nodesArray.length; i++) {
        if (getNodeKey(nodesArray[i].socket) === getNodeKey(socket)) {
            nodesArray.splice(i, 1);
            return true;
        }
    }
    return false;
};

server.get('/nodelist/:id', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    var id = req.params.id;
    if(typeof(id) === "undefined" || typeof(idRegistry[id]) === "undefined")
        res.send(400, createResponseObject('Id is missing or wrong'));

    res.send(200, createResponseObject("OK", nodesArray));
    next();
});
server.get('/heartbeat/:id', function (req, res, next) {
    var id = req.params.id;
    if(typeof(id) === "undefined" || typeof(idRegistry[id]) === "undefined")
        res.send(400, createResponseObject('Id is missing or wrong'));
    res.send(200, createResponseObject('OK'));
    return next();
});
server.post('/register', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var body = JSON.parse(req.body);
    if (typeof(body.address) === "undefined" || typeof(body.port) === "undefined" || typeof(body.key) === "undefined") {
        res.send(400, createResponseObject('Required fields not present(address, port and key)'));
    }

    var genId = uuid.v4();
    nodes.addEntry({socket: {address:body.address,port:body.port}, key: body.key, lastBeat: new Date().getTime(), id:genId});
    res.send(200, createResponseObject('OK', genId));
    return next();
});
server.post('/logout', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var body = JSON.parse(req.body),
        id = body.id,
        socket = body.socket;
    if(typeof(id) === "undefined" || typeof(idRegistry[id]) === "undefined")
        res.send(400, createResponseObject('Id is missing or wrong'));
    if(typeof(nodes[getNodeKey(socket)]) === "undefined")
        res.send(400, createResponseObject('No such socket registered'+socket+" "+req.query+" "+req.query.length));
    if (nodes.deleteEntry(socket)) {
      console.log("node logged out ",socket);
      res.send(200, createResponseObject('OK'));
    }
    else
        res.send(400, createResponseObject('Not registered. (Perhaps multiple logout calls)'));
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

function getNodeKey(socket){
    return socket.address + '' + socket.port;
}
