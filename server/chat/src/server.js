var restify = require('restify');

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

var chatClients = function(){
    var pub = {},
        list = {};
    pub.addClient = function(username, socket, chainid, key){
        if(typeof(list[username]) !== "undefined")
            return "Username already registered";
        list[username] = {};
        list[username].socket = socket;
        list[username].username = username;
        list[username].chainid = chainid;
        list[username].key = key;
        return "OK";
    };
    pub.getClientList = function(){
        return JSON.stringify(list);
    };
    return pub;
}();

// for testing
// curl -H "Content-Type: application/json" -X POST http://localhost:42112/user -d '{"key":"test","username":"testuser","chainid":4,"socket":"1234"}'
server.post('/user', function (req, res, next) {
    console.log("received login");
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    var body = req.body;
    if (typeof(body.username) === "undefined" || typeof(body.chainid) === "undefined" || typeof(body.socket) === "undefined" || typeof(body.key) === "undefined") {
        res.send(400, createResponseObject('Required fields not present(username, chainid, key and socket)'));
    }
    var msg = chatClients.addClient(body.username, body.socket, body.chainid, body.key);
    if(msg !== "OK")
        res.send(400, createResponseObject(msg));
    res.send(200, createResponseObject('OK'));
    return next();
});

// for testing
// curl -X GET http://localhost:42112/user
server.get('/user', function (req, res, next) {
    console.log("received userlist request");
    res.send(200, createResponseObject('OK', chatClients.getClientList()));
    return next();
});

function createResponseObject(message, dataObject) {
    if (typeof(message) === "undefined")
        return "\n";
    if (typeof(dataObject) === "undefined")
        return {msg: message};
    return {msg: message, data: dataObject};
}
