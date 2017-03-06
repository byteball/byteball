'use strict';

angular.module('copayApp.controllers').controller('correspondentDevicesController',
  function($scope, $timeout, configService, profileService, go, correspondentListService, $state, $rootScope) {
	
	var self = this;
	
	$scope.editCorrespondentList = false;
	$scope.selectedCorrespondentList = {};
	var fc = profileService.focusedClient;
	$scope.backgroundColor = fc.backgroundColor;

	$scope.state = $state;

	$scope.hideRemove = true;

	var listScrollTop = 0;

	$scope.$on('$stateChangeStart', function(evt, toState, toParams, fromState) {
	    if (toState.name === 'correspondentDevices') {
	        $scope.readList();
	        $rootScope.$emit('Local/SetTab', 'chat', true);
	    	setTimeout(function(){document.querySelector('[ui-view=chat]').scrollTop = listScrollTop;}, 5);
	    }
	});
	
	$scope.showCorrespondent = function(correspondent) {
		console.log("showCorrespondent", correspondent);
		correspondentListService.currentCorrespondent = correspondent;
		listScrollTop = document.querySelector('[ui-view=chat]').scrollTop;
		go.path('correspondentDevices.correspondentDevice');
	};

	$scope.toggleEditCorrespondentList = function() {
		$scope.editCorrespondentList = !$scope.editCorrespondentList;
		$scope.selectedCorrespondentList = {};
	};

	$scope.toggleSelectCorrespondentList = function(addr) {
		$scope.selectedCorrespondentList[addr] = $scope.selectedCorrespondentList[addr] ? false : true;
	};

	$scope.newMsgByAddressComparator = function(correspondent) {
	      return -($scope.newMessagesCount[correspondent.device_address]|0);
	};

	$scope.beginAddCorrespondent = function() {
		console.log("beginAddCorrespondent");
		listScrollTop = document.querySelector('[ui-view=chat]').scrollTop;
		go.path('correspondentDevices.addCorrespondentDevice');
	};


	$scope.readList = function() {
		$scope.error = null;
		correspondentListService.list(function(err, ab) {
			if (err) {
				$scope.error = err;
				return;
			}
			$scope.list = ab;
			$scope.$digest();
		});
	};
	

	$scope.remove = function(addr) {
		var device = require('byteballcore/device.js');
		device.removeCorrespondentDevice(addr, function() {
			$scope.hideRemove = true;
			$scope.readList();
			$rootScope.$emit('Local/SetTab', 'chat', true);
			setTimeout(function(){document.querySelector('[ui-view=chat]').scrollTop = listScrollTop;}, 5);
		});

		// previous version
		// throw Error("unimplemented");
		// $scope.error = null;
		// $timeout(function() {
		//   correspondentListService.remove(addr, function(err, ab) {
		// 	if (err) {
		// 	  $scope.error = err;
		// 	  return;
		// 	}
		// 	$rootScope.$emit('Local/CorrespondentListUpdated', ab);
		// 	$scope.list = ab;
		// 	$scope.$digest();
		//   });
		// }, 100);
	};

	$scope.cancel = function() {
		console.log("cancel clicked");
		go.walletHome();
	};

  });
