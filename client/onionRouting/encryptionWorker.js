//params: data,key,iv
self.onmessage = function(e) {
    console.log('Enc worker begins to work...');
    var alg = {name: "AES-GCM", iv: e.data.iv};
    var buffer = str2ab(e.data.data);
    crypto.subtle.encrypt(alg, e.data.key, buffer).then(function(encData) {
        postMessage({success:true,data:ab2str(encData)});
        console.log('Enc worker succeeds');
    }).catch(function(error){
        postMessage({success:false,data:error});
        console.log('Enc worker fails');
    });

};


/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

/**
 * Converts string object to ArrayBuffer object
 * @param str the string to be converted to type ArrayBuffer
 * @returns {ArrayBuffer} the ArrayBuffer object
 */
function str2ab(str) {
  var buf = new ArrayBuffer(str.length); // 2 bytes for each char
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}
