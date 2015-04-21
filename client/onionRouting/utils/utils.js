// check if the contents of two ArrayBuffer objects are equal
function abEqual(buf1, buf2)
{
  if (buf1.byteLength != buf2.byteLength) return false;
  var dv1 = new Int8Array(buf1);
  var dv2 = new Int8Array(buf2);
  for (var i = 0 ; i != buf1.byteLength ; i++)
  {
    if (dv1[i] != dv2[i]) return false;
  }
  return true;
}

// convert the given value of type Object to type ArrayBuffer
function objToAb(obj) {
  var newArray = new Uint8Array(16), i=0;
  for (var key in obj) {
    newArray[i++] = obj[key];
  }
  return newArray;
}

/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str(buffer) {
  var binary = '';
  var bytes = new Uint8Array( buffer );
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode( bytes[ i ] );
  }
  return binary;
}

/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str32(buf) {
  return JSON.stringify(buf);
}

/**
 * Converts string object to ArrayBuffer object
 * @param str the string to be converted to type ArrayBuffer
 * @returns {ArrayBuffer} the ArrayBuffer object
 */
function str2ab32(str) {
  var buf = JSON.parse(str);
  return objToAb(buf);
}

/**
 * Converts string object to ArrayBuffer object
 * @param str the string to be converted to type ArrayBuffer
 * @returns {Uint8Array} the ArrayBuffer object
 */
function str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(str.length);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}

// Function wrapping code.
// fn - reference to function.
// context - what you want "this" to be.
// params - array of parameters to pass to function.
function wrapFunction(fn, context, params) {
  return function() {
    return fn.apply(context, params);
  };
}
/**
 *
 * jquery.binarytransport.js
 *
 * @description. jQuery ajax transport for making binary data type requests.
 * @version 1.0
 * @author Henry Algus <henryalgus@gmail.com>
 *
 */

// use this transport for "binary" data type
$.ajaxTransport("+binary", function(options, originalOptions, jqXHR){
  // check for conditions and support for blob / arraybuffer response type
  if (window.FormData && ((options.dataType && (options.dataType == 'binary')) || (options.data && ((window.ArrayBuffer && options.data instanceof ArrayBuffer) || (window.Blob && options.data instanceof Blob)))))
  {
    return {
      // create new XMLHttpRequest
      send: function(headers, callback){
        // setup all variables
        var xhr = new XMLHttpRequest(),
          url = options.url,
          type = options.type,
          async = options.async || true,
        // blob or arraybuffer. Default is blob
          dataType = options.responseType || "blob",
          data = options.data || null,
          username = options.username || null,
          password = options.password || null;

        xhr.addEventListener('load', function(){
          var data = {};
          data[options.dataType] = xhr.response;
          // make callback and send data
          callback(xhr.status, xhr.statusText, data, xhr.getAllResponseHeaders());
        });

        xhr.open(type, url, async, username, password);

        // setup custom headers
        for (var i in headers ) {
          xhr.setRequestHeader(i, headers[i] );
        }

        xhr.responseType = dataType;
        xhr.send(data);
      },
      abort: function(){
        jqXHR.abort();
      }
    };
  }
});

/**
 *
 */
var logging = true;
function logToConsole(){
    if(logging === true){
         console.log(Array.prototype.slice.call(arguments));
    }
}