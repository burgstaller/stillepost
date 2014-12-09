window.stillepost = window.stillepost || {};

window.stillepost.cryptoUtils = (function() {
	var public = {};

	var aesAlgorithm = {name: "AES-GCM", length: 256};
	var pubExp = new Uint8Array([1, 0, 1]);
	var rsaAlgorithm = {name: "RSA-OAEP", modulusLength: 4096, publicExponent: pubExp, hash: {name: "SHA-256"}};
	var keyFormat = "jwk";
	var privateRSAKey = null;

	/**
	 * Generates a nonce
	 * @returns Promise which evaluates to a 128 bit nonce of type Uint8Array(16)
	 */
	public.generateNonce = function() {
		return crypto.getRandomValues(new Uint8Array(16));
	};

	/**
	 * Locally generates a RSA-OAEP key pair of 4096 modulus length.
	 * The private key is stored in a local member.
	 * The public rsa key is wrapped and exported.
	 * @returns Promise which evaluates to the string representation of the exported publicKey
	 */
	public.getGeneratedPublicKey = function() {
		// todo: do we need a random public exponent? ie.:
		// rsaAlgorithm.publicExponent = <random pubExp>
		return crypto.subtle.generateKey(rsaAlgorithm, true, ["wrapKey", "unwrapKey"]).then(function (keyPair) {
				privateRSAKey = keyPair.privateKey;
				return crypto.subtle.exportKey(keyFormat, keyPair.publicKey).then(function(exportKey) {
					// todo: if we use random pubExp we need to return it and store it on the server ie:
					// return {publicKey: JSON.stringify(exportKey), publicExponent:pubExp};
					return JSON.stringify(exportKey);
				});
			});
	};

	/**
	 * Generates a list of AES-GCM keys of 256 bit length, which can be used for encryption and decryption.
	 * @param count the amount of AES keys to be generated
	 * @returns Promise which evaluates to the list of generated AES keys
	 */
	public.getGeneratedAESKeys = function(count) {
		var promises = [];
		for(var i = 0; i < count; i++) {
			promises.push(generateAESKey());
		}
		return Promise.all(promises);
	};

	/**
	 * Generates a single AES-GCM key of 256 bit length, which can be used for encryption and decryption.
	 * @returns Promise which evaluates to AES key
	 */
	function generateAESKey() {
		return crypto.subtle.generateKey(aesAlgorithm, true, ["encrypt", "decrypt"]).then(function(key) {
			return key;
		});
	}

	/**
	 * Wraps an AES key with a RSA keyEncryptionKey.
	 * @param key the key which is to be wrapped
	 * @param keyEncryptionKey the exported keyEncryptionKey which is used to wrap the key
	 * @returns Promise which evaluates to the string represenation of the wrapped AES key
	 */
	public.wrapAESKey = function(key, keyEncryptionKey) {
		// Since given key is an exported key we need to import it first
		return crypto.subtle.importKey(keyFormat, keyEncryptionKey, rsaAlgorithm, false, ["wrapKey"]).then(function(keyEncKey) {
			return crypto.subtle.wrapKey(keyFormat, key, keyEncKey, rsaAlgorithm).then(function(wrappedKey) {
				return ab2str(wrappedKey);
			});
		});
	};

	public.encryptWrappedAES = function(data, wrappedKey, iv) {
		return unwrapAESKey(wrappedKey).then(function(unwrappedKey) {
			return public.encryptAES(data, unwrappedKey, iv);
		});
	};

	public.encryptAES = function(data, key, iv) {
		var alg = {name: "AES-GCM", iv: iv};
		var buffer = str2ab(data);
		return crypto.subtle.encrypt(alg, key, buffer).then(function(encData) {
			return ab2str(encData);
		});
	};

	public.decryptAES = function(encData, key, iv) {
		var alg = {name: "AES-GCM", iv: iv};
		var buffer = str2ab(encData);
		return unwrapAESKey(key).then(function(unwrappedKey) {
			return crypto.subtle.decrypt(alg, unwrappedKey, buffer).then(function(decData) {
				return ab2str(decData);
			});
		});
	};

	function unwrapAESKey(wrappedKey) {
		// Since wrapped key is string we first need to parse it to a ArrayBuffer object
		var wrappedKeyAB = str2ab(wrappedKey);
		return crypto.subtle.unwrapKey(keyFormat, wrappedKeyAB, privateRSAKey, rsaAlgorithm, aesAlgorithm, false,["encrypt","decrypt"]);
	}

	/**
	 * Converts ArrayBuffer object to string object
	 * @param buf the ArrayBuffer object
	 * @returns {string} the stringified ArrayBuffer object
	 */
	function ab2str(buf) {
		return String.fromCharCode.apply(null, new Uint16Array(buf));
	}

	/**
	 * Converts string object to ArrayBuffer object
	 * @param str the string to be converted to type ArrayBuffer
	 * @returns {ArrayBuffer} the ArrayBuffer object
	 */
	function str2ab(str) {
		var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
		var bufView = new Uint16Array(buf);
		for (var i=0, strLen=str.length; i < strLen; i++) {
			bufView[i] = str.charCodeAt(i);
		}
		return buf;
	}

	// TODO: IMPORTANT - Remove following function - only used for test purposes
	// used to simulate public keys retrieved from directory server
	public.getGeneratedRSAKeyPair = function() {
		return crypto.subtle.generateKey(rsaAlgorithm, true, ["wrapKey", "unwrapKey"]).then(function (keyPair) {
			return crypto.subtle.exportKey(keyFormat, keyPair.publicKey).then(function(exportKey) {
				return {publicKey: JSON.stringify(exportKey), privateKey: keyPair.privateKey};
			});
		});
	};

	// Decrypt with given private key - Since we fake being a node - we need to pass privkey
	public.testDecryptAES = function(encData, key, iv, privKey) {
		var alg = {name: "AES-GCM", iv: iv};
		var buffer = str2ab(encData);
		return unwrapAESKey(key, privKey).then(function(unwrappedKey) {
			return crypto.subtle.decrypt(alg, unwrappedKey, buffer).then(function(decData) {
				return ab2str(decData);
			});
		});
	};

	//Same as above - we need to pass privateKey in order to fake being a node
	function unwrapAESKey(wrappedKey, privKey) {
		// Since wrapped key is string we first need to parse it to a ArrayBuffer object
		var wrappedKeyAB = str2ab(wrappedKey);
		return crypto.subtle.unwrapKey(keyFormat, wrappedKeyAB, privKey, rsaAlgorithm, aesAlgorithm, false,["encrypt","decrypt"]);
	}


	return public;
})();