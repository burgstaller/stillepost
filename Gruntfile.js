module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    concat: {
      options: {
        separator: ';'
      },
      dist: {
        src: ['client/jquery-2.1.3.min.js',
            'client/onionRouting/utils/utils.js',
            'client/webrtc/adapter.js',
            'client/webrtc/SignalingChannel.js',
            'client/webrtc/webrtc.js',
            'client/onionRouting/utils/cryptoUtils.js',
            'client/onionRouting/exitNode.js',
            'client/onionRouting/intermediateNode.js',
            'client/onionRouting/clientConnection.js',
            'client/onionRouting/messageHandler.js',
            'client/onionRouting/onionRouting.js',
            'client/interfaces.js'],
        dest: 'mini_client/concat.js'
      }
    },
    uglify: {
      dist: {
        files: {
          'mini/concat.min.js': ['<%= concat.dist.dest %>']
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-concat');


  grunt.registerTask('mini', ['concat', 'uglify']);
  grunt.registerTask('co', ['concat']);

};
