var restify = require('restify');

// Server
var server = restify.createServer({
    name: 'dir-server',
    version: '1.0.0'
});
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

var nodes = [];

server.get('/getList', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    res.send(JSON.stringify(nodes));
    next();
});
server.get('/sendHeardBeat', function (req, res, next) {
    // TODO
});
server.post('/register', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    var body  = JSON.parse(req.body);
    nodes.push({ip:body.address, port:body.port, key:body.key});
    // TODO send ack
    //res.send();
    return next();
});
server.get('/logout', function (req, res, next) {
    // TODO
});

server.listen(80, function () {
    console.log('%s listening at %s', server.name, server.url);
});
