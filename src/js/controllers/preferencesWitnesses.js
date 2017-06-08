'use strict';

angular.module('copayApp.controllers').controller('preferencesWitnessesController',
  function($scope, go, witnessListService, autoUpdatingWitnessesList){
    var self = this;
    this.witnesses = [];
    console.log('preferencesWitnessesController');

    $scope.autoUpdWitnessesList = autoUpdatingWitnessesList.autoUpdate;

    var myWitnesses = require('byteballcore/my_witnesses.js');
    myWitnesses.readMyWitnesses(function(arrWitnesses){
        self.witnesses = arrWitnesses;
        $scope.$apply();
        console.log('preferencesWitnessesController set witnesses '+arrWitnesses);
    }, 'wait');

    this.edit = function(witness) {
      if ($scope.autoUpdWitnessesList) return;

      witnessListService.currentWitness = witness;
      go.path('preferences.witnesses.edit');
    };


    var unwatchAutoUpdWitnessesList = $scope.$watch('autoUpdWitnessesList', function(val){
      autoUpdatingWitnessesList.setAutoUpdate(val);

      if (val) {
        autoUpdatingWitnessesList.checkChangeWitnesses();
      }
    });

    $scope.$on('$destroy', function(){
      unwatchAutoUpdWitnessesList();
    });
  });
