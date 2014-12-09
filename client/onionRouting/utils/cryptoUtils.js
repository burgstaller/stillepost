var para = {name: "AES-GCM", length: 256};
var pubExp = new Uint8Array([1, 0, 1]);
var rsa = {name: "RSA-OAEP", modulusLength: 2048, publicExponent: pubExp, hash: {name: "SHA-256"}};
var keyFormat = "jwk";
var privateRSAKey = null;

crypto.subtle.generateKey(rsa,true,["wrapKey", "unwrapKey"]).then(function(keyPair) {
	console.log("rsa-pubkey: "+keyPair.publicKey);
	crypto.subtle.exportKey(keyFormat,keyPair.publicKey).then(function(exportKey) {
		console.log("exported rsa pubkey: "+exportKey);
		console.log("exported rsa pubkey decoded: "+JSON.stringify(exportKey));

		wrapGeneratedAESKey(exportKey);
	}, function(err){console.log(err);});
	console.log("rsa-privkey: "+keyPair.privateKey);
	privateRSAKey = keyPair.privateKey;
},function(err) {
	console.log(err);
});

function wrapGeneratedAESKey(keyEncryptionKey) {
	crypto.subtle.generateKey(para, true,["encrypt", "decrypt"]).then(
		function(key) {
			console.log("AES-key"+key);

			crypto.subtle.importKey(keyFormat, keyEncryptionKey, rsa, false, ["wrapKey"]).then(function(keyEncKey) {
				console.log("imported keyEncKey: "+keyEncKey);
				crypto.subtle.wrapKey(keyFormat, key, keyEncKey,rsa).then(function(wrappedKey) {
					console.log("wrappedKey: "+wrappedKey);
					var decodedWrappedKey = ab2str(wrappedKey);
					console.log("decoded wrappedKey: "+decodedWrappedKey);
					unwrapKey(decodedWrappedKey);
				}, function(err){console.log(err);});
			}, function(err){console.log(err);});

		}
	);
}

function unwrapKey(decodedWrappedKey) {
	var wrappedKey = str2ab(decodedWrappedKey);
	console.log("re-encoded wrappedKey: "+wrappedKey);
	crypto.subtle.unwrapKey(keyFormat, wrappedKey,privateRSAKey, rsa, para, false,["encrypt","decrypt"]).then(function(key) {
		var nonce = crypto.getRandomValues(new Uint8Array(16));
		console.log(nonce);

		var alg = {name: "AES-GCM", iv: nonce};
		var buffer = new TextEncoder("utf-8").encode("secretText");

		crypto.subtle.encrypt(alg,key,buffer).then(function(enc) {
				console.log('enc'+enc);
				console.log('dec '+new TextDecoder("utf-8").decode(new Uint8Array(enc)));
				crypto.subtle.decrypt(alg,key,enc).then(function(dec) {
					console.log('dec '+new TextDecoder("utf-8").decode(new Uint8Array(dec)));
				});
			}
		);
	}, function(err){console.log(err);});


}

function ab2str(buf) {
	return String.fromCharCode.apply(null, new Uint16Array(buf));
}
function str2ab(str) {
	var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
	var bufView = new Uint16Array(buf);
	for (var i=0, strLen=str.length; i < strLen; i++) {
		bufView[i] = str.charCodeAt(i);
	}
	return buf;
}
