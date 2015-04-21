module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    concat: {
      options: {
        separator: ';'
      },
      dist: {
        src: ['client/webrtc/*.js','client/onionRouting/*.js','client/onionRouting/utils/*.js','client/*.js'],
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
