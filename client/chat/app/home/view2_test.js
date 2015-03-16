'use strict';

describe('myApp.home module', function() {

  beforeEach(module('myApp.view2'));

  describe('home controller', function(){

    it('should ....', inject(function($controller) {
      //spec body
      var view2Ctrl = $controller('View2Ctrl');
      expect(view2Ctrl).toBeDefined();
    }));

  });
});