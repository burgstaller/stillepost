const {Cc,Ci,Cr,Cu} = require("chrome");
var homePath = require('sdk/system').pathFor('Home');
Cu.import("resource://gre/modules/osfile.jsm")
var { env } = require('sdk/system/environment');

var jarPath = homePath+"/Documents/masterproject/stillepost/node/extension/extension/lib"

var javaHome = env.JAVA_HOME;
if (javaHome) {
	console.log("Found JAVA_HOME path="+javaHome);
	console.log("Opening jar in path: "+jarPath);
	// var PATH = env.PATH;
	// console.log(PATH);

	OS.Path.join(OS.Constants.Path.profileDir, "sessionstore.js");
	var child_process = require("sdk/system/child_process");
	var ls = child_process.spawn(javaHome+'/jre/bin/java', 
		["-jar",jarPath]);

	ls.stdout.on('data', function (data) {
	  console.log('stdout: ' + data);
	});

	ls.stderr.on('data', function (data) {
	  console.log('stderr: ' + data);
	});

	ls.on('close', function (code) {
	  console.log('child process exited with code ' + code);
	});
} else {
	console.log("Error: Could not find JAVA_HOME in environment");
}
