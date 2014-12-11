var restify = require('restify');

// Server
var server = restify.createServer({
    name: 'dir-server',
    version: '1.0.0'
});
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.get('/getList', function (req, res, next) {
    res.send(req.params);
    return next();
});
server.get('/sendHeardBeat', function (req, res, next) {
    res.send(req.params);
    return next();
});
server.post('/register', function (req, res, next) {
    res.send(req.params);
    return next();
});
server.get('/logout', function (req, res, next) {
    res.send(req.params);
    return next();
});

server.listen(80, function () {
    console.log('%s listening at %s', server.name, server.url);
});
