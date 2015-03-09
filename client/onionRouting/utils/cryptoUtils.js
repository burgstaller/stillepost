window.stillepost = window.stillepost || {};

window.stillepost.cryptoUtils = (function() {
	var public = {};

	var aesAlgorithm = {name: "AES-GCM", length: 256};
	var pubExp = new Uint8Array([1, 0, 1]);
	var rsaAlgorithm = {name: "RSA-OAEP", modulusLength: 2048, publicExponent: pubExp, hash: {name: "SHA-256"}};
	var keyFormat = "jwk";
	var privateRSAKey = null;

	/**
	 * Generates a nonce
	 * @returns Promise which evaluates to a 128 bit nonce of type Uint8Array(16)
	 */
	public.generateNonce = function() {
		return crypto.getRandomValues(new Uint8Array(16));
	};

  public.generateRandomBytes = function(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  };

	public.generateRandomInt32 = function() {
		var num = crypto.getRandomValues(new Uint32Array(1))[0];
		while (num == 0) {
			num = crypto.getRandomValues(new Uint32Array(1))[0];
		}
		return num;
	};

  /**
   * Concatenate an arbitrary amount of given integers or arraybuffers to a Uint8Array object.
   * Arguments are retrieved via the JavaScript argument array.
   * @returns Uint8Array .. the concatenated arraybuffer
   */
  public.abConcat = function()
  {
    if (arguments.length < 1)
      return null;

    var i = 1,
      result = convertToAb(arguments[0]);

    for (; i < arguments.length; i++) {
      var b = convertToAb(arguments[i]),
        temp = new Uint8Array(result.length + b.length);

      temp.set(result);
      temp.set(b, result.length);
      result = temp;
    }

    return result;
  };

	/**
	 * Locally generates a RSA-OAEP key pair of 4096 modulus length.
	 * The private key is stored in a local member.
	 * The public rsa key is wrapped and exported.
	 * @returns Promise which evaluates to the string representation of the exported publicKey
	 */
	public.getGeneratedPublicKey = function() {
		// rsaAlgorithm.publicExponent = <random pubExp>
		return crypto.subtle.generateKey(rsaAlgorithm, true, ["wrapKey", "unwrapKey"]).then(function (keyPair) {
				privateRSAKey = keyPair.privateKey;
				return crypto.subtle.exportKey(keyFormat, keyPair.publicKey).then(function(exportKey) {
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

  public.generateAESKey = generateAESKey;

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

	public.encryptWrappedAES = function(data, wrappedKey, iv, additionalData) {
		return unwrapAESKey(wrappedKey).then(function(unwrappedKey) {
			return public.encryptAES(data, unwrappedKey, iv, additionalData);
		});
	};

	public.encryptAES = function(data, key, iv, additionalData) {
    var alg = {name: "AES-GCM", iv: iv};
    if (additionalData)
      alg.additionalData = convertToAb(additionalData);
		var buffer = str2ab(data);
		return crypto.subtle.encrypt(alg, key, buffer).then(function(encData) {
			return ab2str(encData);
		});
	};

	public.decryptAES = function(encData, key, iv, additionalData) {
    var alg = {name: "AES-GCM", iv: new Uint8Array(iv)};
    if (additionalData)
      alg.additionalData = convertToAb(additionalData);
		var buffer = str2ab(encData);
		return crypto.subtle.decrypt(alg, key, buffer).then(function(decData) {
			return ab2str(decData);
		});
	};

	public.decryptWrappedAES = function(encData, key, iv, additionalData) {
		var alg = {name: "AES-GCM", iv: iv};
    if (additionalData)
      alg.additionalData = convertToAb(additionalData);
		var buffer = str2ab(encData);
		return unwrapAESKey(key).then(function(unwrappedKey) {
			return crypto.subtle.decrypt(alg, unwrappedKey, buffer).then(function(decData) {
				return ab2str(decData);
			});
		});
	};

	public.unwrapAESKey = function(wrappedKey, keyDecryptionKey) {
    var privKey = keyDecryptionKey;
    if (!keyDecryptionKey)
      privKey = privateRSAKey;
		// Since wrapped key is string we first need to parse it to a ArrayBuffer object
		var wrappedKeyAB = str2ab(wrappedKey);
		return crypto.subtle.unwrapKey(keyFormat, wrappedKeyAB, privKey, rsaAlgorithm, aesAlgorithm, false,["encrypt","decrypt"]);
	};

  public.encryptRSA = function(data, key) {
    var keyData = (typeof key === 'string') ? JSON.parse(key) : key,
      buffer = (typeof data === 'string') ? str2ab(data) : data;
    return importRSAKey(keyData,['encrypt']).then(function(importedKey) {
      return crypto.subtle.encrypt(rsaAlgorithm, importedKey, buffer).then(function (encData) {
        return ab2str(encData);
      });
    });
  };

  public.decryptRSA = function(data, key) {
    var keyData = (typeof key === 'string') ? JSON.parse(key) : key,
      buffer = str2ab(data);
    return crypto.subtle.decrypt(rsaAlgorithm, keyData, buffer).then(function (decData) {
      return ab2str(decData);
    });
  };

  function importRSAKey(key, keyUsages) {
    var keyData = (typeof key === 'string') ? JSON.parse(key) : key;
    return crypto.subtle.importKey(keyFormat, keyData, rsaAlgorithm, false, keyUsages).then(function(importedKey) {
      return importedKey;
    });
  }

	public.hash = function(data) {
		var input = data;
		if (typeof data === "string") {
			input = str2ab(data);
		}
		return crypto.subtle.digest({name: 'SHA-256'}, input).then(function(digest) {
			return ab2str(digest);
		});
	};

	public.hashArrayObjects = function(array) {
		if (array && array.constructor === Array) {
			var promises = [];
			for (var i = 0; i < array.length; i++) {
				promises.push(public.hash(array[i]));
			}
			return Promise.all(promises);
		}
	};

  // Generate a RSA-2048 key pair
  public.getGeneratedRSAKeyPair = function() {
    return crypto.subtle.generateKey(rsaAlgorithm, true, ["wrapKey", "unwrapKey", 'encrypt', 'decrypt']).then(function (keyPair) {
      return crypto.subtle.exportKey(keyFormat, keyPair.publicKey).then(function(exportKey) {
        return {publicKey: JSON.stringify(exportKey), privateKey: keyPair.privateKey};
      });
    });
  };

  function convertToAb(data) {
    if (typeof data === 'string')
      return new Uint8Array(str2ab(data));
    else if (typeof data === 'object')
      return new Uint8Array(str2ab(JSON.stringify(data)));
    else if (typeof data === 'number')
      return new Uint8Array([data]);
    else
      return data;
  }

	// TODO: IMPORTANT - Remove following function - only used for test purpose
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