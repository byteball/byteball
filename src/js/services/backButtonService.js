'use strict';


angular.module('copayApp.services').factory('backButton', function($log, $rootScope, gettextCatalog, $deepStateRedirect, $document, $timeout, go, $state) {
	var root = {};
	
	root.menuOpened = false;
	root.dontDeletePath = false;
	
	var arrHistory = [];
	var body = $document.find('body').eq(0);
	var shownExitMessage = false;
	
	$rootScope.$on('$stateChangeSuccess', function(event, to, toParams, from, fromParams){
		var lastState = arrHistory.length ? arrHistory[arrHistory.length - 1] : null;
		if (from.name == "" || !lastState || (lastState && to.name != lastState.to && toParams != lastState.toParams))
			arrHistory.push({to: to.name, toParams: toParams, from: from.name, fromParams: fromParams});
		if (to.name == "walletHome")
			$rootScope.$emit('Local/SetTab', 'walletHome', true);
		root.menuOpened = false;
	});
	
	function back() {
		if (body.hasClass('modal-open')) {
			$rootScope.$emit('closeModal');
		}
		else if (root.menuOpened) {
			go.swipe();
			root.menuOpened = false;
		}
		else {
			var currentState = arrHistory.pop();
			if (!currentState || currentState.from == "") {
				if (shownExitMessage) {
				navigator.app.exitApp();
				}
				else {
					shownExitMessage = true;
					window.plugins.toast.showShortBottom(gettextCatalog.getString('Press again to exit'));
					$timeout(function() {
						shownExitMessage = false;
					}, 2000);
				}
			} else {
				if (currentState.to.indexOf(currentState.from) != -1)
					$deepStateRedirect.reset(currentState.from);
				$state.go(currentState.from, currentState.fromParams);
			}
		}
	}
	
	document.addEventListener('backbutton', function() {
		back();
	}, false);

	document.addEventListener('keydown', function(e) {
		if (e.which == 37) back();
	}, false);
	
	root.back = back;
	root.arrHistory = arrHistory;
	return root;
});